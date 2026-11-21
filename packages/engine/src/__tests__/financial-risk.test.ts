import { describe, expect, it } from "vitest";
import {
  FinancialRiskSummarySchema,
  type Contract,
  type ContractLine,
  type Facility,
  type Product,
  type RiskSignal,
  type SupplyInput,
  type SupplyLane,
} from "@kulgo/shared";
import {
  computeDefectBufferRecommendation,
  computeEffectiveHorizonProb,
  computeFinancialRiskSummary,
  computeFinancialSimulationDelta,
  deriveLiveRiskMultiplierFromSignals,
} from "../financial-risk.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROD_X = "22222222-2222-4222-8222-222222222220";
const INPUT_SENSOR = "33333333-3333-4333-8333-333333333330";
const FAC_EE = "44444444-4444-4444-8444-444444444441";
const FAC_CN = "44444444-4444-4444-8444-444444444442";
const FAC_FI = "44444444-4444-4444-8444-444444444443";
const LANE_CN = "55555555-5555-4555-8555-555555555551";
const LANE_FI = "55555555-5555-4555-8555-555555555552";
const CONTRACT_CN = "66666666-6666-4666-8666-666666666661";
const CL_CN = "77777777-7777-4777-8777-777777777771";

const facEE: Facility = {
  facilityId: FAC_EE,
  ownerOrgId: ORG,
  name: "Tallinn Precision Drives Factory",
  kind: "FACTORY",
  locationPrecision: "SITE_VERIFIED",
  countryCode: "EE",
  regionCode: "EU_NORDIC_BALTIC",
  lat: 59.437,
  lng: 24.7536,
  isOwnFacility: true,
  isPartnerVerified: false,
  sector: "Electronics",
  esgBadges: [],
  estimatedScope12Tco2e: 420,
};

const facCN: Facility = {
  facilityId: FAC_CN,
  ownerOrgId: ORG,
  name: "Shenzhen SensorTech",
  kind: "FACTORY",
  locationPrecision: "HQ_ESTIMATED",
  countryCode: "CN",
  regionCode: "EAST_ASIA",
  lat: 22.5431,
  lng: 114.0579,
  isOwnFacility: false,
  isPartnerVerified: false,
  sector: "Electronics",
  esgBadges: [],
  estimatedScope12Tco2e: null,
};

const facFI: Facility = {
  facilityId: FAC_FI,
  ownerOrgId: ORG,
  name: "Vantaa MicroSensors Oy",
  kind: "FACTORY",
  locationPrecision: "SITE_VERIFIED",
  countryCode: "FI",
  regionCode: "EU_NORDIC_BALTIC",
  lat: 60.2934,
  lng: 25.0378,
  isOwnFacility: false,
  isPartnerVerified: true,
  sector: "Electronics",
  esgBadges: ["ISO 14001"],
  estimatedScope12Tco2e: null,
};

const inputSensor: SupplyInput = {
  inputId: INPUT_SENSOR,
  ownerOrgId: ORG,
  productId: PROD_X,
  name: "Power Hall-Effect Sensor Array",
  category: "Electronics",
  unit: "UNITS",
  baseUnit: "UNITS",
  unitFamily: "COUNT",
  totalAnnualDemand: 100_000,
};

