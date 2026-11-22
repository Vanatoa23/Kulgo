export type QueryLanguage = "sql" | "cypher";

export interface ArcadeDbConfig {
  url: string;
  database: string;
  user: string;
  password: string;
  queryTimeoutMs?: number;
}

export interface ArcadeDbHealth {
  connected: boolean;
  latencyMs: number | null;
}

export interface ArcadeDbClient {
  /** The callback must contain only database work: it can be retried on conflicts. */
  transaction?<T>(work: (db: ArcadeDbClient) => Promise<T>): Promise<T>;
  healthCheck(): Promise<ArcadeDbHealth>;
  ensureDatabase(): Promise<void>;
  query<T = Record<string, unknown>>(
    language: QueryLanguage,
    statement: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
  command<T = Record<string, unknown>>(
    language: QueryLanguage,
    statement: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
}

const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

class ArcadeDbRequestError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`ArcadeDB request error (${status}): ${detail}`);
  }

  get isConflict(): boolean {
    // Retry only explicit database concurrency failures, never a transport error
    // or a timeout whose commit outcome could be unknown.
    return /(?:ConcurrentModificationException|NeedRetryException|DuplicatedKeyException)/.test(this.detail);
  }
}

/**
 * Hardened ArcadeDB HTTP/JSON client.
 * - Uses exclusively parameterized queries to prevent SQL/Cypher injection.
 * - Connects strictly to the internal ArcadeDB HTTP endpoint (never exposed to browsers).
 */
export class HttpArcadeDbClient implements ArcadeDbClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly database: string;
  private readonly queryTimeoutMs: number;

  constructor(config: ArcadeDbConfig) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.database = config.database;
    this.queryTimeoutMs = config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    const credentials = Buffer.from(
      `${config.user}:${config.password}`,
      "utf8",
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  async healthCheck(): Promise<ArcadeDbHealth> {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/ready`, {
        method: "GET",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) {
        return { connected: false, latencyMs: null };
      }
      return {
        connected: true,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch {
      return { connected: false, latencyMs: null };
    }
  }

  async ensureDatabase(): Promise<void> {
    const existsRes = await fetch(
      `${this.baseUrl}/api/v1/exists/${encodeURIComponent(this.database)}`,
      {
        method: "GET",
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(this.queryTimeoutMs),
      },
    );
    if (!existsRes.ok) {
      throw new Error(
        `ArcadeDB exists check failed with HTTP ${existsRes.status}`,
      );
    }
    const existsPayload = (await existsRes.json()) as { result?: boolean };
    if (existsPayload.result) return;

    const createRes = await fetch(`${this.baseUrl}/api/v1/server`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: `create database ${this.database}`,
      }),
      signal: AbortSignal.timeout(this.queryTimeoutMs),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(
        `ArcadeDB create database failed (${createRes.status}): ${body}`,
      );
    }
  }

  async query<T = Record<string, unknown>>(
    language: QueryLanguage,
    statement: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    return this.execute<T>("query", language, statement, params);
  }

  async command<T = Record<string, unknown>>(
    language: QueryLanguage,
    statement: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    return this.execute<T>("command", language, statement, params);
  }

  async transaction<T>(work: (db: ArcadeDbClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const begin = await this.sessionRequest("begin");
      const sessionId = begin.headers.get("arcadedb-session-id");
      if (!sessionId) throw new Error("ArcadeDB did not return a transaction session");
      const scoped: ArcadeDbClient = {
        healthCheck: () => this.healthCheck(),
        ensureDatabase: async () => { throw new Error("Schema changes are not allowed in a transaction"); },
        query: (language, statement, params = {}) => this.execute("query", language, statement, params, sessionId),
        command: (language, statement, params = {}) => this.execute("command", language, statement, params, sessionId),
      };
      try {
        const result = await work(scoped);
        await this.sessionRequest("commit", sessionId);
        return result;
      } catch (error) {
        // A failed command/commit may already have closed the session. Rollback
        // is idempotent; preserve the original failure if cleanup also fails.
        await this.sessionRequest("rollback", sessionId).catch(() => undefined);
        if (!(error instanceof ArcadeDbRequestError) || !error.isConflict || attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 20));
      }
    }
  }

  private async sessionRequest(action: "begin" | "commit" | "rollback", sessionId?: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/v1/${action}/${encodeURIComponent(this.database)}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...(sessionId ? { "arcadedb-session-id": sessionId } : {}),
      },
      ...(action === "begin" ? { body: JSON.stringify({ isolationLevel: "REPEATABLE_READ" }) } : {}),
      signal: AbortSignal.timeout(this.queryTimeoutMs),
    });
    if (!response.ok) throw new ArcadeDbRequestError(response.status, await response.text());
    return response;
  }

  private async execute<T>(
    endpoint: "query" | "command",
    language: QueryLanguage,
    statement: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/${endpoint}/${encodeURIComponent(this.database)}`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          ...(sessionId ? { "arcadedb-session-id": sessionId } : {}),
        },
        body: JSON.stringify({
          language,
          command: statement,
          params,
        }),
        signal: AbortSignal.timeout(this.queryTimeoutMs),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new ArcadeDbRequestError(res.status, text);
    }
    const json = (await res.json()) as { result?: T[] };
    return json.result ?? [];
  }
}
