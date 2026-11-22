import {
  FACTOR_MATRIX_VERSION,
  type CbamCoveredCategory,
  type CbamFlaggedLane,
  type CbamSummary,
  type ComplianceCheckItem,
  type CompliancePackId,
  type ConfidenceLevel,
  type DerivedLaneCommercialSummary,
  type EsgHotspot,
  type EsgLedgerEntry,
  type EsgSummary,
  type EudrCommodity,
  type Facility,
  type MaterialArchetype,
  type PcafBucketSummary,
  type PcafScore,
  type Scope3AttributionMethod,
  type SupplyInput,
  type SupplyLane,
  type TargetMarket,
  type TaxonomyMatchConfidence,
  type VolumeUnit,
} from "@kulgo/shared";
import {
  haversineDistanceKm,
  SECTOR_BASELINE_SCOPE12_TCO2E,
} from "./baselines.js";
import {
  EXIOBASE382_ARCHETYPE_FACTORS,
  EXIOBASE382_LICENSE_ID,
  EXIOBASE382_PROVENANCE,
  EXIOBASE382_SECTOR_SPEND_FACTORS,
  EXIOBASE382_SOURCE_CITATION,
  resolveExiobaseRegionBucket,
} from "./data/exiobase382-factors.js";
import {
  COUNTRY_GRID_FACTORS,
  OPEN_FREIGHT_FACTORS,
  OPEN_PHYSICAL_FACTORS,
  resolveCountryGridFactor,
  USEEIO_V13_LICENSE_ID,
  USEEIO_V13_NA_SPEND_FACTORS,
  USEEIO_V13_SOURCE_CITATION,
} from "./data/open-physical-factors.js";

const EU_EEA_CBAM_EXEMPT = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "NO",
  "IS",
  "LI",
  "CH",
]);

const APAC_COUNTRIES = new Set([
  "SG",
  "JP",
  "AU",
  "KR",
  "TW",
  "HK",
  "MY",
  "NZ",
  "CN",
  "IN",
  "VN",
  "TH",
  "ID",
  "PH",
]);

const AFRICA_COUNTRIES = new Set([
  "ZA",
  "NG",
  "KE",
  "MA",
  "EG",
  "GH",
  "TN",
  "ET",
  "TZ",
]);

