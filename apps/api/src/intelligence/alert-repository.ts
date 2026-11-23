import {
  AlertNotificationPreferenceSchema,
  OrgAlertAckSchema,
  type AlertNotificationPreference,
  type OrgAlertAck,
} from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";

export type AlertDeliveryChannel = "EMAIL_RED" | "EMAIL_DIGEST" | "WEBHOOK";

export interface AlertDeliveryRecord {
  orgId: string;
  signalId: string;
  channel: AlertDeliveryChannel;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  provider: string;
  errorMessage: string | null;
  deliveredAt: string;
  claimTimestamp?: string;
}

export interface ClaimDeliveryInput {
  orgId: string;
  signalId: string;
  channel: AlertDeliveryChannel;
  provider: string;
  claimedAt: string;
}

export type SweepLeaseStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface SweepLeaseRecord {
  leaseKey: string;
  ownerId: string;
  status: SweepLeaseStatus;
  acquiredAt: string;
  expiresAt: string;
  completedAt: string | null;
  lastError: string | null;
}

export interface AcquireSweepLeaseInput {
  leaseKey: string;
  ownerId: string;
  nowIso: string;
  ttlMs: number;
  preventRerunAfterComplete?: boolean;
}

export interface ReleaseSweepLeaseInput {
  leaseKey: string;
  ownerId: string;
  status: "COMPLETED" | "FAILED";
  completedAt: string;
  lastError?: string | null;
}

export interface StoredNotificationPreference {
  preference: AlertNotificationPreference;
  webhookSecret: string | null;
}

export interface UpsertNotificationPreferenceInput {
  orgId: string;
  instantRedEmailEnabled?: boolean;
  dailyAmberDigestEnabled?: boolean;
  emailRecipients?: string[];
  webhookUrl?: string | null;
  webhookSecret?: string | null;
}

export interface AlertRepository {
  getNotificationPreference(orgId: string): Promise<StoredNotificationPreference>;
  upsertNotificationPreference(
    input: UpsertNotificationPreferenceInput,
  ): Promise<StoredNotificationPreference>;
  listAlertAcks(orgId: string): Promise<OrgAlertAck[]>;
  upsertAlertAck(ack: OrgAlertAck): Promise<OrgAlertAck>;
  hasDelivered(
    orgId: string,
    signalId: string,
    channel: AlertDeliveryChannel,
  ): Promise<boolean>;
  /**
   * Atomically claims an alert delivery slot (`PENDING`) before invoking
   * external email/webhook providers. Returns `false` if already `SENT` or
   * a fresh `PENDING` claim. Stale claims can be recovered after the TTL.
   */
  claimDelivery(input: ClaimDeliveryInput): Promise<boolean>;
  recordDelivery(record: AlertDeliveryRecord): Promise<void>;
  listDeliveries(orgId: string): Promise<AlertDeliveryRecord[]>;
  acquireSweepLease(input: AcquireSweepLeaseInput): Promise<boolean>;
  releaseSweepLease(input: ReleaseSweepLeaseInput): Promise<void>;
  getSweepLease(leaseKey: string): Promise<SweepLeaseRecord | null>;
}

function defaultPreference(orgId: string): StoredNotificationPreference {
  return {
    preference: AlertNotificationPreferenceSchema.parse({
      orgId,
      instantRedEmailEnabled: true,
      dailyAmberDigestEnabled: true,
      emailRecipients: [],
      webhookUrl: null,
      webhookSecretConfigured: false,
      updatedAt: new Date(0).toISOString(),
    }),
    webhookSecret: null,
  };
}

export const DELIVERY_CLAIM_TTL_MS = 15 * 60 * 1000;

function deliveryKey(
  orgId: string,
  signalId: string,
  channel: AlertDeliveryChannel,
): string {
  return `${orgId}:${signalId}:${channel}`;
}

export class ArcadeDbAlertRepository implements AlertRepository {
  constructor(private readonly db: ArcadeDbClient) {}

