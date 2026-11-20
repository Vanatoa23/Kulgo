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

export function estimateLaneCo2eTonnes(input: LaneEmissionInput): number {
  if (input.distanceKm <= 0 || input.annualTonnes <= 0) return 0;
  const factorKgPerTkm =
    TRANSPORT_EMISSION_FACTORS_KG_PER_TKM[input.transportMode];
  const tonnesCo2e =
    (input.distanceKm * input.annualTonnes * factorKgPerTkm) / 1000;
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
    if (supplier.isPartnerVerified) {
      verifiedCount += 1;
      const reported =
        (supplier.reportedScope12Tco2e ?? 0) +
        (supplier.hiddenUpstreamScope3Tco2e ?? 0);
      upstreamScope3Tco2e += reported;
    } else {
      const fallback =
        supplier.reportedScope12Tco2e ??
        SECTOR_BASELINE_SCOPE12_TCO2E[supplier.sector ?? "Manufacturing"] ??
        SECTOR_BASELINE_SCOPE12_TCO2E.Manufacturing!;
      upstreamScope3Tco2e += fallback;
    }
  }

  const transportScope3Tco2e = input.laneTransportCo2eTonnes.reduce(
    (sum, value) => sum + Math.max(0, value),
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

  const scope1 = Math.max(0, input.ownScope1Tco2e);
  const scope2 = Math.max(0, input.ownScope2Tco2e);
  const upstream = Math.round(upstreamScope3Tco2e * 100) / 100;
  const transport = Math.round(transportScope3Tco2e * 100) / 100;

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
