import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { EmailSuppressionSchema, type EmailSuppression } from "@kulgo/shared";
import type { AuthRepository } from "../auth/repository.js";
import type { ArcadeDbClient } from "../db/client.js";
import type { EmailProvider } from "../intelligence/notifications.js";

export type SuppressionReason = EmailSuppression["reason"];

export function hashEmailForPrivacy(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

export interface EmailSuppressionRepository {
  isSuppressed(email: string): Promise<boolean>;
  suppress(email: string, reason: SuppressionReason): Promise<EmailSuppression>;
  listSuppressions(): Promise<EmailSuppression[]>;
  hasOutreachBeenDispatched(dedupeKey: string): Promise<boolean>;
  recordOutreachDispatch(params: {
    dedupeKey: string;
    fromOrgId: string;
    kind: "SUPPLIER_INVITE" | "INTRO_REQUEST";
    recipientEmailHash: string;
    status: "SENT" | "RECORDED" | "SUPPRESSED" | "RATE_LIMITED";
  }): Promise<void>;
  countRecentDispatches(fromOrgId: string | null, sinceIso: string): Promise<number>;
}

interface OutreachDispatchRecord {
  dedupeKey: string;
  fromOrgId: string;
  kind: "SUPPLIER_INVITE" | "INTRO_REQUEST";
  recipientEmailHash: string;
  status: "SENT" | "RECORDED" | "SUPPRESSED" | "RATE_LIMITED";
  dispatchedAt: string;
}

export class InMemoryEmailSuppressionRepository
  implements EmailSuppressionRepository
{
  private readonly suppressions = new Map<string, EmailSuppression>();
  private readonly dispatches = new Map<string, OutreachDispatchRecord>();

  async isSuppressed(email: string): Promise<boolean> {
    return this.suppressions.has(hashEmailForPrivacy(email));
  }

  async suppress(
    email: string,
    reason: SuppressionReason,
  ): Promise<EmailSuppression> {
    const emailHash = hashEmailForPrivacy(email);
    const existing = this.suppressions.get(emailHash);
    if (existing) {
      return existing;
    }
    const created = EmailSuppressionSchema.parse({
      emailHash,
      reason,
      createdAt: new Date().toISOString(),
    });
    this.suppressions.set(emailHash, created);
    return created;
  }

  async listSuppressions(): Promise<EmailSuppression[]> {
    return Array.from(this.suppressions.values());
  }

  async hasOutreachBeenDispatched(dedupeKey: string): Promise<boolean> {
    return this.dispatches.has(dedupeKey);
  }

  async recordOutreachDispatch(params: {
    dedupeKey: string;
    fromOrgId: string;
    kind: "SUPPLIER_INVITE" | "INTRO_REQUEST";
    recipientEmailHash: string;
    status: "SENT" | "RECORDED" | "SUPPRESSED" | "RATE_LIMITED";
  }): Promise<void> {
    if (!this.dispatches.has(params.dedupeKey)) {
      this.dispatches.set(params.dedupeKey, {
        ...params,
        dispatchedAt: new Date().toISOString(),
      });
    }
  }

  async countRecentDispatches(
    fromOrgId: string | null,
    sinceIso: string,
  ): Promise<number> {
    let count = 0;
    for (const rec of this.dispatches.values()) {
      if (rec.dispatchedAt < sinceIso) continue;
      if (fromOrgId !== null && rec.fromOrgId !== fromOrgId) continue;
      if (rec.status === "SENT" || rec.status === "RECORDED") {
        count += 1;
      }
    }
    return count;
  }
}

export class ArcadeDbEmailSuppressionRepository
  implements EmailSuppressionRepository
{
  constructor(private readonly db: ArcadeDbClient) {}

  async isSuppressed(email: string): Promise<boolean> {
    const emailHash = hashEmailForPrivacy(email);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT emailHash FROM EmailSuppression WHERE emailHash = :emailHash LIMIT 1",
      { emailHash },
    );
    return rows.length > 0;
  }

  async suppress(
    email: string,
    reason: SuppressionReason,
  ): Promise<EmailSuppression> {
    const emailHash = hashEmailForPrivacy(email);
    const existing = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT emailHash, reason, createdAt FROM EmailSuppression WHERE emailHash = :emailHash LIMIT 1",
      { emailHash },
    );
    if (existing[0]) {
      return EmailSuppressionSchema.parse({
        emailHash: String(existing[0].emailHash),
        reason: String(existing[0].reason),
        createdAt: String(existing[0].createdAt),
      });
    }
    const createdAt = new Date().toISOString();
    await this.db.command(
      "sql",
      "CREATE VERTEX EmailSuppression SET emailHash = :emailHash, reason = :reason, createdAt = :createdAt",
      { emailHash, reason, createdAt },
    );
    return EmailSuppressionSchema.parse({ emailHash, reason, createdAt });
  }

  async listSuppressions(): Promise<EmailSuppression[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT emailHash, reason, createdAt FROM EmailSuppression",
    );
    return rows.map((row) =>
      EmailSuppressionSchema.parse({
        emailHash: String(row.emailHash),
        reason: String(row.reason),
        createdAt: String(row.createdAt),
      }),
    );
  }

  async hasOutreachBeenDispatched(dedupeKey: string): Promise<boolean> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT dedupeKey FROM OutreachDispatchLog WHERE dedupeKey = :dedupeKey LIMIT 1",
      { dedupeKey },
    );
    return rows.length > 0;
  }

  async recordOutreachDispatch(params: {
    dedupeKey: string;
    fromOrgId: string;
    kind: "SUPPLIER_INVITE" | "INTRO_REQUEST";
    recipientEmailHash: string;
    status: "SENT" | "RECORDED" | "SUPPRESSED" | "RATE_LIMITED";
  }): Promise<void> {
    const exists = await this.hasOutreachBeenDispatched(params.dedupeKey);
    if (exists) return;
    await this.db.command(
      "sql",
      `CREATE VERTEX OutreachDispatchLog SET
        dedupeKey = :dedupeKey,
        fromOrgId = :fromOrgId,
        kind = :kind,
        recipientEmailHash = :recipientEmailHash,
        status = :status,
        dispatchedAt = :dispatchedAt`,
      {
        ...params,
        dispatchedAt: new Date().toISOString(),
      },
    );
  }

  async countRecentDispatches(
    fromOrgId: string | null,
    sinceIso: string,
  ): Promise<number> {
    const rows =
      fromOrgId !== null
        ? await this.db.query<Record<string, unknown>>(
            "sql",
            `SELECT count(*) AS cnt FROM OutreachDispatchLog
             WHERE fromOrgId = :fromOrgId AND dispatchedAt >= :sinceIso AND status IN ['SENT', 'RECORDED']`,
            { fromOrgId, sinceIso },
          )
        : await this.db.query<Record<string, unknown>>(
            "sql",
            `SELECT count(*) AS cnt FROM OutreachDispatchLog
             WHERE dispatchedAt >= :sinceIso AND status IN ['SENT', 'RECORDED']`,
            { sinceIso },
          );
    return Number(rows[0]?.cnt ?? 0);
  }
}