  async getNotificationPreference(
    orgId: string,
  ): Promise<StoredNotificationPreference> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT orgId, instantRedEmailEnabled, dailyAmberDigestEnabled,
              emailRecipients, webhookUrl, webhookSecret, updatedAt
       FROM AlertNotificationPreference
       WHERE orgId = :orgId
       LIMIT 1`,
      { orgId },
    );
    if (rows.length === 0) {
      return defaultPreference(orgId);
    }
    const row = rows[0]!;
    const secret =
      typeof row.webhookSecret === "string" && row.webhookSecret.length > 0
        ? row.webhookSecret
        : null;
    return {
      preference: AlertNotificationPreferenceSchema.parse({
        orgId: String(row.orgId),
        instantRedEmailEnabled: Boolean(row.instantRedEmailEnabled ?? true),
        dailyAmberDigestEnabled: Boolean(row.dailyAmberDigestEnabled ?? true),
        emailRecipients: Array.isArray(row.emailRecipients)
          ? row.emailRecipients
          : [],
        webhookUrl: typeof row.webhookUrl === "string" ? row.webhookUrl : null,
        webhookSecretConfigured: secret !== null,
        updatedAt:
          typeof row.updatedAt === "string"
            ? row.updatedAt
            : new Date().toISOString(),
      }),
      webhookSecret: secret,
    };
  }

  async upsertNotificationPreference(
    input: UpsertNotificationPreferenceInput,
  ): Promise<StoredNotificationPreference> {
    const current = await this.getNotificationPreference(input.orgId);
    const nextSecret =
      input.webhookSecret !== undefined
        ? input.webhookSecret
        : current.webhookSecret;
    const updatedAt = new Date().toISOString();
    const nextPref = AlertNotificationPreferenceSchema.parse({
      orgId: input.orgId,
      instantRedEmailEnabled:
        input.instantRedEmailEnabled ?? current.preference.instantRedEmailEnabled,
      dailyAmberDigestEnabled:
        input.dailyAmberDigestEnabled ??
        current.preference.dailyAmberDigestEnabled,
      emailRecipients:
        input.emailRecipients ?? current.preference.emailRecipients,
      webhookUrl:
        input.webhookUrl !== undefined
          ? input.webhookUrl
          : current.preference.webhookUrl,
      webhookSecretConfigured: Boolean(nextSecret && nextSecret.length > 0),
      updatedAt,
    });

    const existing = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT orgId FROM AlertNotificationPreference WHERE orgId = :orgId LIMIT 1",
      { orgId: input.orgId },
    );
    const params = {
      orgId: nextPref.orgId,
      instantRedEmailEnabled: nextPref.instantRedEmailEnabled,
      dailyAmberDigestEnabled: nextPref.dailyAmberDigestEnabled,
      emailRecipients: nextPref.emailRecipients,
      webhookUrl: nextPref.webhookUrl,
      webhookSecret: nextSecret,
      updatedAt: nextPref.updatedAt,
    };

    if (existing.length > 0) {
      await this.db.command(
        "sql",
        `UPDATE AlertNotificationPreference SET
          instantRedEmailEnabled = :instantRedEmailEnabled,
          dailyAmberDigestEnabled = :dailyAmberDigestEnabled,
          emailRecipients = :emailRecipients,
          webhookUrl = :webhookUrl,
          webhookSecret = :webhookSecret,
          updatedAt = :updatedAt
         WHERE orgId = :orgId`,
        params,
      );
    } else {
      await this.db.command(
        "sql",
        `CREATE VERTEX AlertNotificationPreference SET
          orgId = :orgId,
          instantRedEmailEnabled = :instantRedEmailEnabled,
          dailyAmberDigestEnabled = :dailyAmberDigestEnabled,
          emailRecipients = :emailRecipients,
          webhookUrl = :webhookUrl,
          webhookSecret = :webhookSecret,
          updatedAt = :updatedAt`,
        params,
      );
    }

    return { preference: nextPref, webhookSecret: nextSecret };
  }

  async listAlertAcks(orgId: string): Promise<OrgAlertAck[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT orgId, signalId, status, acknowledgedByUserId, note, acknowledgedAt
       FROM OrgAlertAck
       WHERE orgId = :orgId`,
      { orgId },
    );
    return rows.map((row) =>
      OrgAlertAckSchema.parse({
        orgId: row.orgId,
        signalId: row.signalId,
        status: row.status,
        acknowledgedByUserId: row.acknowledgedByUserId,
        note: typeof row.note === "string" ? row.note : null,
        acknowledgedAt: row.acknowledgedAt,
      }),
    );
  }

  async upsertAlertAck(ack: OrgAlertAck): Promise<OrgAlertAck> {
    const parsed = OrgAlertAckSchema.parse(ack);
    const ackKey = `${parsed.orgId}:${parsed.signalId}`;
    const existing = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT ackKey FROM OrgAlertAck WHERE ackKey = :ackKey LIMIT 1",
      { ackKey },
    );
    const params = {
      ackKey,
      orgId: parsed.orgId,
      signalId: parsed.signalId,
      status: parsed.status,
      acknowledgedByUserId: parsed.acknowledgedByUserId,
      note: parsed.note,
      acknowledgedAt: parsed.acknowledgedAt,
    };

    if (existing.length > 0) {
      await this.db.command(
        "sql",
        `UPDATE OrgAlertAck SET
          status = :status,
          acknowledgedByUserId = :acknowledgedByUserId,
          note = :note,
          acknowledgedAt = :acknowledgedAt
         WHERE ackKey = :ackKey`,
        params,
      );
    } else {
      await this.db.command(
        "sql",
        `CREATE VERTEX OrgAlertAck SET
          ackKey = :ackKey,
          orgId = :orgId,
          signalId = :signalId,
          status = :status,
          acknowledgedByUserId = :acknowledgedByUserId,
          note = :note,
          acknowledgedAt = :acknowledgedAt`,
        params,
      );
    }
    return parsed;
  }

  private isConflictError(err: unknown): boolean {
    return (
      err instanceof Error &&
      /(?:DuplicatedKeyException|ConcurrentModificationException|NeedRetryException)/.test(
        err.message,
      )
    );
  }

  async hasDelivered(
    orgId: string,
    signalId: string,
    channel: AlertDeliveryChannel,
  ): Promise<boolean> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT deliveryKey FROM AlertDeliveryLog
       WHERE deliveryKey = :deliveryKey AND status = 'SENT'
       LIMIT 1`,
      { deliveryKey: deliveryKey(orgId, signalId, channel) },
    );
    return rows.length > 0;
  }

  async claimDelivery(input: ClaimDeliveryInput): Promise<boolean> {
    const key = deliveryKey(input.orgId, input.signalId, input.channel);
    const work = async (db: ArcadeDbClient): Promise<boolean> => {
      const existing = await db.query<Record<string, unknown>>(
        "sql",
        "SELECT deliveryKey, status FROM AlertDeliveryLog WHERE deliveryKey = :deliveryKey LIMIT 1",
        { deliveryKey: key },
      );
      if (existing.length > 0) {
        const status = String(existing[0]?.status ?? "");
        if (status === "SENT") {
          return false;
        }
        const updated = await db.command<Record<string, unknown>>(
          "sql",
          `UPDATE AlertDeliveryLog SET
            status = 'PENDING',
            provider = :provider,
            errorMessage = null,
            deliveredAt = :claimedAt
           WHERE deliveryKey = :deliveryKey
             AND status <> 'SENT'
             AND (status <> 'PENDING' OR deliveredAt <= :staleBefore)`,
          {
            deliveryKey: key,
            provider: input.provider,
            claimedAt: input.claimedAt,
            staleBefore: new Date(Date.parse(input.claimedAt) - DELIVERY_CLAIM_TTL_MS).toISOString(),
          },
        );
        return Number(updated[0]?.count ?? 0) > 0;
      }

      await db.command(
        "sql",
        `CREATE VERTEX AlertDeliveryLog SET
          deliveryKey = :deliveryKey,
          orgId = :orgId,
          signalId = :signalId,
          channel = :channel,
          status = 'PENDING',
          provider = :provider,
          errorMessage = null,
          deliveredAt = :claimedAt`,
        {
          deliveryKey: key,
          orgId: input.orgId,
          signalId: input.signalId,
          channel: input.channel,
          provider: input.provider,
          claimedAt: input.claimedAt,
        },
      );
      return true;
    };

    try {
      return this.db.transaction
        ? await this.db.transaction(work)
        : await work(this.db);
    } catch (err) {
      if (this.isConflictError(err)) {
        return false;
      }
      throw err;
    }
  }

  async recordDelivery(record: AlertDeliveryRecord): Promise<void> {
    const key = deliveryKey(record.orgId, record.signalId, record.channel);
    const existing = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT deliveryKey FROM AlertDeliveryLog WHERE deliveryKey = :deliveryKey LIMIT 1",
      { deliveryKey: key },
    );
    const params = {
      deliveryKey: key,
      orgId: record.orgId,
      signalId: record.signalId,
      channel: record.channel,
      status: record.status,
      provider: record.provider,
      errorMessage: record.errorMessage,
      deliveredAt: record.deliveredAt,
      claimTimestamp: record.claimTimestamp,
    };

    if (existing.length > 0) {
      await this.db.command(
        "sql",
        `UPDATE AlertDeliveryLog SET
          status = :status,
          provider = :provider,
          errorMessage = :errorMessage,
          deliveredAt = :deliveredAt
         WHERE deliveryKey = :deliveryKey
           AND (:claimTimestamp IS NULL OR (status = 'PENDING' AND deliveredAt = :claimTimestamp))`,
        { ...params, claimTimestamp: record.claimTimestamp ?? null },
      );
    } else {
      await this.db.command(
        "sql",
        `CREATE VERTEX AlertDeliveryLog SET
          deliveryKey = :deliveryKey,
          orgId = :orgId,
          signalId = :signalId,
          channel = :channel,
          status = :status,
          provider = :provider,
          errorMessage = :errorMessage,
          deliveredAt = :deliveredAt`,
        params,
      );
    }
  }

  async listDeliveries(orgId: string): Promise<AlertDeliveryRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT orgId, signalId, channel, status, provider, errorMessage, deliveredAt
       FROM AlertDeliveryLog
       WHERE orgId = :orgId`,
      { orgId },
    );
    return rows.map((row) => ({
      orgId: String(row.orgId),
      signalId: String(row.signalId),
      channel: String(row.channel) as AlertDeliveryChannel,
      status: String(row.status) as AlertDeliveryRecord["status"],
      provider: String(row.provider),
      errorMessage:
        typeof row.errorMessage === "string" ? row.errorMessage : null,
      deliveredAt: String(row.deliveredAt),
    }));
  }

  async acquireSweepLease(input: AcquireSweepLeaseInput): Promise<boolean> {
    const nowMs = Date.parse(input.nowIso);
    const normalizedNowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + Math.max(1_000, input.ttlMs)).toISOString();
    const work = async (db: ArcadeDbClient): Promise<boolean> => {
      const existing = await db.query<Record<string, unknown>>(
        "sql",
        `SELECT leaseKey, ownerId, status, acquiredAt, expiresAt, completedAt, lastError
         FROM IntelligenceSweepLease
         WHERE leaseKey = :leaseKey
         LIMIT 1`,
        { leaseKey: input.leaseKey },
      );

      if (existing.length > 0) {
        const row = existing[0]!;
        const status = String(row.status ?? "");
        const existingExpiresMs =
          typeof row.expiresAt === "string" ? Date.parse(row.expiresAt) : 0;
        if (status === "RUNNING" && Number.isFinite(existingExpiresMs) && existingExpiresMs > nowMs) {
          return false;
        }
        if (input.preventRerunAfterComplete && status === "COMPLETED") {
          return false;
        }
        const whereGuard = input.preventRerunAfterComplete
          ? "WHERE leaseKey = :leaseKey AND status <> 'COMPLETED' AND (status <> 'RUNNING' OR expiresAt <= :nowIso)"
          : "WHERE leaseKey = :leaseKey AND (status <> 'RUNNING' OR expiresAt <= :nowIso)";
        const updated = await db.command<Record<string, unknown>>(
          "sql",
          `UPDATE IntelligenceSweepLease SET
            ownerId = :ownerId,
            status = 'RUNNING',
            acquiredAt = :acquiredAt,
            expiresAt = :expiresAt,
            completedAt = null,
            lastError = null
           ${whereGuard}`,
          {
            leaseKey: input.leaseKey,
            ownerId: input.ownerId,
            acquiredAt: normalizedNowIso,
            expiresAt,
            nowIso: normalizedNowIso,
          },
        );
        return Number(updated[0]?.count ?? 0) > 0;
      }

      await db.command(
        "sql",
        `CREATE VERTEX IntelligenceSweepLease SET
          leaseKey = :leaseKey,
          ownerId = :ownerId,
          status = 'RUNNING',
          acquiredAt = :acquiredAt,
          expiresAt = :expiresAt,
          completedAt = null,
          lastError = null`,
        {
          leaseKey: input.leaseKey,
          ownerId: input.ownerId,
          acquiredAt: normalizedNowIso,
          expiresAt,
        },
      );
      return true;
    };

    try {
      return this.db.transaction
        ? await this.db.transaction(work)
        : await work(this.db);
    } catch (err) {
      if (this.isConflictError(err)) {
        return false;
      }
      throw err;
    }
  }

  async releaseSweepLease(input: ReleaseSweepLeaseInput): Promise<void> {
    await this.db.command(
      "sql",
      `UPDATE IntelligenceSweepLease SET
        status = :status,
        completedAt = :completedAt,
        expiresAt = :completedAt,
        lastError = :lastError
       WHERE leaseKey = :leaseKey AND ownerId = :ownerId`,
      {
        leaseKey: input.leaseKey,
        ownerId: input.ownerId,
        status: input.status,
        completedAt: input.completedAt,
        lastError: input.lastError ?? null,
      },
    );
  }

  async getSweepLease(leaseKey: string): Promise<SweepLeaseRecord | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT leaseKey, ownerId, status, acquiredAt, expiresAt, completedAt, lastError
       FROM IntelligenceSweepLease
       WHERE leaseKey = :leaseKey
       LIMIT 1`,
      { leaseKey },
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      leaseKey: String(row.leaseKey),
      ownerId: String(row.ownerId),
      status: String(row.status) as SweepLeaseStatus,
      acquiredAt: String(row.acquiredAt),
      expiresAt: String(row.expiresAt),
      completedAt: typeof row.completedAt === "string" ? row.completedAt : null,
      lastError: typeof row.lastError === "string" ? row.lastError : null,
    };
  }
}

export class InMemoryAlertRepository implements AlertRepository {
  private readonly prefs = new Map<string, StoredNotificationPreference>();
  private readonly acks = new Map<string, OrgAlertAck>();
  private readonly deliveries = new Map<string, AlertDeliveryRecord>();
  private readonly sweepLeases = new Map<string, SweepLeaseRecord>();

  async getNotificationPreference(
    orgId: string,
  ): Promise<StoredNotificationPreference> {
    return this.prefs.get(orgId) ?? defaultPreference(orgId);
  }

  async upsertNotificationPreference(
    input: UpsertNotificationPreferenceInput,
  ): Promise<StoredNotificationPreference> {
    const current = await this.getNotificationPreference(input.orgId);
    const nextSecret =
      input.webhookSecret !== undefined
        ? input.webhookSecret
        : current.webhookSecret;
    const nextPref = AlertNotificationPreferenceSchema.parse({
      orgId: input.orgId,
      instantRedEmailEnabled:
        input.instantRedEmailEnabled ?? current.preference.instantRedEmailEnabled,
      dailyAmberDigestEnabled:
        input.dailyAmberDigestEnabled ??
        current.preference.dailyAmberDigestEnabled,
      emailRecipients:
        input.emailRecipients ?? current.preference.emailRecipients,
      webhookUrl:
        input.webhookUrl !== undefined
          ? input.webhookUrl
          : current.preference.webhookUrl,
      webhookSecretConfigured: Boolean(nextSecret && nextSecret.length > 0),
      updatedAt: new Date().toISOString(),
    });
    const stored: StoredNotificationPreference = {
      preference: nextPref,
      webhookSecret: nextSecret,
    };
    this.prefs.set(input.orgId, stored);
    return stored;
  }

  async listAlertAcks(orgId: string): Promise<OrgAlertAck[]> {
    return Array.from(this.acks.values()).filter((a) => a.orgId === orgId);
  }

  async upsertAlertAck(ack: OrgAlertAck): Promise<OrgAlertAck> {
    const parsed = OrgAlertAckSchema.parse(ack);
    this.acks.set(`${parsed.orgId}:${parsed.signalId}`, parsed);
    return parsed;
  }

  async hasDelivered(
    orgId: string,
    signalId: string,
    channel: AlertDeliveryChannel,
  ): Promise<boolean> {
    const rec = this.deliveries.get(deliveryKey(orgId, signalId, channel));
    return rec?.status === "SENT";
  }

  async claimDelivery(input: ClaimDeliveryInput): Promise<boolean> {
    const key = deliveryKey(input.orgId, input.signalId, input.channel);
    const existing = this.deliveries.get(key);
    if (existing && (existing.status === "SENT" || (existing.status === "PENDING" && Date.parse(existing.deliveredAt) > Date.parse(input.claimedAt) - DELIVERY_CLAIM_TTL_MS))) {
      return false;
    }
    this.deliveries.set(key, {
      orgId: input.orgId,
      signalId: input.signalId,
      channel: input.channel,
      status: "PENDING",
      provider: input.provider,
      errorMessage: null,
      deliveredAt: input.claimedAt,
    });
    return true;
  }

  async recordDelivery(record: AlertDeliveryRecord): Promise<void> {
    const existing = this.deliveries.get(deliveryKey(record.orgId, record.signalId, record.channel));
    if (record.claimTimestamp && (existing?.status !== "PENDING" || existing.deliveredAt !== record.claimTimestamp)) return;
    this.deliveries.set(
      deliveryKey(record.orgId, record.signalId, record.channel),
      record,
    );
  }

  async listDeliveries(orgId: string): Promise<AlertDeliveryRecord[]> {
    return Array.from(this.deliveries.values()).filter(
      (r) => r.orgId === orgId,
    );
  }

  async acquireSweepLease(input: AcquireSweepLeaseInput): Promise<boolean> {
    const nowMs = Date.parse(input.nowIso);
    const existing = this.sweepLeases.get(input.leaseKey);
    if (existing) {
      const existingExpiresMs = Date.parse(existing.expiresAt);
      if (
        existing.status === "RUNNING" &&
        Number.isFinite(existingExpiresMs) &&
        existingExpiresMs > nowMs
      ) {
        return false;
      }
      if (input.preventRerunAfterComplete && existing.status === "COMPLETED") {
        return false;
      }
    }
    const expiresAt = new Date(nowMs + Math.max(1_000, input.ttlMs)).toISOString();
    this.sweepLeases.set(input.leaseKey, {
      leaseKey: input.leaseKey,
      ownerId: input.ownerId,
      status: "RUNNING",
      acquiredAt: input.nowIso,
      expiresAt,
      completedAt: null,
      lastError: null,
    });
    return true;
  }

  async releaseSweepLease(input: ReleaseSweepLeaseInput): Promise<void> {
    const existing = this.sweepLeases.get(input.leaseKey);
    if (!existing || existing.ownerId !== input.ownerId) {
      return;
    }
    this.sweepLeases.set(input.leaseKey, {
      ...existing,
      status: input.status,
      completedAt: input.completedAt,
      expiresAt: input.completedAt,
      lastError: input.lastError ?? null,
    });
  }

  async getSweepLease(leaseKey: string): Promise<SweepLeaseRecord | null> {
    const record = this.sweepLeases.get(leaseKey);
    return record ? { ...record } : null;
  }
}