const NORTH_AMERICA_USEEIO = new Set(["US", "CA", "MX"]);
const NORDIC_LOW_CARBON_SET = new Set(["SE", "NO", "FI", "IS"]);
const DELIVERED_INCOTERMS = new Set([
  "CIF",
  "CFR",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);

const UFLPA_HIGH_RISK_ORIGINS = new Set(["CN"]);
const CBAM_DE_MINIMIS_TONNES = 50;
const LEVEL0_DEFAULT_BUYER_SHARE = 0.08;

const PCAF_LABELS: Readonly<Record<PcafScore, string>> = {
  1: "Score 1 — Verified Primary Supplier Data",
  2: "Score 2 — Unaudited Primary / Economic Allocation",
  3: "Score 3 — Physical Activity-Based Factor",
  4: "Score 4 — Spend-Based EEIO Factor",
  5: "Score 5 — Country × Sector Proxy Baseline",
};

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function finitePositive(val: number | null | undefined): val is number {
  return typeof val === "number" && Number.isFinite(val) && val > 0;
}

function finiteNonNegative(val: number | null | undefined): number {
  if (typeof val !== "number" || !Number.isFinite(val) || val < 0) return 0;
  return val;
}

export interface ResolvedMaterialTaxonomy {
  archetype: MaterialArchetype | null;
  cbamCategory: CbamCoveredCategory | null;
  eudrCommodity: EudrCommodity | null;
  matchConfidence: TaxonomyMatchConfidence;
}

export function detectCbamCategoryFromCnCode(
  cnCode: string | null | undefined,
): CbamCoveredCategory | null {
  if (!cnCode) return null;
  const digits = cnCode.replace(/\D/g, "");
  if (digits.length < 2) return null;
  if (digits.startsWith("72") || digits.startsWith("73")) return "IRON_STEEL";
  if (digits.startsWith("76")) return "ALUMINUM";
  if (digits.startsWith("2523")) return "CEMENT";
  if (digits.startsWith("31") || digits.startsWith("2808") || digits.startsWith("2814")) {
    return "FERTILIZERS";
  }
  if (digits.startsWith("280410")) return "HYDROGEN";
  if (digits.startsWith("2716")) return "ELECTRICITY";
  return null;
}

export function detectEudrCommodityFromCnCode(
  cnCode: string | null | undefined,
): EudrCommodity | null {
  if (!cnCode) return null;
  const digits = cnCode.replace(/\D/g, "");
  if (digits.startsWith("44") || digits.startsWith("47") || digits.startsWith("48")) {
    return "WOOD_TIMBER";
  }
  if (digits.startsWith("40")) return "RUBBER";
  if (digits.startsWith("0901")) return "COFFEE";
  if (digits.startsWith("1801") || digits.startsWith("1806")) return "COCOA";
  if (digits.startsWith("1511")) return "OIL_PALM";
  if (digits.startsWith("1201")) return "SOYA";
  if (digits.startsWith("0102") || digits.startsWith("4101")) return "CATTLE_LEATHER";
  return null;
}

export function resolveMaterialArchetype(
  input: SupplyInput | undefined,
  lane: SupplyLane,
  supplierFacility: Facility | undefined,
): ResolvedMaterialTaxonomy {
  const cnCode = input?.cnCode ?? null;
  const cnCbam = detectCbamCategoryFromCnCode(cnCode);
  const cnEudr = detectEudrCommodityFromCnCode(cnCode);

  // 1. Explicit CN code mapping
  if (cnCode) {
    const digits = cnCode.replace(/\D/g, "");
    let archetype: MaterialArchetype | null = input?.materialArchetype ?? null;
    if (!archetype) {
      if (digits.startsWith("72")) archetype = "STEEL_PRIMARY_FLAT_BAR";
      else if (digits.startsWith("73")) archetype = "FABRICATED_CNC_METAL_PARTS";
      else if (digits.startsWith("76")) archetype = "ALUMINUM_PRIMARY_INGOT_SHEET";
      else if (digits.startsWith("74")) archetype = "COPPER_BRASS_SEMI";
      else if (digits.startsWith("8534") || digits.startsWith("8542")) {
        archetype = "PCB_SEMICONDUCTOR_ELECTRONICS";
      } else if (digits.startsWith("85")) {
        archetype = "ELECTRICAL_DRIVES_MOTORS_BATTERIES";
      } else if (digits.startsWith("39")) archetype = "PLASTICS_POLYMERS_RESINS";
      else if (digits.startsWith("28") || digits.startsWith("29") || digits.startsWith("31")) {
        archetype = "CHEMICALS_SOLVENTS_INORGANIC";
      } else if (digits.startsWith("48")) archetype = "PACKAGING_CARDBOARD_PAPER";
      else if (digits.startsWith("44")) archetype = "PACKAGING_WOOD_PALLETS";
    }
    const phys = archetype ? OPEN_PHYSICAL_FACTORS[archetype] : null;
    return {
      archetype,
      cbamCategory: cnCbam ?? phys?.cbamCategory ?? null,
      eudrCommodity: cnEudr ?? phys?.eudrCommodity ?? null,
      matchConfidence: "EXACT_CODE",
    };
  }

  // 2. Explicit MaterialArchetype enum
  if (input?.materialArchetype) {
    const phys = OPEN_PHYSICAL_FACTORS[input.materialArchetype];
    return {
      archetype: input.materialArchetype,
      cbamCategory: phys.cbamCategory,
      eudrCommodity: phys.eudrCommodity,
      matchConfidence: "ARCHETYPE",
    };
  }

  // 3. Deterministic keyword classifier over free-text materialCategory / input name
  const text = `${input?.name ?? ""} ${input?.category ?? ""} ${lane.materialCategory}`.toLowerCase();
  const isRecycled = text.includes("recycl") || text.includes("scrap") || text.includes("eaf") || text.includes("secondary");

  if (text.includes("steel") || text.includes("iron") || text.includes("rebar") || text.includes("coil")) {
    const archetype: MaterialArchetype = isRecycled
      ? "STEEL_RECYCLED_EAF"
      : "STEEL_PRIMARY_FLAT_BAR";
    return {
      archetype,
      cbamCategory: "IRON_STEEL",
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("alum")) {
    const archetype: MaterialArchetype = isRecycled
      ? "ALUMINUM_RECYCLED_SECONDARY"
      : "ALUMINUM_PRIMARY_INGOT_SHEET";
    return {
      archetype,
      cbamCategory: "ALUMINUM",
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("copper") || text.includes("brass") || text.includes("busbar")) {
    return {
      archetype: "COPPER_BRASS_SEMI",
      cbamCategory: null,
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("cnc") || text.includes("machin") || text.includes("housing") || text.includes("fastener") || text.includes("metal")) {
    return {
      archetype: "FABRICATED_CNC_METAL_PARTS",
      cbamCategory: null,
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("pcb") || text.includes("semi") || text.includes("chip") || text.includes("ic ") || text.includes("sensor") || text.includes("circuit") || text.includes("electr")) {
    const isDrive = text.includes("motor") || text.includes("drive") || text.includes("battery") || text.includes("inverter");
    return {
      archetype: isDrive ? "ELECTRICAL_DRIVES_MOTORS_BATTERIES" : "PCB_SEMICONDUCTOR_ELECTRONICS",
      cbamCategory: null,
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("plastic") || text.includes("polymer") || text.includes("resin") || text.includes("abs") || text.includes("pvc") || text.includes("poly")) {
    return {
      archetype: "PLASTICS_POLYMERS_RESINS",
      cbamCategory: null,
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("chem") || text.includes("solvent") || text.includes("coat") || text.includes("acid") || text.includes("fertiliz") || text.includes("hydrogen")) {
    const cbam: CbamCoveredCategory | null = text.includes("fertiliz")
      ? "FERTILIZERS"
      : text.includes("hydrogen")
        ? "HYDROGEN"
        : null;
    return {
      archetype: "CHEMICALS_SOLVENTS_INORGANIC",
      cbamCategory: cbam,
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("wood") || text.includes("pallet") || text.includes("timber") || text.includes("crate")) {
    return {
      archetype: "PACKAGING_WOOD_PALLETS",
      cbamCategory: null,
      eudrCommodity: "WOOD_TIMBER",
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("cardboard") || text.includes("paper") || text.includes("carton") || text.includes("pack") || text.includes("label")) {
    return {
      archetype: "PACKAGING_CARDBOARD_PAPER",
      cbamCategory: null,
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }
  if (text.includes("cement") || text.includes("clinker")) {
    return {
      archetype: null,
      cbamCategory: "CEMENT",
      eudrCommodity: null,
      matchConfidence: "KEYWORD_INFERRED",
    };
  }

  // 4. Broad sector fallback
  const sector = (supplierFacility?.sector ?? "").toLowerCase();
  if (sector.includes("metal")) {
    return { archetype: "FABRICATED_CNC_METAL_PARTS", cbamCategory: null, eudrCommodity: null, matchConfidence: "SECTOR_FALLBACK" };
  }
  if (sector.includes("electr")) {
    return { archetype: "PCB_SEMICONDUCTOR_ELECTRONICS", cbamCategory: null, eudrCommodity: null, matchConfidence: "SECTOR_FALLBACK" };
  }
  if (sector.includes("chem")) {
    return { archetype: "PLASTICS_POLYMERS_RESINS", cbamCategory: null, eudrCommodity: null, matchConfidence: "SECTOR_FALLBACK" };
  }
  if (sector.includes("pack")) {
    return { archetype: "PACKAGING_CARDBOARD_PAPER", cbamCategory: null, eudrCommodity: null, matchConfidence: "SECTOR_FALLBACK" };
  }

  return {
    archetype: null,
    cbamCategory: null,
    eudrCommodity: null,
    matchConfidence: "SECTOR_FALLBACK",
  };
}

export function resolveActiveCompliancePacks(
  hqCountryCode: string | null | undefined,
  targetMarkets?: readonly TargetMarket[] | null,
  enabledCompliancePacks?: readonly CompliancePackId[] | null,
): CompliancePackId[] {
  const packs = new Set<CompliancePackId>(["GLOBAL_GHG_ISSB"]);

  if (enabledCompliancePacks && enabledCompliancePacks.length > 0) {
    for (const p of enabledCompliancePacks) packs.add(p);
    return Array.from(packs);
  }

  const hq = (hqCountryCode ?? "").trim().toUpperCase();
  if (EU_EEA_CBAM_EXEMPT.has(hq)) packs.add("EU");
  if (hq === "GB") packs.add("UK");
  if (hq === "US") packs.add("US");
  if (APAC_COUNTRIES.has(hq)) packs.add("APAC");
  if (AFRICA_COUNTRIES.has(hq)) packs.add("AFRICA");

  for (const m of targetMarkets ?? []) {
    packs.add(m);
  }

  return Array.from(packs);
}

function convertToMetricTonnes(
  volume: number | null | undefined,
  unit: string | VolumeUnit | null | undefined,
  unitMassKg: number | null | undefined,
): number | null {
  if (!finitePositive(volume)) return null;
  const u = (unit ?? "TONNES").toUpperCase();
  if (u === "TONNES" || u === "T" || u === "MT") return volume;
  if (u === "KG") return volume / 1000;
  if (u === "G") return volume / 1_000_000;
  if (finitePositive(unitMassKg)) {
    return (volume * unitMassKg) / 1000;
  }
  return null;
}

function resolvePhysicalGeoFactor(
  archetype: MaterialArchetype,
  countryCode: string,
  renewableElectricityPct: number | null | undefined,
  renewableInstrumentsVerified: boolean | undefined,
): { value: number; geoKey: string } {
  const entry = OPEN_PHYSICAL_FACTORS[archetype];
  const cc = countryCode.trim().toUpperCase();
  let geoKey = "EU_AVG";
  let baseValue = entry.tco2ePerTonneByGeo.EU_AVG;

  if (cc === "DE") {
    geoKey = "DE";
    baseValue = entry.tco2ePerTonneByGeo.DE;
  } else if (cc === "CN" || cc === "TW") {
    geoKey = "CN";
    baseValue = entry.tco2ePerTonneByGeo.CN;
  } else if (cc === "IN" || cc === "ZA" || cc === "ID") {
    geoKey = "IN";
    baseValue = entry.tco2ePerTonneByGeo.IN;
  } else if (NORDIC_LOW_CARBON_SET.has(cc)) {
    geoKey = "NORDIC_LOW_CARBON";
    baseValue = entry.tco2ePerTonneByGeo.NORDIC_LOW_CARBON;
  }

  // Only adjust physical factor for renewable electricity when instruments are verified
  if (
    renewableInstrumentsVerified === true &&
    typeof renewableElectricityPct === "number" &&
    Number.isFinite(renewableElectricityPct) &&
    renewableElectricityPct > 0
  ) {
    const grid = resolveCountryGridFactor(cc);
    const baselineRen = grid.baselineRenewablePct;
    const clampedRen = Math.min(100, Math.max(0, renewableElectricityPct));
    if (clampedRen > baselineRen && baselineRen < 100) {
      const incrementalRenShare = (clampedRen - baselineRen) / (100 - baselineRen);
      const factorMult = Math.max(
        0.25,
        1 - entry.electricityShareOfTotal * incrementalRenShare,
      );
      return { value: round4(baseValue * factorMult), geoKey };
    }
  }

  return { value: baseValue, geoKey };
}

export interface EsgPartnerAggregateInput {
  hiddenUpstreamScope3Tco2e: number;
  productEmissionFactorTco2ePerUnit?: number | null;
  pcfVerified?: boolean;
  supplierEmissionIntensityTco2ePerEur?: number | null;
  economicAttributionRatio?: number | null;
  /** Optional server-side cap for verified partner total emissions (never serialized). */
  partnerTotalEmissionsCapTco2e?: number | null;
  /** Optional server-side opaque key identifying the underlying partner inventory pool. */
  partnerInventoryKey?: string | null;
}

export interface EvaluateEsgAndComplianceInput {
  organization: {
    orgId?: string;
    name?: string;
    countryCode?: string;
    scope1Tco2e: number | null;
    scope2Tco2e: number | null;
    scope2MarketTco2e?: number | null;
    annualRevenueEur?: number | null;
    targetMarkets?: readonly TargetMarket[] | null;
    enabledCompliancePacks?: readonly CompliancePackId[] | null;
  };
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  partnerHiddenSummaries?: ReadonlyMap<string, EsgPartnerAggregateInput>;
  laneCommercialsByLaneId?: ReadonlyMap<string, DerivedLaneCommercialSummary>;
  incotermsByLaneId?: ReadonlyMap<string, string | null>;
  includeHubEmissions?: boolean;
}

export interface EvaluateEsgAndComplianceOutput {
  summary: EsgSummary;
  ledgerEntries: EsgLedgerEntry[];
}

export function evaluateEsgAndCompliance(
  input: EvaluateEsgAndComplianceInput,
): EvaluateEsgAndComplianceOutput {
  const orgId = input.organization.orgId ?? "00000000-0000-0000-0000-000000000000";
  const orgName = input.organization.name ?? "Organization";
  const orgCountry = (input.organization.countryCode ?? "EE").toUpperCase();

  const facilitiesById = new Map(input.facilities.map((f) => [f.facilityId, f]));
  const inputsById = new Map(input.inputs.map((i) => [i.inputId, i]));
  const ownFacilities = input.facilities.filter((f) => f.isOwnFacility);
  const activeLanes = input.lanes.filter((l) => l.volumeSharePct > 0);

  const ledgerEntries: EsgLedgerEntry[] = [];

  // --- 1. Own Scope 1 & Dual Scope 2 (Location + Market) ---
  let scope1 = 0;
  let scope2Location = 0;
  let scope2Market: number | null = null;
  let hasUnsubstantiatedRenewable = false;

  const ownFacilitiesWithElectricity = ownFacilities.filter((f) =>
    finitePositive(f.annualElectricityMwh),
  );

  // Scope 1
  if (input.organization.scope1Tco2e !== null && Number.isFinite(input.organization.scope1Tco2e)) {
    scope1 = round2(finiteNonNegative(input.organization.scope1Tco2e));
    if (scope1 > 0) {
      ledgerEntries.push({
        entryId: `scope1-org-${orgId}`,
        scope: "SCOPE_1",
        entityType: "OWN_ORGANIZATION",
        entityId: orgId,
        entityName: orgName,
        countryCode: orgCountry,
        sector: null,
        materialCategory: null,
        materialArchetype: null,
        cnCode: null,
        cbamCategory: null,
        matchConfidence: "PRIMARY_PARTNER",
        activityValue: scope1,
        activityUnit: "tCO2e",
        attributionMethod: "DIRECT_REPORTED",
        factorId: "org_reported_scope1",
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: 1,
        factorUnit: "tCO2e / tCO2e",
        sourceCitation: "Organization-reported direct Scope 1 inventory",
        licenseId: "ORG-REPORTED",
        provenanceStatus: "ORG_REPORTED",
        pcafScore: 2,
        tco2e: scope1,
        formulaTrace: `Reported Scope 1 = ${scope1} tCO2e`,
        networkVerified: true,
      });
    }
  } else {
    const ownReported = ownFacilities.reduce(
      (sum, f) => sum + finiteNonNegative(f.estimatedScope12Tco2e),
      0,
    );
    scope1 = round2(ownReported * 0.4);
    if (scope1 > 0) {
      ledgerEntries.push({
        entryId: `scope1-fac-est-${orgId}`,
        scope: "SCOPE_1",
        entityType: "OWN_ORGANIZATION",
        entityId: orgId,
        entityName: orgName,
        countryCode: orgCountry,
        sector: null,
        materialCategory: null,
        materialArchetype: null,
        cnCode: null,
        cbamCategory: null,
        matchConfidence: "SECTOR_FALLBACK",
        activityValue: ownReported,
        activityUnit: "tCO2e (Scope 1+2 combined)",
        attributionMethod: "DIRECT_REPORTED",
        factorId: "facility_scope12_split_40_60",
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: 0.4,
        factorUnit: "share",
        sourceCitation: "Estimated 40/60 Scope 1/2 split from own facility Scope 1+2",
        licenseId: "ORG-REPORTED",
        provenanceStatus: "ORG_REPORTED",
        pcafScore: 3,
        tco2e: scope1,
        formulaTrace: `${round2(ownReported)} tCO2e × 0.40 = ${scope1} tCO2e`,
        networkVerified: false,
      });
    }
  }

  // Scope 2 Dual (Location-Based + Market-Based)
  // Only replace organization-wide Scope 2 with site-level electricity calculations when:
  //   (a) all own facilities have metered electricity (complete site coverage), OR
  //   (b) organization-wide scope2Tco2e is not reported (null), in which case metered sites
  //       use grid factors and unmetered sites still contribute 60% of their estimatedScope12Tco2e.
  const hasOrgReportedScope2 =
    input.organization.scope2Tco2e !== null &&
    Number.isFinite(input.organization.scope2Tco2e);
  const hasCompleteSiteElectricity =
    ownFacilities.length > 0 &&
    ownFacilitiesWithElectricity.length === ownFacilities.length;
  const useSiteElectricityScope2 =
    ownFacilitiesWithElectricity.length > 0 &&
    (hasCompleteSiteElectricity || !hasOrgReportedScope2);

  if (useSiteElectricityScope2) {
    let locTotal = 0;
    let mktTotal = 0;
    for (const fac of ownFacilitiesWithElectricity) {
      const mwh = fac.annualElectricityMwh!;
      const grid = resolveCountryGridFactor(fac.countryCode);
      const locTco2e = round2(mwh * grid.locationTco2ePerMwh);
      locTotal += locTco2e;

      const renPct =
        typeof fac.renewableElectricityPct === "number" &&
        Number.isFinite(fac.renewableElectricityPct)
          ? Math.min(100, Math.max(0, fac.renewableElectricityPct))
          : 0;
      const verifiedRenPct = fac.renewableInstrumentsVerified === true ? renPct : 0;
      if (renPct > 0 && fac.renewableInstrumentsVerified !== true) {
        hasUnsubstantiatedRenewable = true;
      }

      const unmatchedMwh = mwh * (1 - verifiedRenPct / 100);
      const mktTco2e = round2(unmatchedMwh * grid.marketResidualTco2ePerMwh);
      mktTotal += mktTco2e;

      ledgerEntries.push({
        entryId: `scope2-loc-${fac.facilityId}`,
        scope: "SCOPE_2_LOCATION",
        entityType: "OWN_FACILITY",
        entityId: fac.facilityId,
        entityName: fac.name,
        countryCode: fac.countryCode,
        sector: fac.sector,
        materialCategory: "Purchased Electricity (Location-Based)",
        materialArchetype: null,
        cnCode: "2716",
        cbamCategory: null,
        matchConfidence: "EXACT_CODE",
        activityValue: round2(mwh),
        activityUnit: "MWh",
        attributionMethod: "GRID_LOCATION_BASED",
        factorId: `grid_loc_${fac.countryCode.toLowerCase()}_2026`,
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: grid.locationTco2ePerMwh,
        factorUnit: "tCO2e / MWh",
        sourceCitation: grid.sourceCitation,
        licenseId: grid.licenseId,
        provenanceStatus: "OFFICIAL_PUBLISHED",
        pcafScore: 2,
        tco2e: locTco2e,
        formulaTrace: `${round2(mwh)} MWh × ${grid.locationTco2ePerMwh} tCO2e/MWh (${grid.accountingBasis}) = ${locTco2e} tCO2e`,
        networkVerified: true,
      });

      ledgerEntries.push({
        entryId: `scope2-mkt-${fac.facilityId}`,
        scope: "SCOPE_2_MARKET",
        entityType: "OWN_FACILITY",
        entityId: fac.facilityId,
        entityName: fac.name,
        countryCode: fac.countryCode,
        sector: fac.sector,
        materialCategory: "Purchased Electricity (Market-Based)",
        materialArchetype: null,
        cnCode: "2716",
        cbamCategory: null,
        matchConfidence: "EXACT_CODE",
        activityValue: round2(unmatchedMwh),
        activityUnit: "MWh (unmatched)",
        attributionMethod: "GRID_MARKET_BASED",
        factorId: `grid_residual_${fac.countryCode.toLowerCase()}_2026`,
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: grid.marketResidualTco2ePerMwh,
        factorUnit: "tCO2e / MWh",
        sourceCitation: grid.sourceCitation,
        licenseId: grid.licenseId,
        provenanceStatus: "OFFICIAL_PUBLISHED",
        pcafScore: fac.renewableInstrumentsVerified ? 2 : 3,
        tco2e: mktTco2e,
        formulaTrace: `${round2(mwh)} MWh × (1 - ${verifiedRenPct}% verified GO/REC) × ${grid.marketResidualTco2ePerMwh} tCO2e/MWh = ${mktTco2e} tCO2e`,
        networkVerified: Boolean(fac.renewableInstrumentsVerified),
      });
    }

    // Include estimated Scope 2 (60% of estimatedScope12Tco2e) for any unmetered own sites
    // so partial electricity data never silently drops remaining facilities.
    const meteredFacilityIds = new Set(
      ownFacilitiesWithElectricity.map((f) => f.facilityId),
    );
    let unmeteredLocTotal = 0;
    for (const fac of ownFacilities) {
      if (meteredFacilityIds.has(fac.facilityId)) continue;
      const estScope2 = round2(finiteNonNegative(fac.estimatedScope12Tco2e) * 0.6);
      if (estScope2 <= 0) continue;
      unmeteredLocTotal += estScope2;
      ledgerEntries.push({
        entryId: `scope2-loc-est-${fac.facilityId}`,
        scope: "SCOPE_2_LOCATION",
        entityType: "OWN_FACILITY",
        entityId: fac.facilityId,
        entityName: fac.name,
        countryCode: fac.countryCode,
        sector: fac.sector,
        materialCategory: "Purchased Electricity (Estimated Location-Based)",
        materialArchetype: null,
        cnCode: "2716",
        cbamCategory: null,
        matchConfidence: "SECTOR_FALLBACK",
        activityValue: round2(finiteNonNegative(fac.estimatedScope12Tco2e)),
        activityUnit: "tCO2e (Scope 1+2 combined)",
        attributionMethod: "DIRECT_REPORTED",
        factorId: "facility_scope12_split_40_60",
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: 0.6,
        factorUnit: "share",
        sourceCitation: "Estimated 60% Scope 2 share for unmetered own facility",
        licenseId: "ORG-REPORTED",
        provenanceStatus: "ORG_REPORTED",
        pcafScore: 3,
        tco2e: estScope2,
        formulaTrace: `${round2(finiteNonNegative(fac.estimatedScope12Tco2e))} tCO2e × 0.60 = ${estScope2} tCO2e`,
        networkVerified: false,
      });
    }

    scope2Location = round2(locTotal + unmeteredLocTotal);
    scope2Market = hasCompleteSiteElectricity
      ? round2(mktTotal)
      : unmeteredLocTotal === 0
        ? round2(mktTotal)
        : null;
  } else {
    if (input.organization.scope2Tco2e !== null && Number.isFinite(input.organization.scope2Tco2e)) {
      scope2Location = round2(finiteNonNegative(input.organization.scope2Tco2e));
    } else {
      const ownReported = ownFacilities.reduce(
        (sum, f) => sum + finiteNonNegative(f.estimatedScope12Tco2e),
        0,
      );
      scope2Location = round2(ownReported * 0.6);
    }

    if (scope2Location > 0) {
      ledgerEntries.push({
        entryId: `scope2-loc-org-${orgId}`,
        scope: "SCOPE_2_LOCATION",
        entityType: "OWN_ORGANIZATION",
        entityId: orgId,
        entityName: orgName,
        countryCode: orgCountry,
        sector: null,
        materialCategory: "Purchased Electricity (Location-Based)",
        materialArchetype: null,
        cnCode: null,
        cbamCategory: null,
        matchConfidence: "PRIMARY_PARTNER",
        activityValue: scope2Location,
        activityUnit: "tCO2e",
        attributionMethod: "DIRECT_REPORTED",
        factorId: "org_reported_scope2_location",
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: 1,
        factorUnit: "tCO2e / tCO2e",
        sourceCitation: "Organization-reported Scope 2 location-based inventory",
        licenseId: "ORG-REPORTED",
        provenanceStatus: "ORG_REPORTED",
        pcafScore: 2,
        tco2e: scope2Location,
        formulaTrace: `Reported Scope 2 (Location) = ${scope2Location} tCO2e`,
        networkVerified: true,
      });
    }

    if (
      input.organization.scope2MarketTco2e !== null &&
      input.organization.scope2MarketTco2e !== undefined &&
      Number.isFinite(input.organization.scope2MarketTco2e)
    ) {
      scope2Market = round2(finiteNonNegative(input.organization.scope2MarketTco2e));
      ledgerEntries.push({
        entryId: `scope2-mkt-org-${orgId}`,
        scope: "SCOPE_2_MARKET",
        entityType: "OWN_ORGANIZATION",
        entityId: orgId,
        entityName: orgName,
        countryCode: orgCountry,
        sector: null,
        materialCategory: "Purchased Electricity (Market-Based)",
        materialArchetype: null,
        cnCode: null,
        cbamCategory: null,
        matchConfidence: "PRIMARY_PARTNER",
        activityValue: scope2Market,
        activityUnit: "tCO2e",
        attributionMethod: "DIRECT_REPORTED",
        factorId: "org_reported_scope2_market",
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: 1,
        factorUnit: "tCO2e / tCO2e",
        sourceCitation: "Organization-reported Scope 2 market-based inventory",
        licenseId: "ORG-REPORTED",
        provenanceStatus: "ORG_REPORTED",
        pcafScore: 2,
        tco2e: scope2Market,
        formulaTrace: `Reported Scope 2 (Market) = ${scope2Market} tCO2e`,
        networkVerified: true,
      });
    }
  }

  // --- 2. Scope 3 Category 1 (Per-Lane 6-Step Waterfall) & Category 4 (Freight) ---
  const activeSupplierIds = new Set(activeLanes.map((l) => l.fromFacilityId));
  const activeSuppliers = input.facilities.filter(
    (f) => !f.isOwnFacility && activeSupplierIds.has(f.facilityId),
  );
  const verifiedSupplierCount = activeSuppliers.filter((f) => f.isPartnerVerified).length;

  // Track cumulative supplier cap per underlying partner inventory pool
  // (using hidden.partnerInventoryKey when available so multiple buyer nodes
  // linked to the same partner inventory share a single 100% cap).
  const remainingPartnerCapByKey = new Map<string, number>();
  for (const fac of activeSuppliers) {
    const hidden = input.partnerHiddenSummaries?.get(fac.facilityId);
    const capKey = hidden?.partnerInventoryKey ?? fac.facilityId;
    if (remainingPartnerCapByKey.has(capKey)) continue;
    const explicitCap = finitePositive(hidden?.partnerTotalEmissionsCapTco2e)
      ? hidden!.partnerTotalEmissionsCapTco2e!
      : finiteNonNegative(fac.estimatedScope12Tco2e) +
        finiteNonNegative(hidden?.hiddenUpstreamScope3Tco2e);
    if (explicitCap > 0) {
      remainingPartnerCapByKey.set(capKey, explicitCap);
    }
  }

  // Deduplicate Level-0 unpriced/unvolumed suppliers so 3 unpriced lanes from 1 vendor aren't triple-counted
  const level0BaselineEmittedForFacility = new Set<string>();

  let upstreamScope3Tco2e = 0;
  let transportScope3Tco2e = 0;
  let primaryDataScope3Tco2e = 0;
  let totalPhysicalTonnes = 0;
  let unscaledReportedWarningCount = 0;

  const hotspotsRaw: EsgHotspot[] = [];
  const cbamFlaggedLanes: CbamFlaggedLane[] = [];
  let cbamCumulativeMassTonnes = 0;
  let cbamHasNoThresholdCategory = false;

  const eudrLanesMissingSiteVerification: string[] = [];
  const uflpaFlaggedFacilityIds: string[] = [];

  for (const lane of activeLanes) {
    const supplier = facilitiesById.get(lane.fromFacilityId);
    const destination = facilitiesById.get(lane.toFacilityId);
    if (!supplier) continue;

    const supplyInput = lane.inputId ? inputsById.get(lane.inputId) : undefined;
    const hidden = input.partnerHiddenSummaries?.get(supplier.facilityId);
    const partnerCapKey = hidden?.partnerInventoryKey ?? supplier.facilityId;
    const derivedComm = input.laneCommercialsByLaneId?.get(lane.laneId);
    const incoterms = (input.incotermsByLaneId?.get(lane.laneId) ?? "").trim().toUpperCase();

    // When a contract-derived commercial summary exists, treat its derived
    // activeVolume/activeSpendEur as authoritative (including LEVEL_0_UNPRICED,
    // because contracts.ts already handles legacy fallback when a lane has no
    // contract lines and uses LEVEL_0_UNPRICED for future/archived contracts).
    const useDerivedCommercial = derivedComm !== undefined;

    const activeVolume = useDerivedCommercial
      ? finitePositive(derivedComm.activeVolume)
        ? derivedComm.activeVolume
        : null
      : finitePositive(lane.annualVolume)
        ? lane.annualVolume
        : null;
    const activeUnit = useDerivedCommercial
      ? derivedComm.baseUnit ?? supplyInput?.baseUnit ?? lane.volumeUnit
      : supplyInput?.baseUnit ?? lane.volumeUnit;
    const activeSpendEur = useDerivedCommercial
      ? finitePositive(derivedComm.activeSpendEur)
        ? derivedComm.activeSpendEur
        : null
      : finitePositive(lane.annualSpendEur)
        ? lane.annualSpendEur
        : null;

    const massTonnes = convertToMetricTonnes(
      activeVolume,
      activeUnit,
      supplyInput?.unitMassKg,
    );
    if (massTonnes !== null) {
      totalPhysicalTonnes += massTonnes;
    }

    const taxonomy = resolveMaterialArchetype(supplyInput, lane, supplier);
    const cnCode = supplyInput?.cnCode ?? null;

    // EUDR & UFLPA checks
    if (taxonomy.eudrCommodity && supplier.locationPrecision !== "SITE_VERIFIED") {
      eudrLanesMissingSiteVerification.push(lane.laneId);
    }
    if (UFLPA_HIGH_RISK_ORIGINS.has(supplier.countryCode.toUpperCase()) && !supplier.isPartnerVerified) {
      uflpaFlaggedFacilityIds.push(supplier.facilityId);
    }

    // Resolve Category 1 attribution method (6-Step Waterfall)
    const pcfFactor =
      lane.productEmissionFactorTco2ePerUnit ??
      hidden?.productEmissionFactorTco2ePerUnit ??
      supplyInput?.productEmissionFactorTco2ePerUnit ??
      null;
    const pcfVerified = Boolean(
      lane.pcfVerified ?? hidden?.pcfVerified ?? supplyInput?.pcfVerified ?? false,
    );
    const partnerIntensity = hidden?.supplierEmissionIntensityTco2ePerEur ?? null;
    const explicitRatio =
      lane.economicAttributionRatio ?? hidden?.economicAttributionRatio ?? null;

    let cat1Tco2e = 0;
    let method: Scope3AttributionMethod = "SECTOR_BASELINE";
    let pcafScore: PcafScore = 5;
    let factorId = "";
    let factorValue = 0;
    let factorUnit = "";
    let sourceCitation = "";
    let licenseId = "";
    let provenanceStatus: EsgLedgerEntry["provenanceStatus"] = "CALIBRATED_BASELINE_V1";
    let activityValue: number | null = null;
    let activityUnit = activeUnit;
    let formulaTrace = "";
    let matchConfidence: TaxonomyMatchConfidence = taxonomy.matchConfidence;
    let skipLedgerEmission = false;

    // Priority 1: PCF_VOLUME (PCAF 1 if third-party verified, else 2)
    if (finitePositive(activeVolume) && finitePositive(pcfFactor)) {
      method = "PCF_VOLUME";
      cat1Tco2e = round2(activeVolume * pcfFactor);
      pcafScore = pcfVerified ? 1 : 2;
      factorId = `partner_pcf_${lane.laneId.slice(0, 8)}`;
      factorValue = round4(pcfFactor);
      factorUnit = `tCO2e / ${activeUnit}`;
      sourceCitation = pcfVerified
        ? "Third-party verified supplier Product Carbon Footprint (PACT/EPD)"
        : "Supplier-provided primary Product Carbon Footprint (unaudited)";
      licenseId = "PARTNER-PRIMARY";
      provenanceStatus = "PARTNER_PRIMARY";
      matchConfidence = "PRIMARY_PARTNER";
      activityValue = round2(activeVolume);
      activityUnit = activeUnit;
      formulaTrace = `${round2(activeVolume)} ${activeUnit} × ${round4(pcfFactor)} tCO2e/${activeUnit} = ${cat1Tco2e} tCO2e`;
    }
    // Priority 2: ECONOMIC_INTENSITY (Server-side, partner revenue strictly hidden — PCAF 2)
    else if (
      supplier.isPartnerVerified &&
      finitePositive(activeSpendEur) &&
      finitePositive(partnerIntensity)
    ) {
      method = "ECONOMIC_INTENSITY";
      const rawAttributed = activeSpendEur * partnerIntensity;
      const capRemaining = remainingPartnerCapByKey.get(partnerCapKey);
      const capped =
        capRemaining !== undefined ? Math.min(capRemaining, rawAttributed) : rawAttributed;
      if (capRemaining !== undefined) {
        remainingPartnerCapByKey.set(
          partnerCapKey,
          Math.max(0, capRemaining - capped),
        );
      }
      cat1Tco2e = round2(capped);
      pcafScore = 2;
      factorId = `verified_partner_intensity_${supplier.facilityId.slice(0, 8)}`;
      factorValue = round4(partnerIntensity * 1000); // kgCO2e / EUR for readability
      factorUnit = "kgCO2e / EUR";
      sourceCitation =
        "Verified Kulgo Tier-1 Partner Server-Side Emission Intensity (revenue confidential)";
      licenseId = "PARTNER-PRIMARY";
      provenanceStatus = "PARTNER_PRIMARY";
      matchConfidence = "PRIMARY_PARTNER";
      activityValue = round2(activeSpendEur);
      activityUnit = "EUR";
      // Privacy invariant: NEVER print partner revenue or partner total emissions!
      formulaTrace = `€${round2(activeSpendEur)} × ${partnerIntensity.toFixed(6)} tCO2e/EUR (verified partner intensity) = ${cat1Tco2e} tCO2e`;
    }
    // Priority 3: ALLOCATION_RATIO (0 < ratio <= 1 — PCAF 2, capped by shared partner inventory cap, zero raw pool leakage)
    else if (
      finitePositive(explicitRatio) &&
      explicitRatio <= 1 &&
      (finitePositive(supplier.estimatedScope12Tco2e) ||
        finitePositive(hidden?.hiddenUpstreamScope3Tco2e))
    ) {
      method = "ALLOCATION_RATIO";
      const rawPool =
        finiteNonNegative(supplier.estimatedScope12Tco2e) +
        finiteNonNegative(hidden?.hiddenUpstreamScope3Tco2e);
      const rawAllocated = rawPool * explicitRatio;
      const capRemaining = remainingPartnerCapByKey.get(partnerCapKey);
      const capped =
        capRemaining !== undefined ? Math.min(capRemaining, rawAllocated) : rawAllocated;
      if (capRemaining !== undefined) {
        remainingPartnerCapByKey.set(
          partnerCapKey,
          Math.max(0, capRemaining - capped),
        );
      }
      cat1Tco2e = round2(capped);
      pcafScore = 2;
      factorId = `supplier_allocation_${supplier.facilityId.slice(0, 8)}`;
      factorValue = round4(explicitRatio);
      factorUnit = "allocation ratio";
      sourceCitation = supplier.isPartnerVerified
        ? "Verified Tier-1 Partner Proportional Allocation (pool confidential)"
        : "Supplier-Reported Emissions × Explicit Allocation Share";
      licenseId = "PARTNER-PRIMARY";
      provenanceStatus = "PARTNER_PRIMARY";
      matchConfidence = "PRIMARY_PARTNER";
      // Privacy invariant: NEVER serialize rawPool in activityValue or formulaTrace!
      activityValue = round4(explicitRatio);
      activityUnit = "allocation share";
      formulaTrace = `Allocated share (${round2(explicitRatio * 100)}%) of confidential supplier emissions = ${cat1Tco2e} tCO2e`;
    }
    // Priority 4: PHYSICAL_FACTOR (Rank #1 Open Physical Core — PCAF 3)
    else if (massTonnes !== null && taxonomy.archetype !== null) {
      method = "PHYSICAL_FACTOR";
      const physEntry = OPEN_PHYSICAL_FACTORS[taxonomy.archetype];
      const { value: physFactor, geoKey } = resolvePhysicalGeoFactor(
        taxonomy.archetype,
        supplier.countryCode,
        supplier.renewableElectricityPct,
        supplier.renewableInstrumentsVerified,
      );
      cat1Tco2e = round2(massTonnes * physFactor);
      pcafScore = 3;
      factorId = `${physEntry.factorIdPrefix}_${geoKey.toLowerCase()}_2026`;
      factorValue = physFactor;
      factorUnit = "tCO2e / tonne";
      sourceCitation = physEntry.sourceCitation;
      licenseId = physEntry.licenseId;
      provenanceStatus = physEntry.provenanceStatus;
      activityValue = round2(massTonnes);
      activityUnit = "TONNES";
      formulaTrace = `${round2(massTonnes)} t × ${physFactor} tCO2e/t (${geoKey}) = ${cat1Tco2e} tCO2e`;
    }
    // Priority 5: SPEND_EEIO (Rank #2 EXIOBASE v3.8.2 pxp / Rank #3 US EPA USEEIO v1.3 — PCAF 4/5)
    else if (finitePositive(activeSpendEur)) {
      method = "SPEND_EEIO";
      const cc = supplier.countryCode.toUpperCase();
      const useUseeio = NORTH_AMERICA_USEEIO.has(cc) && taxonomy.archetype !== null;
      const isDelivered = DELIVERED_INCOTERMS.has(incoterms);

      if (useUseeio && taxonomy.archetype) {
        const naFactor = USEEIO_V13_NA_SPEND_FACTORS[taxonomy.archetype];
        const marginStrip = isDelivered
          ? EXIOBASE382_ARCHETYPE_FACTORS[taxonomy.archetype].deliveredMarginStripRatio
          : 0;
        const basisSpend = activeSpendEur * (1 - marginStrip);
        cat1Tco2e = round2((basisSpend * naFactor.kgCo2ePerEur2026) / 1000);
        pcafScore = 4;
        factorId = naFactor.factorId;
        factorValue = naFactor.kgCo2ePerEur2026;
        factorUnit = "kgCO2e / EUR_2026";
        sourceCitation = USEEIO_V13_SOURCE_CITATION;
        licenseId = USEEIO_V13_LICENSE_ID;
        provenanceStatus = "OFFICIAL_PUBLISHED";
        activityValue = round2(basisSpend);
        activityUnit = "EUR";
        formulaTrace = isDelivered
          ? `€${round2(activeSpendEur)} × (1 - ${round2(marginStrip * 100)}% ${incoterms} strip) × ${naFactor.kgCo2ePerEur2026} kgCO2e/€ / 1000 = ${cat1Tco2e} tCO2e`
          : `€${round2(activeSpendEur)} × ${naFactor.kgCo2ePerEur2026} kgCO2e/€ / 1000 = ${cat1Tco2e} tCO2e`;
      } else {
        const { bucket, isExactOrRegional } = resolveExiobaseRegionBucket(cc);
        let kgPerEur = 0.81;
        let exioCode = "sector_mfg";
        let marginStripRatio = 0.08;

        if (taxonomy.archetype) {
          const exioEntry = EXIOBASE382_ARCHETYPE_FACTORS[taxonomy.archetype];
          kgPerEur = exioEntry.kgCo2ePerEur2026[bucket];
          exioCode = exioEntry.exiobaseCode;
          marginStripRatio = exioEntry.deliveredMarginStripRatio;
        } else {
          const secKey = supplier.sector ?? "Manufacturing";
          const secMap =
            EXIOBASE382_SECTOR_SPEND_FACTORS[secKey] ??
            EXIOBASE382_SECTOR_SPEND_FACTORS.Manufacturing!;
          kgPerEur = secMap[bucket];
          exioCode = `sector_${secKey.toLowerCase()}`;
        }

        const marginStrip = isDelivered ? marginStripRatio : 0;
        const basisSpend = activeSpendEur * (1 - marginStrip);
        cat1Tco2e = round2((basisSpend * kgPerEur) / 1000);
        pcafScore = isExactOrRegional && taxonomy.archetype !== null ? 4 : 5;
        factorId = `exiobase382_pxp_${bucket.toLowerCase()}_${exioCode.replace(/\./g, "")}_2026`;
        factorValue = kgPerEur;
        factorUnit = "kgCO2e / EUR_2026";
        sourceCitation = EXIOBASE382_SOURCE_CITATION;
        licenseId = EXIOBASE382_LICENSE_ID;
        provenanceStatus = EXIOBASE382_PROVENANCE;
        activityValue = round2(basisSpend);
        activityUnit = "EUR";
        formulaTrace = isDelivered
          ? `€${round2(activeSpendEur)} × (1 - ${round2(marginStrip * 100)}% ${incoterms} strip) × ${kgPerEur} kgCO2e/€ / 1000 = ${cat1Tco2e} tCO2e`
          : `€${round2(activeSpendEur)} × ${kgPerEur} kgCO2e/€ / 1000 = ${cat1Tco2e} tCO2e`;
      }
    }
    // Priority 6: SECTOR_BASELINE (Level-0 Country × Sector proxy scaled by buyer share prior — PCAF 5)
    // Privacy invariant: when a verified partner has no PCF, intensity+spend, explicit allocation
    // ratio, physical volume, or spend basis, NEVER attribute or expose its raw private footprint.
    else {
      method = "SECTOR_BASELINE";
      if (supplier.isPartnerVerified && hidden) {
        unscaledReportedWarningCount += 1;
      }
      if (level0BaselineEmittedForFacility.has(supplier.facilityId)) {
        skipLedgerEmission = true;
      } else {
        level0BaselineEmittedForFacility.add(supplier.facilityId);
        if (supplier.isPartnerVerified && !hidden && !finitePositive(supplier.estimatedScope12Tco2e)) {
          // Cycle-broken verified partner with no activity data: emit 0 to prevent circular double-counting
          skipLedgerEmission = true;
        } else if (finitePositive(supplier.estimatedScope12Tco2e)) {
          unscaledReportedWarningCount += 1;
          cat1Tco2e = round2(supplier.estimatedScope12Tco2e);
          pcafScore = 5;
          factorId = `supplier_reported_unscaled_${supplier.facilityId.slice(0, 8)}`;
          factorValue = cat1Tco2e;
          factorUnit = "tCO2e (unscaled supplier estimate)";
          sourceCitation =
            "User-entered supplier facility Scope 1+2 estimate (add spend, volume, or allocation share for proportional attribution)";
          licenseId = "ORG-REPORTED";
          provenanceStatus = "ORG_REPORTED";
          activityValue = cat1Tco2e;
          activityUnit = "tCO2e";
          formulaTrace = `Unscaled supplier estimate = ${cat1Tco2e} tCO2e (add spend/volume/ratio)`;
        } else {
          const sectorKey = supplier.sector ?? "Manufacturing";
          const facilityBaseline =
            SECTOR_BASELINE_SCOPE12_TCO2E[sectorKey] ??
            SECTOR_BASELINE_SCOPE12_TCO2E.Manufacturing!;
          const eu27Grid = COUNTRY_GRID_FACTORS.EU27!.locationTco2ePerMwh;
          const supplierGrid = resolveCountryGridFactor(supplier.countryCode).locationTco2ePerMwh;
          const countryMod = Math.min(2.2, Math.max(0.35, supplierGrid / eu27Grid));

          cat1Tco2e = round2(facilityBaseline * countryMod * LEVEL0_DEFAULT_BUYER_SHARE);
          pcafScore = 5;
          factorId = `kulgo_level0_proxy_${sectorKey.toLowerCase()}_${supplier.countryCode.toLowerCase()}_2026`;
          factorValue = round2(facilityBaseline * countryMod);
          factorUnit = "tCO2e / supplier-year (8% SME buyer-share prior)";
          sourceCitation =
            "Kulgo Level-0 Country-Grid-Adjusted Sector Proxy (8% provisional SME buyer-share prior; prevents 100% over-attribution)";
          licenseId = "CC-BY-4.0";
          provenanceStatus = "CALIBRATED_BASELINE_V1";
          activityValue = LEVEL0_DEFAULT_BUYER_SHARE;
          activityUnit = "buyer-share prior";
          formulaTrace = `${facilityBaseline} tCO2e × ${round2(countryMod)} grid-mod × 8% buyer-share prior = ${cat1Tco2e} tCO2e`;
        }
      }
    }

    if (!skipLedgerEmission) {
      upstreamScope3Tco2e += cat1Tco2e;
      if (pcafScore === 1 || pcafScore === 2) {
        primaryDataScope3Tco2e += cat1Tco2e;
      }

      ledgerEntries.push({
        entryId: `scope3-cat1-${lane.laneId}`,
        scope: "SCOPE_3_CAT_1",
        entityType: "TIER1_SUPPLIER_LANE",
        entityId: lane.laneId,
        entityName: `${supplier.name} → ${lane.materialCategory}`,
        countryCode: supplier.countryCode,
        sector: supplier.sector,
        materialCategory: lane.materialCategory,
        materialArchetype: taxonomy.archetype,
        cnCode,
        cbamCategory: taxonomy.cbamCategory,
        matchConfidence,
        activityValue,
        activityUnit,
        attributionMethod: method,
        factorId,
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue,
        factorUnit,
        sourceCitation,
        licenseId,
        provenanceStatus,
        pcafScore,
        tco2e: cat1Tco2e,
        formulaTrace,
        networkVerified: supplier.isPartnerVerified,
      });

      hotspotsRaw.push({
        entityId: lane.laneId,
        entityType: "TIER1_SUPPLIER_LANE",
        entityName: supplier.name,
        materialCategory: lane.materialCategory,
        countryCode: supplier.countryCode,
        tco2e: cat1Tco2e,
        shareOfScope3Pct: 0, // populated after total Scope 3 is known
        pcafScore,
        attributionMethod: method,
        cbamCategory: taxonomy.cbamCategory,
      });

      // EU CBAM flagging for non-EU/EEA imports
      if (
        taxonomy.cbamCategory !== null &&
        !EU_EEA_CBAM_EXEMPT.has(supplier.countryCode.toUpperCase())
      ) {
        if (
          taxonomy.cbamCategory === "ELECTRICITY" ||
          taxonomy.cbamCategory === "HYDROGEN"
        ) {
          cbamHasNoThresholdCategory = true;
        } else if (massTonnes !== null) {
          cbamCumulativeMassTonnes += massTonnes;
        }

        cbamFlaggedLanes.push({
          laneId: lane.laneId,
          supplierName: supplier.name,
          originCountryCode: supplier.countryCode.toUpperCase(),
          materialCategory: lane.materialCategory,
          cnCode,
          cbamCategory: taxonomy.cbamCategory,
          annualTonnes: massTonnes !== null ? round2(massTonnes) : null,
          embeddedTco2e: cat1Tco2e,
          usingDefaultFactor: pcafScore >= 3,
          pcafScore,
        });
      }
    }

    // --- Scope 3 Category 4: Upstream Freight ---
    const freightFactor = OPEN_FREIGHT_FACTORS[lane.transportMode];
    let laneFreightTco2e = 0;
    let effectiveDistanceKm = 0;
    let usedHaversine = false;

    if (finitePositive(lane.estimatedLaneCo2e)) {
      laneFreightTco2e = round2(lane.estimatedLaneCo2e);
    } else if (massTonnes !== null) {
      if (finitePositive(lane.distanceKm)) {
        effectiveDistanceKm = lane.distanceKm;
      } else if (destination) {
        const gcd = haversineDistanceKm(
          supplier.lat,
          supplier.lng,
          destination.lat,
          destination.lng,
        );
        usedHaversine = true;
        effectiveDistanceKm = round2(
          gcd * freightFactor.haversineCircuityMultiplier +
            freightFactor.haversineAdditiveKm,
        );
      }

      if (effectiveDistanceKm > 0) {
        const hubKg = input.includeHubEmissions ? freightFactor.hubPenaltyKgPerTonne : 0;
        laneFreightTco2e = round2(
          (massTonnes * (effectiveDistanceKm * freightFactor.wtwKgPerTkm + hubKg)) / 1000,
        );
      }
    }

    if (laneFreightTco2e > 0) {
      transportScope3Tco2e += laneFreightTco2e;
      ledgerEntries.push({
        entryId: `scope3-cat4-${lane.laneId}`,
        scope: "SCOPE_3_CAT_4",
        entityType: "TIER1_SUPPLIER_LANE",
        entityId: lane.laneId,
        entityName: `${supplier.name} (${lane.transportMode} Freight)`,
        countryCode: supplier.countryCode,
        sector: "Logistics",
        materialCategory: lane.materialCategory,
        materialArchetype: null,
        cnCode: null,
        cbamCategory: null,
        matchConfidence: "EXACT_CODE",
        activityValue:
          massTonnes !== null && effectiveDistanceKm > 0
            ? round2(massTonnes * effectiveDistanceKm)
            : laneFreightTco2e,
        activityUnit:
          massTonnes !== null && effectiveDistanceKm > 0 ? "t·km" : "tCO2e",
        attributionMethod: "FREIGHT_WTW",
        factorId: freightFactor.factorId,
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: freightFactor.wtwKgPerTkm,
        factorUnit: "kgCO2e / t·km (WTW)",
        sourceCitation: freightFactor.sourceCitation,
        licenseId: freightFactor.licenseId,
        provenanceStatus: "OFFICIAL_PUBLISHED",
        pcafScore: 3,
        tco2e: laneFreightTco2e,
        formulaTrace:
          massTonnes !== null && effectiveDistanceKm > 0
            ? `${round2(massTonnes)} t × ${effectiveDistanceKm} km${usedHaversine ? " (GCD+circuity)" : ""} × ${freightFactor.wtwKgPerTkm} kg/tkm / 1000 = ${laneFreightTco2e} tCO2e`
            : `Reported lane freight = ${laneFreightTco2e} tCO2e`,
        networkVerified: supplier.isPartnerVerified,
      });
    }
  }

  upstreamScope3Tco2e = round2(upstreamScope3Tco2e);
  transportScope3Tco2e = round2(transportScope3Tco2e);
  const totalTco2e = round2(
    scope1 + scope2Location + upstreamScope3Tco2e + transportScope3Tco2e,
  );
  const totalScope3 = round2(upstreamScope3Tco2e + transportScope3Tco2e);

  // --- 3. PCAF Weighted Score & Breakdown (over Location-Based inventory entries) ---
  const reportableEntries = ledgerEntries.filter((e) => e.scope !== "SCOPE_2_MARKET");
  const pcafMap = new Map<PcafScore, { tco2e: number; lineCount: number }>([
    [1, { tco2e: 0, lineCount: 0 }],
    [2, { tco2e: 0, lineCount: 0 }],
    [3, { tco2e: 0, lineCount: 0 }],
    [4, { tco2e: 0, lineCount: 0 }],
    [5, { tco2e: 0, lineCount: 0 }],
  ]);

  let pcafNumerator = 0;
  let pcafDenominator = 0;
  for (const entry of reportableEntries) {
    const bucket = pcafMap.get(entry.pcafScore)!;
    bucket.tco2e += entry.tco2e;
    bucket.lineCount += 1;
    pcafNumerator += entry.tco2e * entry.pcafScore;
    pcafDenominator += entry.tco2e;
  }

  const weightedPcafScore =
    pcafDenominator > 0 ? round2(pcafNumerator / pcafDenominator) : null;

  const pcafBreakdown: PcafBucketSummary[] = ([1, 2, 3, 4, 5] as const).map((score) => {
    const b = pcafMap.get(score)!;
    return {
      score,
      label: PCAF_LABELS[score],
      tco2e: round2(b.tco2e),
      sharePct: pcafDenominator > 0 ? round2((b.tco2e / pcafDenominator) * 100) : 0,
      lineCount: b.lineCount,
    };
  });

  const primaryDataSharePct =
    upstreamScope3Tco2e > 0
      ? round2((primaryDataScope3Tco2e / upstreamScope3Tco2e) * 100)
      : 0;

  // --- 4. Carbon Intensity & Top-5 Hotspots ---
  const orgRev = input.organization.annualRevenueEur;
  const carbonIntensityPerEurMillion =
    finitePositive(orgRev) ? round2(totalTco2e / (orgRev / 1_000_000)) : null;
  const carbonIntensityPerTonne =
    totalPhysicalTonnes > 0 ? round2(totalTco2e / totalPhysicalTonnes) : null;

  const hotspots = hotspotsRaw
    .map((h) => ({
      ...h,
      shareOfScope3Pct:
        totalScope3 > 0 ? round2((h.tco2e / totalScope3) * 100) : 0,
    }))
    .sort((a, b) => b.tco2e - a.tco2e)
    .slice(0, 5);

  // --- 5. EU CBAM Summary (50 t/yr Cumulative De Minimis Rule) ---
  const activeCompliancePacks = resolveActiveCompliancePacks(
    orgCountry,
    input.organization.targetMarkets,
    input.organization.enabledCompliancePacks,
  );
  const euPackActive = activeCompliancePacks.includes("EU");
  const exceedsDeMinimisThreshold =
    cbamCumulativeMassTonnes >= CBAM_DE_MINIMIS_TONNES || cbamHasNoThresholdCategory;

  const cbamSummary: CbamSummary = {
    euCbamApplicable: euPackActive && cbamFlaggedLanes.length > 0 && exceedsDeMinimisThreshold,
    cumulativeMassTonnes: round2(cbamCumulativeMassTonnes),
    deMinimisThresholdTonnes: CBAM_DE_MINIMIS_TONNES,
    exceedsDeMinimisThreshold,
    hasNoThresholdCategory: cbamHasNoThresholdCategory,
    flaggedLanesCount: cbamFlaggedLanes.length,
    defaultFactorLanesCount: cbamFlaggedLanes.filter((l) => l.usingDefaultFactor).length,
    totalEmbeddedTco2e: round2(
      cbamFlaggedLanes.reduce((sum, l) => sum + l.embeddedTco2e, 0),
    ),
    flaggedLanes: cbamFlaggedLanes,
  };

  // --- 6. Multi-Region Compliance Readiness Checklist ---
  const complianceChecklist = evaluateComplianceChecklist({
    activeCompliancePacks,
    scope1Reported: input.organization.scope1Tco2e !== null || ownFacilities.some((f) => finitePositive(f.estimatedScope12Tco2e)),
    scope2LocationReported: scope2Location > 0 || input.organization.scope2Tco2e !== null,
    scope2MarketReported: scope2Market !== null,
    hasUnsubstantiatedRenewable,
    unscaledReportedWarningCount,
    weightedPcafScore,
    primaryDataSharePct,
    hasCarbonIntensity: carbonIntensityPerEurMillion !== null || carbonIntensityPerTonne !== null,
    cbamSummary,
    eudrLanesMissingSiteVerification,
    uflpaFlaggedFacilityIds,
    hotspots,
    orgCountry,
    activeLaneCount: activeLanes.length,
  });

  // --- 7. Actionable PCAF Improvement Prompts ---
  const improvementPrompts: string[] = [];
  const score5Hotspots = hotspots.filter((h) => h.pcafScore === 5);
  const score4Hotspots = hotspots.filter((h) => h.pcafScore === 4);
  if (score5Hotspots.length > 0) {
    improvementPrompts.push(
      `Add annual spend or contract volumes on ${score5Hotspots.length} proxy lane(s) (starting with ${score5Hotspots[0]!.entityName}) to upgrade from PCAF 5 → 3–4.`,
    );
  }
  if (score4Hotspots.length > 0) {
    improvementPrompts.push(
      `Add physical mass (tonnes/kg or unit weight) on ${score4Hotspots.length} spend-based lane(s) (starting with ${score4Hotspots[0]!.entityName}) to upgrade from PCAF 4 → 3.`,
    );
  }
  if (cbamSummary.euCbamApplicable && cbamSummary.defaultFactorLanesCount > 0) {
    improvementPrompts.push(
      `Invite ${cbamSummary.defaultFactorLanesCount} non-EU CBAM supplier(s) to share verified actual embedded emissions (PCF) and avoid EU CBAM default-value mark-ups.`,
    );
  }
  if (scope2Market === null) {
    improvementPrompts.push(
      "Add facility electricity consumption (MWh) or Market-Based Scope 2 in Organization Settings for dual Scope 2 compliance.",
    );
  }

  const verifiedCoveragePct =
    activeSuppliers.length === 0
      ? 0
      : Math.round((verifiedSupplierCount / activeSuppliers.length) * 100);

  let confidence: ConfidenceLevel = "UNKNOWN";
  if (activeSuppliers.length > 0) {
    confidence =
      verifiedSupplierCount === activeSuppliers.length
        ? "NETWORK_VERIFIED"
        : "ESTIMATED";
  }

  const summary: EsgSummary = {
    scope1Tco2e: scope1,
    scope2Tco2e: scope2Location,
    upstreamScope3Tco2e,
    transportScope3Tco2e,
    totalTco2e,
    confidence,
    verifiedCoveragePct,
    factorMatrixVersion: FACTOR_MATRIX_VERSION,
    scope2LocationTco2e: scope2Location,
    scope2MarketTco2e: scope2Market,
    weightedPcafScore,
    pcafBreakdown,
    primaryDataSharePct,
    carbonIntensityPerEurMillion,
    carbonIntensityPerTonne,
    hotspots,
    cbamSummary,
    activeCompliancePacks,
    complianceChecklist,
    improvementPrompts,
  };

  return { summary, ledgerEntries };
}

interface ChecklistEvalContext {
  activeCompliancePacks: readonly CompliancePackId[];
  scope1Reported: boolean;
  scope2LocationReported: boolean;
  scope2MarketReported: boolean;
  hasUnsubstantiatedRenewable: boolean;
  unscaledReportedWarningCount: number;
  weightedPcafScore: number | null;
  primaryDataSharePct: number;
  hasCarbonIntensity: boolean;
  cbamSummary: CbamSummary;
  eudrLanesMissingSiteVerification: readonly string[];
  uflpaFlaggedFacilityIds: readonly string[];
  hotspots: readonly EsgHotspot[];
  orgCountry: string;
  activeLaneCount: number;
}

function evaluateComplianceChecklist(ctx: ChecklistEvalContext): ComplianceCheckItem[] {
  const items: ComplianceCheckItem[] = [];

  // --- GLOBAL_GHG_ISSB (Always Active) ---
  items.push({
    ruleId: "ISSB_S2_SCOPE12_REPORTED",
    packId: "GLOBAL_GHG_ISSB",
    framework: "GHG Protocol / ISSB IFRS S2",
    legalStatus: "IN_FORCE",
    title: "Scope 1 & Scope 2 Inventory Reported",
    status: ctx.scope1Reported && ctx.scope2LocationReported ? "PASSED" : "ACTION_NEEDED",
    summary:
      ctx.scope1Reported && ctx.scope2LocationReported
        ? "Organization Scope 1 and Scope 2 location-based emissions are populated."
        : "Missing Scope 1 or Scope 2 baseline data for own operations.",
    remediationPrompt:
      ctx.scope1Reported && ctx.scope2LocationReported
        ? null
        : "Enter Scope 1 & Scope 2 (or facility MWh) in Organization Settings.",
    affectedEntityIds: [],
  });

  items.push({
    ruleId: "GHG_SCOPE3_ZERO_OVERATTRIBUTION",
    packId: "GLOBAL_GHG_ISSB",
    framework: "GHG Protocol Scope 3 Cat 1",
    legalStatus: "IN_FORCE",
    title: "Proportional Scope 3 Attribution (Zero 100%-Entity Over-Attribution)",
    status: ctx.unscaledReportedWarningCount === 0 ? "PASSED" : "ACTION_NEEDED",
    summary:
      ctx.unscaledReportedWarningCount === 0
        ? "All active lanes use proportional PCF, server-side partner intensity, physical, spend, or scaled proxy attribution."
        : `${ctx.unscaledReportedWarningCount} unverified supplier(s) have facility Scope 1+2 entered without spend, volume, or allocation share.`,
    remediationPrompt:
      ctx.unscaledReportedWarningCount === 0
        ? null
        : "Add annual spend, contract volume, or an explicit allocation share ratio on affected lanes.",
    affectedEntityIds: [],
  });

  const lowQualityIds = ctx.hotspots
    .filter((h) => h.pcafScore >= 4)
    .map((h) => h.entityId);
  items.push({
    ruleId: "PCAF_DATA_QUALITY_THRESHOLD",
    packId: "GLOBAL_GHG_ISSB",
    framework: "Kulgo PCAF-Aligned Data Quality Rubric",
    legalStatus: "IN_FORCE",
    title: "Weighted Data Quality Score ≤ 3.5",
    status:
      ctx.activeLaneCount === 0
        ? "NOT_APPLICABLE"
        : ctx.weightedPcafScore !== null && ctx.weightedPcafScore <= 3.5
          ? "PASSED"
          : "ACTION_NEEDED",
    summary:
      ctx.activeLaneCount === 0
        ? "No active supply lanes to score yet."
        : `Weighted PCAF-aligned data quality score is ${ctx.weightedPcafScore ?? "N/A"} / 5.0 (1 = highest).`,
    remediationPrompt:
      ctx.weightedPcafScore !== null && ctx.weightedPcafScore <= 3.5
        ? null
        : "Upgrade top spend/proxy hotspots to physical mass (Score 3) or verified partner PCFs (Score 1–2).",
    affectedEntityIds: lowQualityIds,
  });

  items.push({
    ruleId: "ISSB_S2_CARBON_INTENSITY",
    packId: "GLOBAL_GHG_ISSB",
    framework: "ISSB IFRS S2",
    legalStatus: "IN_FORCE",
    title: "Carbon Intensity Ratio Available",
    status: ctx.hasCarbonIntensity ? "PASSED" : "ACTION_NEEDED",
    summary: ctx.hasCarbonIntensity
      ? "Carbon intensity (tCO2e / €M revenue or tCO2e / tonne) is computed for executive reporting."
      : "No annual revenue or physical mass denominator available to compute carbon intensity.",
    remediationPrompt: ctx.hasCarbonIntensity
      ? null
      : "Set Organization Annual Revenue (EUR) in Settings to unlock tCO2e / €M revenue intensity.",
    affectedEntityIds: [],
  });

  // --- EU Pack (CSRD/VSME + CBAM + EUDR) ---
  if (ctx.activeCompliancePacks.includes("EU")) {
    items.push({
      ruleId: "ESRS_E1_6_DUAL_SCOPE2",
      packId: "EU",
      framework: "EU CSRD / ESRS E1 & VSME (Reg. 2026/1560)",
      legalStatus: "IN_FORCE",
      title: "Dual Scope 2 Reporting (Location-Based + Market-Based)",
      status:
        ctx.scope2LocationReported && ctx.scope2MarketReported && !ctx.hasUnsubstantiatedRenewable
          ? "PASSED"
          : "ACTION_NEEDED",
      summary: ctx.hasUnsubstantiatedRenewable
        ? "Renewable electricity % entered without verified GO/REC/PPA evidence; market-based Scope 2 evaluated at AIB residual mix."
        : ctx.scope2LocationReported && ctx.scope2MarketReported
          ? "Both Location-Based and Market-Based Scope 2 totals are reported."
          : "Market-Based Scope 2 is missing (required alongside Location-Based under ESRS E1-6 & VSME).",
      remediationPrompt:
        ctx.scope2LocationReported && ctx.scope2MarketReported && !ctx.hasUnsubstantiatedRenewable
          ? null
          : "Enter Market-Based Scope 2 or facility electricity MWh with verified GO/REC status in Settings.",
      affectedEntityIds: [],
    });

    items.push({
      ruleId: "ESRS_E1_6_PRIMARY_DATA_SHARE",
      packId: "EU",
      framework: "EU ESRS E1-6 §AR 46 / VSME",
      legalStatus: "IN_FORCE",
      title: "Primary Supplier Data Share (≥ 25% of Scope 3 Cat 1)",
      status:
        ctx.activeLaneCount === 0
          ? "NOT_APPLICABLE"
          : ctx.primaryDataSharePct >= 25
            ? "PASSED"
            : "ACTION_NEEDED",
      summary: `${ctx.primaryDataSharePct}% of Scope 3 Category 1 emissions come from primary supplier data (Score 1–2).`,
      remediationPrompt:
        ctx.primaryDataSharePct >= 25
          ? null
          : "Invite top Tier-1 suppliers to connect on Kulgo or upload supplier-specific PCFs.",
      affectedEntityIds: ctx.hotspots.slice(0, 3).map((h) => h.entityId),
    });

    const cbamLaneIds = ctx.cbamSummary.flaggedLanes
      .filter((l) => l.usingDefaultFactor)
      .map((l) => l.laneId);
    items.push({
      ruleId: "EU_CBAM_EMBEDDED_EMISSIONS",
      packId: "EU",
      framework: "EU CBAM Definitive Regime (Reg. 2023/956 & 2025/2083)",
      legalStatus: "IN_FORCE",
      title: "CBAM Embedded Emissions Verification (50 t/yr Cumulative Threshold)",
      status: !ctx.cbamSummary.euCbamApplicable
        ? "NOT_APPLICABLE"
        : ctx.cbamSummary.defaultFactorLanesCount === 0
          ? "PASSED"
          : "ACTION_NEEDED",
      summary: !ctx.cbamSummary.euCbamApplicable
        ? ctx.cbamSummary.flaggedLanesCount === 0
          ? "No non-EU imports in CBAM-covered categories (steel, aluminum, cement, fertilizers, hydrogen, electricity)."
          : `Cumulative non-EU CBAM mass (${ctx.cbamSummary.cumulativeMassTonnes} t) is below the 50 t/yr de minimis threshold.`
        : ctx.cbamSummary.defaultFactorLanesCount === 0
          ? `All ${ctx.cbamSummary.flaggedLanesCount} CBAM import lane(s) (${ctx.cbamSummary.cumulativeMassTonnes} t) have primary supplier emissions.`
          : `${ctx.cbamSummary.defaultFactorLanesCount} of ${ctx.cbamSummary.flaggedLanesCount} non-EU CBAM import lane(s) (${ctx.cbamSummary.cumulativeMassTonnes} t ≥ 50 t threshold) still rely on default values.`,
      remediationPrompt:
        ctx.cbamSummary.euCbamApplicable && ctx.cbamSummary.defaultFactorLanesCount > 0
          ? "Collect verified installation actual embedded emissions (PCF) from non-EU CBAM suppliers."
          : null,
      affectedEntityIds: cbamLaneIds,
    });

    items.push({
      ruleId: "EU_EUDR_GEOLOCATION_TRACEABILITY",
      packId: "EU",
      framework: "EU Deforestation Regulation (EUDR Reg. 2023/1115)",
      legalStatus: "FUTURE",
      title: "EUDR Commodity Site-Level Geolocation Traceability",
      status:
        ctx.eudrLanesMissingSiteVerification.length === 0
          ? "NOT_APPLICABLE"
          : "ACTION_NEEDED",
      summary:
        ctx.eudrLanesMissingSiteVerification.length === 0
          ? "No unverified EUDR-covered commodity lanes (wood, rubber, cocoa, coffee, palm oil, soya, cattle) detected."
          : `${ctx.eudrLanesMissingSiteVerification.length} EUDR-covered lane(s) (e.g., wood/pallets) lack SITE_VERIFIED geolocation.`,
      remediationPrompt:
        ctx.eudrLanesMissingSiteVerification.length === 0
          ? null
          : "Verify exact supplier production coordinates (SITE_VERIFIED) for EUDR-covered inputs.",
      affectedEntityIds: [...ctx.eudrLanesMissingSiteVerification],
    });
  }

  // --- UK Pack (UK SRS + SECR + UK CBAM 2027) ---
  if (ctx.activeCompliancePacks.includes("UK")) {
    items.push({
      ruleId: "UK_SECR_INTENSITY_RATIO",
      packId: "UK",
      framework: "UK SECR & UK SRS S1/S2",
      legalStatus: "IN_FORCE",
      title: "UK SECR Intensity Ratio & DESNZ Traceability",
      status:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.hasCarbonIntensity
          ? "PASSED"
          : "ACTION_NEEDED",
      summary:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.hasCarbonIntensity
          ? "Scope 1/2 emissions and auditable carbon intensity ratio are ready for SECR / UK SRS."
          : "Add Scope 1/2 emissions and annual revenue or output tonnes to satisfy UK SECR intensity disclosure.",
      remediationPrompt:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.hasCarbonIntensity
          ? null
          : "Complete Scope 1/2 and Annual Revenue in Organization Settings.",
      affectedEntityIds: [],
    });

    items.push({
      ruleId: "UK_CBAM_2027_READINESS",
      packId: "UK",
      framework: "UK CBAM (Effective Jan 2027)",
      legalStatus: "FUTURE",
      title: "UK CBAM 2027 Supplier Actuals Readiness",
      status:
        ctx.cbamSummary.flaggedLanesCount === 0
          ? "NOT_APPLICABLE"
          : ctx.cbamSummary.defaultFactorLanesCount === 0
            ? "PASSED"
            : "ACTION_NEEDED",
      summary:
        ctx.cbamSummary.flaggedLanesCount === 0
          ? "No CBAM-covered import categories detected."
          : `${ctx.cbamSummary.defaultFactorLanesCount} CBAM-category lane(s) use default factors ahead of UK CBAM 2027.`,
      remediationPrompt:
        ctx.cbamSummary.defaultFactorLanesCount > 0
          ? "Request supplier-specific PCFs for steel, aluminum, cement, or fertilizer imports."
          : null,
      affectedEntityIds: ctx.cbamSummary.flaggedLanes.map((l) => l.laneId),
    });
  }

  // --- US Pack (CA SB 253 + UFLPA) ---
  if (ctx.activeCompliancePacks.includes("US")) {
    items.push({
      ruleId: "US_CA_SB253_SCOPE3_AUDIT_TRAIL",
      packId: "US",
      framework: "California SB 253 (Scope 3 Litigation-Sensitive — Nov 2026)",
      legalStatus: "LITIGATED",
      title: "Assurance-Ready Scope 1/2/3 Factor Audit Trail",
      status:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.activeLaneCount > 0
          ? "PASSED"
          : "ACTION_NEEDED",
      summary:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.activeLaneCount > 0
          ? "Deterministic Scope 1/2/3 ledger with cited open factors is ready (note: CA SB 253 Scope 3 mandate is currently under Ninth Circuit severability remand)."
          : "Complete Scope 1/2 inventory and active supply lanes to generate an assurance-ready ledger.",
      remediationPrompt:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.activeLaneCount > 0
          ? null
          : "Populate Scope 1/2 emissions and supply lane data.",
      affectedEntityIds: [],
    });

    items.push({
      ruleId: "US_UFLPA_ORIGIN_SCREENING",
      packId: "US",
      framework: "US UFLPA (Uyghur Forced Labor Prevention Act)",
      legalStatus: "IN_FORCE",
      title: "High-Risk Origin Provenance & Chain-of-Custody Screening",
      status: ctx.uflpaFlaggedFacilityIds.length === 0 ? "PASSED" : "ACTION_NEEDED",
      summary:
        ctx.uflpaFlaggedFacilityIds.length === 0
          ? "No unverified Tier-1 suppliers in UFLPA high-scrutiny jurisdictions."
          : `${ctx.uflpaFlaggedFacilityIds.length} unverified supplier(s) operate in high-scrutiny origin jurisdictions requiring chain-of-custody verification.`,
      remediationPrompt:
        ctx.uflpaFlaggedFacilityIds.length === 0
          ? null
          : "Invite flagged suppliers for verified partner provenance or document origin chain-of-custody.",
      affectedEntityIds: [...ctx.uflpaFlaggedFacilityIds],
    });
  }

  // --- APAC Pack (AASB S2 / SGX / SSBJ) ---
  if (ctx.activeCompliancePacks.includes("APAC")) {
    items.push({
      ruleId: "APAC_ISSB_SCOPE3_HOTSPOTS",
      packId: "APAC",
      framework: "APAC ISSB Mandates (AU AASB S2 / SG ACRA-SGX / JP SSBJ)",
      legalStatus: "IN_FORCE",
      title: "ISSB S2 Scope 3 Hotspot & Data-Quality Disclosure",
      status:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.hotspots.length > 0
          ? "PASSED"
          : "ACTION_NEEDED",
      summary:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.hotspots.length > 0
          ? "Scope 1/2/3 totals, top emission hotspots, and PCAF-aligned data quality scores are ready for AASB S2 / SGX reporting."
          : "Populate Scope 1/2 and active supply lanes to compute ISSB S2 hotspot disclosures.",
      remediationPrompt:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.hotspots.length > 0
          ? null
          : "Complete Scope 1/2 and supply lane inputs.",
      affectedEntityIds: [],
    });
  }

  // --- AFRICA Pack (Nigeria FRC / Kenya ICPAK / South Africa JSE + CBAM Exporter) ---
  if (ctx.activeCompliancePacks.includes("AFRICA")) {
    const grid = resolveCountryGridFactor(ctx.orgCountry);
    items.push({
      ruleId: "AFRICA_ISSB_CBAM_EXPORTER_READINESS",
      packId: "AFRICA",
      framework: "Africa ISSB (NG FRC / KE ICPAK / ZA JSE) & EU CBAM Export Readiness",
      legalStatus: "IN_FORCE",
      title: "ISSB Inventory & High-Grid-Intensity Export Readiness",
      status:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.scope2MarketReported
          ? "PASSED"
          : "ACTION_NEEDED",
      summary: `Local grid intensity is ${grid.locationTco2ePerMwh} tCO2e/MWh. Dual Scope 2 & captive renewable tracking quantifies carbon savings for EU CBAM buyers.`,
      remediationPrompt:
        ctx.scope1Reported && ctx.scope2LocationReported && ctx.scope2MarketReported
          ? null
          : "Enter facility electricity MWh and verified renewable share to prove lower indirect emissions to export buyers.",
      affectedEntityIds: [],
    });
  }

  return items;
}

/**
 * Neutralizes spreadsheet formula injection (OWASP CSV injection) and applies
 * RFC-4180 quoting so auditor CSV exports are safe to open in Excel / Sheets.
 */
function sanitizeCsvCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let str = String(raw);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatEsgLedgerCsv(entries: readonly EsgLedgerEntry[]): string {
  const headers = [
    "entryId",
    "scope",
    "entityType",
    "entityId",
    "entityName",
    "countryCode",
    "sector",
    "materialCategory",
    "materialArchetype",
    "cnCode",
    "cbamCategory",
    "matchConfidence",
    "activityValue",
    "activityUnit",
    "attributionMethod",
    "factorId",
    "factorVersion",
    "factorValue",
    "factorUnit",
    "sourceCitation",
    "licenseId",
    "provenanceStatus",
    "pcafScore",
    "tco2e",
    "formulaTrace",
    "networkVerified",
  ];

  const rows = entries.map((e) =>
    [
      e.entryId,
      e.scope,
      e.entityType,
      e.entityId,
      e.entityName,
      e.countryCode,
      e.sector,
      e.materialCategory,
      e.materialArchetype,
      e.cnCode,
      e.cbamCategory,
      e.matchConfidence,
      e.activityValue,
      e.activityUnit,
      e.attributionMethod,
      e.factorId,
      e.factorVersion,
      e.factorValue,
      e.factorUnit,
      e.sourceCitation,
      e.licenseId,
      e.provenanceStatus,
      e.pcafScore,
      e.tco2e,
      e.formulaTrace,
      e.networkVerified,
    ]
      .map(sanitizeCsvCell)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n") + "\n";
}
