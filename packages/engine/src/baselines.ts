import type { TransportMode } from "@kulgo/shared";

/**
 * Default GLEC-aligned well-to-wheel freight emission factors
 * expressed in kg CO2e per tonne-kilometer.
 */
export const TRANSPORT_EMISSION_FACTORS_KG_PER_TKM: Record<
  TransportMode,
  number
> = {
  SEA: 0.016,
  RAIL: 0.028,
  ROAD: 0.096,
  AIR: 0.602,
  MULTIMODAL: 0.065,
};

/**
 * Baseline annual Scope 1+2 tCO2e estimate per unverified Tier-1 supplier
 * by broad sector (used strictly as a clearly-labelled ESTIMATED fallback).
 */
export const SECTOR_BASELINE_SCOPE12_TCO2E: Record<string, number> = {
  Electronics: 420,
  Metals: 1150,
  Chemicals: 980,
  Packaging: 260,
  Logistics: 510,
  Manufacturing: 480,
};

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return 0;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

/**
 * Versioned Phase 0 provisional baseline parameters for financial risk modeling.
 * All lane-level probabilities, defect rates, and freight multipliers are
 * explicitly labeled provisional v1 priors (see docs/research/FINANCIAL_RISK_METHODOLOGY.md).
 */
export const FINANCIAL_RISK_BENCHMARK_VERSION =
  "financial-risk-2026-11-21.v1" as const;

export type CorridorBaselineKey =
  | "EU_NORDIC_BALTIC_INTRA"
  | "WESTERN_CENTRAL_EU_OVERLAND"
  | "TRANS_ATLANTIC"
  | "EASTERN_EUROPE_BALTIC_BORDER"
  | "CHINA_EAST_ASIA_SOURCING"
  | "RED_SEA_SUEZ_ASIA_EU_MARITIME";

export type SectorDefectKey =
  | "Electronics"
  | "Metals"
  | "Chemicals"
  | "Packaging"
  | "General Manufacturing";

export type SwitchingReadinessTier =
  | "WARM_SECONDARY"
  | "PREQUALIFIED"
  | "UNQUALIFIED";

export type ExpeditingShiftKey =
  | "SEA_TO_AIR"
  | "SEA_TO_RAIL"
  | "RAIL_TO_ROAD"
  | "ROAD_TO_AIR"
  | "MULTIMODAL_TO_AIR";

