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
import { withSessionSecret } from "./auth/middleware.js";
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
  ArcadeDbAlertRepository,
  InMemoryAlertRepository,
  type AlertRepository,
} from "./intelligence/alert-repository.js";
import { LlmRouter } from "./intelligence/llm-router.js";
import {
  createBrevoEmailProvider,
  createResendEmailProvider,
} from "./intelligence/notifications.js";
import { createAlertRoutes } from "./intelligence/routes.js";
import { IntelligenceRunner } from "./intelligence/runner.js";
import type { WebhookDnsLookup } from "./intelligence/webhook-security.js";
import {
  ArcadeDbInvitationRepository,
  InMemoryInvitationRepository,
  type InvitationRepository,
} from "./invites/repository.js";
import { createInviteRoutes } from "./invites/routes.js";
import {
  createBodySizeLimitMiddleware,
  createRateLimiter,
  createRequestLogger,
  type RequestLogEntry,
} from "./middleware/security.js";
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
  alertRepo?: AlertRepository;
  intelligenceRunner?: IntelligenceRunner;
  webhookDnsLookup?: WebhookDnsLookup;
  webhookValidationTimeoutMs?: number;
  onRequestLog?: (entry: RequestLogEntry) => void;
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
  alertRepo = new ArcadeDbAlertRepository(db),
  webhookDnsLookup,
  webhookValidationTimeoutMs,
  intelligenceRunner = new IntelligenceRunner({
    authRepo,
    workspaceRepo,
    inviteRepo,
    riskSignalRepo,
    alertRepo,
    llmRouter: LlmRouter.fromConfig({
      geminiApiKey: config.GEMINI_API_KEY,
      groqApiKey: config.GROQ_API_KEY,
      openaiApiKey: config.OPENAI_API_KEY,
      openrouterApiKey: config.OPENROUTER_API_KEY,
    }),
    redEmailProvider: config.RESEND_API_KEY
      ? createResendEmailProvider(config.RESEND_API_KEY)
      : null,
    digestEmailProvider: config.BREVO_API_KEY
      ? createBrevoEmailProvider(config.BREVO_API_KEY)
      : null,
    fromEmail: config.ALERT_FROM_EMAIL,
    webhookDnsLookup,
  }),
  onRequestLog,
}: AppDependencies): Hono {
  const app = new Hono();

  app.use("*", async (_c, next) =>
    withSessionSecret(config.SESSION_SECRET, next),
  );
  app.use(
    "*",
    createRequestLogger({
      enabled: config.NODE_ENV !== "test",
      onLog: onRequestLog,
    }),
  );
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
  app.use(
    "/api/*",
    createBodySizeLimitMiddleware({
      maxJsonBytes: config.MAX_JSON_BODY_BYTES,
      maxImportBytes: config.MAX_IMPORT_BODY_BYTES,
    }),
  );

  // Lightweight in-memory rate limits on auth & bulk import endpoints
  app.use(
    "/api/v1/auth/login",
    createRateLimiter({
      bucket: "auth:login",
      maxRequests: config.RATE_LIMIT_AUTH_MAX,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
    }),
  );
  app.use(
    "/api/v1/auth/register",
    createRateLimiter({
      bucket: "auth:register",
      maxRequests: config.RATE_LIMIT_AUTH_MAX,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
    }),
  );
  const membersCreateRateLimiter = createRateLimiter({
    bucket: "auth:members",
    maxRequests: config.RATE_LIMIT_AUTH_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
  });
  app.use("/api/v1/auth/members", async (c, next) => {
    if (c.req.method.toUpperCase() === "POST") {
      return membersCreateRateLimiter(c, next);
    }
    await next();
  });
  const inviteAcceptRateLimiter = createRateLimiter({
    bucket: "invites:accept",
    maxRequests: config.RATE_LIMIT_AUTH_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
  });
  app.use("/api/v1/invites/:token/accept", async (c, next) => {
    if (c.req.method.toUpperCase() === "POST") {
      return inviteAcceptRateLimiter(c, next);
    }
    await next();
  });
  app.use(
    "/api/v1/workspace/import",
    createRateLimiter({
      bucket: "workspace:import",
      maxRequests: config.RATE_LIMIT_IMPORT_MAX,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
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
  app.route(
    "/api/v1/alerts",
    createAlertRoutes({
      authRepo,
      alertRepo,
      intelligenceRunner,
      webhookDnsLookup,
      webhookValidationTimeoutMs,
    }),
  );

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("[kulgo-api] Unhandled error:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}

export interface CreateTestAppOptions {
  onRequestLog?: (entry: RequestLogEntry) => void;
  webhookDnsLookup?: WebhookDnsLookup;
  webhookValidationTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_TEST_WEBHOOK_DNS_LOOKUP: WebhookDnsLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];

/**
 * Creates an isolated Hono app backed by InMemory repositories,
 * OrgScopedAnalyticsRepository with partner hidden summary resolution,
 * KulgoDirectoryRepository, and a healthy mock ArcadeDbClient
 * for deterministic zero-Docker unit, privacy, and opaque-box E2E tests.
 */
export function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: CreateTestAppOptions = {},
): Hono {
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
  const alertRepo = new InMemoryAlertRepository();
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
  const webhookDnsLookup =
    options.webhookDnsLookup ?? DEFAULT_TEST_WEBHOOK_DNS_LOOKUP;
  const intelligenceRunner = new IntelligenceRunner({
    authRepo,
    workspaceRepo,
    inviteRepo,
    riskSignalRepo,
    alertRepo,
    llmRouter: new LlmRouter([]),
    fromEmail: config.ALERT_FROM_EMAIL,
    fetchStage1: async () => ({ signals: [], errors: [] }),
    fetchFn: options.fetchFn,
    webhookDnsLookup,
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
    alertRepo,
    intelligenceRunner,
    webhookDnsLookup,
    webhookValidationTimeoutMs: options.webhookValidationTimeoutMs,
    onRequestLog: options.onRequestLog,
  });
}
