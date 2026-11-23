import { isSignalExpired } from "@kulgo/engine";
import { RiskSignalSchema, type RiskSignal } from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";
import {
  findMatchingSignal,
  mergeRiskSignals,
} from "../intelligence/dedupe.js";

/**
 * Built-in demo RiskSignal polygons for the Latvia secondary-sanctions corridor
 * and the South China / maritime geopolitical risk corridor.
 */
export const DEMO_RISK_SIGNALS: readonly RiskSignal[] = [
  RiskSignalSchema.parse({
    signalId: "sig-latvia-sanctions-01",
    kind: "SANCTIONS",
    severity: "RED",
    title: "Baltic / Latvia Secondary Sanctions Corridor",
    description:
      "Elevated EU secondary sanctions compliance risk on petrochemical and specialty polymer feedstocks transiting eastern Baltic corridors.",
    regionCode: "LV-BALTIC",
    affectedCountryCodes: ["LV"],
    affectedChokepoints: ["BALTIC_SEA", "BALTIC_VIA_BALTICA_CORRIDOR"],
    polygonWkt:
      "POLYGON ((20.9 55.6, 28.3 55.6, 28.3 58.1, 20.9 58.1, 20.9 55.6))",
    verificationStatus: "CONFIRMED",
    lifecycle: "ACTIVE",
    active: true,
  }),
  RiskSignalSchema.parse({
    signalId: "sig-china-corridor-01",
    kind: "GEOPOLITICAL",
    severity: "YELLOW",
    title: "South China Maritime & Geopolitical Risk Zone",
    description:
      "Geopolitical export-control monitoring and Red Sea / Suez maritime transit congestion impacting Shenzhen-to-Baltic rare-earth and electronics corridors.",
    regionCode: "CN-SOUTH",
    affectedCountryCodes: ["CN"],
    affectedChokepoints: ["MALACCA_STRAIT", "RED_SEA_BAB_EL_MANDEB", "SUEZ_CANAL"],
    polygonWkt:
      "POLYGON ((110.0 19.5, 122.5 19.5, 122.5 26.5, 110.0 26.5, 110.0 19.5))",
    verificationStatus: "CONFIRMED",
    lifecycle: "ACTIVE",
    active: true,
  }),
];

export interface UpsertSignalResult {
  signal: RiskSignal;
  created: boolean;
}

export interface RiskSignalRepository {
  listActive(): Promise<RiskSignal[]>;
  ensureDemoSignals(): Promise<RiskSignal[]>;
  upsertSignal(signal: RiskSignal): Promise<UpsertSignalResult>;
  resolveExpired(nowIso: string): Promise<number>;
}

const RISK_SIGNAL_SELECT_FIELDS = `
  signalId, kind, severity, title, description, regionCode,
  affectedCountryCodes, affectedChokepoints, affectedSectors,
  polygonWkt, sourceUrls, evidenceQuotes, publishedAt, lastSeenAt,
  eventStartAt, eventEndAt, expiresAt, resolvedAt, dedupeKey,
  confidence, verificationStatus, lifecycle, active
`;

function mapRiskSignalRow(row: Record<string, unknown>): RiskSignal {
  const evidenceQuotes = Array.isArray(row.evidenceQuotes)
    ? row.evidenceQuotes.filter((q): q is string => typeof q === "string")
    : undefined;

  return RiskSignalSchema.parse({
    signalId: row.signalId,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    description: typeof row.description === "string" ? row.description : null,
    regionCode: typeof row.regionCode === "string" ? row.regionCode : null,
    affectedCountryCodes: Array.isArray(row.affectedCountryCodes)
      ? row.affectedCountryCodes
      : [],
    affectedChokepoints: Array.isArray(row.affectedChokepoints)
      ? row.affectedChokepoints
      : [],
    affectedSectors: Array.isArray(row.affectedSectors)
      ? row.affectedSectors
      : [],
    polygonWkt: row.polygonWkt,
    sourceUrls: Array.isArray(row.sourceUrls) ? row.sourceUrls : [],
    ...(evidenceQuotes && evidenceQuotes.length > 0 ? { evidenceQuotes } : {}),
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    lastSeenAt: typeof row.lastSeenAt === "string" ? row.lastSeenAt : null,
    ...(typeof row.eventStartAt === "string"
      ? { eventStartAt: row.eventStartAt }
      : row.eventStartAt === null
        ? { eventStartAt: null }
        : {}),
    ...(typeof row.eventEndAt === "string"
      ? { eventEndAt: row.eventEndAt }
      : row.eventEndAt === null
        ? { eventEndAt: null }
        : {}),
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
    resolvedAt: typeof row.resolvedAt === "string" ? row.resolvedAt : null,
    dedupeKey: typeof row.dedupeKey === "string" ? row.dedupeKey : null,
    confidence: typeof row.confidence === "number" ? row.confidence : 1,
    verificationStatus:
      typeof row.verificationStatus === "string"
        ? row.verificationStatus
        : "CONFIRMED",
    lifecycle: typeof row.lifecycle === "string" ? row.lifecycle : "ACTIVE",
    active: row.active !== undefined ? Boolean(row.active) : true,
  });
}

