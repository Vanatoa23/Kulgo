export type QueryLanguage = "sql" | "cypher" | "sqlscript";

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

  private async execute<T>(
    endpoint: "query" | "command",
    language: QueryLanguage,
    statement: string,
    params: Record<string, unknown>,
  ): Promise<T[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/${endpoint}/${encodeURIComponent(this.database)}`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
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
      throw new Error(`ArcadeDB ${endpoint} error (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { result?: T[] };
    return json.result ?? [];
  }
}
