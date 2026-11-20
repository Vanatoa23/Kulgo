import type {
  AuthMeResponse,
  Facility,
  Product,
  SupplyInput,
  SupplyLane,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createFacility,
  getAnalyticsSummary,
  getMe,
  getNetwork,
  login,
  seedDemo,
  simulateAnalytics,
  updateFacility,
} from "../lib/api.js";
import {
  RISK_COLORS,
  buildCorridorArcs,
  buildFacilityMarkers,
  buildLogicalGraphModel,
  buildRiskSignalPolygons,
  computeCorridorWidth,
  computeFacilitiesBounds,
  filterWorkspaceNetwork,
  formatEur,
} from "../lib/workspace-utils.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_X_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_Y_ID = "44444444-4444-4444-8444-444444444444";
const INPUT_A_ID = "55555555-5555-4555-8555-555555555551";
const INPUT_B_ID = "55555555-5555-4555-8555-555555555552";
const INPUT_Y_ID = "55555555-5555-4555-8555-555555555553";
const FAC_TALLINN_ID = "66666666-6666-4666-8666-666666666661";
const FAC_RIGA_ID = "66666666-6666-4666-8666-666666666662";
const FAC_SHENZHEN_ID = "66666666-6666-4666-8666-666666666663";
const FAC_HELSINKI_ID = "66666666-6666-4666-8666-666666666664";
const LANE_GREEN_ID = "77777777-7777-4777-8777-777777777771";
const LANE_YELLOW_ID = "77777777-7777-4777-8777-777777777772";
const LANE_RED_ID = "77777777-7777-4777-8777-777777777773";

