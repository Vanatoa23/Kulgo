import {
  AnalyticsSummarySchema,
  ExecutiveReportSchema,
  SimulateAnalyticsResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../src/app.js";

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /kulgo_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Expected kulgo_session cookie");
  }
  return `kulgo_session=${match[1]}`;
}

async function setupTwoSupplierNetwork(
  app: ReturnType<typeof createTestApp>,
  options?: {
    lane1AnnualVolume?: number | null;
    lane2AnnualVolume?: number | null;
    lane1AnnualSpendEur?: number | null;
    lane2AnnualSpendEur?: number | null;
    orgRevenueEur?: number;
  },
) {
  const regRes = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `issue42-${Math.random().toString(36).slice(2)}@kulgo.ee`,
      password: "KulgoIssue42Password!2026",
      organizationName: "Baltic Precision OÜ",
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(regRes.status).toBe(201);
  const cookie = extractCookie(regRes);

  // Configure extended organization ESG & compliance context so simulation parity is tested
  const settingsRes = await app.request("/api/v1/auth/organization", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      scope1Tco2e: 45,
      scope2Tco2e: 80,
      scope2MarketTco2e: 30,
      annualRevenueEur: options?.orgRevenueEur ?? 10_000_000,
      targetMarkets: ["EU", "US"],
      enabledCompliancePacks: ["EU", "US"],
    }),
  });
  expect(settingsRes.status).toBe(200);

  // Create Product
  const prodRes = await app.request("/api/v1/workspace/products", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: "Sensor Module X",
      sku: "SMX-100",
      annualRevenueEur: 5_000_000,
      grossMarginPct: 40,
    }),
  });
  expect(prodRes.status).toBe(201);
  const { product } = (await prodRes.json()) as {
    product: { productId: string };
  };

  // Create SupplyInput (Material)
  const inputRes = await app.request("/api/v1/workspace/inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      productId: product.productId,
      name: "Specialty Resin",
      category: "Polymers",
      unit: "TONNES",
      baseUnit: "TONNES",
    }),
  });
  expect(inputRes.status).toBe(201);
  const { input } = (await inputRes.json()) as {
    input: { inputId: string };
  };

  // Create HQ + 2 Tier-1 suppliers in different countries
  const createFacility = async (payload: Record<string, unknown>) => {
    const res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { facility: { facilityId: string } };
    return body.facility;
  };

  const hq = await createFacility({
    name: "Tallinn Assembly HQ",
    kind: "HQ",
    isOwnFacility: true,
    countryCode: "EE",
    lat: 59.437,
    lng: 24.7536,
  });
  const supA = await createFacility({
    name: "Tampere Polymers Oy",
    kind: "FACTORY",
    isOwnFacility: false,
    countryCode: "FI",
    lat: 61.4978,
    lng: 23.761,
  });
  const supB = await createFacility({
    name: "Hamburg Chemicals GmbH",
    kind: "FACTORY",
    isOwnFacility: false,
    countryCode: "DE",
    lat: 53.5511,
    lng: 9.9937,
  });

  // Create 2 lanes with STALE 50/50 shares & stale legacy commercials
  const createLane = async (
    fromFacilityId: string,
    annualVolume: number | null,
    annualSpendEur: number | null,
  ) => {
    const res = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        fromFacilityId,
        toFacilityId: hq.facilityId,
        inputId: input.inputId,
        materialCategory: "Polymers",
        volumeSharePct: 50,
        annualVolume,
        volumeUnit: "TONNES",
        annualSpendEur,
        transportMode: "ROAD",
        leadTimeDays: 10,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { lane: { laneId: string } };
    return body.lane;
  };

  const laneA = await createLane(
    supA.facilityId,
    options?.lane1AnnualVolume !== undefined ? options.lane1AnnualVolume : 50,
    options?.lane1AnnualSpendEur !== undefined
      ? options.lane1AnnualSpendEur
      : 50_000,
  );
  const laneB = await createLane(
    supB.facilityId,
    options?.lane2AnnualVolume !== undefined ? options.lane2AnnualVolume : 50,
    options?.lane2AnnualSpendEur !== undefined
      ? options.lane2AnnualSpendEur
      : 50_000,
  );

  return { cookie, product, input, hq, supA, supB, laneA, laneB };
}

