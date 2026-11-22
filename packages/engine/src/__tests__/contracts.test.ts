import { ContractSchema, ContractLineSchema, FacilitySchema } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import type {
  Contract,
  ContractLine,
  SupplyInput,
  SupplyLane,
} from "@kulgo/shared";
import {
  clusterErpPoHistoryToDraftContracts,
  deriveNetworkCommercials,
  toBaseUnit,
  toEur,
} from "../contracts.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const SUP_A = "22222222-2222-4222-8222-222222222221";
const FAC_OWN = "22222222-2222-4222-8222-222222222222";
const INPUT_1 = "33333333-3333-4333-8333-333333333331";
const LANE_1 = "44444444-4444-4444-8444-444444444441";
const LANE_2 = "44444444-4444-4444-8444-444444444442";
const C_BASE = "55555555-5555-4555-8555-555555555551";
const C_SPOT = "55555555-5555-4555-8555-555555555552";
const C_SPEND_ONLY = "55555555-5555-4555-8555-555555555553";
const C_EST = "55555555-5555-4555-8555-555555555554";
const CL_1 = "66666666-6666-4666-8666-666666666661";
const CL_2 = "66666666-6666-4666-8666-666666666662";
const CL_3 = "66666666-6666-4666-8666-666666666663";
const CL_4 = "66666666-6666-4666-8666-666666666664";

function makeInput(overrides: Partial<SupplyInput> = {}): SupplyInput {
  return {
    inputId: INPUT_1,
    ownerOrgId: ORG,
    productId: null,
    name: "Aluminum Extrusions",
    category: "Metals",
    unit: "UNITS",
    baseUnit: "UNITS",
    unitFamily: "COUNT",
    ...overrides,
  };
}

function makeLane(overrides: Partial<SupplyLane> = {}): SupplyLane {
  return {
    laneId: LANE_1,
    ownerOrgId: ORG,
    fromFacilityId: SUP_A,
    toFacilityId: FAC_OWN,
    inputId: INPUT_1,
    materialCategory: "Metals",
    transportMode: "ROAD",
    volumeSharePct: 100,
    annualVolume: null,
    volumeUnit: "UNITS",
    annualSpendEur: null,
    contractEndDate: null,
    contractTerms: null,
    leadTimeDays: 14,
    distanceKm: 400,
    estimatedLaneCo2e: null,
    riskStatus: "GREEN",
    riskReason: null,
    ...overrides,
  };
}

