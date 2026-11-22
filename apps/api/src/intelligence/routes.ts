import {
  AlertNotificationPreferenceSchema,
  ChokepointCodeSchema,
  OrgAlertAckSchema,
  RiskSignalKindSchema,
  RiskSignalSchema,
  RiskStatusSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import type { AlertRepository } from "./alert-repository.js";
import type { IntelligenceRunner } from "./runner.js";
import {
  MAX_WEBHOOK_URL_LENGTH,
  validateWebhookDestination,
  type WebhookDnsLookup,
} from "./webhook-security.js";

const AckAlertRequestSchema = z
  .object({
    status: z.enum(["ACKNOWLEDGED", "MUTED"]),
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
  webhookDnsLookup?: WebhookDnsLookup;
}

export function createAlertRoutes({
  authRepo,
  alertRepo,
  intelligenceRunner,
  webhookDnsLookup,
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

    const ack = await alertRepo.upsertAlertAck({
      orgId: auth.organization.orgId,
      signalId,
      status: parsed.data.status,
      acknowledgedByUserId: auth.user.userId,
      note: parsed.data.note ?? null,
      acknowledgedAt: new Date().toISOString(),
    });

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
      try {
        await validateWebhookDestination(parsed.data.webhookUrl, {
          dnsLookup: webhookDnsLookup,
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
