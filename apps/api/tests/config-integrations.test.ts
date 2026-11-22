import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const providerKeys = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
  "RESEND_API_KEY", "BREVO_API_KEY",
] as const;

describe("optional integration configuration", () => {
  it("accepts omitted and blank keys, while preserving configured values", () => {
    for (const value of [undefined, "", "   "]) {
      const config = loadConfig(Object.fromEntries(providerKeys.map((key) => [key, value])));
      for (const key of providerKeys) expect(config[key]).toBeUndefined();
    }
    const config = loadConfig(Object.fromEntries(providerKeys.map((key) => [key, `configured-${key}`])));
    for (const key of providerKeys) expect(config[key]).toBe(`configured-${key}`);
  });

  it("loads the supplied production template with required values and no providers", () => {
    const env = parseEnv(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"));
    const config = loadConfig({ ...env, WEB_ORIGIN: "https://example.com", SESSION_SECRET: "aB9!xY7@pQ2#vW4$mN6&cR8*tK3-zF5+", ARCADEDB_PASSWORD: "aB9!xY7@pQ2#" });
    for (const key of providerKeys) expect(config[key]).toBeUndefined();
    expect(config.INTELLIGENCE_SWEEP_ENABLED).toBe(false);
    expect(() => loadConfig({ ...env, WEB_ORIGIN: "https://example.com" })).toThrow();
  });

  it("forwards integration settings in the API Compose environment", () => {
    const compose = readFileSync(new URL("../../../infra/docker-compose.yml", import.meta.url), "utf8");
    const apiEnvironment = compose.split("  api:")[1]?.split("  web:")[0]?.split("    environment:")[1]?.split("    # Bound")[0];
    expect(apiEnvironment).toBeDefined();
    for (const key of providerKeys) expect(apiEnvironment).toContain(`${key}: \${${key}:-}`);
    expect(apiEnvironment).toContain("INTELLIGENCE_SWEEP_ENABLED: ${INTELLIGENCE_SWEEP_ENABLED:-false}");
    expect(apiEnvironment).toContain("ALERT_FROM_EMAIL: ${ALERT_FROM_EMAIL:-alerts@kulgo.eu}");
  });
});
