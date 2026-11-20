import { RiskSignalSchema, type RiskSignal } from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";

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
    polygonWkt:
      "POLYGON ((20.9 55.6, 28.3 55.6, 28.3 58.1, 20.9 58.1, 20.9 55.6))",
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
    polygonWkt:
      "POLYGON ((110.0 19.5, 122.5 19.5, 122.5 26.5, 110.0 26.5, 110.0 19.5))",
    active: true,
  }),
];

export interface RiskSignalRepository {
  listActive(): Promise<RiskSignal[]>;
  ensureDemoSignals(): Promise<RiskSignal[]>;
}

function mapRiskSignalRow(row: Record<string, unknown>): RiskSignal {
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
    polygonWkt: row.polygonWkt,
    active: row.active !== undefined ? Boolean(row.active) : true,
  });
}

export class ArcadeDbRiskSignalRepository implements RiskSignalRepository {
  constructor(private readonly db: ArcadeDbClient) {}

  async listActive(): Promise<RiskSignal[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT signalId, kind, severity, title, description, regionCode,
              affectedCountryCodes, polygonWkt, active
       FROM RiskSignal
       WHERE active = true`,
    );
    if (rows.length === 0) {
      return [...DEMO_RISK_SIGNALS];
    }
    return rows.map(mapRiskSignalRow);
  }

  async ensureDemoSignals(): Promise<RiskSignal[]> {
    for (const signal of DEMO_RISK_SIGNALS) {
      const existing = await this.db.query<Record<string, unknown>>(
        "sql",
        "SELECT signalId FROM RiskSignal WHERE signalId = :signalId LIMIT 1",
        { signalId: signal.signalId },
      );
      if (existing.length > 0) continue;

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
          polygonWkt = :polygonWkt,
          active = :active`,
        {
          signalId: signal.signalId,
          kind: signal.kind,
          severity: signal.severity,
          title: signal.title,
          description: signal.description,
          regionCode: signal.regionCode,
          affectedCountryCodes: signal.affectedCountryCodes,
          polygonWkt: signal.polygonWkt,
          active: signal.active,
        },
      );
    }

    return this.listActive();
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
    return Array.from(this.signals.values()).filter((s) => s.active);
  }

  async ensureDemoSignals(): Promise<RiskSignal[]> {
    for (const signal of DEMO_RISK_SIGNALS) {
      if (!this.signals.has(signal.signalId)) {
        this.signals.set(signal.signalId, signal);
      }
    }
    return this.listActive();
  }
}
