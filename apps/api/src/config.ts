import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("kulgo-dev-session-secret-change-in-prod"),
  ARCADEDB_URL: z.string().url().default("http://127.0.0.1:2480"),
  ARCADEDB_DATABASE: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default("kulgo"),
  ARCADEDB_USER: z.string().min(1).default("root"),
  ARCADEDB_PASSWORD: z
    .string()
    .min(1)
    .default("kulgo-dev-password-change-me"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
