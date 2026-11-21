import type { ConfidenceLevel, EsgSummary, TransportMode } from "@kulgo/shared";
import {
  SECTOR_BASELINE_SCOPE12_TCO2E,
  TRANSPORT_EMISSION_FACTORS_KG_PER_TKM,
} from "./baselines.js";

export interface LaneEmissionInput {
  distanceKm: number;
  annualTonnes: number;
  transportMode: TransportMode;
}

function finitePositive(val: number): boolean {
  return Number.isFinite(val) && val > 0;
}

function finiteNonNegativeOrZero(val: number | null | undefined): number {
  if (val === null || val === undefined || !Number.isFinite(val) || val <= 0) {
    return 0;
  }
  return val;
}

export function estimateLaneCo2eTonnes(input: LaneEmissionInput): number {
  if (!finitePositive(input.distanceKm) || !finitePositive(input.annualTonnes)) {
    return 0;
  }
  const factorKgPerTkm =
    TRANSPORT_EMISSION_FACTORS_KG_PER_TKM[input.transportMode];
  if (!finitePositive(factorKgPerTkm)) {
    return 0;
  }
  const tonnesCo2e =
    (input.distanceKm * input.annualTonnes * factorKgPerTkm) / 1000;
  if (!Number.isFinite(tonnesCo2e)) {
    return 0;
  }
  return Math.round(tonnesCo2e * 100) / 100;
}

export interface SupplierEsgNode {
  isPartnerVerified: boolean;
  sector: string | null;
  reportedScope12Tco2e: number | null;
  hiddenUpstreamScope3Tco2e: number | null;
}

export interface EsgRollupInput {
  ownScope1Tco2e: number;
  ownScope2Tco2e: number;
  suppliers: SupplierEsgNode[];
  laneTransportCo2eTonnes: number[];
}

export function computeEsgSummary(input: EsgRollupInput): EsgSummary {
  const totalSuppliers = input.suppliers.length;
  let verifiedCount = 0;
  let upstreamScope3Tco2e = 0;

  for (const supplier of input.suppliers) {
    const reportedScope12 =
      supplier.reportedScope12Tco2e !== null &&
      Number.isFinite(supplier.reportedScope12Tco2e) &&
      supplier.reportedScope12Tco2e >= 0
        ? supplier.reportedScope12Tco2e
        : null;

    if (supplier.isPartnerVerified) {
      verifiedCount += 1;
      const reported =
        (reportedScope12 ?? 0) +
        finiteNonNegativeOrZero(supplier.hiddenUpstreamScope3Tco2e);
      upstreamScope3Tco2e += reported;
    } else {
      const fallback =
        reportedScope12 ??
        SECTOR_BASELINE_SCOPE12_TCO2E[supplier.sector ?? "Manufacturing"] ??
        SECTOR_BASELINE_SCOPE12_TCO2E.Manufacturing!;
      upstreamScope3Tco2e += finiteNonNegativeOrZero(fallback);
    }
  }

  const transportScope3Tco2e = input.laneTransportCo2eTonnes.reduce(
    (sum, value) => sum + finiteNonNegativeOrZero(value),
    0,
  );

  const verifiedCoveragePct =
    totalSuppliers === 0
      ? 0
      : Math.round((verifiedCount / totalSuppliers) * 100);

  let confidence: ConfidenceLevel = "UNKNOWN";
  if (totalSuppliers > 0) {
    confidence = verifiedCount === totalSuppliers ? "NETWORK_VERIFIED" : "ESTIMATED";
  }

  const scope1 = Math.round(finiteNonNegativeOrZero(input.ownScope1Tco2e) * 100) / 100;
  const scope2 = Math.round(finiteNonNegativeOrZero(input.ownScope2Tco2e) * 100) / 100;
  const upstream = Math.round(finiteNonNegativeOrZero(upstreamScope3Tco2e) * 100) / 100;
  const transport = Math.round(finiteNonNegativeOrZero(transportScope3Tco2e) * 100) / 100;

  return {
    scope1Tco2e: scope1,
    scope2Tco2e: scope2,
    upstreamScope3Tco2e: upstream,
    transportScope3Tco2e: transport,
    totalTco2e: Math.round((scope1 + scope2 + upstream + transport) * 100) / 100,
    confidence,
    verifiedCoveragePct,
  };
}
