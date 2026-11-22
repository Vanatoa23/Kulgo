import {
  EsgLedgerEntrySchema,
  EsgSummarySchema,
  FACTOR_MATRIX_VERSION,
  type Facility,
  type SupplyInput,
  type SupplyLane,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import {
  evaluateEsgAndCompliance,
  formatEsgLedgerCsv,
  resolveActiveCompliancePacks,
  type EsgPartnerAggregateInput,
} from "../esg-compliance.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const FAC_TALLINN = "44444444-4444-4444-8444-444444444401";
const FAC_DE_STEEL = "44444444-4444-4444-8444-444444444402";
const FAC_CN_STEEL = "44444444-4444-4444-8444-444444444403";
const FAC_CN_PCB = "44444444-4444-4444-8444-444444444404";
const FAC_US_CHEM = "44444444-4444-4444-8444-444444444405";

const INP_STEEL = "33333333-3333-4333-8333-333333333301";
const INP_PCB = "33333333-3333-4333-8333-333333333302";
const INP_CHEM = "33333333-3333-4333-8333-333333333303";

const LANE_DE_STEEL = "55555555-5555-4555-8555-555555555501";
const LANE_CN_STEEL = "55555555-5555-4555-8555-555555555502";
const LANE_CN_PCB = "55555555-5555-4555-8555-555555555503";
const LANE_US_CHEM = "55555555-5555-4555-8555-555555555504";

describe("missing supplier attribution inputs (#37)", () => {
  it.each([false, true])("uses the documented proxy instead of a full reported inventory (verified=%s)", (verified) => {
    const fixture = makeTallinnFixture();
    const own = fixture.facilities[0]!;
    const supplier = {
      ...fixture.facilities[1]!,
      isPartnerVerified: verified,
      estimatedScope12Tco2e: 1000,
    };
    const lane = {
      ...fixture.lanes[0]!,
      inputId: null,
      annualVolume: null,
      annualSpendEur: null,
      productEmissionFactorTco2ePerUnit: null,
      economicAttributionRatio: null,
    };
    const hidden = new Map<string, EsgPartnerAggregateInput>([
      [supplier.facilityId, {
        hiddenUpstreamScope3Tco2e: 8765,
        supplierEmissionIntensityTco2ePerEur: null,
        partnerTotalEmissionsCapTco2e: 9765,
      }],
    ]);
    const evaluate = (estimate: number | null, lanes = [lane]) => evaluateEsgAndCompliance({
      organization: { scope1Tco2e: 0, scope2Tco2e: 0 },
      inputs: [],
      facilities: [own, { ...supplier, estimatedScope12Tco2e: estimate }],
      lanes,
      partnerHiddenSummaries: verified ? hidden : undefined,
    });
    const expected = evaluate(null);
    const result = evaluate(1000, [lane, { ...lane, laneId: LANE_CN_STEEL }]);
    expect(result.summary.upstreamScope3Tco2e).toBe(expected.summary.upstreamScope3Tco2e);
    const entries = result.ledgerEntries.filter((e) => e.scope === "SCOPE_3_CAT_1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      attributionMethod: "SECTOR_BASELINE",
      pcafScore: 5,
      activityValue: 0.08,
      provenanceStatus: "CALIBRATED_BASELINE_V1",
    });
    expect(entries[0]!.formulaTrace).toContain("8% buyer-share prior");
    expect(JSON.stringify(result)).not.toMatch(/8765|9765|unscaled supplier estimate/);
  });
});