export interface OutreachServiceDeps {
  suppressionRepo: EmailSuppressionRepository;
  authRepo: AuthRepository;
  emailProvider?: EmailProvider | null;
  fromEmail: string;
  webOrigin: string;
  signingSecret: string;
  maxOrgEmailsPerHour?: number;
  maxGlobalEmailsPerHour?: number;
}

export interface AutoOutreachResult {
  status: "SENT" | "RECORDED" | "SKIPPED_DUPLICATE" | "SKIPPED_SUPPRESSED" | "RATE_LIMITED";
}

export interface IntroDispatchResult {
  requestId: string;
  status: "SENT" | "RECORDED" | "SUPPRESSED";
  sentAt: string;
}

/**
 * Automated supplier outreach & buyer-to-supplier intro email service.
 * Enforces:
 * - Strict per-(buyerOrg, supplierEmail) deduplication for outreach invites
 * - Global 1-click unsubscribe suppression list (HMAC-SHA256 signed tokens)
 * - Per-org and global hourly outbound rate limits
 * - Zero leakage of private supply graphs, existing suppliers, or raw tokens
 */
export class OutreachService {
  private readonly maxOrgEmailsPerHour: number;
  private readonly maxGlobalEmailsPerHour: number;

  constructor(private readonly deps: OutreachServiceDeps) {
    this.maxOrgEmailsPerHour = deps.maxOrgEmailsPerHour ?? 50;
    this.maxGlobalEmailsPerHour = deps.maxGlobalEmailsPerHour ?? 500;
  }

