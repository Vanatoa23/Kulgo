import type { ConfidenceLevel, EsgSummary, TransportMode } from "@kulgo/shared";
import {
  LEVEL0_DEFAULT_BUYER_SHARE,
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
  /**
   * Optional GHG Protocol Scope 3 Category 1 Product/Volume PCF inputs:
   * `purchasedVolume * productEmissionFactorTco2ePerUnit`.
   */
  purchasedVolume?: number | null;
  productEmissionFactorTco2ePerUnit?: number | null;
  /**
   * Optional Economic Attribution inputs:
   * Either privacy-safe server-side `supplierEmissionIntensityTco2ePerEur`
   * (`supplierTotalTco2e / supplierTotalRevenueEur`, so supplier revenue is never exposed)
   * paired with `buyerActiveSpendEur`, or an explicit `economicAttributionRatio` in [0, 1].
   */
  buyerActiveSpendEur?: number | null;
  supplierEmissionIntensityTco2ePerEur?: number | null;
  economicAttributionRatio?: number | null;
}

/**
 * Computes attributed Scope 3 Category 1 upstream emissions for a single Tier-1 supplier
 * aligned with GHG Protocol Category 1:
 * 1. Product / Volume-based PCF: `purchasedVolume * productEmissionFactorTco2ePerUnit`
 * 2. Server-side Economic Emission Intensity: `buyerActiveSpendEur * supplierEmissionIntensityTco2ePerEur`
 *    (capped at 100% of `rawSupplierTotalTco2e` if positive total is provided so a buyer never exceeds 100%)
 * 3. Explicit `economicAttributionRatio` in (0, 1]: `rawSupplierTotalTco2e * clamp(ratio, 0, 1)`
 * 4. Public sector baseline × provisional 8% SME buyer share when attribution inputs
 *    are missing. This compatibility API has no country/activity data; the current
 *    evaluateEsgAndCompliance API additionally supports physical/spend factors and
 *    country adjustment. Raw partner inventories are never used as fallback activity.
 */
export function computeSupplierScope3Attribution(
  supplier: SupplierEsgNode,
  rawSupplierTotalTco2e: number,
): number {
  const safeRawTotal = finiteNonNegativeOrZero(rawSupplierTotalTco2e);

  // 1. Product / Volume-based PCF (preferred)
  if (
    supplier.purchasedVolume !== null &&
    supplier.purchasedVolume !== undefined &&
    finitePositive(supplier.purchasedVolume) &&
    supplier.productEmissionFactorTco2ePerUnit !== null &&
    supplier.productEmissionFactorTco2ePerUnit !== undefined &&
    finitePositive(supplier.productEmissionFactorTco2ePerUnit)
  ) {
    const pcfTco2e =
      supplier.purchasedVolume * supplier.productEmissionFactorTco2ePerUnit;
    return Number.isFinite(pcfTco2e) && pcfTco2e >= 0 ? pcfTco2e : 0;
  }

  // 2. Privacy-safe server-side Economic Attribution via Emission Intensity (tCO2e / EUR)
  if (
    supplier.buyerActiveSpendEur !== null &&
    supplier.buyerActiveSpendEur !== undefined &&
    finitePositive(supplier.buyerActiveSpendEur) &&
    supplier.supplierEmissionIntensityTco2ePerEur !== null &&
    supplier.supplierEmissionIntensityTco2ePerEur !== undefined &&
    finitePositive(supplier.supplierEmissionIntensityTco2ePerEur)
  ) {
    const attributed =
      supplier.buyerActiveSpendEur *
      supplier.supplierEmissionIntensityTco2ePerEur;
    if (!Number.isFinite(attributed) || attributed <= 0) {
      return 0;
    }
    return safeRawTotal > 0 ? Math.min(safeRawTotal, attributed) : attributed;
  }

  // 3. Explicit economic / volume allocation ratio in [0, 1]
  if (
    supplier.economicAttributionRatio !== null &&
    supplier.economicAttributionRatio !== undefined &&
    Number.isFinite(supplier.economicAttributionRatio) &&
    supplier.economicAttributionRatio >= 0
  ) {
    const clampedRatio = Math.min(1, Math.max(0, supplier.economicAttributionRatio));
    return safeRawTotal * clampedRatio;
  }

  // 4. Keep empty/cycle-broken inventories empty; otherwise use a public proxy.
  if (safeRawTotal === 0) return 0;
  const sectorBaseline =
    SECTOR_BASELINE_SCOPE12_TCO2E[supplier.sector ?? "Manufacturing"] ??
    SECTOR_BASELINE_SCOPE12_TCO2E.Manufacturing!;
  return sectorBaseline * LEVEL0_DEFAULT_BUYER_SHARE;
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
      const rawVerifiedTotal =
        (reportedScope12 ?? 0) +
        finiteNonNegativeOrZero(supplier.hiddenUpstreamScope3Tco2e);
      upstreamScope3Tco2e += computeSupplierScope3Attribution(
        supplier,
        rawVerifiedTotal,
      );
    } else {
      const fallback =
        reportedScope12 ??
        SECTOR_BASELINE_SCOPE12_TCO2E[supplier.sector ?? "Manufacturing"] ??
        SECTOR_BASELINE_SCOPE12_TCO2E.Manufacturing!;
      upstreamScope3Tco2e += computeSupplierScope3Attribution(
        supplier,
        finiteNonNegativeOrZero(fallback),
      );
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

