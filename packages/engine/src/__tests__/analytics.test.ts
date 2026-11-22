import {
  RiskSignalSchema,
  type Contract,
  type ContractLine,
  type Facility,
  type RiskSignal,
  type SupplyInput,
  type SupplyLane,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import {
  evaluateNetworkAnalytics,
  simulateNetworkAnalytics,
} from "../analytics.js";
import { deriveNetworkCommercials } from "../contracts.js";
import { isPointInWktPolygon, parseWktPolygon } from "../geo.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROD_ID = "22222222-2222-4222-8222-222222222221";
const INPUT_POLYMER_ID = "33333333-3333-4333-8333-333333333331";
const INPUT_CHIPS_ID = "33333333-3333-4333-8333-333333333332";
const FAC_HQ_ID = "44444444-4444-4444-8444-444444444441";
const FAC_RIGA_ID = "44444444-4444-4444-8444-444444444442";
const FAC_TAMPERE_ID = "44444444-4444-4444-8444-444444444443";
const FAC_HAMBURG_ID = "44444444-4444-4444-8444-444444444444";
const LANE_RIGA_ID = "55555555-5555-4555-8555-555555555551";
const LANE_TAMPERE_ID = "55555555-5555-4555-8555-555555555552";
const LANE_HAMBURG_ID = "55555555-5555-4555-8555-555555555553";

const LATVIA_SIGNAL: RiskSignal = RiskSignalSchema.parse({
  signalId: "sig-latvia-sanctions-01",
  kind: "SANCTIONS",
  severity: "RED",
  title: "Baltic / Latvia Secondary Sanctions Corridor",
  description: "Sanctions risk on upstream petrochemical feedstock.",
  regionCode: "LV-BALTIC",
  affectedCountryCodes: ["LV"],
  polygonWkt:
    "POLYGON ((20.9 55.6, 28.3 55.6, 28.3 58.1, 20.9 58.1, 20.9 55.6))",
  active: true,
});

const FACILITIES: Facility[] = [
  {
    facilityId: FAC_HQ_ID,
    ownerOrgId: ORG_ID,
    name: "Tallinn HQ",
    kind: "HQ",
    locationPrecision: "SITE_VERIFIED",
    countryCode: "EE",
    regionCode: "EE-37",
    lat: 59.437,
    lng: 24.7536,
    isOwnFacility: true,
    isPartnerVerified: false,
    sector: "Electronics",
    esgBadges: ["ISO 14001"],
    estimatedScope12Tco2e: 300,
  },
  {
    facilityId: FAC_RIGA_ID,
    ownerOrgId: ORG_ID,
    name: "Riga Polymers",
    kind: "FACTORY",
    locationPrecision: "HQ_ESTIMATED",
    countryCode: "LV",
    regionCode: "LV-RIX",
    lat: 56.9496,
    lng: 24.1052,
    isOwnFacility: false,
    isPartnerVerified: false,
    sector: "Chemicals",
    esgBadges: [],
    estimatedScope12Tco2e: 600,
  },
  {
    facilityId: FAC_TAMPERE_ID,
    ownerOrgId: ORG_ID,
    name: "Tampere Photonics",
    kind: "FACTORY",
    locationPrecision: "SITE_VERIFIED",
    countryCode: "FI",
    regionCode: "FI-11",
    lat: 61.4978,
    lng: 23.761,
    isOwnFacility: false,
    isPartnerVerified: true,
    sector: "Electronics",
    esgBadges: ["RE100"],
    estimatedScope12Tco2e: 250,
  },
  {
    facilityId: FAC_HAMBURG_ID,
    ownerOrgId: ORG_ID,
    name: "Hamburg Mechatronics",
    kind: "FACTORY",
    locationPrecision: "SITE_VERIFIED",
    countryCode: "DE",
    regionCode: "DE-HH",
    lat: 53.5511,
    lng: 9.9937,
    isOwnFacility: false,
    isPartnerVerified: false,
    sector: "Electronics",
    esgBadges: [],
    estimatedScope12Tco2e: 400,
  },
];

const INPUTS: SupplyInput[] = [
  {
    inputId: INPUT_POLYMER_ID,
    ownerOrgId: ORG_ID,
    productId: PROD_ID,
    name: "Material B",
    category: "Polymers",
    unit: "TONNES",
  },
  {
    inputId: INPUT_CHIPS_ID,
    ownerOrgId: ORG_ID,
    productId: PROD_ID,
    name: "Material C",
    category: "Semiconductors",
    unit: "TONNES",
  },
];

const LANES: SupplyLane[] = [
  {
    laneId: LANE_RIGA_ID,
    ownerOrgId: ORG_ID,
    fromFacilityId: FAC_RIGA_ID,
    toFacilityId: FAC_HQ_ID,
    inputId: INPUT_POLYMER_ID,
    materialCategory: "Polymers",
    transportMode: "ROAD",
    volumeSharePct: 100,
    annualVolume: 100,
    volumeUnit: "TONNES",
    annualSpendEur: 300000,
    contractEndDate: "2026-12-15",
    contractTerms: "Net 30",
    leadTimeDays: 5,
    distanceKm: 300,
    estimatedLaneCo2e: null,
    riskStatus: "RED",
    riskReason: "Latvian sanctions exposure",
  },
  {
    laneId: LANE_TAMPERE_ID,
    ownerOrgId: ORG_ID,
    fromFacilityId: FAC_TAMPERE_ID,
    toFacilityId: FAC_HQ_ID,
    inputId: INPUT_CHIPS_ID,
    materialCategory: "Semiconductors",
    transportMode: "AIR",
    volumeSharePct: 60,
    annualVolume: 60,
    volumeUnit: "TONNES",
    annualSpendEur: 500000,
    contractEndDate: "2028-06-30",
    contractTerms: "CIF Tallinn",
    leadTimeDays: 3,
    distanceKm: 250,
    estimatedLaneCo2e: null,
    riskStatus: "GREEN",
    riskReason: null,
  },
  {
    laneId: LANE_HAMBURG_ID,
    ownerOrgId: ORG_ID,
    fromFacilityId: FAC_HAMBURG_ID,
    toFacilityId: FAC_HQ_ID,
    inputId: INPUT_CHIPS_ID,
    materialCategory: "Semiconductors",
    transportMode: "ROAD",
    volumeSharePct: 40,
    annualVolume: 40,
    volumeUnit: "TONNES",
    annualSpendEur: 350000,
    contractEndDate: "2028-06-30",
    contractTerms: "DAP Tallinn",
    leadTimeDays: 7,
    distanceKm: 1100,
    estimatedLaneCo2e: null,
    riskStatus: "GREEN",
    riskReason: null,
  },
];

describe("geo WKT polygon helpers", () => {
  it("parses WKT polygon and detects Riga inside Latvia sanctions polygon", () => {
    const ring = parseWktPolygon(LATVIA_SIGNAL.polygonWkt);
    expect(ring.length).toBe(5);
    expect(
      isPointInWktPolygon(56.9496, 24.1052, LATVIA_SIGNAL.polygonWkt),
    ).toBe(true);
    expect(
      isPointInWktPolygon(61.4978, 23.761, LATVIA_SIGNAL.polygonWkt),
    ).toBe(false);
  });
});

describe("evaluateNetworkAnalytics & simulateNetworkAnalytics", () => {
  const asOfDate = new Date("2026-11-20T00:00:00Z");

  it("computes HHI, SPOF, contract expiry, RiskSignal alerts, and Scope 1/2/3 ESG", () => {
    const summary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: null, scope2Tco2e: null },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: LANES,
      riskSignals: [LATVIA_SIGNAL],
      asOfDate,
    });

    expect(summary.overallStatus).toBe("RED");
    expect(summary.resilienceScore).toBeLessThan(70);

    // Material B is 100% single source (SPOF); Material C is 60/40 split (HHI = 5200)
    const matBHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL" && m.label.includes("Material B"),
    );
    const matCHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL" && m.label.includes("Material C"),
    );
    expect(matBHhi?.rawHhi).toBe(10000);
    expect(matBHhi?.isSinglePointOfFailure).toBe(true);
    expect(matCHhi?.rawHhi).toBe(5200);
    expect(matCHhi?.isSinglePointOfFailure).toBe(false);

    // Alerts include SINGLE_SOURCE, CONTRACT_EXPIRY (25d), and SECONDARY_SANCTION (Latvia polygon)
    const categories = new Set(summary.alerts.map((a) => a.category));
    expect(categories.has("SINGLE_SOURCE")).toBe(true);
    expect(categories.has("CONTRACT_EXPIRY")).toBe(true);
    expect(categories.has("SECONDARY_SANCTION")).toBe(true);

    // Own Scope 1+2 derived from Tallinn HQ (300 -> 120 + 180)
    expect(summary.esg.scope1Tco2e).toBe(120);
    expect(summary.esg.scope2Tco2e).toBe(180);
    // Physical-first Category 1: 100t Polymers (2.42) + 60t FI Semiconductors (16.40) + 40t DE Semiconductors (19.80) = 2018 tCO2e
    expect(summary.esg.upstreamScope3Tco2e).toBe(2018);
    expect(summary.esg.weightedPcafScore).toBeGreaterThanOrEqual(2.5);
    expect(summary.esg.weightedPcafScore).toBeLessThanOrEqual(3);
    expect(summary.esg.transportScope3Tco2e).toBeGreaterThan(0);
    expect(summary.esg.verifiedCoveragePct).toBe(33);
    expect(summary.riskSignals).toHaveLength(1);
  });

  it("runs stateless what-if simulations returning accurate CO2e, HHI, and risk deltas", () => {
    const sim = simulateNetworkAnalytics(
      {
        organization: { scope1Tco2e: 120, scope2Tco2e: 180 },
        inputs: INPUTS,
        facilities: FACILITIES,
        lanes: LANES,
        riskSignals: [LATVIA_SIGNAL],
        asOfDate,
      },
      [
        // De-risk RED Latvia lane by setting volume share to 0%
        { laneId: LANE_RIGA_ID, volumeSharePct: 0 },
        // Switch Tampere from AIR to SEA and rebalance 50/50 with Hamburg
        { laneId: LANE_TAMPERE_ID, volumeSharePct: 50, transportMode: "SEA" },
        { laneId: LANE_HAMBURG_ID, volumeSharePct: 50, transportMode: "RAIL" },
      ],
    );

    expect(sim.appliedChangesCount).toBe(3);
    expect(sim.simulated.resilienceScore).toBeGreaterThan(
      sim.baseline.resilienceScore,
    );
    expect(sim.deltas.resilienceScoreDelta).toBeGreaterThan(0);
    expect(sim.deltas.redAlertCountDelta).toBeLessThan(0);
    expect(sim.deltas.spofCountDelta).toBe(-1);
    expect(sim.deltas.transportScope3Tco2eDelta).toBeLessThan(0);
    expect(sim.deltas.totalTco2eDelta).toBeLessThan(0);
    expect(sim.simulated.overallStatus).toBe("GREEN");
  });

  it("scales annualSpendEur proportionally when volumeSharePct changes in simulateNetworkAnalytics, updating SUPPLIER and COUNTRY HHI", () => {
    const sim = simulateNetworkAnalytics(
      {
        organization: { scope1Tco2e: 120, scope2Tco2e: 180 },
        inputs: INPUTS,
        facilities: FACILITIES,
        lanes: LANES,
        riskSignals: [],
        asOfDate,
      },
      [
        // Halve Tampere's share (60% -> 30%, spend 500k -> 250k) and boost Hamburg's share (40% -> 70%, spend 350k -> 612.5k)
        { laneId: LANE_TAMPERE_ID, volumeSharePct: 30 },
        { laneId: LANE_HAMBURG_ID, volumeSharePct: 70 },
      ],
    );

    const baseSupplierHhi = sim.baseline.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    const simSupplierHhi = sim.simulated.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    const baseCountryHhi = sim.baseline.hhiMetrics.find(
      (m) => m.dimension === "COUNTRY",
    )!;
    const simCountryHhi = sim.simulated.hhiMetrics.find(
      (m) => m.dimension === "COUNTRY",
    )!;

    // Baseline spend: Riga 300k, Tampere 500k, Hamburg 350k (total 1150k)
    // Simulated spend: Riga 300k, Tampere 250k, Hamburg 612.5k (total 1162.5k)
    expect(simSupplierHhi.rawHhi).not.toBe(baseSupplierHhi.rawHhi);
    expect(simCountryHhi.rawHhi).not.toBe(baseCountryHhi.rawHhi);
    expect(simSupplierHhi.rawHhi).toBe(3904);
  });

  it("normalizes KG vs TONNES and uses a consistent weight dimension across mixed-unit lanes in HHI", () => {
    // Case 1: One lane in KG (50,000 KG = 50 TONNES) and one lane in TONNES (50 TONNES) with no spend -> equal 50/50 -> HHI 5000
    const kgVsTonnesLanes: SupplyLane[] = [
      {
        ...LANES[1]!,
        annualSpendEur: null,
        annualVolume: 50_000,
        volumeUnit: "KG",
        volumeSharePct: 50,
      },
      {
        ...LANES[2]!,
        annualSpendEur: null,
        annualVolume: 50,
        volumeUnit: "TONNES",
        volumeSharePct: 50,
      },
    ];

    const kgTonnesSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: kgVsTonnesLanes,
      riskSignals: [],
      asOfDate,
    });

    const kgTonnesSupplierHhi = kgTonnesSummary.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    );
    const kgTonnesCountryHhi = kgTonnesSummary.hhiMetrics.find(
      (m) => m.dimension === "COUNTRY",
    );
    expect(kgTonnesSupplierHhi?.rawHhi).toBe(5000);
    expect(kgTonnesCountryHhi?.rawHhi).toBe(5000);

    // Case 2: Mixed spend (only one lane has annualSpendEur) falls back to normalized volume across all active lanes
    const mixedSpendLanes: SupplyLane[] = [
      {
        ...LANES[1]!,
        annualSpendEur: 500_000,
        annualVolume: 60_000,
        volumeUnit: "KG",
        volumeSharePct: 60,
      },
      {
        ...LANES[2]!,
        annualSpendEur: null,
        annualVolume: 40,
        volumeUnit: "TONNES",
        volumeSharePct: 40,
      },
    ];

    const mixedSpendSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: mixedSpendLanes,
      riskSignals: [],
      asOfDate,
    });

    const mixedSupplierHhi = mixedSpendSummary.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    );
    // 60t vs 40t -> 60^2 + 40^2 = 5200 (not skewed by mixing 500,000 EUR with 40 TONNES)
    expect(mixedSupplierHhi?.rawHhi).toBe(5200);

    // Case 3: Mixed spend AND missing volume on one lane falls back consistently to volumeSharePct
    const mixedVolumeAndShareLanes: SupplyLane[] = [
      {
        ...LANES[1]!,
        annualSpendEur: 500_000,
        annualVolume: null,
        volumeUnit: "TONNES",
        volumeSharePct: 60,
      },
      {
        ...LANES[2]!,
        annualSpendEur: null,
        annualVolume: 40,
        volumeUnit: "TONNES",
        volumeSharePct: 40,
      },
    ];

    const mixedShareSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: mixedVolumeAndShareLanes,
      riskSignals: [],
      asOfDate,
    });

    const mixedShareSupplierHhi = mixedShareSummary.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    );
    expect(mixedShareSupplierHhi?.rawHhi).toBe(5200);
  });

  it("does not emit SHARED_UPSTREAM_CHOKEPOINT when only 1 Tier-1 partner has hasSharedChokepoint, but emits RED when 2+ share a region", () => {
    const singlePartnerHidden = new Map([
      [
        FAC_TAMPERE_ID,
        {
          hiddenUpstreamScope3Tco2e: 200,
          hasSanctionedUpstream: false,
          regionCode: "FI",
          hasSharedChokepoint: true,
          chokepointRegionCode: "CN",
        },
      ],
    ]);

    const singleSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: LANES,
      riskSignals: [],
      partnerHiddenSummaries: singlePartnerHidden,
      asOfDate,
    });

    expect(
      singleSummary.alerts.some(
        (a) => a.category === "SHARED_UPSTREAM_CHOKEPOINT",
      ),
    ).toBe(false);

    const sharedPartnerHidden = new Map([
      [
        FAC_TAMPERE_ID,
        {
          hiddenUpstreamScope3Tco2e: 200,
          hasSanctionedUpstream: false,
          regionCode: "FI",
          hasSharedChokepoint: true,
          chokepointRegionCode: "CN",
        },
      ],
      [
        FAC_HAMBURG_ID,
        {
          hiddenUpstreamScope3Tco2e: 150,
          hasSanctionedUpstream: false,
          regionCode: "DE",
          hasSharedChokepoint: true,
          chokepointRegionCode: "CN",
        },
      ],
    ]);

    const sharedSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: LANES,
      riskSignals: [],
      partnerHiddenSummaries: sharedPartnerHidden,
      asOfDate,
    });

    const chokepointAlert = sharedSummary.alerts.find(
      (a) => a.category === "SHARED_UPSTREAM_CHOKEPOINT",
    );
    expect(chokepointAlert).toBeDefined();
    expect(chokepointAlert?.severity).toBe("RED");
    expect(chokepointAlert?.affectedRegionCode).toBe("CN");
    expect(chokepointAlert?.affectedTier1FacilityIds).toEqual([
      FAC_TAMPERE_ID,
      FAC_HAMBURG_ID,
    ]);
  });

  it("computes partial-coverage org-wide HHI on activeSpendEur with explicit coveragePct and falls back to activeSpendEur on per-material unit conflict", () => {
    // 3 active lanes: 2 have annualSpendEur (500k and 500k), 1 is missing annualSpendEur (null).
    // Furthermore, on Material C (lanes 2 and 3), one lane is in TONNES and one is in UNITS (unit conflict!) -> Material C HHI must fall back to SPEND_EUR instead of summing incompatible units.
    const partialAndConflictLanes: SupplyLane[] = [
      {
        ...LANES[0]!,
        annualSpendEur: null,
        annualVolume: 100,
        volumeUnit: "TONNES",
        volumeSharePct: 100,
      },
      {
        ...LANES[1]!,
        annualSpendEur: 500_000,
        annualVolume: 60,
        volumeUnit: "TONNES",
        volumeSharePct: 60,
      },
      {
        ...LANES[2]!,
        annualSpendEur: 500_000,
        annualVolume: 4000,
        volumeUnit: "UNITS",
        volumeSharePct: 40,
      },
    ];

    const summary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: partialAndConflictLanes,
      riskSignals: [],
      asOfDate,
    });

    const supplierHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    // Partial coverage: 2 of 3 active lanes have spend (500k / 500k -> 50/50 -> HHI 5000, 67% coverage)
    expect(supplierHhi.rawHhi).toBe(5000);
    expect(supplierHhi.coveredLanesCount).toBe(2);
    expect(supplierHhi.totalActiveLanesCount).toBe(3);
    expect(supplierHhi.coveragePct).toBe(67);
    expect(supplierHhi.weightingBasis).toBe("SPEND_EUR");

    // Material C has conflicting units (60 TONNES vs 4000 UNITS), so it must NOT sum 60 + 4000;
    // it falls back cleanly to SPEND_EUR (500k vs 500k -> HHI 5000).
    const matCHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL" && m.label.includes("Material C"),
    )!;
    expect(matCHhi.rawHhi).toBe(5000);
    expect(matCHhi.weightingBasis).toBe("SPEND_EUR");
    expect(matCHhi.coveragePct).toBe(100);
  });

  it("uses contract-derived 90/10 volumes and spend over stale 50/50 lane fields for HHI", () => {
    const stale5050Lanes: SupplyLane[] = [
      {
        ...LANES[1]!,
        volumeSharePct: 50,
        annualVolume: 50,
        volumeUnit: "TONNES",
        annualSpendEur: 50_000,
      },
      {
        ...LANES[2]!,
        volumeSharePct: 50,
        annualVolume: 50,
        volumeUnit: "TONNES",
        annualSpendEur: 50_000,
      },
    ];

    const contracts: Contract[] = [
      {
        contractId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        ownerOrgId: ORG_ID,
        supplierFacilityId: FAC_TAMPERE_ID,
        title: "Tampere Primary Framework",
        contractType: "FRAMEWORK",
        pricingModel: "FIXED",
        expiryBehavior: "AUTO_ARCHIVE",
        confidence: "CONTRACTED",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        noticePeriodDays: 60,
        nonRenewalNoticeGiven: false,
        archiveEffectiveDate: null,
        isManuallyArchived: false,
        incoterms: "DAP",
        notes: null,
      },
      {
        contractId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        ownerOrgId: ORG_ID,
        supplierFacilityId: FAC_HAMBURG_ID,
        title: "Hamburg Secondary Framework",
        contractType: "FRAMEWORK",
        pricingModel: "FIXED",
        expiryBehavior: "AUTO_ARCHIVE",
        confidence: "CONTRACTED",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        noticePeriodDays: 60,
        nonRenewalNoticeGiven: false,
        archiveEffectiveDate: null,
        isManuallyArchived: false,
        incoterms: "DAP",
        notes: null,
      },
    ];

    const contractLines: ContractLine[] = [
      {
        contractLineId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        ownerOrgId: ORG_ID,
        contractId: contracts[0]!.contractId,
        laneId: LANE_TAMPERE_ID,
        inputId: INPUT_CHIPS_ID,
        cadence: "PER_YEAR",
        committedVolume: 90,
        unit: "TONNES",
        committedSpend: 90_000,
        unitPrice: 1000,
        currency: "EUR",
        startDateOverride: null,
        endDateOverride: null,
      },
      {
        contractLineId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        ownerOrgId: ORG_ID,
        contractId: contracts[1]!.contractId,
        laneId: LANE_HAMBURG_ID,
        inputId: INPUT_CHIPS_ID,
        cadence: "PER_YEAR",
        committedVolume: 10,
        unit: "TONNES",
        committedSpend: 10_000,
        unitPrice: 1000,
        currency: "EUR",
        startDateOverride: null,
        endDateOverride: null,
      },
    ];

    const commercials = deriveNetworkCommercials(
      stale5050Lanes,
      INPUTS,
      contracts,
      contractLines,
      { asOfDate: "2026-06-01", viewMode: "RUN_RATE" },
    );

    const summary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: stale5050Lanes,
      riskSignals: [],
      laneCommercialsByLaneId: commercials.laneSummaries,
      asOfDate,
    });

    const materialHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL" && m.label.includes("Material C"),
    )!;
    const supplierHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    const countryHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "COUNTRY",
    )!;

    // 90^2 + 10^2 = 8200 (not 5000 from stale 50/50 lane fields)
    expect(materialHhi.rawHhi).toBe(8200);
    expect(materialHhi.weightingBasis).toBe("VOLUME");
    expect(supplierHhi.rawHhi).toBe(8200);
    expect(supplierHhi.weightingBasis).toBe("SPEND_EUR");
    expect(countryHhi.rawHhi).toBe(8200);
  });

  it("excludes expired (LAPSED_UNCONTRACTED) lanes from HHI and SPOF without reviving stale 50/50 lane shares", () => {
    const stale5050Lanes: SupplyLane[] = [
      {
        ...LANES[1]!,
        volumeSharePct: 50,
        annualVolume: 50,
        volumeUnit: "TONNES",
        annualSpendEur: 50_000,
      },
      {
        ...LANES[2]!,
        volumeSharePct: 50,
        annualVolume: 50,
        volumeUnit: "TONNES",
        annualSpendEur: 50_000,
      },
    ];

    const contracts: Contract[] = [
      {
        contractId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        ownerOrgId: ORG_ID,
        supplierFacilityId: FAC_TAMPERE_ID,
        title: "Active Tampere Contract",
        contractType: "FRAMEWORK",
        pricingModel: "FIXED",
        expiryBehavior: "AUTO_ARCHIVE",
        confidence: "CONTRACTED",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        noticePeriodDays: 60,
        nonRenewalNoticeGiven: false,
        archiveEffectiveDate: null,
        isManuallyArchived: false,
        incoterms: null,
        notes: null,
      },
      {
        contractId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        ownerOrgId: ORG_ID,
        supplierFacilityId: FAC_HAMBURG_ID,
        title: "Expired Hamburg Contract",
        contractType: "FRAMEWORK",
        pricingModel: "FIXED",
        expiryBehavior: "AUTO_ARCHIVE",
        confidence: "CONTRACTED",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        noticePeriodDays: 60,
        nonRenewalNoticeGiven: false,
        archiveEffectiveDate: null,
        isManuallyArchived: false,
        incoterms: null,
        notes: null,
      },
    ];

    const contractLines: ContractLine[] = [
      {
        contractLineId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
        ownerOrgId: ORG_ID,
        contractId: contracts[0]!.contractId,
        laneId: LANE_TAMPERE_ID,
        inputId: INPUT_CHIPS_ID,
        cadence: "PER_YEAR",
        committedVolume: 90,
        unit: "TONNES",
        committedSpend: 90_000,
        unitPrice: 1000,
        currency: "EUR",
        startDateOverride: null,
        endDateOverride: null,
      },
      {
        contractLineId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        ownerOrgId: ORG_ID,
        contractId: contracts[1]!.contractId,
        laneId: LANE_HAMBURG_ID,
        inputId: INPUT_CHIPS_ID,
        cadence: "PER_YEAR",
        committedVolume: 10,
        unit: "TONNES",
        committedSpend: 10_000,
        unitPrice: 1000,
        currency: "EUR",
        startDateOverride: null,
        endDateOverride: null,
      },
    ];

    const oneActiveComm = deriveNetworkCommercials(
      stale5050Lanes,
      INPUTS,
      contracts,
      contractLines,
      { asOfDate: "2026-06-01", viewMode: "RUN_RATE" },
    );
    expect(
      oneActiveComm.laneSummaries.get(LANE_HAMBURG_ID)?.laneCommercialState,
    ).toBe("LAPSED_UNCONTRACTED");

    const oneActiveSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: stale5050Lanes,
      riskSignals: [],
      laneCommercialsByLaneId: oneActiveComm.laneSummaries,
      asOfDate,
    });

    const materialHhi = oneActiveSummary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL",
    )!;
    const supplierHhi = oneActiveSummary.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    expect(materialHhi.rawHhi).toBe(10000);
    expect(materialHhi.isSinglePointOfFailure).toBe(true);
    expect(materialHhi.totalActiveLanesCount).toBe(1);
    expect(supplierHhi.rawHhi).toBe(10000);
    expect(
      oneActiveSummary.alerts.some((a) => a.category === "SINGLE_SOURCE"),
    ).toBe(true);

    // When all contracts have expired, HHI must not fabricate 5,000 from stale 50/50 shares
    const allExpiredComm = deriveNetworkCommercials(
      stale5050Lanes,
      INPUTS,
      contracts,
      contractLines,
      { asOfDate: "2028-06-01", viewMode: "RUN_RATE" },
    );
    const allExpiredSummary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: 100, scope2Tco2e: 100 },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: stale5050Lanes,
      riskSignals: [],
      laneCommercialsByLaneId: allExpiredComm.laneSummaries,
      asOfDate: new Date("2028-06-01T00:00:00Z"),
    });
    expect(allExpiredSummary.hhiMetrics).toEqual([]);
  });

  it("honors explicit annualSpendEur overrides in simulateNetworkAnalytics across HHI and spend-based ESG", () => {
    const spendOnlyLanes: SupplyLane[] = [
      {
        ...LANES[1]!,
        volumeSharePct: 50,
        annualVolume: null,
        annualSpendEur: 50_000,
      },
      {
        ...LANES[2]!,
        volumeSharePct: 50,
        annualVolume: null,
        annualSpendEur: 50_000,
      },
    ];

    const result = simulateNetworkAnalytics(
      {
        organization: { scope1Tco2e: 0, scope2Tco2e: 0 },
        inputs: INPUTS,
        facilities: FACILITIES,
        lanes: spendOnlyLanes,
        riskSignals: [],
        asOfDate,
      },
      [{ laneId: LANE_TAMPERE_ID, annualSpendEur: 450_000 }],
    );

    const baseSupplierHhi = result.baseline.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    const simSupplierHhi = result.simulated.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    const simMaterialHhi = result.simulated.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL",
    )!;

    // 50k/50k -> 5000; 450k/50k (90%/10%) -> 8200
    expect(baseSupplierHhi.rawHhi).toBe(5000);
    expect(simSupplierHhi.rawHhi).toBe(8200);
    expect(simMaterialHhi.rawHhi).toBe(8200);
    // Spend-based Scope 3 upstream must increase when spend jumps from €100k to €500k
    expect(result.simulated.esg.upstreamScope3Tco2e).toBeGreaterThan(
      result.baseline.esg.upstreamScope3Tco2e * 3,
    );
  });
});

