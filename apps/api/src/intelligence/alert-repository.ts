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
  status: "SENT" | "FAILED" | "SKIPPED";
  provider: string;
  errorMessage: string | null;
  deliveredAt: string;
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
  recordDelivery(record: AlertDeliveryRecord): Promise<void>;
  listDeliveries(orgId: string): Promise<AlertDeliveryRecord[]>;
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
    };

    if (existing.length > 0) {
      await this.db.command(
        "sql",
        `UPDATE AlertDeliveryLog SET
          status = :status,
          provider = :provider,
          errorMessage = :errorMessage,
          deliveredAt = :deliveredAt
         WHERE deliveryKey = :deliveryKey`,
        params,
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
}

export class InMemoryAlertRepository implements AlertRepository {
  private readonly prefs = new Map<string, StoredNotificationPreference>();
  private readonly acks = new Map<string, OrgAlertAck>();
  private readonly deliveries = new Map<string, AlertDeliveryRecord>();

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

  async recordDelivery(record: AlertDeliveryRecord): Promise<void> {
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
}
