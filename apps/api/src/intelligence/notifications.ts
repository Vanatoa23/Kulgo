import { createHash, createHmac } from "node:crypto";
import type {
  AnonymizedPartnerRegionAlert,
  FacilitySignalMatch,
  LaneSignalMatch,
} from "@kulgo/engine";
import type { RiskSignal } from "@kulgo/shared";
import type { AlertRepository } from "./alert-repository.js";
import {
  deliverSafeWebhook,
  type WebhookDnsLookup,
} from "./webhook-security.js";

export interface OutboundEmailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmailMessage): Promise<void>;
}

export function createResendEmailProvider(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): EmailProvider {
  return {
    name: "resend",
    async send(message) {
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend HTTP ${res.status}`);
      }
    },
  };
}

export function createBrevoEmailProvider(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): EmailProvider {
  return {
    name: "brevo",
    async send(message) {
      const res = await fetchFn("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          sender: { email: message.from, name: "Kulgo Risk Monitor" },
          to: message.to.map((email) => ({ email })),
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
      });
      if (!res.ok) {
        throw new Error(`Brevo HTTP ${res.status}`);
      }
    },
  };
}

export class InMemoryCaptureEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: OutboundEmailMessage[] = [];

  async send(message: OutboundEmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export function signWebhookPayload(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export interface WebhookAlertPayload {
  event: "kulgo.risk_signal.red";
  orgId: string;
  signalId: string;
  kind: RiskSignal["kind"];
  severity: RiskSignal["severity"];
  verificationStatus: RiskSignal["verificationStatus"];
  title: string;
  description: string | null;
  affectedTier1FacilityIds: string[];
  affectedTier1LaneIds: string[];
  anonymizedPartnerRegions: Array<{
    countryCode: string | null;
    regionCode: string | null;
    matchedChokepoints: string[];
  }>;
  sourceUrls: string[];
  sentAt: string;
}

export interface OrgSignalMatchBundle {
  orgId: string;
  signal: RiskSignal;
  facilityMatches: FacilitySignalMatch[];
  laneMatches: LaneSignalMatch[];
  partnerRegionAlerts: AnonymizedPartnerRegionAlert[];
}

export interface AlertDispatchDeps {
  alertRepo: AlertRepository;
  redEmailProvider?: EmailProvider | null;
  digestEmailProvider?: EmailProvider | null;
  fromEmail: string;
  fetchFn?: typeof fetch;
  webhookDnsLookup?: WebhookDnsLookup;
  webhookTimeoutMs?: number;
  nowIso?: string;
}

export interface DispatchSummary {
  emailsSent: number;
  webhooksSent: number;
  skippedDuplicate: number;
  skippedUnverified: number;
  skippedMuted: number;
}

/**
 * Anti-fatigue dispatcher for instant RED alerts:
 * - Only dispatches CONFIRMED or CORROBORATED RED signals (never ALLEGED rumours)
 * - Respects org mute settings (`OrgAlertAck.status === "MUTED"`)
 * - Strictly deduplicates per `(orgId, signalId, channel)` in `AlertDeliveryLog`
 * - Enforces PRIVACY_CONTRACT.md: zero Tier-2+ partner names, IDs, or coordinates
 */
export async function dispatchInstantRedAlerts(
  bundles: readonly OrgSignalMatchBundle[],
  deps: AlertDispatchDeps,
): Promise<DispatchSummary> {
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const summary: DispatchSummary = {
    emailsSent: 0,
    webhooksSent: 0,
    skippedDuplicate: 0,
    skippedUnverified: 0,
    skippedMuted: 0,
  };

  for (const bundle of bundles) {
    const { orgId, signal } = bundle;
    if (signal.severity !== "RED") continue;
    if (
      signal.verificationStatus !== "CONFIRMED" &&
      signal.verificationStatus !== "CORROBORATED"
    ) {
      summary.skippedUnverified++;
      continue;
    }

    const [storedPref, acks] = await Promise.all([
      deps.alertRepo.getNotificationPreference(orgId),
      deps.alertRepo.listAlertAcks(orgId),
    ]);

    const isMuted = acks.some(
      (a) => a.signalId === signal.signalId && a.status === "MUTED",
    );
    if (isMuted) {
      summary.skippedMuted++;
      continue;
    }

    const tier1FacilityIds = Array.from(
      new Set(bundle.facilityMatches.map((m) => m.facilityId)),
    );
    const tier1LaneIds = Array.from(
      new Set(bundle.laneMatches.map((m) => m.laneId)),
    );
    const anonymizedPartnerRegions = bundle.partnerRegionAlerts.map((a) => ({
      countryCode: a.countryCode,
      regionCode: a.regionCode,
      matchedChokepoints: a.matchedChokepoints,
    }));

    // 1. Instant RED Email (atomic outbox claim before provider call)
    if (
      storedPref.preference.instantRedEmailEnabled &&
      storedPref.preference.emailRecipients.length > 0 &&
      deps.redEmailProvider
    ) {
      const claimed = await deps.alertRepo.claimDelivery({
        orgId,
        signalId: signal.signalId,
        channel: "EMAIL_RED",
        provider: deps.redEmailProvider.name,
        claimedAt: nowIso,
      });
      if (!claimed) {
        summary.skippedDuplicate++;
      } else {
        const subject = `[Kulgo RED Alert] ${signal.title}`;
        const lines = [
          `Critical supply chain disruption detected (${signal.verificationStatus}):`,
          `Title: ${signal.title}`,
          `Category: ${signal.kind}`,
          signal.description ? `Details: ${signal.description}` : null,
          tier1FacilityIds.length > 0
            ? `Affected Tier-1 facilities: ${tier1FacilityIds.length}`
            : null,
          tier1LaneIds.length > 0
            ? `Affected transport lanes: ${tier1LaneIds.length}`
            : null,
          anonymizedPartnerRegions.length > 0
            ? `Anonymized upstream partner exposure regions: ${anonymizedPartnerRegions.map((r) => r.countryCode ?? r.regionCode ?? "Regional").join(", ")}`
            : null,
          signal.sourceUrls.length > 0
            ? `Sources: ${signal.sourceUrls.join(", ")}`
            : null,
        ].filter((line): line is string => line !== null);

        try {
          await deps.redEmailProvider.send({
            idempotencyKey: createHash("sha256").update(JSON.stringify([orgId, signal.signalId, "EMAIL_RED"])).digest("hex"),
            from: deps.fromEmail,
            to: storedPref.preference.emailRecipients,
            subject,
            text: lines.join("\n"),
            html: `<p>${lines.map((l) => l.replace(/</g, "&lt;")).join("<br/>")}</p>`,
          });
          await deps.alertRepo.recordDelivery({
            orgId,
            signalId: signal.signalId,
            channel: "EMAIL_RED",
            status: "SENT",
            provider: deps.redEmailProvider.name,
            errorMessage: null,
            deliveredAt: nowIso,
            claimTimestamp: nowIso,
          });
          summary.emailsSent++;
        } catch (err) {
          await deps.alertRepo.recordDelivery({
            orgId,
            signalId: signal.signalId,
            channel: "EMAIL_RED",
            status: "FAILED",
            provider: deps.redEmailProvider.name,
            errorMessage: err instanceof Error ? err.message : String(err),
            deliveredAt: nowIso,
            claimTimestamp: nowIso,
          });
        }
      }
    }

    // 2. Signed Webhook (atomic outbox claim before network call)
    if (storedPref.preference.webhookUrl) {
      const claimed = await deps.alertRepo.claimDelivery({
        orgId,
        signalId: signal.signalId,
        channel: "WEBHOOK",
        provider: "webhook",
        claimedAt: nowIso,
      });
      if (!claimed) {
        summary.skippedDuplicate++;
      } else {
        const payloadObj: WebhookAlertPayload = {
          event: "kulgo.risk_signal.red",
          orgId,
          signalId: signal.signalId,
          kind: signal.kind,
          severity: signal.severity,
          verificationStatus: signal.verificationStatus,
          title: signal.title,
          description: signal.description,
          affectedTier1FacilityIds: tier1FacilityIds,
          affectedTier1LaneIds: tier1LaneIds,
          anonymizedPartnerRegions,
          sourceUrls: signal.sourceUrls,
          sentAt: nowIso,
        };
        const body = JSON.stringify(payloadObj);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Kulgo-Event": "kulgo.risk_signal.red",
          "Idempotency-Key": createHash("sha256").update(JSON.stringify([orgId, signal.signalId, "WEBHOOK"])).digest("hex"),
        };
        if (storedPref.webhookSecret) {
          headers["X-Kulgo-Signature-256"] = signWebhookPayload(
            body,
            storedPref.webhookSecret,
          );
        }
        try {
          await deliverSafeWebhook({
            url: storedPref.preference.webhookUrl,
            headers,
            body,
            fetchFn: deps.fetchFn,
            dnsLookup: deps.webhookDnsLookup,
            timeoutMs: deps.webhookTimeoutMs,
          });
          await deps.alertRepo.recordDelivery({
            orgId,
            signalId: signal.signalId,
            channel: "WEBHOOK",
            status: "SENT",
            provider: "webhook",
            errorMessage: null,
            deliveredAt: nowIso,
            claimTimestamp: nowIso,
          });
          summary.webhooksSent++;
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : String(err);
          await deps.alertRepo.recordDelivery({
            orgId,
            signalId: signal.signalId,
            channel: "WEBHOOK",
            status: "FAILED",
            provider: "webhook",
            errorMessage: rawMessage.slice(0, 500),
            deliveredAt: nowIso,
            claimTimestamp: nowIso,
          });
        }
      }
    }
  }

  return summary;
}
