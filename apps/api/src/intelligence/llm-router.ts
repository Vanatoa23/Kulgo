import type { z } from "zod";

export type LlmProviderName = "gemini" | "groq" | "openai" | "openrouter" | string;

export const DEFAULT_LLM_COOLDOWN_MS = 60_000;
export const DEFAULT_LLM_FAILURE_THRESHOLD = 2;
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 2_048;

export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmDailyUsage extends LlmTokenUsage {
  dateUtc: string;
  requests: number;
}

export interface LlmCompletionOutput {
  text: string;
  usage?: Partial<LlmTokenUsage>;
}

export interface LlmJsonCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export interface LlmProviderAdapter {
  readonly name: LlmProviderName;
  readonly model: string;
  completeJson(
    req: LlmJsonCompletionRequest,
  ): Promise<string | LlmCompletionOutput>;
}

export interface LlmRouterAttempt {
  provider: LlmProviderName;
  model?: string;
  rawText?: string;
  error?: string;
  skippedReason?: string;
}

export interface LlmRouterResult<T> {
  data: T;
  rawText: string;
  provider: LlmProviderName;
  model: string;
  usage: LlmTokenUsage;
  attempts: LlmRouterAttempt[];
}

export class LlmRouterAllFailedError extends Error {
  constructor(
    message: string,
    readonly attempts: readonly LlmRouterAttempt[],
  ) {
    super(message);
    this.name = "LlmRouterAllFailedError";
  }
}

export interface LlmRouterOptions {
  cooldownMs?: number;
  failureThreshold?: number;
  defaultMaxOutputTokens?: number;
  maxDailyRequests?: number;
  maxDailyTokens?: number;
  nowFn?: () => number;
}

export interface LlmRouterConfig extends LlmRouterOptions {
  geminiApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  fetchFn?: typeof fetch;
}

export class LlmProviderHttpError extends Error {
  constructor(
    readonly provider: LlmProviderName,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `${provider} HTTP ${status}`);
    this.name = "LlmProviderHttpError";
  }
}

export class LlmBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmBudgetExceededError";
  }
}

interface ProviderCircuitState {
  consecutiveFailures: number;
  cooldownUntilMs: number;
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : trimmed;
}

function normalizeUsage(usage?: Partial<LlmTokenUsage>): LlmTokenUsage {
  const promptTokens =
    typeof usage?.promptTokens === "number" && Number.isFinite(usage.promptTokens) && usage.promptTokens > 0
      ? Math.trunc(usage.promptTokens)
      : 0;
  const completionTokens =
    typeof usage?.completionTokens === "number" &&
    Number.isFinite(usage.completionTokens) &&
    usage.completionTokens > 0
      ? Math.trunc(usage.completionTokens)
      : 0;
  const totalTokens =
    typeof usage?.totalTokens === "number" &&
    Number.isFinite(usage.totalTokens) &&
    usage.totalTokens > 0
      ? Math.trunc(usage.totalTokens)
      : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function isTransientProviderError(err: unknown): boolean {
  if (err instanceof LlmProviderHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return true;
    }
    return /\b(429|5\d{2})\b|timeout|timed out|abort|econnreset|etimedout|fetch failed/i.test(
      err.message,
    );
  }
  return false;
}

function utcDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function createGeminiAdapter(
  apiKey: string,
  model = "gemini-2.5-flash-lite",
  fetchFn: typeof fetch = fetch,
): LlmProviderAdapter {
  return {
    name: "gemini",
    model,
    async completeJson({
      systemPrompt,
      userPrompt,
      timeoutMs = 12_000,
      maxOutputTokens = DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
                maxOutputTokens,
              },
            }),
          },
        );
        if (!res.ok) {
          throw new LlmProviderHttpError("gemini", res.status, `Gemini HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Gemini returned empty content");
        }
        return {
          text,
          usage: normalizeUsage({
            promptTokens: json.usageMetadata?.promptTokenCount,
            completionTokens: json.usageMetadata?.candidatesTokenCount,
            totalTokens: json.usageMetadata?.totalTokenCount,
          }),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createOpenAiCompatibleAdapter(options: {
  name: LlmProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchFn?: typeof fetch;
}): LlmProviderAdapter {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    name: options.name,
    model: options.model,
    async completeJson({
      systemPrompt,
      userPrompt,
      timeoutMs = 12_000,
      maxOutputTokens = DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: options.model,
            temperature: 0.1,
            max_completion_tokens: maxOutputTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (!res.ok) {
          throw new LlmProviderHttpError(options.name, res.status);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        const text = json.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error(`${options.name} returned empty content`);
        }
        return {
          text,
          usage: normalizeUsage({
            promptTokens: json.usage?.prompt_tokens,
            completionTokens: json.usage?.completion_tokens,
            totalTokens: json.usage?.total_tokens,
          }),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Provider-agnostic AI API Centre with ordered circuit-breaker fallback,
 * per-provider transient-failure cooldowns, and daily request/token accounting.
 * Default priority: Gemini (free tier) -> Groq (free tier) -> OpenAI -> OpenRouter.
 */
export class LlmRouter {
  private readonly cooldownMs: number;
  private readonly failureThreshold: number;
  private readonly defaultMaxOutputTokens: number;
  private readonly maxDailyRequests: number | undefined;
  private readonly maxDailyTokens: number | undefined;
  private readonly nowFn: () => number;
  private readonly circuitStates = new Map<LlmProviderName, ProviderCircuitState>();
  private dailyUsage: LlmDailyUsage;

  constructor(
    private readonly providers: readonly LlmProviderAdapter[],
    options: LlmRouterOptions = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_LLM_COOLDOWN_MS;
    this.failureThreshold = Math.max(
      1,
      options.failureThreshold ?? DEFAULT_LLM_FAILURE_THRESHOLD,
    );
    this.defaultMaxOutputTokens =
      options.defaultMaxOutputTokens ?? DEFAULT_LLM_MAX_OUTPUT_TOKENS;
    this.maxDailyRequests =
      typeof options.maxDailyRequests === "number" && options.maxDailyRequests > 0
        ? options.maxDailyRequests
        : undefined;
    this.maxDailyTokens =
      typeof options.maxDailyTokens === "number" && options.maxDailyTokens > 0
        ? options.maxDailyTokens
        : undefined;
    this.nowFn = options.nowFn ?? Date.now;
    this.dailyUsage = {
      dateUtc: utcDateKey(this.nowFn()),
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }

  static fromConfig(config: LlmRouterConfig): LlmRouter {
    const providers: LlmProviderAdapter[] = [];
    const fetchFn = config.fetchFn ?? fetch;

    if (config.geminiApiKey) {
      providers.push(
        createGeminiAdapter(
          config.geminiApiKey,
          "gemini-2.5-flash-lite",
          fetchFn,
        ),
      );
    }
    if (config.groqApiKey) {
      providers.push(
        createOpenAiCompatibleAdapter({
          name: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: config.groqApiKey,
          model: "llama-3.3-70b-versatile",
          fetchFn,
        }),
      );
    }
    if (config.openaiApiKey) {
      providers.push(
        createOpenAiCompatibleAdapter({
          name: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: config.openaiApiKey,
          model: "gpt-4o-mini",
          fetchFn,
        }),
      );
    }
    if (config.openrouterApiKey) {
      providers.push(
        createOpenAiCompatibleAdapter({
          name: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: config.openrouterApiKey,
          model: "google/gemini-2.5-flash-lite",
          fetchFn,
        }),
      );
    }

    return new LlmRouter(providers, {
      cooldownMs: config.cooldownMs,
      failureThreshold: config.failureThreshold,
      defaultMaxOutputTokens: config.defaultMaxOutputTokens,
      maxDailyRequests: config.maxDailyRequests,
      maxDailyTokens: config.maxDailyTokens,
      nowFn: config.nowFn,
    });
  }

  get configuredProviders(): LlmProviderName[] {
    return this.providers.map((p) => p.name);
  }

  private rollDailyWindowIfNeeded(nowMs: number): void {
    const today = utcDateKey(nowMs);
    if (this.dailyUsage.dateUtc !== today) {
      this.dailyUsage = {
        dateUtc: today,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
    }
  }

  private assertWithinDailyBudget(nowMs: number): void {
    this.rollDailyWindowIfNeeded(nowMs);
    if (
      this.maxDailyRequests !== undefined &&
      this.dailyUsage.requests >= this.maxDailyRequests
    ) {
      throw new LlmBudgetExceededError(
        `Daily LLM request ceiling reached (${this.dailyUsage.requests}/${this.maxDailyRequests})`,
      );
    }
    if (
      this.maxDailyTokens !== undefined &&
      this.dailyUsage.totalTokens >= this.maxDailyTokens
    ) {
      throw new LlmBudgetExceededError(
        `Daily LLM token ceiling reached (${this.dailyUsage.totalTokens}/${this.maxDailyTokens})`,
      );
    }
  }

  getDailyUsage(): LlmDailyUsage {
    this.rollDailyWindowIfNeeded(this.nowFn());
    return { ...this.dailyUsage };
  }

  isProviderInCooldown(providerName: LlmProviderName): boolean {
    const state = this.circuitStates.get(providerName);
    if (!state) return false;
    return this.nowFn() < state.cooldownUntilMs;
  }

  async generateStructured<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    req: LlmJsonCompletionRequest,
  ): Promise<LlmRouterResult<T>> {
    if (this.providers.length === 0) {
      throw new Error("No LLM providers configured in AI API Centre");
    }

    const requestWithDefaults: LlmJsonCompletionRequest = {
      ...req,
      maxOutputTokens: req.maxOutputTokens ?? this.defaultMaxOutputTokens,
    };

    const attempts: LlmRouterAttempt[] = [];

    for (const provider of this.providers) {
      const nowMs = this.nowFn();
      const circuit = this.circuitStates.get(provider.name) ?? {
        consecutiveFailures: 0,
        cooldownUntilMs: 0,
      };

      if (nowMs < circuit.cooldownUntilMs) {
        attempts.push({
          provider: provider.name,
          skippedReason: "cooldown",
        });
        continue;
      }

      this.assertWithinDailyBudget(nowMs);
      this.dailyUsage.requests += 1;

      let capturedRawText: string | undefined;
      try {
        const rawOutput = await provider.completeJson(requestWithDefaults);
        const text =
          typeof rawOutput === "string" ? rawOutput : rawOutput.text;
        capturedRawText = text;
        const usage =
          typeof rawOutput === "string"
            ? normalizeUsage(undefined)
            : normalizeUsage(rawOutput.usage);

        this.rollDailyWindowIfNeeded(this.nowFn());
        this.dailyUsage.promptTokens += usage.promptTokens;
        this.dailyUsage.completionTokens += usage.completionTokens;
        this.dailyUsage.totalTokens += usage.totalTokens;

        const parsedJson: unknown = JSON.parse(stripMarkdownFences(text));
        const validated = schema.parse(parsedJson);

        this.circuitStates.set(provider.name, {
          consecutiveFailures: 0,
          cooldownUntilMs: 0,
        });
        attempts.push({ provider: provider.name, model: provider.model });
        return {
          data: validated,
          rawText: text,
          provider: provider.name,
          model: provider.model,
          usage,
          attempts,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isTransientProviderError(err)) {
          const nextFailures = circuit.consecutiveFailures + 1;
          const cooldownUntilMs =
            nextFailures >= this.failureThreshold
              ? this.nowFn() + this.cooldownMs
              : 0;
          this.circuitStates.set(provider.name, {
            consecutiveFailures: nextFailures,
            cooldownUntilMs,
          });
        }
        attempts.push({
          provider: provider.name,
          model: provider.model,
          ...(capturedRawText !== undefined ? { rawText: capturedRawText } : {}),
          error: message,
        });
      }
    }

    const summary = attempts
      .map(
        (a) =>
          `${a.provider}: ${a.error ?? (a.skippedReason ? `skipped (${a.skippedReason})` : "unknown")}`,
      )
      .join("; ");
    throw new LlmRouterAllFailedError(
      `All AI API Centre providers failed (${summary})`,
      attempts,
    );
  }
}