describe("financial-risk pure engine (Phase 1)", () => {
  it("Fixture B: Tallinn Precision Drives OÜ Level 0 -> Level 1 -> Level 2 range narrowing and What-If ROI", () => {
    const productLevel0: Product = {
      productId: PROD_X,
      ownerOrgId: ORG,
      name: "Product X Servo Drive",
      sku: "PX-100",
      description: null,
    };
    const laneLevel0: SupplyLane = {
      laneId: LANE_CN,
      ownerOrgId: ORG,
      fromFacilityId: FAC_CN,
      toFacilityId: FAC_EE,
      inputId: INPUT_SENSOR,
      materialCategory: "Electronics",
      transportMode: "SEA",
      volumeSharePct: 100,
      annualVolume: null,
      volumeUnit: "UNITS",
      annualSpendEur: null,
      contractEndDate: null,
      contractTerms: null,
      leadTimeDays: 42,
      distanceKm: 18500,
      estimatedLaneCo2e: null,
      riskStatus: "RED",
      riskReason: "Red Sea chokepoint",
    };

    const liveMult = new Map([[LANE_CN, 1.35]]);

    // Level 0: Never invents euros from topology alone
    const l0 = computeFinancialRiskSummary({
      products: [productLevel0],
      inputs: [inputSensor],
      facilities: [facEE, facCN],
      lanes: [laneLevel0],
      liveRiskMultiplierByLaneId: liveMult,
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });
    expect(l0.lowEur).toBeNull();
    expect(l0.baseEur).toBeNull();
    expect(l0.highEur).toBeNull();
    expect(l0.confidenceBadge).toBe("ESTIMATED");
    expect(l0.missingInputsPrompt).toContain("annual spend");

    // Level 1: Quick commercial spend (€1.2M), no product revenue/margin
    const laneLevel1: SupplyLane = {
      ...laneLevel0,
      annualVolume: 100_000,
      annualSpendEur: 1_200_000,
    };
    const l1 = computeFinancialRiskSummary({
      products: [productLevel0],
      inputs: [inputSensor],
      facilities: [facEE, facCN],
      lanes: [laneLevel1],
      liveRiskMultiplierByLaneId: liveMult,
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });
    expect(l1.isEstimatedProxy).toBe(true);
    expect(l1.baseEur).toBeGreaterThan(100_000);
    expect(l1.highEur!).toBeGreaterThan(l1.baseEur!);
    expect(l1.lowEur!).toBeLessThan(l1.baseEur!);
    const l1SpreadRatio = l1.highEur! / Math.max(1, l1.lowEur!);

    // Level 2: Signed FRAMEWORK contract + €8M rev / 35% GM + TTS = 10d
    const productLevel2: Product = {
      ...productLevel0,
      annualRevenueEur: 8_000_000,
      grossMarginPct: 35,
    };
    const laneLevel2: SupplyLane = {
      ...laneLevel1,
      safetyStockDays: 10,
      defectRatePct: 2.5,
      carryingCostPct: 20,
    };
    const contractCN: Contract = {
      contractId: CONTRACT_CN,
      ownerOrgId: ORG,
      supplierFacilityId: FAC_CN,
      title: "Shenzhen Annual Framework",
      contractType: "FRAMEWORK",
      pricingModel: "FIXED",
      expiryBehavior: "HOLDOVER",
      confidence: "CONTRACTED",
      startDate: "2026-01-01",
      endDate: "2027-06-30",
      noticePeriodDays: 60,
      nonRenewalNoticeGiven: false,
      archiveEffectiveDate: null,
      isManuallyArchived: false,
      incoterms: "CIF",
      notes: null,
    };
    const contractLineCN: ContractLine = {
      contractLineId: CL_CN,
      contractId: CONTRACT_CN,
      ownerOrgId: ORG,
      laneId: LANE_CN,
      inputId: INPUT_SENSOR,
      cadence: "PER_YEAR",
      committedVolume: 100_000,
      unit: "UNITS",
      committedSpend: 1_200_000,
      unitPrice: null,
      currency: "EUR",
      startDateOverride: null,
      endDateOverride: null,
    };

    const l2 = computeFinancialRiskSummary({
      products: [productLevel2],
      inputs: [inputSensor],
      facilities: [facEE, facCN],
      lanes: [laneLevel2],
      contracts: [contractCN],
      contractLines: [contractLineCN],
      liveRiskMultiplierByLaneId: liveMult,
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });

    expect(l2.isEstimatedProxy).toBe(false);
    expect(l2.confidenceBadge).toBe("HYBRID");
    expect(l2.baseEur).toBeCloseTo(156_240, -2);
    expect(l2.varP90Eur).toBeCloseTo(524_027, -2);
    expect(l2.varP95Eur).toBeCloseTo(524_027, -2);
    const l2SpreadRatio = l2.highEur! / Math.max(1, l2.lowEur!);
    expect(l2SpreadRatio).toBeLessThan(l1SpreadRatio);

    // What-If 1: +14 days safety stock (TTS 10 -> 24d)
    const laneWi1: SupplyLane = { ...laneLevel2, safetyStockDays: 24 };
    const wi1 = computeFinancialRiskSummary({
      products: [productLevel2],
      inputs: [inputSensor],
      facilities: [facEE, facCN],
      lanes: [laneWi1],
      contracts: [contractCN],
      contractLines: [contractLineCN],
      liveRiskMultiplierByLaneId: liveMult,
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });
    const deltaWi1 = computeFinancialSimulationDelta({
      baseline: l2,
      simulated: wi1,
      baselineLanes: [laneLevel2],
      simulatedLanes: [laneWi1],
    });
    expect(deltaWi1.baseEalDeltaEur!).toBeLessThan(-40_000);
    expect(deltaWi1.incrementalWorkingCapitalEur).toBeCloseTo(46_027.4, 0);
    expect(deltaWi1.carryingCostDeltaEur).toBeCloseTo(9_205.48, 0);
    expect(deltaWi1.workingCapitalRoiPct!).toBeGreaterThan(80);
    expect(deltaWi1.workingCapitalRoiPct!).toBeLessThan(100);
    expect(deltaWi1.paybackYears!).toBeCloseTo(1.14, 1);

    // What-If 2: Dual-source 40% to Nordic FI Road supplier
    const laneCN60: SupplyLane = {
      ...laneLevel2,
      volumeSharePct: 60,
      annualVolume: 60_000,
      annualSpendEur: 720_000,
    };
    const laneFI40: SupplyLane = {
      laneId: LANE_FI,
      ownerOrgId: ORG,
      fromFacilityId: FAC_FI,
      toFacilityId: FAC_EE,
      inputId: INPUT_SENSOR,
      materialCategory: "Electronics",
      transportMode: "ROAD",
      volumeSharePct: 40,
      annualVolume: 40_000,
      volumeUnit: "UNITS",
      annualSpendEur: 528_000,
      contractEndDate: null,
      contractTerms: null,
      leadTimeDays: 3,
      distanceKm: 90,
      estimatedLaneCo2e: null,
      riskStatus: "GREEN",
      riskReason: null,
      safetyStockDays: 10,
      carryingCostPct: 20,
    };
    const wi2 = computeFinancialRiskSummary({
      products: [productLevel2],
      inputs: [inputSensor],
      facilities: [facEE, facCN, facFI],
      lanes: [laneCN60, laneFI40],
      liveRiskMultiplierByLaneId: liveMult,
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });
    expect(wi2.baseEur!).toBeLessThan(l2.baseEur! * 0.55);
    expect(wi2.networkVerified).toBe(true);
  });

  it("computes exact 1/(1-d) defect gross-up buffer (not naive 1+d)", () => {
    const rec = computeDefectBufferRecommendation({
      laneId: LANE_CN,
      inputId: INPUT_SENSOR,
      annualUsableVolume: 100,
      defectRatePct: 10,
      leadTimeDays: 365,
      unitPriceEur: 12,
    });
    // 100 / 0.9 = 111.111... -> ceil = 112 gross -> 12 buffer units, 11.1111%
    expect(rec.recommendedOrderBufferPct).toBeCloseTo(11.1111, 3);
    expect(rec.recommendedBufferUnitsAnnual).toBe(12);
    expect(rec.expectedFaultyUnitsAnnual).toBe(10);
    expect(rec.defectOverheadCostEur).toBe(144);
  });

  it("combines concurrent Sub-Project 1 RiskSignals sub-additively and clamps hazard probabilities safely", () => {
    const redSanctions: RiskSignal = {
      signalId: "sig-1",
      kind: "SANCTIONS",
      severity: "RED",
      title: "Sanctions",
      description: null,
      regionCode: null,
      affectedCountryCodes: ["CN"],
      affectedChokepoints: [],
      affectedSectors: [],
      polygonWkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
      sourceUrls: [],
      publishedAt: null,
      lastSeenAt: null,
      expiresAt: null,
      resolvedAt: null,
      dedupeKey: null,
      confidence: 1,
      verificationStatus: "CONFIRMED",
      lifecycle: "ACTIVE",
      active: true,
    };
    const yellowSignal: RiskSignal = {
      ...redSanctions,
      signalId: "sig-2",
      kind: "PORT_CONGESTION",
      severity: "YELLOW",
      verificationStatus: "CORROBORATED",
    };

    const mult = deriveLiveRiskMultiplierFromSignals([redSanctions, yellowSignal]);
    // 1 + sqrt(1.5^2 + 0.45^2) = 1 + sqrt(2.4525) ~= 2.566
    expect(mult).toBeCloseTo(2.566, 2);

    expect(computeEffectiveHorizonProb(0.35, 1.15, 5, 2, 365)).toBeLessThanOrEqual(
      0.95,
    );
    expect(computeEffectiveHorizonProb(0.35, 1.15, 0, 1, 365)).toBe(0);
    expect(computeEffectiveHorizonProb(0.35, 1.15, 1, 1, 0)).toBe(0);
  });

  it("enforces .strict() privacy boundary: Tier-2+ hidden multipliers adjust EAL without leaking internal fields", () => {
    const prod: Product = {
      productId: PROD_X,
      ownerOrgId: ORG,
      name: "Product X",
      sku: null,
      description: null,
      annualRevenueEur: 5_000_000,
      grossMarginPct: 30,
    };
    const lane: SupplyLane = {
      laneId: LANE_FI,
      ownerOrgId: ORG,
      fromFacilityId: FAC_FI,
      toFacilityId: FAC_EE,
      inputId: INPUT_SENSOR,
      materialCategory: "Electronics",
      transportMode: "ROAD",
      volumeSharePct: 100,
      annualVolume: 50_000,
      volumeUnit: "UNITS",
      annualSpendEur: 500_000,
      contractEndDate: null,
      contractTerms: null,
      leadTimeDays: 5,
      distanceKm: 90,
      estimatedLaneCo2e: null,
      riskStatus: "GREEN",
      riskReason: null,
      safetyStockDays: 5,
    };

    const withoutHidden = computeFinancialRiskSummary({
      products: [prod],
      inputs: [inputSensor],
      facilities: [facEE, facFI],
      lanes: [lane],
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });

    const withHidden = computeFinancialRiskSummary({
      products: [prod],
      inputs: [inputSensor],
      facilities: [facEE, facFI],
      lanes: [lane],
      hiddenRiskByLaneId: new Map([
        [
          LANE_FI,
          {
            eventGroupId: "opaque-tier2-secret-group-xyz",
            hiddenProbabilityMultiplier: 1.8,
            hiddenTtrMultiplier: 1.6,
            verified: true,
          },
        ],
      ]),
      asOfDate: "2026-06-01",
      viewMode: "RUN_RATE",
    });

    expect(withHidden.baseEur!).toBeGreaterThan(withoutHidden.baseEur!);
    expect(withHidden.networkVerified).toBe(true);
    // Verify opaque eventGroupId and raw multipliers never appear in serialized DTO
    const serialized = JSON.stringify(withHidden);
    expect(serialized).not.toContain("opaque-tier2-secret-group-xyz");
    expect(serialized).not.toContain("hiddenProbabilityMultiplier");

    // Verify .strict() rejects any injected Tier-2+ field
    expect(() =>
      FinancialRiskSummarySchema.parse({
        ...withHidden,
        tier2SupplierName: "Secret Upstream Corp",
      }),
    ).toThrow();
  });
});