export const FINANCIAL_RISK_PARAMS_V1 = {
  benchmarkVersion: FINANCIAL_RISK_BENCHMARK_VERSION,
  dayCountBasis: 365,
  defaultWindowCalendarMonths: 12,
  probabilityCap: 0.95,
  liveRiskMultiplierBounds: [0, 5] as const,
  hiddenProbabilityMultiplierBounds: [1, 2] as const,
  hiddenTtrMultiplierBounds: [1, 2] as const,
  ttrSupportMass: [0.5, 0.4, 0.05, 0.05] as const,
  ttrTailCapFactor: 1.5,
  renewalCliff: { thresholdExclusivePct: 30, lookaheadDays: 90 },
  warmBackupSurgeSlack: 0.25,
  spotGhost: { probabilityMultiplier: 1.35, ttrPenaltyDays: 7, spotPremiumPct: 14 },
  level1: { spendToMarginFactor: [1.0, 2.5, 4.0] as const, defaultTtsDays: 7 },
  sensitivity: { pLow: 0.75, pHigh: 1.25, ttsDeltaDays: 7 },
  carryingCostPct: { low: 10, base: 20, high: 35 },
  corridors: {
    EU_NORDIC_BALTIC_INTRA: { pBase: 0.07, ttrP50: 6, ttrP90: 16, ttrP95: 22 },
    WESTERN_CENTRAL_EU_OVERLAND: {
      pBase: 0.09,
      ttrP50: 7,
      ttrP90: 18,
      ttrP95: 25,
    },
    TRANS_ATLANTIC: { pBase: 0.11, ttrP50: 10, ttrP90: 25, ttrP95: 34 },
    EASTERN_EUROPE_BALTIC_BORDER: {
      pBase: 0.22,
      ttrP50: 15,
      ttrP90: 38,
      ttrP95: 52,
    },
    CHINA_EAST_ASIA_SOURCING: {
      pBase: 0.26,
      ttrP50: 18,
      ttrP90: 45,
      ttrP95: 60,
    },
    RED_SEA_SUEZ_ASIA_EU_MARITIME: {
      pBase: 0.28,
      ttrP50: 24,
      ttrP90: 55,
      ttrP95: 72,
    },
  },
  transportModeModifiers: {
    SEA: {
      probMultiplier: 1.15,
      ttrMultiplier: 1.25,
      defaultLeadTimeDays: 35,
      freightCostShare: 0.06,
    },
    RAIL: {
      probMultiplier: 1.05,
      ttrMultiplier: 1.1,
      defaultLeadTimeDays: 18,
      freightCostShare: 0.05,
    },
    ROAD: {
      probMultiplier: 0.95,
      ttrMultiplier: 0.85,
      defaultLeadTimeDays: 3,
      freightCostShare: 0.05,
    },
    AIR: {
      probMultiplier: 0.75,
      ttrMultiplier: 0.5,
      defaultLeadTimeDays: 3,
      freightCostShare: 0.15,
    },
    MULTIMODAL: {
      probMultiplier: 1.1,
      ttrMultiplier: 1.15,
      defaultLeadTimeDays: 14,
      freightCostShare: 0.055,
    },
  } satisfies Record<
    TransportMode,
    {
      probMultiplier: number;
      ttrMultiplier: number;
      defaultLeadTimeDays: number;
      freightCostShare: number;
    }
  >,
  sectorDefectRatePct: {
    Electronics: { low: 0.5, base: 2.0, high: 5.0 },
    Metals: { low: 0.5, base: 1.5, high: 4.0 },
    Chemicals: { low: 0.2, base: 1.0, high: 3.0 },
    Packaging: { low: 0.5, base: 2.0, high: 5.0 },
    "General Manufacturing": { low: 0.5, base: 2.0, high: 5.0 },
  },
  expeditingFreightMultipliers: {
    SEA_TO_AIR: { low: 4.0, base: 8.5, high: 12.0 },
    SEA_TO_RAIL: { low: 1.5, base: 2.6, high: 4.0 },
    RAIL_TO_ROAD: { low: 1.2, base: 1.9, high: 3.0 },
    ROAD_TO_AIR: { low: 3.0, base: 4.8, high: 10.0 },
    MULTIMODAL_TO_AIR: { low: 4.0, base: 6.5, high: 10.5 },
  },
  switching: {
    WARM_SECONDARY: {
      days: [2, 4, 7] as const,
      eur: [250, 750, 2000] as const,
      spotPremiumPct: [3, 6, 12] as const,
    },
    PREQUALIFIED: {
      days: [7, 14, 30] as const,
      eur: [500, 2000, 8000] as const,
      spotPremiumPct: [8, 14, 25] as const,
    },
    UNQUALIFIED: {
      days: [30, 60, 120] as const,
      eur: [2000, 9500, 40000] as const,
      spotPremiumPct: [12, 20, 35] as const,
    },
  },
} as const;

const NORDIC_BALTIC_COUNTRIES = new Set([
  "EE",
  "LV",
  "LT",
  "FI",
  "SE",
  "DK",
  "NO",
]);
const WESTERN_CENTRAL_EU_COUNTRIES = new Set([
  "DE",
  "PL",
  "NL",
  "BE",
  "FR",
  "IT",
  "AT",
  "CZ",
  "SK",
  "HU",
  "CH",
  "ES",
  "PT",
  "IE",
  "GB",
  "LU",
  "SI",
  "HR",
  "RO",
  "BG",
  "GR",
]);
const EASTERN_BORDER_COUNTRIES = new Set([
  "RU",
  "BY",
  "UA",
  "MD",
  "GE",
  "AM",
  "AZ",
  "KZ",
]);
const EAST_ASIA_COUNTRIES = new Set([
  "CN",
  "TW",
  "KR",
  "JP",
  "VN",
  "TH",
  "MY",
  "SG",
  "ID",
  "IN",
  "PH",
  "HK",
]);
const AMERICAS_COUNTRIES = new Set(["US", "CA", "MX", "BR", "AR", "CL"]);

