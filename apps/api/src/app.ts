import { HealthResponseSchema } from "@kulgo/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import {
  OrgScopedAnalyticsRepository,
  type AnalyticsRepository,
} from "./analytics/repository.js";
import {
  ArcadeDbRiskSignalRepository,
  InMemoryRiskSignalRepository,
  type RiskSignalRepository,
} from "./analytics/risk-signals.js";
import { createAnalyticsRoutes } from "./analytics/routes.js";
import {
  ArcadeDbAuthRepository,
  InMemoryAuthRepository,
  type AuthRepository,
} from "./auth/repository.js";
import { createAuthRoutes } from "./auth/routes.js";
import { loadConfig, type AppConfig } from "./config.js";
import type { ArcadeDbClient } from "./db/client.js";
import {
  ArcadeDbWorkspaceRepository,
  InMemoryWorkspaceRepository,
  type WorkspaceRepository,
} from "./workspace/repository.js";
import { createWorkspaceRoutes } from "./workspace/routes.js";

export interface AppDependencies {
  config: AppConfig;
  db: ArcadeDbClient;
  authRepo?: AuthRepository;
  workspaceRepo?: WorkspaceRepository;
  riskSignalRepo?: RiskSignalRepository;
  analyticsRepo?: AnalyticsRepository;
}

export function createApp({
  config,
  db,
  authRepo = new ArcadeDbAuthRepository(db),
  workspaceRepo = new ArcadeDbWorkspaceRepository(db),
  riskSignalRepo = new ArcadeDbRiskSignalRepository(db),
  analyticsRepo = new OrgScopedAnalyticsRepository({
    authRepo,
    workspaceRepo,
    riskSignalRepo,
  }),
}: AppDependencies): Hono {
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

  app.route("/api/v1/auth", createAuthRoutes({ authRepo, config }));
  app.route(
    "/api/v1/workspace",
    createWorkspaceRoutes({ authRepo, workspaceRepo, riskSignalRepo }),
  );
  app.route(
    "/api/v1/analytics",
    createAnalyticsRoutes({ authRepo, analyticsRepo }),
  );

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("[kulgo-api] Unhandled error:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}

/**
 * Creates an isolated Hono app backed by InMemoryAuthRepository,
 * InMemoryWorkspaceRepository, InMemoryRiskSignalRepository,
 * OrgScopedAnalyticsRepository, and a healthy mock ArcadeDbClient
 * for deterministic zero-Docker unit, privacy, and opaque-box E2E tests.
 */
export function createTestApp(overrides: Partial<AppConfig> = {}): Hono {
  const config: AppConfig = {
    ...loadConfig({ NODE_ENV: "test" }),
    ...overrides,
  };
  const mockDb: ArcadeDbClient = {
    async healthCheck() {
      return { connected: true, latencyMs: 1 };
    },
    async ensureDatabase() {},
    async query() {
      return [];
    },
    async command() {
      return [];
    },
  };

  const authRepo = new InMemoryAuthRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const riskSignalRepo = new InMemoryRiskSignalRepository();
  const analyticsRepo = new OrgScopedAnalyticsRepository({
    authRepo,
    workspaceRepo,
    riskSignalRepo,
  });

  return createApp({
    config,
    db: mockDb,
    authRepo,
    workspaceRepo,
    riskSignalRepo,
    analyticsRepo,
  });
}
