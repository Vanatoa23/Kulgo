import {
  AlertNotificationPreferenceSchema,
  ChokepointCodeSchema,
  AlertAckReasonSchema,
  OrgAlertAckSchema,
  RiskSignalKindSchema,
  RiskSignalSchema,
  RiskStatusSchema,
  TRAINING_VAULT_SCHEMA_VERSION,
  toUtcDayBucket,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { RiskSignalRepository } from "../analytics/risk-signals.js";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import type { AlertRepository } from "./alert-repository.js";
import type { IntelligenceRunner } from "./runner.js";
import {
  generateBatchId,
  safeWriteVaultBatch,
  type TrainingVaultSink,
} from "./training-vault.js";
import {
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  MAX_WEBHOOK_URL_LENGTH,
  validateWebhookDestination,
  type WebhookDnsLookup,
} from "./webhook-security.js";

const AckAlertRequestSchema = z
  .object({
    status: z.enum(["ACKNOWLEDGED", "MUTED"]),
    reason: AlertAckReasonSchema.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const UpdateNotificationPreferenceRequestSchema = z
  .object({
    instantRedEmailEnabled: z.boolean().optional(),
    dailyAmberDigestEnabled: z.boolean().optional(),
    emailRecipients: z.array(z.string().email()).max(20).optional(),
    webhookUrl: z
      .string()
      .trim()
      .max(MAX_WEBHOOK_URL_LENGTH)
      .url()
      .nullable()
      .optional(),
    webhookSecret: z.string().min(16).max(256).nullable().optional(),
    allowAnonymizedTraining: z.boolean().optional(),
  })
  .strict();

const LiveAlertFeedResponseSchema = z
  .object({
    signals: z.array(RiskSignalSchema),
    facilityMatches: z.array(
      z
        .object({
          facilityId: z.string().min(1),
          signalId: z.string().min(1),
          matchType: z.enum(["POLYGON", "COUNTRY", "REGION"]),
          severity: RiskStatusSchema,
        })
        .strict(),
    ),
    laneMatches: z.array(
      z
        .object({
          laneId: z.string().min(1),
          signalId: z.string().min(1),
          matchedChokepoints: z.array(ChokepointCodeSchema),
          severity: RiskStatusSchema,
        })
        .strict(),
    ),
    partnerRegionAlerts: z.array(
      z
        .object({
          signalId: z.string().min(1),
          kind: RiskSignalKindSchema,
          severity: RiskStatusSchema,
          title: z.string().min(1),
          countryCode: z.string().length(2).nullable(),
          regionCode: z.string().nullable(),
          matchedChokepoints: z.array(ChokepointCodeSchema),
        })
        .strict(),
    ),
    acknowledgements: z.array(OrgAlertAckSchema),
  })
  .strict();

export interface AlertRoutesDependencies {
  authRepo: AuthRepository;
  alertRepo: AlertRepository;
  intelligenceRunner: IntelligenceRunner;
  riskSignalRepo?: RiskSignalRepository;
  trainingVault?: TrainingVaultSink;
  webhookDnsLookup?: WebhookDnsLookup;
  webhookValidationTimeoutMs?: number;
}

export function createAlertRoutes({
  authRepo,
  alertRepo,
  intelligenceRunner,
  riskSignalRepo,
  trainingVault,
  webhookDnsLookup,
  webhookValidationTimeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS,
}: AlertRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  routes.get("/feed", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const [feed, acknowledgements] = await Promise.all([
      intelligenceRunner.evaluateOrgAlertFeed(orgId),
      alertRepo.listAlertAcks(orgId),
    ]);

    return c.json(
      LiveAlertFeedResponseSchema.parse({
        signals: feed.signals,
        facilityMatches: feed.facilityMatches,
        laneMatches: feed.laneMatches,
        partnerRegionAlerts: feed.partnerRegionAlerts,
        acknowledgements,
      }),
      200,
    );
  });

  routes.post("/:signalId/ack", async (c) => {
    const auth = c.get("auth");
    const signalId = c.req.param("signalId")?.trim();
    if (!signalId) {
      return c.json({ error: "signalId is required" }, 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = AckAlertRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        400,
      );
    }

    const acknowledgedAt = new Date().toISOString();
    const ack = await alertRepo.upsertAlertAck({
      orgId: auth.organization.orgId,
      signalId,
      status: parsed.data.status,
      acknowledgedByUserId: auth.user.userId,
      reason: parsed.data.reason ?? null,
      note: parsed.data.note ?? null,
      acknowledgedAt,
    });

    // Plane B anonymized operational feedback archival (strictly gated by per-org opt-out).
    if (trainingVault && ack.reason) {
      const storedPref = await alertRepo.getNotificationPreference(
        auth.organization.orgId,
      );
      if (storedPref.preference.allowAnonymizedTraining) {
        let eventCategory: string | null = null;
        let severity: string | null = null;
        let countryCode: string | null = null;
        if (riskSignalRepo) {
          const activeSignals = await riskSignalRepo.listActive();
          const matched = activeSignals.find((s) => s.signalId === signalId);
          if (matched) {
            eventCategory = matched.kind;
            severity = matched.severity;
            countryCode = matched.affectedCountryCodes[0] ?? null;
          }
        }
        await safeWriteVaultBatch(
          trainingVault,
          "anonymized_alert_feedback",
          [
            {
              schemaVersion: TRAINING_VAULT_SCHEMA_VERSION,
              plane: "anonymized_outcomes",
              labelProvenance: "HUMAN_VERIFIED",
              signalId: ack.signalId,
              reasonCode: ack.reason,
              eventCategory,
              severity,
              countryCode,
              timestampBucket: toUtcDayBucket(ack.acknowledgedAt),
            },
          ],
          { batchId: generateBatchId("fb") },
        );
      }
    }

    return c.json(OrgAlertAckSchema.parse(ack), 200);
  });

  routes.get("/preferences", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const stored = await alertRepo.getNotificationPreference(orgId);
    return c.json(
      AlertNotificationPreferenceSchema.parse(stored.preference),
      200,
    );
  });

  routes.patch("/preferences", async (c) => {
    const auth = c.get("auth");
    if (auth.user.role !== "OWNER") {
      return c.json(
        { error: "Only organization owners can update alert preferences" },
        403,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = UpdateNotificationPreferenceRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        400,
      );
    }

    if (parsed.data.webhookUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, webhookValidationTimeoutMs);
      try {
        await validateWebhookDestination(parsed.data.webhookUrl, {
          dnsLookup: webhookDnsLookup,
          signal: controller.signal,
        });
      } catch (err) {
        return c.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "Webhook URL destination is not allowed",
          },
          400,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    const stored = await alertRepo.upsertNotificationPreference({
      orgId: auth.organization.orgId,
      ...parsed.data,
    });

    return c.json(
      AlertNotificationPreferenceSchema.parse(stored.preference),
      200,
    );
  });

  routes.post("/sweep", async (c) => {
    const auth = c.get("auth");
    if (auth.user.role !== "OWNER") {
      return c.json(
        { error: "Only organization owners can trigger a manual sweep" },
        403,
      );
    }

    const result = await intelligenceRunner.runSweep({
      orgIds: [auth.organization.orgId],
    });
    return c.json(result, 200);
  });

  return routes;
}