function toSqlParams(signal: RiskSignal): Record<string, unknown> {
  return {
    signalId: signal.signalId,
    kind: signal.kind,
    severity: signal.severity,
    title: signal.title,
    description: signal.description,
    regionCode: signal.regionCode,
    affectedCountryCodes: signal.affectedCountryCodes,
    affectedChokepoints: signal.affectedChokepoints,
    affectedSectors: signal.affectedSectors,
    polygonWkt: signal.polygonWkt,
    sourceUrls: signal.sourceUrls,
    evidenceQuotes: signal.evidenceQuotes ?? [],
    publishedAt: signal.publishedAt,
    lastSeenAt: signal.lastSeenAt,
    eventStartAt: signal.eventStartAt ?? null,
    eventEndAt: signal.eventEndAt ?? null,
    expiresAt: signal.expiresAt,
    resolvedAt: signal.resolvedAt,
    dedupeKey: signal.dedupeKey,
    confidence: signal.confidence,
    verificationStatus: signal.verificationStatus,
    lifecycle: signal.lifecycle,
    active: signal.active,
  };
}

function shouldActivatePlannedSignal(
  signal: RiskSignal,
  nowMs: number,
): boolean {
  if (signal.lifecycle !== "PLANNED" || !signal.eventStartAt) {
    return false;
  }
  const startMs = Date.parse(signal.eventStartAt);
  return !Number.isNaN(startMs) && startMs <= nowMs;
}

export class ArcadeDbRiskSignalRepository implements RiskSignalRepository {
  constructor(private readonly db: ArcadeDbClient) {}

  async listActive(): Promise<RiskSignal[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT ${RISK_SIGNAL_SELECT_FIELDS}
       FROM RiskSignal
       WHERE active = true`,
    );
    return rows.map(mapRiskSignalRow);
  }

  async ensureDemoSignals(): Promise<RiskSignal[]> {
    for (const signal of DEMO_RISK_SIGNALS) {
      await this.upsertSignal(signal);
    }
    return this.listActive();
  }

  async upsertSignal(incoming: RiskSignal): Promise<UpsertSignalResult> {
    const parsed = RiskSignalSchema.parse(incoming);
    const exactRows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT ${RISK_SIGNAL_SELECT_FIELDS}
       FROM RiskSignal
       WHERE signalId = :signalId
       LIMIT 1`,
      { signalId: parsed.signalId },
    );

    let existing: RiskSignal | null =
      exactRows.length > 0 ? mapRiskSignalRow(exactRows[0]!) : null;

    if (!existing) {
      const candidateRows = await this.db.query<Record<string, unknown>>(
        "sql",
        `SELECT ${RISK_SIGNAL_SELECT_FIELDS}
         FROM RiskSignal
         WHERE active = true AND kind = :kind`,
        { kind: parsed.kind },
      );
      existing = findMatchingSignal(
        candidateRows.map(mapRiskSignalRow),
        parsed,
      );
    }

    if (existing) {
      const merged = RiskSignalSchema.parse(mergeRiskSignals(existing, parsed));
      await this.db.command(
        "sql",
        `UPDATE RiskSignal SET
          severity = :severity,
          description = :description,
          affectedCountryCodes = :affectedCountryCodes,
          affectedChokepoints = :affectedChokepoints,
          affectedSectors = :affectedSectors,
          polygonWkt = :polygonWkt,
          sourceUrls = :sourceUrls,
          evidenceQuotes = :evidenceQuotes,
          lastSeenAt = :lastSeenAt,
          eventStartAt = :eventStartAt,
          eventEndAt = :eventEndAt,
          expiresAt = :expiresAt,
          resolvedAt = :resolvedAt,
          confidence = :confidence,
          verificationStatus = :verificationStatus,
          lifecycle = :lifecycle,
          active = :active
         WHERE signalId = :signalId`,
        toSqlParams(merged),
      );
      return { signal: merged, created: false };
    }