function makeSampleNetwork(): WorkspaceNetworkResponse {
  const products: Product[] = [
    {
      productId: PRODUCT_X_ID,
      ownerOrgId: ORG_ID,
      name: "Product X",
      sku: "EE-PX-01",
      description: "Flagship Estonian assembly",
    },
    {
      productId: PRODUCT_Y_ID,
      ownerOrgId: ORG_ID,
      name: "Product Y",
      sku: "EE-PY-02",
      description: null,
    },
  ];

  const inputs: SupplyInput[] = [
    {
      inputId: INPUT_A_ID,
      ownerOrgId: ORG_ID,
      productId: PRODUCT_X_ID,
      name: "Material A — Steel",
      category: "Steel",
      unit: "TONNES",
    },
    {
      inputId: INPUT_B_ID,
      ownerOrgId: ORG_ID,
      productId: PRODUCT_X_ID,
      name: "Material B — Electronics",
      category: "Electronics",
      unit: "UNITS",
    },
    {
      inputId: INPUT_Y_ID,
      ownerOrgId: ORG_ID,
      productId: PRODUCT_Y_ID,
      name: "Material Y — Polymer",
      category: "Polymer",
      unit: "TONNES",
    },
  ];

  const facilities: Facility[] = [
    {
      facilityId: FAC_TALLINN_ID,
      ownerOrgId: ORG_ID,
      name: "Tallinn HQ & Assembly",
      kind: "HQ",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      regionCode: "EE-37",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
      isPartnerVerified: false,
      sector: "Manufacturing",
      esgBadges: [],
      estimatedScope12Tco2e: 420,
    },
    {
      facilityId: FAC_RIGA_ID,
      ownerOrgId: ORG_ID,
      name: "Riga Metalworks",
      kind: "FACTORY",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "LV",
      regionCode: null,
      lat: 56.9496,
      lng: 24.1052,
      isOwnFacility: false,
      isPartnerVerified: false,
      sector: "Metallurgy",
      esgBadges: [],
      estimatedScope12Tco2e: null,
    },
    {
      facilityId: FAC_SHENZHEN_ID,
      ownerOrgId: ORG_ID,
      name: "Shenzhen MicroTech",
      kind: "FACTORY",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "CN",
      regionCode: null,
      lat: 22.5431,
      lng: 114.0579,
      isOwnFacility: false,
      isPartnerVerified: false,
      sector: "Electronics",
      esgBadges: [],
      estimatedScope12Tco2e: null,
    },
    {
      facilityId: FAC_HELSINKI_ID,
      ownerOrgId: ORG_ID,
      name: "Helsinki Nordic Polymers",
      kind: "WAREHOUSE",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "FI",
      regionCode: null,
      lat: 60.1699,
      lng: 24.9384,
      isOwnFacility: false,
      isPartnerVerified: false,
      sector: "Chemicals",
      esgBadges: [],
      estimatedScope12Tco2e: null,
    },
  ];

  const lanes: SupplyLane[] = [
    {
      laneId: LANE_RED_ID,
      ownerOrgId: ORG_ID,
      fromFacilityId: FAC_RIGA_ID,
      toFacilityId: FAC_TALLINN_ID,
      inputId: INPUT_A_ID,
      materialCategory: "Steel",
      transportMode: "ROAD",
      volumeSharePct: 40,
      annualVolume: 800,
      volumeUnit: "TONNES",
      annualSpendEur: 320000,
      contractEndDate: "2026-12-31",
      contractTerms: "Net 30",
      leadTimeDays: 3,
      distanceKm: 280,
      estimatedLaneCo2e: 18,
      riskStatus: "RED",
      riskReason: "Latvian intermediary flagged for secondary sanctions exposure",
    },
    {
      laneId: LANE_YELLOW_ID,
      ownerOrgId: ORG_ID,
      fromFacilityId: FAC_SHENZHEN_ID,
      toFacilityId: FAC_TALLINN_ID,
      inputId: INPUT_B_ID,
      materialCategory: "Electronics",
      transportMode: "SEA",
      volumeSharePct: 85,
      annualVolume: 12000,
      volumeUnit: "UNITS",
      annualSpendEur: 950000,
      contractEndDate: "2027-06-30",
      contractTerms: "FOB Shenzhen",
      leadTimeDays: 42,
      distanceKm: 7800,
      estimatedLaneCo2e: 65,
      riskStatus: "YELLOW",
      riskReason: "Long-haul China maritime corridor & Red Sea transit risk",
    },
    {
      laneId: LANE_GREEN_ID,
      ownerOrgId: ORG_ID,
      fromFacilityId: FAC_HELSINKI_ID,
      toFacilityId: FAC_TALLINN_ID,
      inputId: INPUT_Y_ID,
      materialCategory: "Polymer",
      transportMode: "SEA",
      volumeSharePct: 100,
      annualVolume: 300,
      volumeUnit: "TONNES",
      annualSpendEur: 180000,
      contractEndDate: "2027-03-15",
      contractTerms: "DDP Tallinn",
      leadTimeDays: 2,
      distanceKm: 82,
      estimatedLaneCo2e: 3.5,
      riskStatus: "GREEN",
      riskReason: null,
    },
  ];

  return { products, inputs, facilities, lanes, riskSignals: [] };
}

