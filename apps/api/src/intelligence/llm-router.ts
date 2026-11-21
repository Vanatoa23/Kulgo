import type { z } from "zod";

export type LlmProviderName = "gemini" | "groq" | "openai" | "openrouter" | string;

export interface LlmJsonCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}

export interface LlmProviderAdapter {
  readonly name: LlmProviderName;
  readonly model: string;
  completeJson(req: LlmJsonCompletionRequest): Promise<string>;
}

export interface LlmRouterResult<T> {
  data: T;
  provider: LlmProviderName;
  model: string;
  attempts: Array<{ provider: LlmProviderName; error?: string }>;
}

export interface LlmRouterConfig {
  geminiApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  fetchFn?: typeof fetch;
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : trimmed;
}

export function createGeminiAdapter(
  apiKey: string,
  model = "gemini-2.5-flash-lite",
  fetchFn: typeof fetch = fetch,
): LlmProviderAdapter {
  return {
    name: "gemini",
    model,
    async completeJson({ systemPrompt, userPrompt, timeoutMs = 12_000 }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            }),
          },
        );
        if (!res.ok) {
          throw new Error(`Gemini HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Gemini returned empty content");
        }
        return text;
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
    async completeJson({ systemPrompt, userPrompt, timeoutMs = 12_000 }) {
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
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (!res.ok) {
          throw new Error(`${options.name} HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = json.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error(`${options.name} returned empty content`);
        }
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Provider-agnostic AI API Centre with ordered circuit-breaker fallback.
 * Default priority: Gemini (free tier) -> Groq (free tier) -> OpenAI -> OpenRouter.
 */
export class LlmRouter {
  constructor(private readonly providers: readonly LlmProviderAdapter[]) {}

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

    return new LlmRouter(providers);
  }

  get configuredProviders(): LlmProviderName[] {
    return this.providers.map((p) => p.name);
  }

  async generateStructured<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    req: LlmJsonCompletionRequest,
  ): Promise<LlmRouterResult<T>> {
    if (this.providers.length === 0) {
      throw new Error("No LLM providers configured in AI API Centre");
    }

    const attempts: Array<{ provider: LlmProviderName; error?: string }> = [];

    for (const provider of this.providers) {
      try {
        const raw = await provider.completeJson(req);
        const parsedJson: unknown = JSON.parse(stripMarkdownFences(raw));
        const validated = schema.parse(parsedJson);
        attempts.push({ provider: provider.name });
        return {
          data: validated,
          provider: provider.name,
          model: provider.model,
          attempts,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({ provider: provider.name, error: message });
      }
    }

    const summary = attempts
      .map((a) => `${a.provider}: ${a.error ?? "unknown"}`)
      .join("; ");
    throw new Error(`All AI API Centre providers failed (${summary})`);
  }
}