describe("contracts derivation engine (Phase 1)", () => {
  it("Fixture A: exact 184/365 pro-ration, Run-Rate vs Calendar Year Window T, and C_both denominator hygiene", () => {
    const baseContract: Contract = {
      contractId: C_BASE,
      ownerOrgId: ORG,
      supplierFacilityId: SUP_A,
      title: "Base Framework",
      contractType: "FRAMEWORK",
      pricingModel: "FIXED",
      expiryBehavior: "HOLDOVER",
      confidence: "CONTRACTED",
      startDate: "2025-01-01",
      endDate: null,
      noticePeriodDays: 30,
      nonRenewalNoticeGiven: false,
      archiveEffectiveDate: null,
      isManuallyArchived: false,
      incoterms: "DAP",
      notes: null,
    };
    const spotContract: Contract = {
      ...baseContract,
      contractId: C_SPOT,
      title: "July 1 Spot Top-Up",
      contractType: "SPOT_PO",
      expiryBehavior: "AUTO_ARCHIVE",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      noticePeriodDays: 0,
    };
    const spendOnlyContract: Contract = {
      ...baseContract,
      contractId: C_SPEND_ONLY,
      title: "Tooling Retainer (Spend Only)",
      contractType: "SPOT_PO",
      expiryBehavior: "AUTO_ARCHIVE",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      noticePeriodDays: 0,
    };

    const lines: ContractLine[] = [
      {
        contractLineId: CL_1,
        contractId: C_BASE,
        ownerOrgId: ORG,
        laneId: LANE_1,
        inputId: INPUT_1,
        cadence: "PER_YEAR",
        committedVolume: 10,
        unit: "UNITS",
        committedSpend: 10,
        unitPrice: null,
        currency: "EUR",
        startDateOverride: null,
        endDateOverride: null,
      },
      {
        contractLineId: CL_2,
        contractId: C_SPOT,
        ownerOrgId: ORG,
        laneId: LANE_1,
        inputId: INPUT_1,
        cadence: "TOTAL_OVER_TERM",
        committedVolume: 2,
        unit: "UNITS",
        committedSpend: 3,
        unitPrice: null,
        currency: "EUR",
        startDateOverride: null,
        endDateOverride: null,
      },
    ];

    // View 1: Current Run-Rate on 2026-09-01
    const runRate = deriveNetworkCommercials(
      [makeLane()],
      [makeInput()],
      [baseContract, spotContract],
      lines,
      { asOfDate: "2026-09-01", viewMode: "RUN_RATE" },
    );
    const rrLane = runRate.laneSummaries.get(LANE_1)!;
    expect(rrLane.activeVolume).toBe(12);
    expect(rrLane.activeSpendEur).toBe(13);
    expect(rrLane.weightedAvgUnitPrice).toBeCloseTo(1.0833, 4);

    // View 2: Calendar Year Window T = [2026-01-01, 2027-01-01) (184 exact calendar days in H2)
    const windowT = deriveNetworkCommercials(
      [makeLane()],
      [makeInput()],
      [baseContract, spotContract],
      lines,
      {
        asOfDate: "2026-09-01",
        viewMode: "PERIOD_WINDOW",
        windowStart: "2026-01-01",
        windowEndExclusive: "2027-01-01",
      },
    );
    const wtLane = windowT.laneSummaries.get(LANE_1)!;
    expect(wtLane.activeVolume).toBeCloseTo(10 + (2 * 184) / 365, 4);
    expect(wtLane.activeSpendEur).toBeCloseTo(10 + (3 * 184) / 365, 4);
    expect(wtLane.weightedAvgUnitPrice).toBeCloseTo(1.0458, 4);

    // Variant with 3rd spend-only contract (€5, null volume): C_both unit price MUST stay uncorrupted
    const withSpendOnly = deriveNetworkCommercials(
      [makeLane()],
      [makeInput()],
      [baseContract, spotContract, spendOnlyContract],
      [
        ...lines,
        {
          contractLineId: CL_3,
          contractId: C_SPEND_ONLY,
          ownerOrgId: ORG,
          laneId: LANE_1,
          inputId: INPUT_1,
          cadence: "PER_YEAR",
          committedVolume: null,
          unit: "UNITS",
          committedSpend: 5,
          unitPrice: null,
          currency: "EUR",
          startDateOverride: null,
          endDateOverride: null,
        },
      ],
      {
        asOfDate: "2026-09-01",
        viewMode: "PERIOD_WINDOW",
        windowStart: "2026-01-01",
        windowEndExclusive: "2027-01-01",
      },
    );
    const soLane = withSpendOnly.laneSummaries.get(LANE_1)!;
    expect(soLane.activeVolume).toBeCloseTo(11.0082, 4);
    expect(soLane.activeSpendEur).toBeCloseTo(16.5123, 4);
    expect(soLane.spendOnlyExcludedEur).toBe(5);
    expect(soLane.weightedAvgUnitPrice).toBeCloseTo(1.0458, 4);
  });

  it("automatically archives ESTIMATE contract when a formal FRAMEWORK contract exists on the same lane", () => {
    const est: Contract = {
      contractId: C_EST,
      ownerOrgId: ORG,
      supplierFacilityId: SUP_A,
      title: "Quick Estimate",
      contractType: "ESTIMATE",
      pricingModel: "FIXED",
      expiryBehavior: "HOLDOVER",
      confidence: "ESTIMATED",
      startDate: "2026-01-01",
      endDate: null,
      noticePeriodDays: 0,
      nonRenewalNoticeGiven: false,
      archiveEffectiveDate: null,
      isManuallyArchived: false,
      incoterms: null,
      notes: null,
    };
    const fw: Contract = {
      ...est,
      contractId: C_BASE,
      title: "Signed Framework",
      contractType: "FRAMEWORK",
      confidence: "CONTRACTED",
    };

    const res = deriveNetworkCommercials(
      [makeLane()],
      [makeInput()],
      [est, fw],
      [
        {
          contractLineId: CL_1,
          contractId: C_EST,
          ownerOrgId: ORG,
          laneId: LANE_1,
          inputId: INPUT_1,
          cadence: "PER_YEAR",
          committedVolume: 100,
          unit: "UNITS",
          committedSpend: 1000,
          unitPrice: null,
          currency: "EUR",
          startDateOverride: null,
          endDateOverride: null,
        },
        {
          contractLineId: CL_2,
          contractId: C_BASE,
          ownerOrgId: ORG,
          laneId: LANE_1,
          inputId: INPUT_1,
          cadence: "PER_YEAR",
          committedVolume: 120,
          unit: "UNITS",
          committedSpend: 1200,
          unitPrice: null,
          currency: "EUR",
          startDateOverride: null,
          endDateOverride: null,
        },
      ],
      { asOfDate: "2026-06-01", viewMode: "RUN_RATE" },
    );

    const lane = res.laneSummaries.get(LANE_1)!;
    expect(lane.activeVolume).toBe(120);
    expect(lane.activeSpendEur).toBe(1200);
    expect(lane.confidenceBadge).toBe("CONTRACTED");
    const estLine = res.evaluatedLines.find((l) => l.contract.contractId === C_EST);
    expect(estLine?.lifecycleState).toBe("ARCHIVED_BY_FRAMEWORK");
  });

  it("handles HOLDOVER, AUTO_ARCHIVE -> LAPSED_UNCONTRACTED, and renewal cliff (>30% in 90d)", () => {
    const holdoverContract: Contract = {
      contractId: C_BASE,
      ownerOrgId: ORG,
      supplierFacilityId: SUP_A,
      title: "Past-End Framework",
      contractType: "FRAMEWORK",
      pricingModel: "FIXED",
      expiryBehavior: "HOLDOVER",
      confidence: "CONTRACTED",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      noticePeriodDays: 30,
      nonRenewalNoticeGiven: false,
      archiveEffectiveDate: null,
      isManuallyArchived: false,
      incoterms: null,
      notes: null,
    };
    const expiredSpot: Contract = {
      ...holdoverContract,
      contractId: C_SPOT,
      title: "Expired Spot PO",
      contractType: "SPOT_PO",
      expiryBehavior: "AUTO_ARCHIVE",
      startDate: "2025-06-01",
      endDate: "2025-12-31",
    };

    const res = deriveNetworkCommercials(
      [makeLane({ laneId: LANE_1 }), makeLane({ laneId: LANE_2 })],
      [makeInput({ totalAnnualDemand: 100 })],
      [holdoverContract, expiredSpot],
      [
        {
          contractLineId: CL_1,
          contractId: C_BASE,
          ownerOrgId: ORG,
          laneId: LANE_1,
          inputId: INPUT_1,
          cadence: "PER_YEAR",
          committedVolume: 70,
          unit: "UNITS",
          committedSpend: 700,
          unitPrice: null,
          currency: "EUR",
          startDateOverride: null,
          endDateOverride: null,
        },
        {
          contractLineId: CL_2,
          contractId: C_SPOT,
          ownerOrgId: ORG,
          laneId: LANE_2,
          inputId: INPUT_1,
          cadence: "TOTAL_OVER_TERM",
          committedVolume: 30,
          unit: "UNITS",
          committedSpend: 450,
          unitPrice: null,
          currency: "EUR",
          startDateOverride: null,
          endDateOverride: null,
        },
      ],
      { asOfDate: "2026-03-01", viewMode: "RUN_RATE" },
    );

    const l1 = res.laneSummaries.get(LANE_1)!;
    const l2 = res.laneSummaries.get(LANE_2)!;
    const mat = res.materialSummaries.get(INPUT_1)!;

    expect(l1.laneCommercialState).toBe("HOLDOVER");
    expect(l1.activeVolume).toBe(70);
    expect(l1.assumedHoldoverVolume).toBe(70);

    expect(l2.laneCommercialState).toBe("LAPSED_UNCONTRACTED");
    expect(l2.activeVolume).toBeNull();

    // 70 mapped out of 100 demand -> 30% uncontracted ghost exposure
    expect(mat.uncontractedDemand).toBe(30);
    expect(mat.uncontractedDemandPct).toBe(30);
    // 100% of active volume is on holdover -> renewal cliff triggered
    expect(mat.isRenewalCliff).toBe(true);
    expect(mat.atRiskVolumePct).toBe(100);
  });

  it("handles custom unit conversions, unit conflicts, and missing FX without fabricating rates", () => {
    expect(toBaseUnit(2, "COILS", "KG", { COILS: 1250 })).toEqual({
      value: 2500,
      unitConflict: false,
    });
    expect(toBaseUnit(10, "UNITS", "KG")).toEqual({
      value: null,
      unitConflict: true,
    });
    expect(toEur(1000, "SEK", {})).toEqual({
      value: null,
      missingCurrency: "SEK",
    });
    expect(toEur(1000, "SEK", { SEK: 0.088 })).toEqual({
      value: 88,
      missingCurrency: null,
    });
  });

  it("clusters 12-month ERP PO history into draft FRAMEWORK (stable) and SPOT_PO (outlier) contracts", () => {
    const drafts = clusterErpPoHistoryToDraftContracts([
      { supplierName: "Nordic Metals", materialName: "Steel", orderDate: "2026-01-10", quantity: 10, unit: "TONNES", unitPrice: 1000, currency: "EUR" },
      { supplierName: "Nordic Metals", materialName: "Steel", orderDate: "2026-03-10", quantity: 10, unit: "TONNES", unitPrice: 1020, currency: "EUR" },
      { supplierName: "Nordic Metals", materialName: "Steel", orderDate: "2026-05-10", quantity: 10, unit: "TONNES", unitPrice: 990, currency: "EUR" },
      { supplierName: "Nordic Metals", materialName: "Steel", orderDate: "2026-07-10", quantity: 10, unit: "TONNES", unitPrice: 1010, currency: "EUR" },
      // Price spike outlier -> SPOT_PO
      { supplierName: "Nordic Metals", materialName: "Steel", orderDate: "2026-08-15", quantity: 3, unit: "TONNES", unitPrice: 1450, currency: "EUR" },
    ]);

    expect(drafts).toHaveLength(2);
    const fw = drafts.find((d) => d.contractType === "FRAMEWORK")!;
    const spot = drafts.find((d) => d.contractType === "SPOT_PO")!;
    expect(fw.committedVolume).toBe(40);
    expect(fw.confidence).toBe("IMPORTED");
    expect(fw.sourceOrderCount).toBe(4);
    expect(spot.committedVolume).toBe(3);
    expect(spot.committedSpend).toBe(4350);
    expect(spot.expiryBehavior).toBe("AUTO_ARCHIVE");
  });
});