  createUnsubscribeToken(email: string): string {
    const normalized = email.trim().toLowerCase();
    const payload = Buffer.from(normalized, "utf8").toString("base64url");
    const sig = createHmac("sha256", this.deps.signingSecret)
      .update(`kulgo-unsub-v1:${payload}`)
      .digest("base64url");
    return `${payload}.${sig}`;
  }

  verifyUnsubscribeToken(token: string): string | null {
    const dotIdx = token.indexOf(".");
    if (dotIdx <= 0 || dotIdx === token.length - 1) return null;
    const payload = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    const expected = createHmac("sha256", this.deps.signingSecret)
      .update(`kulgo-unsub-v1:${payload}`)
      .digest("base64url");
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const email = Buffer.from(payload, "base64url").toString("utf8").trim().toLowerCase();
      return email.includes("@") ? email : null;
    } catch {
      return null;
    }
  }

  async suppressByToken(token: string): Promise<EmailSuppression | null> {
    const email = this.verifyUnsubscribeToken(token);
    if (!email) return null;
    return this.deps.suppressionRepo.suppress(email, "UNSUBSCRIBE");
  }

  async suppressEmail(
    email: string,
    reason: SuppressionReason = "UNSUBSCRIBE",
  ): Promise<EmailSuppression> {
    return this.deps.suppressionRepo.suppress(email, reason);
  }

  async isSuppressed(email: string): Promise<boolean> {
    return this.deps.suppressionRepo.isSuppressed(email);
  }

  async dispatchSupplierOutreach(params: {
    fromOrgId: string;
    fromOrgName: string;
    actorUserId: string;
    actorEmail: string;
    supplierName: string;
    recipientEmail: string;
    inviteLink?: string;
    referenceId?: string;
  }): Promise<AutoOutreachResult> {
    const recipientHash = hashEmailForPrivacy(params.recipientEmail);
    const dedupeKey = `SUPPLIER_INVITE:${params.fromOrgId}:${recipientHash}`;

    // 1. Strict deduplication: never email the same supplier twice for the same buyer org
    if (await this.deps.suppressionRepo.hasOutreachBeenDispatched(dedupeKey)) {
      return { status: "SKIPPED_DUPLICATE" };
    }

    // 2. Global suppression / unsubscribe check
    if (await this.deps.suppressionRepo.isSuppressed(params.recipientEmail)) {
      return { status: "SKIPPED_SUPPRESSED" };
    }

    // 3. Per-org and global hourly rate limits
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [orgCount, globalCount] = await Promise.all([
      this.deps.suppressionRepo.countRecentDispatches(params.fromOrgId, oneHourAgo),
      this.deps.suppressionRepo.countRecentDispatches(null, oneHourAgo),
    ]);
    if (
      orgCount >= this.maxOrgEmailsPerHour ||
      globalCount >= this.maxGlobalEmailsPerHour
    ) {
      return { status: "RATE_LIMITED" };
    }

    const unsubToken = this.createUnsubscribeToken(params.recipientEmail);
    const unsubUrl = `${this.deps.webOrigin.replace(/\/$/, "")}/api/v1/outreach/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const joinUrl = params.inviteLink ?? this.deps.webOrigin;

    let status: "SENT" | "RECORDED" = "RECORDED";
    if (this.deps.emailProvider) {
      const subject = `${params.fromOrgName} invited ${params.supplierName} to verify your supply relationship on Kulgo`;
      const text = [
        `Hello ${params.supplierName},`,
        "",
        `${params.fromOrgName} listed your organization as a supply partner on Kulgo.`,
        "You can join Kulgo for free to:",
        "1. Confirm the supply relationship and reconcile your fulfilling facility.",
        "2. Receive free disruption risk monitoring for your operations.",
        "3. Optionally publish your Product Catalogue to become discoverable to new buyers.",
        "",
        `Accept or review invitation: ${joinUrl}`,
        "",
        `Do not want to receive Kulgo invitations? Unsubscribe with 1 click: ${unsubUrl}`,
      ].join("\n");
      const html = `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`;

      await this.deps.emailProvider.send({
        from: this.deps.fromEmail,
        to: [params.recipientEmail.trim().toLowerCase()],
        subject,
        text,
        html,
        idempotencyKey: createHash("sha256").update(dedupeKey).digest("hex"),
      });
      status = "SENT";
    }

    await this.deps.suppressionRepo.recordOutreachDispatch({
      dedupeKey,
      fromOrgId: params.fromOrgId,
      kind: "SUPPLIER_INVITE",
      recipientEmailHash: recipientHash,
      status,
    });

    await this.deps.authRepo.recordAuditEvent({
      orgId: params.fromOrgId,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      action: "INVITE_CREATED",
      summary: `Automated outreach ${status.toLowerCase()} for ${params.supplierName}`,
      metadata: {
        outreachStatus: status,
        recipientEmailHash: recipientHash.slice(0, 16),
        ...(params.referenceId ? { referenceId: params.referenceId } : {}),
      },
    });

    return { status };
  }

  async dispatchIntroRequest(params: {
    fromOrgId: string;
    fromOrgName: string;
    fromCountryCode: string;
    actorUserId: string;
    actorEmail: string;
    targetOrgId: string;
    targetOrgName: string;
    targetContactEmail: string | null;
    materialCategory: string;
    volumeBand: string;
    unit?: string;
    note?: string;
  }): Promise<IntroDispatchResult> {
    const requestId = randomUUID();
    const sentAt = new Date().toISOString();
    const recipientHash = params.targetContactEmail
      ? hashEmailForPrivacy(params.targetContactEmail)
      : hashEmailForPrivacy(`org:${params.targetOrgId}`);

    if (
      params.targetContactEmail &&
      (await this.deps.suppressionRepo.isSuppressed(params.targetContactEmail))
    ) {
      return { requestId, status: "SUPPRESSED", sentAt };
    }

    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [orgCount, globalCount] = await Promise.all([
      this.deps.suppressionRepo.countRecentDispatches(params.fromOrgId, oneHourAgo),
      this.deps.suppressionRepo.countRecentDispatches(null, oneHourAgo),
    ]);
    if (
      orgCount >= this.maxOrgEmailsPerHour ||
      globalCount >= this.maxGlobalEmailsPerHour
    ) {
      throw new Error("Outbound intro request rate limit exceeded. Please try again later.");
    }

    let status: "SENT" | "RECORDED" = "RECORDED";
    if (this.deps.emailProvider && params.targetContactEmail) {
      const unsubToken = this.createUnsubscribeToken(params.targetContactEmail);
      const unsubUrl = `${this.deps.webOrigin.replace(/\/$/, "")}/api/v1/outreach/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      const subject = `New buyer introduction request via Kulgo: ${params.materialCategory}`;
      const lines = [
        `Hello ${params.targetOrgName},`,
        "",
        `A buyer on Kulgo (${params.fromOrgName}, ${params.fromCountryCode}) requested an introduction / quote for:`,
        `- Material / Category: ${params.materialCategory}`,
        `- Requested Volume Band: ${params.volumeBand}${params.unit ? ` (${params.unit})` : ""}`,
        params.note ? `- Buyer Note: ${params.note}` : null,
        "",
        "This introduction was triggered via your opt-in Kulgo Product Catalogue profile.",
        `1-click unsubscribe: ${unsubUrl}`,
      ].filter((l): l is string => l !== null);

      const text = lines.join("\n");
      const html = `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`;

      await this.deps.emailProvider.send({
        from: this.deps.fromEmail,
        to: [params.targetContactEmail.trim().toLowerCase()],
        subject,
        text,
        html,
        idempotencyKey: requestId,
      });
      status = "SENT";
    }

    await this.deps.suppressionRepo.recordOutreachDispatch({
      dedupeKey: `INTRO_REQUEST:${requestId}`,
      fromOrgId: params.fromOrgId,
      kind: "INTRO_REQUEST",
      recipientEmailHash: recipientHash,
      status,
    });

    await this.deps.authRepo.recordAuditEvent({
      orgId: params.fromOrgId,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      action: "INTRO_REQUESTED",
      summary: `Requested introduction to ${params.targetOrgName} for ${params.materialCategory}`,
      metadata: {
        requestId,
        targetOrgId: params.targetOrgId,
        materialCategory: params.materialCategory,
        volumeBand: params.volumeBand,
        status,
      },
    });

    return { requestId, status, sentAt };
  }
}
