import { z } from "zod";

export const DEFAULT_SESSION_SECRET =
  "kulgo-dev-session-secret-change-in-prod";
export const DEFAULT_ARCADEDB_PASSWORD = "kulgo-dev-password-change-me";

const WEAK_SECRET_PATTERNS = [
  "change-in-prod",
  "change-me",
  "kulgo-dev",
  "ci-test-password",
  "default",
  "secret",
  "password",
  "123456",
  "qwerty",
];

function isWeakProductionSecret(value: string, minLength: number): boolean {
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (WEAK_SECRET_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return true;
  }
  // Reject trivial single-character or ultra-low-entropy values
  const uniqueChars = new Set(trimmed);
  if (uniqueChars.size < 6) {
    return true;
  }
  return false;
}

const optionalIntegrationKey = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const RawEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16).default(DEFAULT_SESSION_SECRET),
  ARCADEDB_URL: z.string().url().default("http://127.0.0.1:2480"),
  ARCADEDB_DATABASE: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default("kulgo"),
  ARCADEDB_USER: z.string().min(1).default("root"),
  ARCADEDB_PASSWORD: z.string().min(1).default(DEFAULT_ARCADEDB_PASSWORD),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(0).optional(),
  RATE_LIMIT_IMPORT_MAX: z.coerce.number().int().min(0).optional(),
  MAX_JSON_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(1_048_576),
  MAX_IMPORT_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5_242_880),
  // --- Live Disruption Monitoring & AI API Centre (all optional for €0 MVP / test) ---
  INTELLIGENCE_SWEEP_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  GEMINI_API_KEY: optionalIntegrationKey,
  GROQ_API_KEY: optionalIntegrationKey,
  OPENAI_API_KEY: optionalIntegrationKey,
  OPENROUTER_API_KEY: optionalIntegrationKey,
  RESEND_API_KEY: optionalIntegrationKey,
  BREVO_API_KEY: optionalIntegrationKey,
  ALERT_FROM_EMAIL: z.string().email().default("alerts@kulgo.eu"),
});

const EnvSchema = RawEnvSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === "production") {
    if (
      data.SESSION_SECRET === DEFAULT_SESSION_SECRET ||
      isWeakProductionSecret(data.SESSION_SECRET, 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_SECRET"],
        message:
          "SESSION_SECRET must be a strong, non-default secret (at least 32 characters) in production",
      });
    }
    if (
      data.ARCADEDB_PASSWORD === DEFAULT_ARCADEDB_PASSWORD ||
      isWeakProductionSecret(data.ARCADEDB_PASSWORD, 12)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ARCADEDB_PASSWORD"],
        message:
          "ARCADEDB_PASSWORD must be a strong, non-default password (at least 12 characters) in production",
      });
    }
  }
}).transform((data) => ({
  ...data,
  // Disabled by default in NODE_ENV=test so test suites are never throttled
  // unless explicitly configured via env or createTestApp overrides.
  RATE_LIMIT_AUTH_MAX:
    data.RATE_LIMIT_AUTH_MAX ?? (data.NODE_ENV === "test" ? 0 : 20),
  RATE_LIMIT_IMPORT_MAX:
    data.RATE_LIMIT_IMPORT_MAX ?? (data.NODE_ENV === "test" ? 0 : 10),
}));

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