describe("Split destination eligibility and inferred directions", () => {
  const contract = ContractSchema.parse({
    contractId: C_BASE, ownerOrgId: ORG, supplierFacilityId: SUP_A,
    title: "Active source", contractType: "FRAMEWORK",
    startDate: "2026-01-01", endDate: null,
  });
  const lapsed = ContractSchema.parse({
    ...contract, contractId: C_SPOT, title: "Expired destination",
    contractType: "SPOT_PO", expiryBehavior: "AUTO_ARCHIVE",
    startDate: "2025-01-01", endDate: "2025-12-31",
  });
  const lines = [contract, lapsed].map((c, i) => ContractLineSchema.parse({
    contractLineId: i === 0 ? CL_1 : CL_2, contractId: c.contractId,
    ownerOrgId: ORG, laneId: i === 0 ? LANE_1 : LANE_2, inputId: INPUT_1,
    cadence: "PER_YEAR", committedVolume: 100, unit: "UNITS",
    committedSpend: 1000, currency: "EUR",
  }));

  it.each(["RUN_RATE", "PERIOD_WINDOW"] as const)(
    "retains active volume and spend when a destination lapses (%s)", (viewMode) => {
      const lanes = [makeLane({ allocationSplitPct: 75 }),
        makeLane({ laneId: LANE_2, allocationSplitPct: 25 })];
      const result = deriveNetworkCommercials(lanes, [makeInput()],
        [contract, lapsed], lines, {
          asOfDate: "2026-01-01", viewMode,
          windowStart: "2026-01-01", windowEndExclusive: "2027-01-01",
        });
      expect(result.laneSummaries.get(LANE_1)?.activeVolume).toBe(100);
      expect(result.laneSummaries.get(LANE_1)?.activeSpendEur).toBe(1000);
      expect(result.laneSummaries.get(LANE_2)?.laneCommercialState).toBe("LAPSED_UNCONTRACTED");
      expect(result.materialSummaries.get(INPUT_1)?.mappedActiveVolume).toBe(100);
      expect(result.materialSummaries.get(INPUT_1)?.mappedActiveSpendEur).toBe(1000);
    },
  );

  it("retains the active source when all eligible destinations have zero allocation", () => {
    const result = deriveNetworkCommercials([
      makeLane({ allocationSplitPct: 0 }),
      makeLane({ laneId: LANE_2, allocationSplitPct: 100 }),
    ], [makeInput()], [contract, lapsed], lines, { asOfDate: "2026-01-01", viewMode: "RUN_RATE" });
    expect(result.laneSummaries.get(LANE_1)?.activeVolume).toBe(100);
    expect(result.laneSummaries.get(LANE_1)?.activeSpendEur).toBe(1000);
  });

  it.each(["INTERNAL", "DOWNSTREAM"] as const)(
    "groups an older inferred direction with an explicit %s sibling", (direction) => {
      const facilities = [SUP_A, FAC_OWN].map((facilityId, i) => FacilitySchema.parse({
        facilityId, ownerOrgId: ORG, name: `Facility ${i}`, kind: "WAREHOUSE",
        countryCode: "EE", lat: 59, lng: 25, isOwnFacility: true,
        ...(i === 1 && direction === "DOWNSTREAM" ? { relationshipRole: "CLIENT" } : {}),
      }));
      const result = deriveNetworkCommercials([
        makeLane({ allocationSplitPct: 75, annualVolume: 100, annualSpendEur: 1000 }),
        makeLane({ laneId: LANE_2, direction, allocationSplitPct: 25 }),
      ], [makeInput()], [], [], { asOfDate: "2026-01-01", viewMode: "RUN_RATE", facilities });
      expect(result.laneSummaries.get(LANE_1)?.activeVolume).toBe(75);
      expect(result.laneSummaries.get(LANE_2)?.activeVolume).toBe(25);
      expect(result.laneSummaries.get(LANE_2)?.activeSpendEur).toBe(250);
    },
  );

  it("pools compatible legacy mass units without changing source quantities", () => {
    const lanes = [makeLane({ inputId: null, volumeUnit: "TONNES", annualVolume: 1, allocationSplitPct: 60 }),
      makeLane({ laneId: LANE_2, inputId: null, volumeUnit: "KG", annualVolume: 1000, allocationSplitPct: 40 })];
    const result = deriveNetworkCommercials(lanes, [], [], [], {
      asOfDate: "2026-01-01", viewMode: "RUN_RATE",
    });
    expect(result.laneSummaries.get(LANE_1)?.activeVolume).toBe(1.2);
    expect(result.laneSummaries.get(LANE_2)?.activeVolume).toBe(800);
    expect(lanes.map((lane) => lane.annualVolume)).toEqual([1, 1000]);
  });
});