async function createContract(
  app: ReturnType<typeof createTestApp>,
  cookie: string,
  payload: Record<string, unknown>,
) {
  const res = await app.request("/api/v1/workspace/contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return res.json();
}

describe("Analytics & What-If Commercial Consistency (Issue #42)", () => {
  it("computes contract-weighted 90/10 HHI (8,200) over stale 50/50 lanes across summary, executive report, and simulation", async () => {
    const app = createTestApp();
    const { cookie, supA, supB, laneA, laneB } =
      await setupTwoSupplierNetwork(app);

    await createContract(app, cookie, {
      supplierFacilityId: supA.facilityId,
      title: "Tampere 90% Framework",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      incoterms: "CIF",
      lines: [
        {
          laneId: laneA.laneId,
          cadence: "PER_YEAR",
          committedVolume: 90,
          unit: "TONNES",
          committedSpend: 90_000,
          currency: "EUR",
        },
      ],
    });
    await createContract(app, cookie, {
      supplierFacilityId: supB.facilityId,
      title: "Hamburg 10% Framework",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      incoterms: "FOB",
      lines: [
        {
          laneId: laneB.laneId,
          cadence: "PER_YEAR",
          committedVolume: 10,
          unit: "TONNES",
          committedSpend: 10_000,
          currency: "EUR",
        },
      ],
    });

    const summaryRes = await app.request(
      "/api/v1/analytics/summary?viewMode=RUN_RATE",
      { headers: { Cookie: cookie } },
    );
    expect(summaryRes.status).toBe(200);
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());

    const matHhi = summary.hhiMetrics.find((m) => m.dimension === "MATERIAL")!;
    const supHhi = summary.hhiMetrics.find((m) => m.dimension === "SUPPLIER")!;
    const ctyHhi = summary.hhiMetrics.find((m) => m.dimension === "COUNTRY")!;
    expect(matHhi.rawHhi).toBe(8200);
    expect(supHhi.rawHhi).toBe(8200);
    expect(ctyHhi.rawHhi).toBe(8200);
    expect(summary.financialRisk?.totalActiveSpendEur).toBe(100_000);

    const reportRes = await app.request(
      "/api/v1/analytics/report?viewMode=RUN_RATE",
      { headers: { Cookie: cookie } },
    );
    expect(reportRes.status).toBe(200);
    const report = ExecutiveReportSchema.parse(await reportRes.json());
    expect(
      report.analytics.hhiMetrics.find((m) => m.dimension === "MATERIAL")
        ?.rawHhi,
    ).toBe(8200);
    expect(report.analytics.esg.totalTco2e).toBe(summary.esg.totalTco2e);

    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        viewMode: "RUN_RATE",
        laneChanges: [{ laneId: laneA.laneId }],
      }),
    });
    expect(simRes.status).toBe(200);
    const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());
    expect(
      sim.baseline.hhiMetrics.find((m) => m.dimension === "MATERIAL")?.rawHhi,
    ).toBe(8200);
    expect(
      sim.baseline.hhiMetrics.find((m) => m.dimension === "SUPPLIER")?.rawHhi,
    ).toBe(8200);
  });

  it("excludes expired contracts from HHI, SPOF, ESG, and financial spend without reviving stale 50/50 lane shares", async () => {
    const app = createTestApp();
    const { cookie, supA, supB, laneA, laneB } =
      await setupTwoSupplierNetwork(app);

    await createContract(app, cookie, {
      supplierFacilityId: supA.facilityId,
      title: "Active Tampere Contract",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      lines: [
        {
          laneId: laneA.laneId,
          cadence: "PER_YEAR",
          committedVolume: 90,
          unit: "TONNES",
          committedSpend: 90_000,
          currency: "EUR",
        },
      ],
    });
    await createContract(app, cookie, {
      supplierFacilityId: supB.facilityId,
      title: "Expired Hamburg Contract",
      contractType: "FRAMEWORK",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      expiryBehavior: "AUTO_ARCHIVE",
      lines: [
        {
          laneId: laneB.laneId,
          cadence: "PER_YEAR",
          committedVolume: 10,
          unit: "TONNES",
          committedSpend: 10_000,
          currency: "EUR",
        },
      ],
    });

    const summaryRes = await app.request(
      "/api/v1/analytics/summary?viewMode=RUN_RATE",
      { headers: { Cookie: cookie } },
    );
    expect(summaryRes.status).toBe(200);
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());

    const matHhi = summary.hhiMetrics.find((m) => m.dimension === "MATERIAL")!;
    const supHhi = summary.hhiMetrics.find((m) => m.dimension === "SUPPLIER")!;
    expect(matHhi.rawHhi).toBe(10000);
    expect(matHhi.isSinglePointOfFailure).toBe(true);
    expect(supHhi.rawHhi).toBe(10000);
    expect(summary.alerts.some((a) => a.category === "SINGLE_SOURCE")).toBe(
      true,
    );
    expect(summary.financialRisk?.totalActiveSpendEur).toBe(90_000);
    expect(summary.financialRisk?.lapsedLaneCount).toBe(1);
  });

  it("applies explicit annualSpendEur overrides consistently across financial risk, HHI, and spend-based ESG", async () => {
    const app = createTestApp();
    // Use spend-only lanes (no physical volume) so ESG uses spend-based attribution
    // and both SUPPLIER and MATERIAL HHI are weighted by SPEND_EUR
    const { cookie, supA, supB, laneA, laneB } = await setupTwoSupplierNetwork(
      app,
      {
        lane1AnnualVolume: null,
        lane2AnnualVolume: null,
        lane1AnnualSpendEur: 50_000,
        lane2AnnualSpendEur: 50_000,
      },
    );

    await createContract(app, cookie, {
      supplierFacilityId: supA.facilityId,
      title: "Tampere Spend Contract",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      lines: [
        {
          laneId: laneA.laneId,
          cadence: "PER_YEAR",
          committedSpend: 50_000,
          currency: "EUR",
        },
      ],
    });
    await createContract(app, cookie, {
      supplierFacilityId: supB.facilityId,
      title: "Hamburg Spend Contract",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      lines: [
        {
          laneId: laneB.laneId,
          cadence: "PER_YEAR",
          committedSpend: 50_000,
          currency: "EUR",
        },
      ],
    });

    // Override laneA annualSpendEur from 50k to 450k (90%/10% split -> HHI 8,200, total spend 500k)
    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        viewMode: "RUN_RATE",
        laneChanges: [{ laneId: laneA.laneId, annualSpendEur: 450_000 }],
      }),
    });
    expect(simRes.status).toBe(200);
    const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());

    // Baseline: 50k/50k -> HHI 5,000, spend 100k
    expect(sim.baseline.financialRisk?.totalActiveSpendEur).toBe(100_000);
    expect(
      sim.baseline.hhiMetrics.find((m) => m.dimension === "SUPPLIER")?.rawHhi,
    ).toBe(5000);
    expect(
      sim.baseline.hhiMetrics.find((m) => m.dimension === "MATERIAL")?.rawHhi,
    ).toBe(5000);

    // Simulated: 450k/50k -> HHI 8,200, spend 500k, and spend-based ESG scales up
    expect(sim.simulated.financialRisk?.totalActiveSpendEur).toBe(500_000);
    expect(
      sim.simulated.hhiMetrics.find((m) => m.dimension === "SUPPLIER")?.rawHhi,
    ).toBe(8200);
    expect(
      sim.simulated.hhiMetrics.find((m) => m.dimension === "MATERIAL")?.rawHhi,
    ).toBe(8200);
    expect(sim.deltas.maxHhiDelta).toBe(3200);
    expect(sim.simulated.esg.upstreamScope3Tco2e).toBeGreaterThan(
      sim.baseline.esg.upstreamScope3Tco2e * 3,
    );
    expect(sim.deltas.totalTco2eDelta).toBeGreaterThan(0);
  });

  it("matches the equivalent dashboard view on a no-change simulation for both PERIOD_WINDOW and RUN_RATE views", async () => {
    const app = createTestApp();
    const { cookie, supA, supB, laneA, laneB } =
      await setupTwoSupplierNetwork(app);

    await createContract(app, cookie, {
      supplierFacilityId: supA.facilityId,
      title: "Tampere Contract",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      incoterms: "CIF",
      lines: [
        {
          laneId: laneA.laneId,
          cadence: "PER_YEAR",
          committedVolume: 90,
          unit: "TONNES",
          committedSpend: 90_000,
          currency: "EUR",
        },
      ],
    });
    await createContract(app, cookie, {
      supplierFacilityId: supB.facilityId,
      title: "Hamburg Contract",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      incoterms: "DDP",
      lines: [
        {
          laneId: laneB.laneId,
          cadence: "PER_YEAR",
          committedVolume: 10,
          unit: "TONNES",
          committedSpend: 10_000,
          currency: "EUR",
        },
      ],
    });

    for (const viewMode of ["PERIOD_WINDOW", "RUN_RATE"] as const) {
      const summaryRes = await app.request(
        `/api/v1/analytics/summary?viewMode=${viewMode}`,
        { headers: { Cookie: cookie } },
      );
      expect(summaryRes.status).toBe(200);
      const dashboard = AnalyticsSummarySchema.parse(await summaryRes.json());

      // No-change simulation: references laneA with its current volumeSharePct (50) and transportMode ("ROAD")
      const simRes = await app.request("/api/v1/analytics/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          viewMode,
          laneChanges: [
            {
              laneId: laneA.laneId,
              volumeSharePct: 50,
              transportMode: "ROAD",
            },
          ],
        }),
      });
      expect(simRes.status).toBe(200);
      const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());

      const stripTimestamp = (s: typeof dashboard) => ({
        ...s,
        computedAt: "IGNORED",
      });

      expect(stripTimestamp(sim.baseline)).toEqual(stripTimestamp(dashboard));
      expect(stripTimestamp(sim.simulated)).toEqual(stripTimestamp(dashboard));

      // Verify extended organization context & compliance packs were preserved in simulation
      expect(sim.baseline.esg.scope2MarketTco2e).toBe(30);
      expect(sim.baseline.esg.carbonIntensityPerEurMillion).toBe(
        dashboard.esg.carbonIntensityPerEurMillion,
      );
      expect(sim.baseline.esg.activeCompliancePacks).toEqual(
        dashboard.esg.activeCompliancePacks,
      );
      expect(sim.baseline.esg.complianceChecklist).toEqual(
        dashboard.esg.complianceChecklist,
      );

      // Verify zero deltas on no-change simulation
      expect(sim.deltas.resilienceScoreDelta).toBe(0);
      expect(sim.deltas.maxHhiDelta).toBe(0);
      expect(sim.deltas.avgHhiDelta).toBe(0);
      expect(sim.deltas.alertCountDelta).toBe(0);
      expect(sim.deltas.redAlertCountDelta).toBe(0);
      expect(sim.deltas.spofCountDelta).toBe(0);
      expect(sim.deltas.transportScope3Tco2eDelta).toBe(0);
      expect(sim.deltas.totalTco2eDelta).toBe(0);
      expect(sim.deltas.financialDeltas?.baseEalDeltaEur ?? 0).toBe(0);
    }
  });

  it("preserves untouched canonical volume on a spend-only override for lanes with custom unitConversionFactors", async () => {
    const app = createTestApp();
    const { cookie, product, hq, supA, supB } =
      await setupTwoSupplierNetwork(app);

    // Create a custom-converted input: baseUnit TONNES, 1 UNIT = 0.02 TONNES
    const customInputRes = await app.request("/api/v1/workspace/inputs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        productId: product.productId,
        name: "Preform Reels",
        category: "Polymers",
        unit: "TONNES",
        baseUnit: "TONNES",
        unitConversionFactors: { UNITS: 0.02 },
      }),
    });
    expect(customInputRes.status).toBe(201);
    const { input: customInput } = (await customInputRes.json()) as {
      input: { inputId: string };
    };

    const createUnitLane = async (fromFacilityId: string) => {
      const res = await app.request("/api/v1/workspace/lanes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          fromFacilityId,
          toFacilityId: hq.facilityId,
          inputId: customInput.inputId,
          materialCategory: "Polymers",
          volumeSharePct: 50,
          annualVolume: 1000,
          volumeUnit: "UNITS",
          annualSpendEur: 50_000,
          transportMode: "ROAD",
          leadTimeDays: 10,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { lane: { laneId: string } };
      return body.lane;
    };

    const customLaneA = await createUnitLane(supA.facilityId);
    const customLaneB = await createUnitLane(supB.facilityId);

    // Contract A: 5,000 UNITS * 0.02 = 100 TONNES; Contract B: 5,000 UNITS * 0.02 = 100 TONNES
    await createContract(app, cookie, {
      supplierFacilityId: supA.facilityId,
      title: "Custom Unit Contract A",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      lines: [
        {
          laneId: customLaneA.laneId,
          cadence: "PER_YEAR",
          committedVolume: 5000,
          unit: "UNITS",
          committedSpend: 100_000,
          currency: "EUR",
        },
      ],
    });
    await createContract(app, cookie, {
      supplierFacilityId: supB.facilityId,
      title: "Custom Unit Contract B",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      lines: [
        {
          laneId: customLaneB.laneId,
          cadence: "PER_YEAR",
          committedVolume: 5000,
          unit: "UNITS",
          committedSpend: 100_000,
          currency: "EUR",
        },
      ],
    });

    // Spend-only override on customLaneA must NOT double-apply 0.02 (100t -> 2t)
    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        inputId: customInput.inputId,
        viewMode: "RUN_RATE",
        laneChanges: [{ laneId: customLaneA.laneId, annualSpendEur: 300_000 }],
      }),
    });
    expect(simRes.status).toBe(200);
    const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());

    const baseLaneAComm = sim.baseline.financialRisk?.laneCommercials.find(
      (lc) => lc.laneId === customLaneA.laneId,
    );
    const simLaneAComm = sim.simulated.financialRisk?.laneCommercials.find(
      (lc) => lc.laneId === customLaneA.laneId,
    );
    expect(baseLaneAComm?.activeVolume).toBe(100);
    expect(simLaneAComm?.activeVolume).toBe(100);
    expect(simLaneAComm?.baseUnit).toBe("TONNES");
    expect(simLaneAComm?.activeSpendEur).toBe(300_000);

    // Material HHI is volume-weighted (100t vs 100t -> still 5,000),
    // while Supplier HHI is spend-weighted (300k vs 100k -> 75/25 -> 6,250)
    const simMatHhi = sim.simulated.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL",
    )!;
    const simSupHhi = sim.simulated.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    expect(simMatHhi.rawHhi).toBe(5000);
    expect(simSupHhi.rawHhi).toBe(6250);
  });

  it("preserves LAPSED_UNCONTRACTED state on a share-only edit so lapsed lanes are not revived into HHI or SPOF", async () => {
    const app = createTestApp();
    const { cookie, supA, supB, laneA, laneB } =
      await setupTwoSupplierNetwork(app);

    await createContract(app, cookie, {
      supplierFacilityId: supA.facilityId,
      title: "Active Tampere Contract",
      contractType: "FRAMEWORK",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      lines: [
        {
          laneId: laneA.laneId,
          cadence: "PER_YEAR",
          committedVolume: 90,
          unit: "TONNES",
          committedSpend: 90_000,
          currency: "EUR",
        },
      ],
    });
    await createContract(app, cookie, {
      supplierFacilityId: supB.facilityId,
      title: "Expired Hamburg Contract",
      contractType: "FRAMEWORK",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      expiryBehavior: "AUTO_ARCHIVE",
      lines: [
        {
          laneId: laneB.laneId,
          cadence: "PER_YEAR",
          committedVolume: 10,
          unit: "TONNES",
          committedSpend: 10_000,
          currency: "EUR",
        },
      ],
    });

    // Share-only edit on lapsed laneB (50 -> 30) adds no active volume or spend
    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        viewMode: "RUN_RATE",
        laneChanges: [{ laneId: laneB.laneId, volumeSharePct: 30 }],
      }),
    });
    expect(simRes.status).toBe(200);
    const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());

    const simLaneBComm = sim.simulated.financialRisk?.laneCommercials.find(
      (lc) => lc.laneId === laneB.laneId,
    );
    expect(simLaneBComm?.laneCommercialState).toBe("LAPSED_UNCONTRACTED");
    expect(simLaneBComm?.activeVolume).toBeNull();
    expect(simLaneBComm?.activeSpendEur).toBeNull();
    expect(sim.simulated.financialRisk?.lapsedLaneCount).toBe(1);

    const simMatHhi = sim.simulated.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL",
    )!;
    const simSupHhi = sim.simulated.hhiMetrics.find(
      (m) => m.dimension === "SUPPLIER",
    )!;
    expect(simMatHhi.rawHhi).toBe(10000);
    expect(simMatHhi.isSinglePointOfFailure).toBe(true);
    expect(simSupHhi.rawHhi).toBe(10000);
    expect(
      sim.simulated.alerts.some((a) => a.category === "SINGLE_SOURCE"),
    ).toBe(true);
  });
});