describe("workspace-utils", () => {
  it("returns full network and accurate summary stats when no filters are active", () => {
    const network = makeSampleNetwork();
    const result = filterWorkspaceNetwork(network, {
      productId: null,
      inputId: null,
    });

    expect(result.lanes).toHaveLength(3);
    expect(result.facilities).toHaveLength(4);
    expect(result.inputs).toHaveLength(3);
    expect(result.stats).toEqual({
      totalSpendEur: 1_450_000,
      greenLaneCount: 1,
      yellowLaneCount: 1,
      redLaneCount: 1,
      unverifiedHqCount: 2,
      verifiedSiteCount: 2,
      totalLanes: 3,
      totalFacilities: 4,
    });
  });

  it("filters corridors, inputs, and facilities by active Product pill", () => {
    const network = makeSampleNetwork();
    const result = filterWorkspaceNetwork(network, {
      productId: PRODUCT_X_ID,
      inputId: null,
    });

    expect(result.inputs.map((i) => i.inputId)).toEqual([
      INPUT_A_ID,
      INPUT_B_ID,
    ]);
    expect(result.lanes.map((l) => l.laneId)).toEqual([
      LANE_RED_ID,
      LANE_YELLOW_ID,
    ]);
    expect(result.facilities.map((f) => f.facilityId).sort()).toEqual(
      [FAC_TALLINN_ID, FAC_RIGA_ID, FAC_SHENZHEN_ID].sort(),
    );
    expect(result.stats.totalSpendEur).toBe(1_270_000);
    expect(result.stats.greenLaneCount).toBe(0);
    expect(result.stats.yellowLaneCount).toBe(1);
    expect(result.stats.redLaneCount).toBe(1);
    expect(result.stats.unverifiedHqCount).toBe(2);
  });

  it("filters corridors and facilities by active Material pill while retaining own HQ", () => {
    const network = makeSampleNetwork();
    const result = filterWorkspaceNetwork(network, {
      productId: null,
      inputId: INPUT_B_ID,
    });

    expect(result.lanes.map((l) => l.laneId)).toEqual([LANE_YELLOW_ID]);
    expect(result.facilities.map((f) => f.facilityId).sort()).toEqual(
      [FAC_TALLINN_ID, FAC_SHENZHEN_ID].sort(),
    );
    expect(result.stats.totalSpendEur).toBe(950_000);
    expect(result.stats.yellowLaneCount).toBe(1);
  });

  it("handles combined Product + Material filtering including non-matching combinations", () => {
    const network = makeSampleNetwork();
    const matching = filterWorkspaceNetwork(network, {
      productId: PRODUCT_X_ID,
      inputId: INPUT_A_ID,
    });
    expect(matching.lanes.map((l) => l.laneId)).toEqual([LANE_RED_ID]);

    const mismatched = filterWorkspaceNetwork(network, {
      productId: PRODUCT_X_ID,
      inputId: INPUT_Y_ID,
    });
    expect(mismatched.lanes).toHaveLength(0);
    // Own facility (Tallinn HQ) stays anchored
    expect(mismatched.facilities.map((f) => f.facilityId)).toEqual([
      FAC_TALLINN_ID,
    ]);
  });

  it("maps SupplyLanes to Deck.gl corridor arcs with exact GREEN/YELLOW/RED colors and scaled widths", () => {
    const network = makeSampleNetwork();
    const facilitiesById = new Map(
      network.facilities.map((f) => [f.facilityId, f]),
    );
    const inputsById = new Map(network.inputs.map((i) => [i.inputId, i]));

    const arcs = buildCorridorArcs(network.lanes, facilitiesById, inputsById);
    expect(arcs).toHaveLength(3);

    const redArc = arcs.find((a) => a.laneId === LANE_RED_ID);
    const yellowArc = arcs.find((a) => a.laneId === LANE_YELLOW_ID);
    const greenArc = arcs.find((a) => a.laneId === LANE_GREEN_ID);

    expect(redArc?.color).toEqual([...RISK_COLORS.RED]);
    expect(yellowArc?.color).toEqual([...RISK_COLORS.YELLOW]);
    expect(greenArc?.color).toEqual([...RISK_COLORS.GREEN]);
    expect(redArc?.inputName).toBe("Material A — Steel");
    expect(yellowArc?.sourcePosition).toEqual([114.0579, 22.5431]);
    expect(yellowArc?.targetPosition).toEqual([24.7536, 59.437]);

    expect(computeCorridorWidth(85, 950_000)).toBeGreaterThan(
      computeCorridorWidth(20, 50_000),
    );
  });

  it("skips lanes whose endpoint facilities are missing from the lookup map", () => {
    const network = makeSampleNetwork();
    const partialMap = new Map<string, Facility>([
      [FAC_TALLINN_ID, network.facilities[0]!],
    ]);

    const arcs = buildCorridorArcs(network.lanes, partialMap);
    expect(arcs).toHaveLength(0);
  });

  it("builds distinct facility markers for Own HQ, SITE_VERIFIED, and HQ_ESTIMATED", () => {
    const network = makeSampleNetwork();
    const markers = buildFacilityMarkers(network.facilities, FAC_RIGA_ID);
    const own = markers.find((m) => m.facilityId === FAC_TALLINN_ID);
    const verified = markers.find((m) => m.facilityId === FAC_HELSINKI_ID);
    const estimated = markers.find((m) => m.facilityId === FAC_RIGA_ID);

    expect(own?.fillColor).toEqual([16, 185, 129, 240]);
    expect(verified?.fillColor).toEqual([6, 182, 212, 230]);
    expect(estimated?.fillColor).toEqual([245, 158, 11, 185]);
    // Selected HQ_ESTIMATED marker gets bumped radius
    expect(estimated?.radiusPixels).toBe(9);
  });

  it("computes bounding boxes for empty, single, and multi-facility networks", () => {
    const network = makeSampleNetwork();
    expect(computeFacilitiesBounds([])).toBeNull();

    const single = computeFacilitiesBounds([network.facilities[0]!]);
    expect(single).not.toBeNull();
    expect(single!.maxLng).toBeGreaterThan(single!.minLng);
    expect(single!.maxLat).toBeGreaterThan(single!.minLat);

    const multi = computeFacilitiesBounds(network.facilities);
    expect(multi).toEqual({
      minLng: 24.1052,
      minLat: 22.5431,
      maxLng: 114.0579,
      maxLat: 60.1699,
    });
  });

  it("formats EUR amounts cleanly", () => {
    expect(formatEur(1_450_000)).toBe("€1.45M");
    expect(formatEur(320_000)).toBe("€320k");
    expect(formatEur(850)).toBe("€850");
    expect(formatEur(null)).toBe("—");
  });
});

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOnce(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends credentials: include and validates AuthMeResponse with Zod on getMe()", async () => {
    const payload: AuthMeResponse = {
      user: {
        userId: USER_ID,
        orgId: ORG_ID,
        email: "ops@tallinn-mfg.ee",
        role: "OWNER",
        createdAt: "2026-11-20T12:00:00.000Z",
      },
      organization: {
        orgId: ORG_ID,
        name: "Tallinn Mfg OÜ",
        slug: "tallinn-mfg-ou",
        countryCode: "EE",
        sector: "Manufacturing",
        esgBadges: [],
        scope1Tco2e: null,
        scope2Tco2e: null,
        openToNewBuyers: false,
        capabilities: [],
        createdAt: "2026-11-20T12:00:00.000Z",
      },
    };

    const fetchMock = mockFetchOnce(200, payload);
    const result = await getMe();

    expect(result.user.email).toBe("ops@tallinn-mfg.ee");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("appends productId and inputId query params on getNetwork()", async () => {
    const network = makeSampleNetwork();
    const fetchMock = mockFetchOnce(200, network);

    const res = await getNetwork({
      productId: PRODUCT_X_ID,
      inputId: INPUT_A_ID,
    });
    expect(res.products).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/workspace/network?productId=${PRODUCT_X_ID}&inputId=${INPUT_A_ID}`,
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("posts to seed-demo and validates WorkspaceNetworkResponse", async () => {
    const network = makeSampleNetwork();
    const fetchMock = mockFetchOnce(201, network);

    const res = await seedDemo();
    expect(res.lanes).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/workspace/seed-demo",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("creates and updates facilities with Zod response parsing", async () => {
    const facility = makeSampleNetwork().facilities[1]!;
    const fetchCreate = mockFetchOnce(201, { facility });
    const created = await createFacility({
      name: facility.name,
      kind: "FACTORY",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "LV",
      lat: 56.9496,
      lng: 24.1052,
      isOwnFacility: false,
    });
    expect(created.facilityId).toBe(FAC_RIGA_ID);
    expect(fetchCreate).toHaveBeenCalledWith(
      "/api/v1/workspace/facilities",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );

    const verifiedFacility: Facility = {
      ...facility,
      locationPrecision: "SITE_VERIFIED",
    };
    const fetchPatch = mockFetchOnce(200, { facility: verifiedFacility });
    const updated = await updateFacility(FAC_RIGA_ID, {
      locationPrecision: "SITE_VERIFIED",
    });
    expect(updated.locationPrecision).toBe("SITE_VERIFIED");
    expect(fetchPatch).toHaveBeenCalledWith(
      `/api/v1/workspace/facilities/${FAC_RIGA_ID}`,
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });

  it("throws structured ApiError with status, message, and details on HTTP error", async () => {
    mockFetchOnce(401, {
      error: "Invalid email or password",
      details: { field: "password" },
    });

    await expect(
      login({ email: "ops@tallinn-mfg.ee", password: "wrong" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Invalid email or password",
      details: { field: "password" },
    });
  });

  it("throws ApiError(500) when backend returns malformed payload failing Zod schema", async () => {
    mockFetchOnce(200, { user: { userId: "not-a-uuid" } });

    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
    mockFetchOnce(200, { user: { userId: "not-a-uuid" } });
    await expect(getMe()).rejects.toMatchObject({
      status: 500,
      message: "Unexpected API response format",
    });
  });

  it("builds LogicalGraphModel (Products -> SupplyInputs -> Facilities) with color-coded edges", () => {
    const network = makeSampleNetwork();
    const graph = buildLogicalGraphModel({
      products: network.products,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      activeProductId: null,
      activeInputId: null,
      selectedFacilityId: FAC_RIGA_ID,
      selectedLaneId: LANE_RED_ID,
    });

    expect(graph.nodes.filter((n) => n.kind === "product")).toHaveLength(2);
    expect(graph.nodes.filter((n) => n.kind === "input")).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.kind === "facility")).toHaveLength(4);

    const redEdge = graph.edges.find(
      (e) => e.laneId === LANE_RED_ID && e.kind === "supply",
    );
    expect(redEdge?.color).toBe("#ef4444");
    expect(redEdge?.animated).toBe(true);
    expect(redEdge?.isSelected).toBe(true);

    const rigaNode = graph.nodes.find((n) => n.entityId === FAC_RIGA_ID);
    expect(rigaNode?.isSelected).toBe(true);
  });

  it("parses RiskSignal WKT polygons for Deck.gl PolygonLayer", () => {
    const polygons = buildRiskSignalPolygons([
      {
        signalId: "sig-lv",
        kind: "SANCTIONS",
        severity: "RED",
        title: "Latvia Sanctions",
        description: "Test",
        regionCode: "LV",
        affectedCountryCodes: ["LV"],
        polygonWkt:
          "POLYGON ((20.9 55.6, 28.3 55.6, 28.3 58.1, 20.9 58.1, 20.9 55.6))",
        active: true,
      },
    ]);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]!.polygon).toHaveLength(5);
    expect(polygons[0]!.fillColor[0]).toBe(239);
  });

  it("calls GET /api/v1/analytics/summary and POST /api/v1/analytics/simulate with strict Zod parsing", async () => {
    const summaryPayload = {
      resilienceScore: 68,
      overallStatus: "YELLOW" as const,
      verifiedCoveragePct: 50,
      confidence: "ESTIMATED" as const,
      hhiMetrics: [],
      alerts: [],
      esg: {
        scope1Tco2e: 120,
        scope2Tco2e: 180,
        upstreamScope3Tco2e: 500,
        transportScope3Tco2e: 25,
        totalTco2e: 825,
        confidence: "ESTIMATED" as const,
        verifiedCoveragePct: 50,
      },
      riskSignals: [],
      computedAt: "2026-11-20T12:00:00.000Z",
    };

    const summaryMock = mockFetchOnce(200, summaryPayload);
    const summary = await getAnalyticsSummary({ productId: PRODUCT_X_ID });
    expect(summary.resilienceScore).toBe(68);
    expect(summaryMock).toHaveBeenCalledWith(
      `/api/v1/analytics/summary?productId=${PRODUCT_X_ID}`,
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );

    const simPayload = {
      baseline: summaryPayload,
      simulated: { ...summaryPayload, resilienceScore: 84, overallStatus: "GREEN" as const },
      deltas: {
        resilienceScoreDelta: 16,
        maxHhiDelta: -2000,
        avgHhiDelta: -1000,
        alertCountDelta: -1,
        redAlertCountDelta: 0,
        spofCountDelta: -1,
        transportScope3Tco2eDelta: -10,
        totalTco2eDelta: -10,
      },
      appliedChangesCount: 1,
    };

    const simMock = mockFetchOnce(200, simPayload);
    const simRes = await simulateAnalytics({
      laneChanges: [{ laneId: LANE_RED_ID, volumeSharePct: 0 }],
    });
    expect(simRes.deltas.resilienceScoreDelta).toBe(16);
    expect(simMock).toHaveBeenCalledWith(
      "/api/v1/analytics/simulate",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
