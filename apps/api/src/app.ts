import { HealthResponseSchema } from "@kulgo/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createPartnerHiddenSummaryResolver } from "./analytics/partner-resolver.js";
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
  KulgoDirectoryRepository,
  type DirectoryRepository,
} from "./directory/repository.js";
import { createDirectoryRoutes } from "./directory/routes.js";
import {
  ArcadeDbInvitationRepository,
  InMemoryInvitationRepository,
  type InvitationRepository,
} from "./invites/repository.js";
import { createInviteRoutes } from "./invites/routes.js";
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
  inviteRepo?: InvitationRepository;
  directoryRepo?: DirectoryRepository;
  analyticsRepo?: AnalyticsRepository;
}

export function createApp({
  config,
  db,
  authRepo = new ArcadeDbAuthRepository(db),
  workspaceRepo = new ArcadeDbWorkspaceRepository(db),
  riskSignalRepo = new ArcadeDbRiskSignalRepository(db),
  inviteRepo = new ArcadeDbInvitationRepository(db, {
    authRepo,
    workspaceRepo,
  }),
  directoryRepo = new KulgoDirectoryRepository({
    authRepo,
    riskSignalRepo,
  }),
  analyticsRepo = new OrgScopedAnalyticsRepository({
    authRepo,
    workspaceRepo,
    riskSignalRepo,
    resolvePartnerHiddenSummaries: createPartnerHiddenSummaryResolver({
      authRepo,
      workspaceRepo,
      riskSignalRepo,
      inviteRepo,
    }),
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
  app.route(
    "/api/v1/invites",
    createInviteRoutes({ authRepo, inviteRepo, config }),
  );
  app.route(
    "/api/v1/directory",
    createDirectoryRoutes({ authRepo, directoryRepo }),
  );

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("[kulgo-api] Unhandled error:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}

/**
 * Creates an isolated Hono app backed by InMemory repositories,
 * OrgScopedAnalyticsRepository with partner hidden summary resolution,
 * KulgoDirectoryRepository, and a healthy mock ArcadeDbClient
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
  const inviteRepo = new InMemoryInvitationRepository({
    authRepo,
    workspaceRepo,
  });
  const directoryRepo = new KulgoDirectoryRepository({
    authRepo,
    riskSignalRepo,
  });
  const analyticsRepo = new OrgScopedAnalyticsRepository({
    authRepo,
    workspaceRepo,
    riskSignalRepo,
    resolvePartnerHiddenSummaries: createPartnerHiddenSummaryResolver({
      authRepo,
      workspaceRepo,
      riskSignalRepo,
      inviteRepo,
    }),
  });

  return createApp({
    config,
    db: mockDb,
    authRepo,
    workspaceRepo,
    riskSignalRepo,
    inviteRepo,
    directoryRepo,
    analyticsRepo,
  });
}
