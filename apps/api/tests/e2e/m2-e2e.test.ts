import {
  AnalyticsSummarySchema,
  SimulateAnalyticsResponseSchema,
  WorkspaceNetworkResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../src/app.js";

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /kulgo_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Expected kulgo_session cookie");
  }
  return `kulgo_session=${match[1]}`;
}

async function registerAndSeed(app: ReturnType<typeof createTestApp>) {
  const regRes = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `m2-e2e-${Math.random().toString(36).slice(2)}@kulgo.ee`,
      password: "KulgoM2Password!2026",
      organizationName: "Tallinn Electronics M2 OÜ",
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(regRes.status).toBe(201);
  const cookie = extractCookie(regRes);

  const seedRes = await app.request("/api/v1/workspace/seed-demo", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  expect(seedRes.status).toBe(201);
  const network = WorkspaceNetworkResponseSchema.parse(await seedRes.json());
  return { cookie, network };
}

describe("M2 E2E — Analytics Summary, RiskSignals, and Stateless What-If Simulator", () => {
  it("returns demo Latvia and China RiskSignal polygons in both network and analytics views", async () => {
    const app = createTestApp();
    const { cookie, network } = await registerAndSeed(app);

    // Network view includes Latvia (RED SANCTIONS) and China (YELLOW GEOPOLITICAL) polygons
    expect(network.riskSignals.length).toBeGreaterThanOrEqual(2);
    const lvSignal = network.riskSignals.find((s) =>
      s.affectedCountryCodes.includes("LV"),
    );
    const cnSignal = network.riskSignals.find((s) =>
      s.affectedCountryCodes.includes("CN"),
    );
    expect(lvSignal?.severity).toBe("RED");
    expect(lvSignal?.kind).toBe("SANCTIONS");
    expect(lvSignal?.polygonWkt).toContain("POLYGON");
    expect(cnSignal?.severity).toBe("YELLOW");
    expect(cnSignal?.kind).toBe("GEOPOLITICAL");

    // GET /api/v1/analytics/summary returns strict DTO with HHI, SPOF, contract expiry, RiskSignals, and ESG
    const summaryRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: cookie },
    });
    expect(summaryRes.status).toBe(200);
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());

    expect(summary.overallStatus).toBe("RED");
    expect(summary.hhiMetrics.some((m) => m.dimension === "SUPPLIER")).toBe(true);
    expect(summary.hhiMetrics.some((m) => m.dimension === "COUNTRY")).toBe(true);
    expect(summary.hhiMetrics.some((m) => m.dimension === "MATERIAL")).toBe(true);
    expect(summary.alerts.some((a) => a.category === "SINGLE_SOURCE")).toBe(true);
    expect(summary.alerts.some((a) => a.category === "CONTRACT_EXPIRY")).toBe(true);
    expect(summary.alerts.some((a) => a.category === "SECONDARY_SANCTION")).toBe(true);
    expect(summary.alerts.some((a) => a.category === "GEOPOLITICAL")).toBe(true);
    expect(summary.esg.scope1Tco2e).toBeGreaterThan(0);
    expect(summary.esg.scope2Tco2e).toBeGreaterThan(0);
    expect(summary.esg.upstreamScope3Tco2e).toBeGreaterThan(0);
    expect(summary.esg.transportScope3Tco2e).toBeGreaterThan(0);
    expect(summary.riskSignals.length).toBeGreaterThanOrEqual(2);
  });

  it("supports productId and inputId query filters on GET /api/v1/analytics/summary", async () => {
    const app = createTestApp();
    const { cookie, network } = await registerAndSeed(app);

    const productX = network.products[0]!;
    const materialC = network.inputs.find((i) => i.name === "Material C")!;

    // Filter to Material C (60/40 split between Tampere and Hamburg -> HHI 5200, non-SPOF, GREEN)
    const filteredRes = await app.request(
      `/api/v1/analytics/summary?productId=${productX.productId}&inputId=${materialC.inputId}`,
      { headers: { Cookie: cookie } },
    );
    expect(filteredRes.status).toBe(200);
    const filtered = AnalyticsSummarySchema.parse(await filteredRes.json());

    const matCHhi = filtered.hhiMetrics.find((m) => m.dimension === "MATERIAL");
    expect(matCHhi?.rawHhi).toBe(5200);
    expect(matCHhi?.isSinglePointOfFailure).toBe(false);
    expect(filtered.alerts.some((a) => a.category === "SINGLE_SOURCE")).toBe(
      false,
    );

    // Invalid UUID query param returns 400
    const badRes = await app.request(
      "/api/v1/analytics/summary?productId=not-a-uuid",
      { headers: { Cookie: cookie } },
    );
    expect(badRes.status).toBe(400);
  });

  it("runs stateless POST /api/v1/analytics/simulate and leaves persisted workspace lanes unchanged", async () => {
    const app = createTestApp();
    const { cookie, network } = await registerAndSeed(app);

    const facilityById = new Map(
      network.facilities.map((f) => [f.facilityId, f]),
    );
    const rigaLane = network.lanes.find(
      (l) => facilityById.get(l.fromFacilityId)?.countryCode === "LV",
    )!;
    const shenzhenLane = network.lanes.find(
      (l) => facilityById.get(l.fromFacilityId)?.countryCode === "CN",
    )!;

    // Simulate removing RED Latvia lane (volumeSharePct -> 0) and switching Shenzhen SEA -> AIR
    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        laneChanges: [
          { laneId: rigaLane.laneId, volumeSharePct: 0 },
          { laneId: shenzhenLane.laneId, transportMode: "AIR" },
        ],
      }),
    });
    expect(simRes.status).toBe(200);
    const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());

    expect(sim.appliedChangesCount).toBe(2);
    // Switching Shenzhen SEA -> AIR dramatically increases transport Scope 3 CO2e
    expect(sim.deltas.transportScope3Tco2eDelta).toBeGreaterThan(100);
    // Removing RED Latvia lane reduces RED alerts
    expect(sim.deltas.redAlertCountDelta).toBeLessThan(0);

    // Verify statelessness: persisted lanes are completely unchanged
    const afterNetworkRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: cookie },
    });
    const afterNetwork = WorkspaceNetworkResponseSchema.parse(
      await afterNetworkRes.json(),
    );
    const persistedRigaLane = afterNetwork.lanes.find(
      (l) => l.laneId === rigaLane.laneId,
    )!;
    const persistedShenzhenLane = afterNetwork.lanes.find(
      (l) => l.laneId === shenzhenLane.laneId,
    )!;
    expect(persistedRigaLane.volumeSharePct).toBe(rigaLane.volumeSharePct);
    expect(persistedShenzhenLane.transportMode).toBe("SEA");
  });
});
