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
});