function makeTallinnFixture() {
  const facilities: Facility[] = [
    {
      facilityId: FAC_TALLINN,
      ownerOrgId: ORG_ID,
      name: "Tallinn Precision Drives Plant",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      regionCode: "EE-37",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
      isPartnerVerified: false,
      sector: "Manufacturing",
      esgBadges: ["ISO 14001"],
      estimatedScope12Tco2e: null,
      annualElectricityMwh: 1000,
      renewableElectricityPct: 30,
      renewableInstrumentsVerified: true,
    },
    {
      facilityId: FAC_DE_STEEL,
      ownerOrgId: ORG_ID,
      name: "RuhrStahl GmbH",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "DE",
      regionCode: "DE-NW",
      lat: 51.4556,
      lng: 7.0116,
      isOwnFacility: false,
      isPartnerVerified: true,
      sector: "Metals",
      esgBadges: [],
      estimatedScope12Tco2e: null,
    },
    {
      facilityId: FAC_CN_STEEL,
      ownerOrgId: ORG_ID,
      name: "Baoshan Metals Co.",
      kind: "FACTORY",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "CN",
      regionCode: "CN-SH",
      lat: 31.2304,
      lng: 121.4737,
      isOwnFacility: false,
      isPartnerVerified: false,
      sector: "Metals",
      esgBadges: [],
      estimatedScope12Tco2e: null,
    },
    {
      facilityId: FAC_CN_PCB,
      ownerOrgId: ORG_ID,
      name: "Shenzhen Circuits Ltd.",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "CN",
      regionCode: "CN-GD",
      lat: 22.5431,
      lng: 114.0579,
      isOwnFacility: false,
      isPartnerVerified: true,
      sector: "Electronics",
      esgBadges: [],
      estimatedScope12Tco2e: null,
    },
  ];

  const inputs: SupplyInput[] = [
    {
      inputId: INP_STEEL,
      ownerOrgId: ORG_ID,
      productId: null,
      name: "Electrical Steel Laminations",
      category: "Steel",
      unit: "TONNES",
      cnCode: "72251100",
      materialArchetype: "STEEL_PRIMARY_FLAT_BAR",
    },
    {
      inputId: INP_PCB,
      ownerOrgId: ORG_ID,
      productId: null,
      name: "Multi-Layer Driver PCBs",
      category: "Electronics",
      unit: "UNITS",
      cnCode: "85340011",
      materialArchetype: "PCB_SEMICONDUCTOR_ELECTRONICS",
    },
  ];

  const lanes: SupplyLane[] = [
    {
      laneId: LANE_DE_STEEL,
      ownerOrgId: ORG_ID,
      fromFacilityId: FAC_DE_STEEL,
      toFacilityId: FAC_TALLINN,
      inputId: INP_STEEL,
      materialCategory: "Electrical Steel",
      transportMode: "ROAD",
      volumeSharePct: 67,
      annualVolume: 400,
      volumeUnit: "TONNES",
      annualSpendEur: 480_000,
      contractEndDate: null,
      contractTerms: "EXW",
      leadTimeDays: 5,
      distanceKm: 1450,
      estimatedLaneCo2e: null,
      riskStatus: "GREEN",
      riskReason: null,
    },
    {
      laneId: LANE_CN_STEEL,
      ownerOrgId: ORG_ID,
      fromFacilityId: FAC_CN_STEEL,
      toFacilityId: FAC_TALLINN,
      inputId: INP_STEEL,
      materialCategory: "Electrical Steel",
      transportMode: "SEA",
      volumeSharePct: 33,
      annualVolume: 200,
      volumeUnit: "TONNES",
      annualSpendEur: 150_000,
      contractEndDate: null,
      contractTerms: "FOB",
      leadTimeDays: 35,
      distanceKm: 19500,
      estimatedLaneCo2e: null,
      riskStatus: "YELLOW",
      riskReason: null,
    },
    {
      laneId: LANE_CN_PCB,
      ownerOrgId: ORG_ID,
      fromFacilityId: FAC_CN_PCB,
      toFacilityId: FAC_TALLINN,
      inputId: INP_PCB,
      materialCategory: "Driver PCBs",
      transportMode: "SEA",
      volumeSharePct: 100,
      annualVolume: 100_000,
      volumeUnit: "UNITS",
      annualSpendEur: 1_200_000,
      contractEndDate: null,
      contractTerms: "FOB",
      leadTimeDays: 30,
      distanceKm: 19500,
      estimatedLaneCo2e: null,
      riskStatus: "GREEN",
      riskReason: null,
    },
  ];

  return { facilities, inputs, lanes };
}

