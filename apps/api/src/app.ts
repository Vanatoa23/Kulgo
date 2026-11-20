import { HealthResponseSchema } from "@kulgo/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.js";
import type { ArcadeDbClient } from "./db/client.js";

export interface AppDependencies {
  config: AppConfig;
  db: ArcadeDbClient;
}

export function createApp({ config, db }: AppDependencies): Hono {
  const app = new Hono();

  app.use("*", secureHeaders());
  app.use(
    "/api/*",
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/api/v1/health", async (c) => {
    const dbHealth = await db.healthCheck();
    const payload = HealthResponseSchema.parse({
      status: dbHealth.connected ? "ok" : "degraded",
      service: "kulgo-api",
      version: "0.1.0",
      database: {
        engine: "arcadedb",
        connected: dbHealth.connected,
        latencyMs: dbHealth.latencyMs,
      },
      timestamp: new Date().toISOString(),
    });
    return c.json(payload, dbHealth.connected ? 200 : 503);
  });

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("[kulgo-api] Unhandled error:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