export function inferCorridorKey(
  fromCountryCode: string,
  toCountryCode: string,
  transportMode: TransportMode,
  matchedChokepoints?: readonly string[],
): CorridorBaselineKey {
  const from = fromCountryCode.toUpperCase();
  const to = toCountryCode.toUpperCase();
  const cps = new Set(matchedChokepoints ?? []);

  if (
    cps.has("SUEZ_CANAL") ||
    cps.has("RED_SEA_BAB_EL_MANDEB") ||
    (EAST_ASIA_COUNTRIES.has(from) && transportMode === "SEA")
  ) {
    return "RED_SEA_SUEZ_ASIA_EU_MARITIME";
  }
  if (EAST_ASIA_COUNTRIES.has(from)) {
    return "CHINA_EAST_ASIA_SOURCING";
  }
  if (
    cps.has("EU_EASTERN_BORDER_CORRIDOR") ||
    EASTERN_BORDER_COUNTRIES.has(from)
  ) {
    return "EASTERN_EUROPE_BALTIC_BORDER";
  }
  if (AMERICAS_COUNTRIES.has(from)) {
    return "TRANS_ATLANTIC";
  }
  if (NORDIC_BALTIC_COUNTRIES.has(from) && NORDIC_BALTIC_COUNTRIES.has(to)) {
    return "EU_NORDIC_BALTIC_INTRA";
  }
  if (
    WESTERN_CENTRAL_EU_COUNTRIES.has(from) ||
    NORDIC_BALTIC_COUNTRIES.has(from)
  ) {
    return "WESTERN_CENTRAL_EU_OVERLAND";
  }
  return transportMode === "SEA"
    ? "RED_SEA_SUEZ_ASIA_EU_MARITIME"
    : "CHINA_EAST_ASIA_SOURCING";
}

export function resolveSectorDefectBaseline(
  sectorOrCategory: string | null | undefined,
): { key: SectorDefectKey; low: number; base: number; high: number } {
  const normalized = (sectorOrCategory ?? "").toLowerCase();
  if (
    normalized.includes("electr") ||
    normalized.includes("semi") ||
    normalized.includes("pcb") ||
    normalized.includes("sensor")
  ) {
    return {
      key: "Electronics",
      ...FINANCIAL_RISK_PARAMS_V1.sectorDefectRatePct.Electronics,
    };
  }
  if (
    normalized.includes("metal") ||
    normalized.includes("steel") ||
    normalized.includes("alum") ||
    normalized.includes("cnc") ||
    normalized.includes("cast")
  ) {
    return {
      key: "Metals",
      ...FINANCIAL_RISK_PARAMS_V1.sectorDefectRatePct.Metals,
    };
  }
  if (
    normalized.includes("chem") ||
    normalized.includes("poly") ||
    normalized.includes("resin") ||
    normalized.includes("coat")
  ) {
    return {
      key: "Chemicals",
      ...FINANCIAL_RISK_PARAMS_V1.sectorDefectRatePct.Chemicals,
    };
  }
  if (
    normalized.includes("pack") ||
    normalized.includes("cardboard") ||
    normalized.includes("pallet") ||
    normalized.includes("label")
  ) {
    return {
      key: "Packaging",
      ...FINANCIAL_RISK_PARAMS_V1.sectorDefectRatePct.Packaging,
    };
  }
  return {
    key: "General Manufacturing",
    ...FINANCIAL_RISK_PARAMS_V1.sectorDefectRatePct["General Manufacturing"],
  };
}