describe("Sub-Project 3 ESG & Multi-Region Compliance Engine", () => {
  it("reproduces the Tallinn Precision Drives worked fixture across Physical (PCAF 3), Spend EEIO (PCAF 4), Verified PCF (PCAF 1) and Server-Side Partner Intensity (PCAF 2)", () => {
    const { facilities, inputs, lanes } = makeTallinnFixture();

    // Path 1: Physical-first on Steel (DE 400t * 1.95 = 780; CN 200t * 2.73 = 546) + EXIOBASE Spend EEIO on CN PCBs (€1.2M * 0.78 / 1000 = 936)
    const baseEval = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Tallinn Precision Drives OÜ",
        countryCode: "EE",
        scope1Tco2e: 80,
        scope2Tco2e: null,
        annualRevenueEur: 8_000_000,
        targetMarkets: ["EU", "UK"],
      },
      inputs,
      facilities,
      lanes,
    });

    const parsedSummary = EsgSummarySchema.parse(baseEval.summary);
    expect(parsedSummary.factorMatrixVersion).toBe(FACTOR_MATRIX_VERSION);
    // Dual Scope 2 from 1,000 MWh in EE (30% verified GOs):
    // Location: 1000 * 0.312 = 312.00; Market: 700 * 0.518 = 362.60
    expect(parsedSummary.scope2LocationTco2e).toBe(312);
    expect(parsedSummary.scope2MarketTco2e).toBe(362.6);
    expect(parsedSummary.upstreamScope3Tco2e).toBe(780 + 546 + 936); // 2262
    // Freight Cat 4: DE road 400*1450*0.096/1000 = 55.68; CN sea 200*19500*0.016/1000 = 62.40
    expect(parsedSummary.transportScope3Tco2e).toBe(118.08);
    expect(parsedSummary.cbamSummary?.euCbamApplicable).toBe(true);
    expect(parsedSummary.cbamSummary?.cumulativeMassTonnes).toBe(200);
    expect(parsedSummary.cbamSummary?.defaultFactorLanesCount).toBe(1);
    expect(parsedSummary.activeCompliancePacks).toEqual(
      expect.arrayContaining(["GLOBAL_GHG_ISSB", "EU", "UK"]),
    );

    // Path 2: Verified partners provide third-party EPD (1.12 tCO2e/t) on DE Steel -> 448 tCO2e (PCAF 1)
    // and server-side economic intensity (0.0005 tCO2e/EUR) on CN PCBs -> 600 tCO2e (PCAF 2)
    const partnerHiddenSummaries = new Map<string, EsgPartnerAggregateInput>([
      [
        FAC_DE_STEEL,
        {
          hiddenUpstreamScope3Tco2e: 5000,
          productEmissionFactorTco2ePerUnit: 1.12,
          pcfVerified: true,
        },
      ],
      [
        FAC_CN_PCB,
        {
          hiddenUpstreamScope3Tco2e: 18500,
          supplierEmissionIntensityTco2ePerEur: 0.0005,
          partnerTotalEmissionsCapTco2e: 18500,
        },
      ],
    ]);

    const enriched = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Tallinn Precision Drives OÜ",
        countryCode: "EE",
        scope1Tco2e: 80,
        scope2Tco2e: null,
        annualRevenueEur: 8_000_000,
        targetMarkets: ["EU", "UK"],
      },
      inputs,
      facilities,
      lanes,
      partnerHiddenSummaries,
    });

    expect(enriched.summary.upstreamScope3Tco2e).toBe(448 + 546 + 600); // 1594
    expect(enriched.summary.weightedPcafScore!).toBeLessThan(
      baseEval.summary.weightedPcafScore!,
    );
    expect(enriched.summary.primaryDataSharePct).toBeCloseTo(
      ((448 + 600) / 1594) * 100,
      1,
    );

    // Validate every ledger entry against .strict() schema and confirm zero partner revenue leakage
    for (const entry of enriched.ledgerEntries) {
      EsgLedgerEntrySchema.parse(entry);
      expect(entry.formulaTrace).not.toContain("37000000");
      expect(entry.formulaTrace).not.toContain("18500");
    }
  });

  it("enforces EU CBAM 50-tonne cumulative de minimis exemption and US EPA USEEIO v1.3 + delivered Incoterms margin strip", () => {
    const { facilities, inputs, lanes } = makeTallinnFixture();
    // Drop CN steel below 50 tonnes (30 t < 50 t de minimis)
    const smallCbamLanes: SupplyLane[] = [
      { ...lanes[1]!, annualVolume: 30, annualSpendEur: 22_500 },
      {
        laneId: LANE_US_CHEM,
        ownerOrgId: ORG_ID,
        fromFacilityId: FAC_US_CHEM,
        toFacilityId: FAC_TALLINN,
        inputId: INP_CHEM,
        materialCategory: "Industrial Solvents",
        transportMode: "SEA",
        volumeSharePct: 100,
        annualVolume: 1000,
        volumeUnit: "LITERS",
        annualSpendEur: 100_000,
        contractEndDate: null,
        contractTerms: "DDP",
        leadTimeDays: 20,
        distanceKm: 7000,
        estimatedLaneCo2e: null,
        riskStatus: "GREEN",
        riskReason: null,
      },
    ];

    const extendedFacilities: Facility[] = [
      ...facilities,
      {
        facilityId: FAC_US_CHEM,
        ownerOrgId: ORG_ID,
        name: "Houston Solvents Inc.",
        kind: "FACTORY",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "US",
        regionCode: "US-TX",
        lat: 29.7604,
        lng: -95.3698,
        isOwnFacility: false,
        isPartnerVerified: false,
        sector: "Chemicals",
        esgBadges: [],
        estimatedScope12Tco2e: null,
      },
    ];

    const extendedInputs: SupplyInput[] = [
      ...inputs,
      {
        inputId: INP_CHEM,
        ownerOrgId: ORG_ID,
        productId: null,
        name: "Industrial Solvent",
        category: "Chemicals",
        unit: "LITERS",
        materialArchetype: "CHEMICALS_SOLVENTS_INORGANIC",
      },
    ];

    const res = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Tallinn Precision Drives OÜ",
        countryCode: "EE",
        scope1Tco2e: 50,
        scope2Tco2e: 40,
        targetMarkets: ["EU", "US"],
      },
      inputs: extendedInputs,
      facilities: extendedFacilities,
      lanes: smallCbamLanes,
      incotermsByLaneId: new Map([[LANE_US_CHEM, "DDP"]]),
    });

    // 30 t < 50 t threshold -> EU CBAM NOT_APPLICABLE
    expect(res.summary.cbamSummary?.euCbamApplicable).toBe(false);
    expect(res.summary.cbamSummary?.cumulativeMassTonnes).toBe(30);
    const cbamCheck = res.summary.complianceChecklist?.find(
      (c) => c.ruleId === "EU_CBAM_EMBEDDED_EMISSIONS",
    );
    expect(cbamCheck?.status).toBe("NOT_APPLICABLE");

    // US Chemicals lane uses USEEIO v1.3 (0.98 kg/EUR) with 8% DDP margin strip: 100,000 * 0.92 * 0.98 / 1000 = 90.16 tCO2e
    const usEntry = res.ledgerEntries.find(
      (e) => e.entryId === `scope3-cat1-${LANE_US_CHEM}`,
    );
    expect(usEntry?.licenseId).toBe("CC0-1.0");
    expect(usEntry?.tco2e).toBe(90.16);
    expect(usEntry?.formulaTrace).toContain("DDP strip");

    // US CA SB 253 check explicitly tagged LITIGATED
    const sb253Check = res.summary.complianceChecklist?.find(
      (c) => c.ruleId === "US_CA_SB253_SCOPE3_AUDIT_TRAIL",
    );
    expect(sb253Check?.legalStatus).toBe("LITIGATED");
  });

  it("never alters Location-Based Scope 2 for unsubstantiated renewableElectricityPct and flags ESRS E1-6", () => {
    const { facilities } = makeTallinnFixture();
    const unverifiedRenFacility: Facility = {
      ...facilities[0]!,
      annualElectricityMwh: 500,
      renewableElectricityPct: 80,
      renewableInstrumentsVerified: false,
    };

    const res = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Tallinn Test",
        countryCode: "EE",
        scope1Tco2e: 20,
        scope2Tco2e: null,
        targetMarkets: ["EU"],
      },
      inputs: [],
      facilities: [unverifiedRenFacility],
      lanes: [],
    });

    // Location = 500 * 0.312 = 156; Market = 500 * 0.518 = 259 (0% credited since unverified)
    expect(res.summary.scope2LocationTco2e).toBe(156);
    expect(res.summary.scope2MarketTco2e).toBe(259);
    const dualCheck = res.summary.complianceChecklist?.find(
      (c) => c.ruleId === "ESRS_E1_6_DUAL_SCOPE2",
    );
    expect(dualCheck?.status).toBe("ACTION_NEEDED");
  });

  it("auto-detects regional compliance packs from HQ and target markets and sanitizes CSV ledger against formula injection", () => {
    expect(resolveActiveCompliancePacks("EE", ["US", "APAC"])).toEqual([
      "GLOBAL_GHG_ISSB",
      "EU",
      "US",
      "APAC",
    ]);
    expect(resolveActiveCompliancePacks("ZA", [], ["GLOBAL_GHG_ISSB", "AFRICA"])).toEqual([
      "GLOBAL_GHG_ISSB",
      "AFRICA",
    ]);

    const csv = formatEsgLedgerCsv([
      {
        entryId: "e-1",
        scope: "SCOPE_3_CAT_1",
        entityType: "TIER1_SUPPLIER_LANE",
        entityId: LANE_DE_STEEL,
        entityName: "=CMD|' /C calc'!A0",
        countryCode: "DE",
        sector: "Metals",
        materialCategory: "Steel",
        materialArchetype: "STEEL_PRIMARY_FLAT_BAR",
        cnCode: "7225",
        cbamCategory: "IRON_STEEL",
        matchConfidence: "EXACT_CODE",
        activityValue: 100,
        activityUnit: "TONNES",
        attributionMethod: "PHYSICAL_FACTOR",
        factorId: "test_factor",
        factorVersion: FACTOR_MATRIX_VERSION,
        factorValue: 1.95,
        factorUnit: "tCO2e / tonne",
        sourceCitation: "Test Citation",
        licenseId: "CC-BY-4.0",
        provenanceStatus: "OFFICIAL_PUBLISHED",
        pcafScore: 3,
        tco2e: 195,
        formulaTrace: "+100 * 1.95",
        networkVerified: false,
      },
    ]);

    expect(csv).toContain("'=CMD|' /C calc'!A0");
    expect(csv).toContain("'+100 * 1.95");
  });

  it("enforces cumulative 100% partner cap across multi-lane ALLOCATION_RATIO, never leaks raw partner pool, prefers proportional Physical/Spend over unscaled partner rollup, and treats lapsed derivedComm as authoritative", () => {
    const { facilities, inputs, lanes } = makeTallinnFixture();

    // 1. Two 75% allocation lanes from the same supplier (pool = 10,000 tCO2e) -> capped at 10,000 total (7,500 + 2,500), never 15,000!
    //    AND neither activityValue nor formulaTrace nor CSV exposes "10000"
    const allocLanes: SupplyLane[] = [
      { ...lanes[0]!, laneId: "55555555-5555-4555-8555-555555555591", economicAttributionRatio: 0.75 },
      { ...lanes[0]!, laneId: "55555555-5555-4555-8555-555555555592", economicAttributionRatio: 0.75 },
    ];
    const partnerSummaries = new Map<string, EsgPartnerAggregateInput>([
      [
        FAC_DE_STEEL,
        {
          hiddenUpstreamScope3Tco2e: 10_000,
          partnerTotalEmissionsCapTco2e: 10_000,
        },
      ],
    ]);

    const cappedRes = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Cap Test",
        countryCode: "EE",
        scope1Tco2e: 0,
        scope2Tco2e: 0,
      },
      inputs,
      facilities,
      lanes: allocLanes,
      partnerHiddenSummaries: partnerSummaries,
    });

    expect(cappedRes.summary.upstreamScope3Tco2e).toBe(10_000);
    const cat1Entries = cappedRes.ledgerEntries.filter((e) => e.scope === "SCOPE_3_CAT_1");
    expect(cat1Entries[0]?.tco2e).toBe(7500);
    expect(cat1Entries[1]?.tco2e).toBe(2500);
    expect(cat1Entries[0]?.activityValue).toBe(0.75);
    const ledgerSerialized = JSON.stringify(cat1Entries) + formatEsgLedgerCsv(cat1Entries);
    expect(ledgerSerialized).not.toContain("10000");

    // 2. Verified partner without PCF/revenue/ratio MUST continue through proportional PHYSICAL_FACTOR (400t * 1.95 = 780), NOT 10,000!
    const propRes = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Proportional Test",
        countryCode: "EE",
        scope1Tco2e: 0,
        scope2Tco2e: 0,
      },
      inputs,
      facilities,
      lanes: [lanes[0]!],
      partnerHiddenSummaries: partnerSummaries,
    });
    expect(propRes.summary.upstreamScope3Tco2e).toBe(780);
    const propEntry = propRes.ledgerEntries.find((e) => e.scope === "SCOPE_3_CAT_1");
    expect(propEntry?.attributionMethod).toBe("PHYSICAL_FACTOR");

    // 3. Authoritative LAPSED_UNCONTRACTED derivedComm (activeVolume: null, activeSpendEur: null) MUST NOT revive legacy lane.annualVolume/annualSpendEur
    const lapsedComm = new Map([
      [
        LANE_CN_STEEL,
        {
          laneId: LANE_CN_STEEL,
          viewMode: "PERIOD_WINDOW" as const,
          asOfDate: "2026-11-22",
          windowStart: "2026-11-22",
          windowEndExclusive: "2027-11-22",
          laneCommercialState: "LAPSED_UNCONTRACTED" as const,
          activeVolume: null,
          baseUnit: "TONNES",
          activeSpendEur: null,
          weightedAvgUnitPrice: null,
          spendOnlyExcludedEur: 0,
          cBothSpendCoveragePct: null,
          knownMappedSharePct: null,
          totalDemandSharePct: null,
          weightingBasis: null,
          nextExpirationDate: null,
          nextNoticeDeadline: null,
          atRiskVolumePct: 0,
          assumedHoldoverVolume: 0,
          hasUnitConflict: false,
          missingFxCurrencies: [],
          activeContractCount: 0,
          confidenceBadge: "CONTRACTED" as const,
        },
      ],
    ]);

    const lapsedRes = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Lapsed Test",
        countryCode: "EE",
        scope1Tco2e: 0,
        scope2Tco2e: 0,
      },
      inputs,
      facilities,
      lanes: [lanes[1]!],
      laneCommercialsByLaneId: lapsedComm,
    });
    const lapsedEntry = lapsedRes.ledgerEntries.find((e) => e.scope === "SCOPE_3_CAT_1");
    expect(lapsedEntry?.attributionMethod).toBe("SECTOR_BASELINE");
    expect(lapsedEntry?.tco2e).not.toBe(546);
  });

  it("enforces follow-up privacy & accounting invariants: no unscaled topology leak, shared partnerInventoryKey cap, LEVEL_0_UNPRICED authority, and partial Scope 2 coverage", () => {
    const { facilities: baseFacilities, lanes: baseLanes } = makeTallinnFixture();
    const baseOwn = baseFacilities[0]!;
    const baseSup = baseFacilities[1]!;
    const baseLane = baseLanes[0]!;

    const own1: Facility = {
      ...baseOwn,
      facilityId: "20000000-0000-4000-8000-000000000031",
      name: "Own Site A",
      countryCode: "DE",
      annualElectricityMwh: 100,
      renewableElectricityPct: 0,
      renewableInstrumentsVerified: false,
      estimatedScope12Tco2e: null,
    };
    const own2: Facility = {
      ...baseOwn,
      facilityId: "20000000-0000-4000-8000-000000000032",
      name: "Own Site B",
      countryCode: "DE",
      annualElectricityMwh: null,
      renewableElectricityPct: null,
      renewableInstrumentsVerified: false,
      estimatedScope12Tco2e: 200,
    };

    // 1. Verified partner with NO allocation basis must NEVER leak raw total (8,765 tCO2e)
    const unallocatedPartner: Facility = {
      ...baseSup,
      facilityId: "20000000-0000-4000-8000-000000000033",
      name: "Confidential Partner Co",
      countryCode: "FI",
      isPartnerVerified: true,
      sector: "Chemicals",
      estimatedScope12Tco2e: null,
    };
    const unallocatedLane: SupplyLane = {
      ...baseLane,
      laneId: "30000000-0000-4000-8000-000000000031",
      inputId: null,
      fromFacilityId: unallocatedPartner.facilityId,
      toFacilityId: own1.facilityId,
      materialCategory: "Specialty Chemicals",
      annualVolume: null,
      annualSpendEur: null,
      productEmissionFactorTco2ePerUnit: null,
      economicAttributionRatio: null,
    };

    const hiddenMap = new Map<string, EsgPartnerAggregateInput>([
      [
        unallocatedPartner.facilityId,
        {
          hiddenUpstreamScope3Tco2e: 8_765,
          partnerTotalEmissionsCapTco2e: 8_765,
          partnerInventoryKey: "partner:org-secret:org",
        },
      ],
    ]);

    const res1 = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Partial Scope2 Org",
        countryCode: "DE",
        scope1Tco2e: 100,
        scope2Tco2e: 500, // Org-wide Scope 2 MUST NOT be replaced by partial site electricity!
      },
      inputs: [],
      facilities: [own1, own2, unallocatedPartner],
      lanes: [unallocatedLane],
      partnerHiddenSummaries: hiddenMap,
    });

    // P1 #1: Falls back to SECTOR_BASELINE; raw 8,765 never leaks
    const cat1 = res1.ledgerEntries.find((e) => e.scope === "SCOPE_3_CAT_1");
    expect(cat1?.attributionMethod).toBe("SECTOR_BASELINE");
    expect(JSON.stringify(res1)).not.toContain("8765");
    expect(JSON.stringify(res1)).not.toContain("8,765");

    // P2 #5a: Partial site electricity (1 of 2 sites) preserves org-wide Scope 2 (500 tCO2e)
    expect(res1.summary.scope2LocationTco2e).toBe(500);

    // P2 #5b: When org-wide scope2Tco2e is null, metered site + unmetered site estimate (0.6 * 200 = 120) are combined
    const res1b = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Partial Scope2 No Org Override",
        countryCode: "DE",
        scope1Tco2e: 100,
        scope2Tco2e: null,
      },
      inputs: [],
      facilities: [own1, own2],
      lanes: [],
    });
    expect(res1b.summary.scope2LocationTco2e).toBeGreaterThan(120);
    expect(
      res1b.ledgerEntries.some(
        (e) => e.entryId === `scope2-loc-est-${own2.facilityId}` && e.tco2e === 120,
      ),
    ).toBe(true);

    // 2. P1 #2: Two distinct buyer nodes linked to the SAME underlying partnerInventoryKey share one cap (1,000 tCO2e)
    const nodeA: Facility = {
      ...baseSup,
      facilityId: "20000000-0000-4000-8000-000000000034",
      name: "Shared Partner Node A",
      countryCode: "DE",
      isPartnerVerified: true,
      estimatedScope12Tco2e: null,
    };
    const nodeB: Facility = {
      ...baseSup,
      facilityId: "20000000-0000-4000-8000-000000000035",
      name: "Shared Partner Node B",
      countryCode: "DE",
      isPartnerVerified: true,
      estimatedScope12Tco2e: null,
    };
    const laneA: SupplyLane = {
      ...baseLane,
      laneId: "30000000-0000-4000-8000-000000000032",
      inputId: null,
      fromFacilityId: nodeA.facilityId,
      toFacilityId: own1.facilityId,
      materialCategory: "Parts A",
      economicAttributionRatio: 0.75,
      productEmissionFactorTco2ePerUnit: null,
    };
    const laneB: SupplyLane = {
      ...baseLane,
      laneId: "30000000-0000-4000-8000-000000000033",
      inputId: null,
      fromFacilityId: nodeB.facilityId,
      toFacilityId: own2.facilityId,
      materialCategory: "Parts B",
      economicAttributionRatio: 0.75,
      productEmissionFactorTco2ePerUnit: null,
    };
    const sharedCapHidden = new Map<string, EsgPartnerAggregateInput>([
      [
        nodeA.facilityId,
        {
          hiddenUpstreamScope3Tco2e: 1_000,
          partnerTotalEmissionsCapTco2e: 1_000,
          partnerInventoryKey: "partner:org-shared-123:org",
        },
      ],
      [
        nodeB.facilityId,
        {
          hiddenUpstreamScope3Tco2e: 1_000,
          partnerTotalEmissionsCapTco2e: 1_000,
          partnerInventoryKey: "partner:org-shared-123:org",
        },
      ],
    ]);

    const res2 = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Multi-Node Buyer",
        countryCode: "DE",
        scope1Tco2e: 0,
        scope2Tco2e: 0,
      },
      inputs: [],
      facilities: [own1, own2, nodeA, nodeB],
      lanes: [laneA, laneB],
      partnerHiddenSummaries: sharedCapHidden,
    });
    // 75% + 75% across two buyer nodes for one partner MUST cap at 1,000 tCO2e (750 + 250)
    expect(res2.summary.upstreamScope3Tco2e).toBe(1_000);

    // 3. P2 #3: LEVEL_0_UNPRICED derived commercial summary (e.g. future/archived contract) must NOT revive stale legacy volume
    const futureContractLane: SupplyLane = {
      ...baseLane,
      laneId: "30000000-0000-4000-8000-000000000034",
      inputId: null,
      fromFacilityId: nodeA.facilityId,
      toFacilityId: own1.facilityId,
      materialCategory: "Steel",
      annualVolume: 300,
      volumeUnit: "TONNES",
      annualSpendEur: 250_000,
      productEmissionFactorTco2ePerUnit: null,
      economicAttributionRatio: null,
    };
    const level0UnpricedMap = new Map([
      [
        futureContractLane.laneId,
        {
          laneId: futureContractLane.laneId,
          viewMode: "PERIOD_WINDOW" as const,
          asOfDate: "2026-11-22",
          windowStart: "2026-11-22",
          windowEndExclusive: "2027-11-22",
          laneCommercialState: "LEVEL_0_UNPRICED" as const,
          activeVolume: null,
          baseUnit: "TONNES",
          activeSpendEur: null,
          weightedAvgUnitPrice: null,
          spendOnlyExcludedEur: 0,
          cBothSpendCoveragePct: null,
          knownMappedSharePct: null,
          totalDemandSharePct: null,
          weightingBasis: null,
          nextExpirationDate: null,
          nextNoticeDeadline: null,
          atRiskVolumePct: 0,
          assumedHoldoverVolume: 0,
          hasUnitConflict: false,
          missingFxCurrencies: [],
          activeContractCount: 0,
          confidenceBadge: "CONTRACTED" as const,
        },
      ],
    ]);
    const res3 = evaluateEsgAndCompliance({
      organization: {
        orgId: ORG_ID,
        name: "Future Contract Org",
        countryCode: "DE",
        scope1Tco2e: 0,
        scope2Tco2e: 0,
      },
      inputs: [],
      facilities: [own1, { ...nodeA, isPartnerVerified: false }],
      lanes: [futureContractLane],
      laneCommercialsByLaneId: level0UnpricedMap,
    });
    const futureEntry = res3.ledgerEntries.find((e) => e.scope === "SCOPE_3_CAT_1");
    expect(futureEntry?.attributionMethod).toBe("SECTOR_BASELINE");
  });
});