    await this.db.command(
      "sql",
      `CREATE VERTEX RiskSignal SET
        signalId = :signalId,
        kind = :kind,
        severity = :severity,
        title = :title,
        description = :description,
        regionCode = :regionCode,
        affectedCountryCodes = :affectedCountryCodes,
        affectedChokepoints = :affectedChokepoints,
        affectedSectors = :affectedSectors,
        polygonWkt = :polygonWkt,
        sourceUrls = :sourceUrls,
        evidenceQuotes = :evidenceQuotes,
        publishedAt = :publishedAt,
        lastSeenAt = :lastSeenAt,
        eventStartAt = :eventStartAt,
        eventEndAt = :eventEndAt,
        expiresAt = :expiresAt,
        resolvedAt = :resolvedAt,
        dedupeKey = :dedupeKey,
        confidence = :confidence,
        verificationStatus = :verificationStatus,
        lifecycle = :lifecycle,
        active = :active`,
      toSqlParams(parsed),
    );
    return { signal: parsed, created: true };
  }

  async resolveExpired(nowIso: string): Promise<number> {
    const activeRows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT ${RISK_SIGNAL_SELECT_FIELDS}
       FROM RiskSignal
       WHERE active = true`,
    );
    const nowMs = Date.parse(nowIso);
    let resolvedCount = 0;

    for (const row of activeRows) {
      const signal = mapRiskSignalRow(row);
      if (isSignalExpired(signal, nowIso)) {
        await this.db.command(
          "sql",
          `UPDATE RiskSignal SET active = :active, lifecycle = :lifecycle, resolvedAt = :resolvedAt
           WHERE signalId = :signalId`,
          {
            signalId: signal.signalId,
            active: false,
            lifecycle: "RESOLVED",
            resolvedAt: nowIso,
          },
        );
        resolvedCount++;
      } else if (
        !Number.isNaN(nowMs) &&
        shouldActivatePlannedSignal(signal, nowMs)
      ) {
        await this.db.command(
          "sql",
          `UPDATE RiskSignal SET lifecycle = :lifecycle
           WHERE signalId = :signalId`,
          {
            signalId: signal.signalId,
            lifecycle: "ACTIVE",
          },
        );
      }
    }

    return resolvedCount;
  }
}

export class InMemoryRiskSignalRepository implements RiskSignalRepository {
  private readonly signals = new Map<string, RiskSignal>();

  constructor(initialSignals: readonly RiskSignal[] = DEMO_RISK_SIGNALS) {
    for (const signal of initialSignals) {
      this.signals.set(signal.signalId, signal);
    }
  }

  async listActive(): Promise<RiskSignal[]> {
    return Array.from(this.signals.values()).filter(
      (s) => s.active && s.lifecycle !== "RESOLVED",
    );
  }

  async ensureDemoSignals(): Promise<RiskSignal[]> {
    for (const signal of DEMO_RISK_SIGNALS) {
      if (!this.signals.has(signal.signalId)) {
        this.signals.set(signal.signalId, signal);
      }
    }
    return this.listActive();
  }

  async upsertSignal(incoming: RiskSignal): Promise<UpsertSignalResult> {
    const parsed = RiskSignalSchema.parse(incoming);
    const existing = findMatchingSignal(
      Array.from(this.signals.values()),
      parsed,
    );

    if (existing) {
      const merged = RiskSignalSchema.parse(mergeRiskSignals(existing, parsed));
      this.signals.set(merged.signalId, merged);
      return { signal: merged, created: false };
    }

    this.signals.set(parsed.signalId, parsed);
    return { signal: parsed, created: true };
  }

  async resolveExpired(nowIso: string): Promise<number> {
    let count = 0;
    const nowMs = Date.parse(nowIso);
    for (const [id, signal] of this.signals.entries()) {
      if (!signal.active) continue;

      if (isSignalExpired(signal, nowIso)) {
        this.signals.set(id, {
          ...signal,
          active: false,
          lifecycle: "RESOLVED",
          resolvedAt: nowIso,
        });
        count++;
      } else if (
        !Number.isNaN(nowMs) &&
        shouldActivatePlannedSignal(signal, nowMs)
      ) {
        this.signals.set(id, {
          ...signal,
          lifecycle: "ACTIVE",
        });
      }
    }
    return count;
  }
}
