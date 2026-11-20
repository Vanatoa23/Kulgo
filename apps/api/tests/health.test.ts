import { HealthResponseSchema } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { ArcadeDbClient } from "../src/db/client.js";

function createMockDb(connected: boolean): ArcadeDbClient {
  return {
    async healthCheck() {
      return { connected, latencyMs: connected ? 4 : null };
    },
    async ensureDatabase() {},
    async query() {
      return [];
    },
    async command() {
      return [];
    },
  };
}

describe("GET /api/v1/health", () => {
  it("returns 200 ok when ArcadeDB is reachable", async () => {
    const app = createApp({ config: loadConfig({}), db: createMockDb(true) });
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.status).toBe("ok");
    expect(body.database.engine).toBe("arcadedb");
    expect(body.database.connected).toBe(true);
  });

  it("returns 503 degraded when ArcadeDB is unreachable", async () => {
    const app = createApp({ config: loadConfig({}), db: createMockDb(false) });
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(503);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.status).toBe("degraded");
    expect(body.database.connected).toBe(false);
  });
});