describe("What-If split source quantities", () => {
  for (const viewMode of ["RUN_RATE", "PERIOD_WINDOW"] as const) {
    it.each(["legacy", "mixed", "contract"])(`keeps physical totals on spend-only edits (${viewMode}, %s)`, async (source) => {
      const app = createTestApp();
      const { cookie, supA, laneA, laneB } = await setupTwoSupplierNetwork(app, {
        lane1AnnualVolume: 100, lane2AnnualVolume: 100,
        lane1AnnualSpendEur: 1000, lane2AnnualSpendEur: 1000,
      });
      const patch = async (laneId: string, payload: Record<string, unknown>) => {
        const res = await app.request(`/api/v1/workspace/lanes/${laneId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify(payload),
        });
        expect(res.status).toBe(200);
      };
      await patch(laneA.laneId, { volumeUnit: "KG", annualVolume: 100000 });
      await patch(laneB.laneId, { fromFacilityId: supA.facilityId });
      if (source !== "legacy") {
        await createContract(app, cookie, {
          supplierFacilityId: supA.facilityId, title: "Source commitments",
          contractType: "FRAMEWORK", startDate: "2025-01-01", endDate: null,
          lines: [laneA, ...(source === "contract" ? [laneB] : [])].map((lane) => ({
            laneId: lane.laneId, cadence: "PER_YEAR", committedVolume: 100,
            unit: "TONNES", committedSpend: 1000, currency: "EUR",
          })),
        });
      }
      const split = await app.request("/api/v1/workspace/lanes/allocation-splits", {
        method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ splits: [
          { laneId: laneA.laneId, allocationSplitPct: 75 },
          { laneId: laneB.laneId, allocationSplitPct: 25 },
        ] }),
      });
      expect(split.status).toBe(200);
      const result = await app.request("/api/v1/analytics/simulate", {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ viewMode, laneChanges: [{ laneId: laneA.laneId, annualSpendEur: 500000 }] }),
      });
      expect(result.status).toBe(200);
      const simulation = SimulateAnalyticsResponseSchema.parse(await result.json());
      const baseline = simulation.baseline.financialRisk!.laneCommercials!;
      const simulated = simulation.simulated.financialRisk!.laneCommercials!;
      expect(baseline.reduce((sum, lane) => sum + (lane.activeVolume ?? 0), 0)).toBeCloseTo(200, 0);
      for (const lane of simulated) {
        const original = baseline.find((l) => l.laneId === lane.laneId)!;
        expect(lane.activeVolume).toBeCloseTo(original.activeVolume!, 4);
      }
      expect(simulation.simulated.financialRisk!.totalActiveSpendEur)
        .not.toBe(simulation.baseline.financialRisk!.totalActiveSpendEur);
      expect(simulation.simulated.hhiMetrics).toEqual(simulation.baseline.hhiMetrics);
      expect(baseline.find((lane) => lane.laneId === laneA.laneId)?.activeSpendEur).toBe(1500);
      expect(baseline.find((lane) => lane.laneId === laneB.laneId)?.activeSpendEur).toBe(500);
      expect(simulated.find((lane) => lane.laneId === laneA.laneId)?.activeSpendEur).toBe(500000);
      expect(simulated.find((lane) => lane.laneId === laneB.laneId)?.activeSpendEur).toBe(500);

      const noOpResponse = await app.request("/api/v1/analytics/simulate", {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ viewMode, laneChanges: [{ laneId: laneA.laneId, annualSpendEur: 1500 }] }),
      });
      expect(noOpResponse.status).toBe(200);
      const noOp = SimulateAnalyticsResponseSchema.parse(await noOpResponse.json());
      expect(noOp.simulated.financialRisk).toEqual(noOp.baseline.financialRisk);
      expect(noOp.simulated.hhiMetrics).toEqual(noOp.baseline.hhiMetrics);
      expect(noOp.simulated.esg).toEqual(noOp.baseline.esg);
    });
  }
});
