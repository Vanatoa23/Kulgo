import { serve } from "@hono/node-server";
import { ArcadeDbRiskSignalRepository } from "./analytics/risk-signals.js";
import { createApp } from "./app.js";
import { ArcadeDbAuthRepository } from "./auth/repository.js";
import { loadConfig } from "./config.js";
import { HttpArcadeDbClient } from "./db/client.js";
import { bootstrapSchema } from "./db/schema.js";
import { ArcadeDbAlertRepository } from "./intelligence/alert-repository.js";
import { LlmRouter } from "./intelligence/llm-router.js";
import {
  createBrevoEmailProvider,
  createResendEmailProvider,
} from "./intelligence/notifications.js";
import { IntelligenceRunner } from "./intelligence/runner.js";
import { startIntelligenceScheduler } from "./intelligence/scheduler.js";
import { ArcadeDbInvitationRepository } from "./invites/repository.js";
import { ArcadeDbWorkspaceRepository } from "./workspace/repository.js";

const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function startServer() {
  const config = loadConfig();
  const db = new HttpArcadeDbClient({
    url: config.ARCADEDB_URL,
    database: config.ARCADEDB_DATABASE,
    user: config.ARCADEDB_USER,
    password: config.ARCADEDB_PASSWORD,
  });

  await bootstrapSchema(db);

  const authRepo = new ArcadeDbAuthRepository(db);
  const workspaceRepo = new ArcadeDbWorkspaceRepository(db);
  const riskSignalRepo = new ArcadeDbRiskSignalRepository(db);
  const inviteRepo = new ArcadeDbInvitationRepository(db, {
    authRepo,
    workspaceRepo,
  });
  const alertRepo = new ArcadeDbAlertRepository(db);
  const intelligenceRunner = new IntelligenceRunner({
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
  });

  await authRepo.deleteExpiredSessions(new Date().toISOString());

  setInterval(() => {
    void authRepo
      .deleteExpiredSessions(new Date().toISOString())
      .catch((err) => {
        console.error("[kulgo-api] Failed to prune expired sessions:", err);
      });
  }, SESSION_CLEANUP_INTERVAL_MS).unref();

  if (config.INTELLIGENCE_SWEEP_ENABLED) {
    startIntelligenceScheduler(async () => {
      const orgRows = await db.query<{ orgId: string }>(
        "sql",
        "SELECT orgId FROM Organization",
      );
      const result = await intelligenceRunner.runSweep({
        orgIds: orgRows.map((r) => r.orgId),
      });
      console.log(
        `[kulgo-intelligence] Sweep complete: new=${result.upsertedNew} merged=${result.upsertedMerged} resolved=${result.resolvedExpired} emails=${result.dispatch.emailsSent} webhooks=${result.dispatch.webhooksSent}`,
      );
    });
    console.log(
      "[kulgo-intelligence] 3x daily UTC sweep scheduler active (06:00, 12:00, 17:00 UTC)",
    );
  }

  const app = createApp({
    config,
    db,
    authRepo,
    workspaceRepo,
    riskSignalRepo,
    inviteRepo,
    alertRepo,
    intelligenceRunner,
  });

  serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      console.log(`[kulgo-api] Listening on http://127.0.0.1:${info.port}`);
    },
  );
}

startServer().catch((err) => {
  console.error("[kulgo-api] Failed to start server:", err);
  process.exit(1);
});
