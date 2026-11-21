import {
  AnalyticsSummarySchema,
  AnonymizedRiskAlertSchema,
  ExecutiveReportSchema,
  SimulateAnalyticsResponseSchema,
  WorkspaceExportJsonSchema,
  WorkspaceNetworkResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../src/app.js";

/**
 * Mandatory Privacy Boundary Test Suite.
 *
 * 1. Guarantees that the Analytics DTO contract structurally rejects any leaked
 *    hidden Tier-2+ supplier identities, names, emails, or exact coordinates.
 * 2. Guarantees strict two-org workspace isolation: Org A and Org B can never
 *    read, mutate, delete, or reference each other's entities, client-supplied
 *    ownerOrgId is ignored, and unauthenticated requests return 401.
 */
describe("Privacy Boundary Contract (Tier-2+ Anonymization)", () => {
  it("accepts a clean anonymized alert referencing only Org A's Tier-1 facility", () => {
    const validAlert = {
      alertId: "alert-sanction-01",
      severity: "RED",
      category: "SECONDARY_SANCTION",
      title: "Hidden upstream sanctions exposure",
      summary:
        "A verified Tier-1 partner has an upstream dependency linked to a sanctioned jurisdiction. Consider switching suppliers.",
      affectedTier1FacilityIds: ["11111111-1111-4111-8111-111111111111"],
      affectedRegionCode: "EASTERN_EUROPE",
      confidence: "NETWORK_VERIFIED",
      recommendedAction: "Review verified alternative suppliers in Kulgo Directory.",
    };

    expect(() => AnonymizedRiskAlertSchema.parse(validAlert)).not.toThrow();
  });

  it("rejects any alert payload attempting to leak hidden Tier-2+ identity or coordinates", () => {
    const leakyAlert = {
      alertId: "alert-leak-01",
      severity: "RED",
      category: "SECONDARY_SANCTION",
      title: "Upstream risk",
      summary: "Upstream exposure detected",
      affectedTier1FacilityIds: ["11111111-1111-4111-8111-111111111111"],
      affectedRegionCode: "EASTERN_EUROPE",
      confidence: "NETWORK_VERIFIED",
      recommendedAction: "Switch supplier",
      // Forbidden leaked fields:
      tier2SupplierName: "Secret Upstream LLC",
      tier2FacilityLat: 55.7558,
      tier2FacilityLng: 37.6173,
    };

    expect(() => AnonymizedRiskAlertSchema.parse(leakyAlert)).toThrow();
  });

  it("rejects any AnalyticsSummary containing raw hidden upstream graph nodes", () => {
    const leakySummary = {
      resilienceScore: 62,
      overallStatus: "RED",
      verifiedCoveragePct: 50,
      confidence: "ESTIMATED",
      hhiMetrics: [],
      alerts: [],
      esg: {
        scope1Tco2e: 100,
        scope2Tco2e: 50,
        upstreamScope3Tco2e: 400,
        transportScope3Tco2e: 30,
        totalTco2e: 580,
        confidence: "ESTIMATED",
        verifiedCoveragePct: 50,
      },
      computedAt: new Date().toISOString(),
      // Forbidden leaked raw graph:
      hiddenUpstreamNodes: [{ name: "Secret Tier-2 Factory" }],
    };

    expect(() => AnalyticsSummarySchema.parse(leakySummary)).toThrow();
  });
});

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /kulgo_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Expected kulgo_session cookie");
  }
  return `kulgo_session=${match[1]}`;
}

async function registerOrg(
  app: ReturnType<typeof createTestApp>,
  email: string,
  organizationName: string,
): Promise<{ cookie: string; orgId: string }> {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "PrivacyBoundaryPassword2026!",
      organizationName,
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { organization: { orgId: string } };
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

describe("Privacy Boundary Contract (Two-Org Workspace Isolation)", () => {
  it("returns 401 for unauthenticated requests to all workspace endpoints", async () => {
    const app = createTestApp();
    const endpoints: Array<[string, string]> = [
      ["GET", "/api/v1/workspace/network"],
      ["GET", "/api/v1/workspace/products"],
      ["POST", "/api/v1/workspace/products"],
      ["GET", "/api/v1/workspace/inputs"],
      ["GET", "/api/v1/workspace/facilities"],
      ["GET", "/api/v1/workspace/lanes"],
      ["POST", "/api/v1/workspace/seed-demo"],
    ];

    for (const [method, path] of endpoints) {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
    }
  });

  it("isolates Org A and Org B data across reads, mutations, deletes, ownerOrgId spoofing, and cross-org references", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, "alpha@org-a.ee", "Org Alpha OU");
    const orgB = await registerOrg(app, "beta@org-b.ee", "Org Beta OU");

    // Org A seeds its Estonia Product X demo network
    const seedARes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: orgA.cookie },
    });
    expect(seedARes.status).toBe(201);
    const networkA = WorkspaceNetworkResponseSchema.parse(await seedARes.json());
    expect(networkA.products.length).toBeGreaterThan(0);
    expect(networkA.facilities.length).toBeGreaterThan(0);
    expect(networkA.lanes.length).toBeGreaterThan(0);

    // Org B sees an empty workspace — zero leakage from Org A
    const networkBRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: orgB.cookie },
    });
    expect(networkBRes.status).toBe(200);
    const networkB = WorkspaceNetworkResponseSchema.parse(
      await networkBRes.json(),
    );
    expect(networkB.products).toHaveLength(0);
    expect(networkB.inputs).toHaveLength(0);
    expect(networkB.facilities).toHaveLength(0);
    expect(networkB.lanes).toHaveLength(0);

    const orgAProductId = networkA.products[0]!.productId;
    const orgAInputId = networkA.inputs[0]!.inputId;
    const orgAFacility1Id = networkA.facilities[0]!.facilityId;
    const orgAFacility2Id = networkA.facilities[1]!.facilityId;
    const orgALaneId = networkA.lanes[0]!.laneId;

    // Org B cannot update or delete any of Org A's entities (must return 404)
    expect(
      (
        await app.request(`/api/v1/workspace/products/${orgAProductId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
          body: JSON.stringify({ name: "Hijacked Product" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/workspace/products/${orgAProductId}`, {
          method: "DELETE",
          headers: { Cookie: orgB.cookie },
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await app.request(`/api/v1/workspace/inputs/${orgAInputId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
          body: JSON.stringify({ name: "Hijacked Input" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/workspace/inputs/${orgAInputId}`, {
          method: "DELETE",
          headers: { Cookie: orgB.cookie },
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await app.request(`/api/v1/workspace/facilities/${orgAFacility1Id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
          body: JSON.stringify({ name: "Hijacked Facility" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/workspace/facilities/${orgAFacility1Id}`, {
          method: "DELETE",
          headers: { Cookie: orgB.cookie },
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await app.request(`/api/v1/workspace/lanes/${orgALaneId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
          body: JSON.stringify({ riskStatus: "RED" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/workspace/lanes/${orgALaneId}`, {
          method: "DELETE",
          headers: { Cookie: orgB.cookie },
        })
      ).status,
    ).toBe(404);

    // Client-supplied ownerOrgId spoofing is ignored — entity is strictly owned by Org B
    const spoofProductRes = await app.request("/api/v1/workspace/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        ownerOrgId: orgA.orgId,
        name: "Org B Spoof Attempt",
      }),
    });
    expect(spoofProductRes.status).toBe(201);
    const { product: spoofProduct } = (await spoofProductRes.json()) as {
      product: { ownerOrgId: string };
    };
    expect(spoofProduct.ownerOrgId).toBe(orgB.orgId);

    // Create two own facilities for Org B
    const bFac1Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        ownerOrgId: orgA.orgId,
        name: "Org B HQ",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
      }),
    });
    expect(bFac1Res.status).toBe(201);
    const { facility: bFac1 } = (await bFac1Res.json()) as {
      facility: { facilityId: string; ownerOrgId: string };
    };
    expect(bFac1.ownerOrgId).toBe(orgB.orgId);

    const bFac2Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        name: "Org B Supplier",
        countryCode: "FI",
        lat: 60.1699,
        lng: 24.9384,
      }),
    });
    expect(bFac2Res.status).toBe(201);
    const { facility: bFac2 } = (await bFac2Res.json()) as {
      facility: { facilityId: string };
    };

    // Cross-org references are rejected with 400
    const crossOrgInputRes = await app.request("/api/v1/workspace/inputs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        productId: orgAProductId,
        name: "Cross-Org Material",
        category: "Metals",
      }),
    });
    expect(crossOrgInputRes.status).toBe(400);

    const crossOrgLaneFromRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        fromFacilityId: orgAFacility1Id,
        toFacilityId: bFac1.facilityId,
        materialCategory: "Metals",
      }),
    });
    expect(crossOrgLaneFromRes.status).toBe(400);

    const crossOrgLaneToRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        fromFacilityId: bFac2.facilityId,
        toFacilityId: orgAFacility2Id,
        materialCategory: "Metals",
      }),
    });
    expect(crossOrgLaneToRes.status).toBe(400);

    const crossOrgLaneInputRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        fromFacilityId: bFac2.facilityId,
        toFacilityId: bFac1.facilityId,
        inputId: orgAInputId,
        materialCategory: "Metals",
      }),
    });
    expect(crossOrgLaneInputRes.status).toBe(400);

    // Org A's network remains completely untouched
    const networkAAfterRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: orgA.cookie },
    });
    const networkAAfter = WorkspaceNetworkResponseSchema.parse(
      await networkAAfterRes.json(),
    );
    expect(networkAAfter.products).toHaveLength(networkA.products.length);
    expect(networkAAfter.facilities).toHaveLength(networkA.facilities.length);
    expect(networkAAfter.lanes).toHaveLength(networkA.lanes.length);
  });

  it("enforces auth, strict DTOs, and two-org isolation on /api/v1/analytics/summary and /api/v1/analytics/simulate", async () => {
    const app = createTestApp();

    // Unauthenticated analytics endpoints return 401
    expect((await app.request("/api/v1/analytics/summary")).status).toBe(401);
    expect(
      (
        await app.request("/api/v1/analytics/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            laneChanges: [
              {
                laneId: "11111111-1111-4111-8111-111111111111",
                volumeSharePct: 50,
              },
            ],
          }),
        })
      ).status,
    ).toBe(401);

    const orgA = await registerOrg(app, "analytics-a@org-a.ee", "Analytics Alpha OU");
    const orgB = await registerOrg(app, "analytics-b@org-b.ee", "Analytics Beta OU");

    const seedARes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: orgA.cookie },
    });
    expect(seedARes.status).toBe(201);
    const networkA = WorkspaceNetworkResponseSchema.parse(await seedARes.json());
    const orgAFacilityIds = new Set(networkA.facilities.map((f) => f.facilityId));
    const orgALaneId = networkA.lanes[0]!.laneId;

    // Org A gets strict AnalyticsSummary with alerts referencing ONLY Org A's Tier-1 facility IDs
    const summaryARes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: orgA.cookie },
    });
    expect(summaryARes.status).toBe(200);
    const summaryA = AnalyticsSummarySchema.parse(await summaryARes.json());
    expect(summaryA.alerts.length).toBeGreaterThan(0);
    for (const alert of summaryA.alerts) {
      for (const fid of alert.affectedTier1FacilityIds) {
        expect(orgAFacilityIds.has(fid)).toBe(true);
      }
    }

    // Org B sees zero HHI, zero alerts, zero upstream Scope 3 from Org A
    const summaryBRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: orgB.cookie },
    });
    expect(summaryBRes.status).toBe(200);
    const summaryB = AnalyticsSummarySchema.parse(await summaryBRes.json());
    expect(summaryB.hhiMetrics).toHaveLength(0);
    expect(summaryB.alerts).toHaveLength(0);
    expect(summaryB.esg.upstreamScope3Tco2e).toBe(0);
    expect(summaryB.esg.transportScope3Tco2e).toBe(0);

    // Org B cannot simulate Org A's laneId (must reject with 400)
    const crossOrgSimRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        laneChanges: [{ laneId: orgALaneId, volumeSharePct: 0 }],
      }),
    });
    expect(crossOrgSimRes.status).toBe(400);

    // SimulateAnalyticsResponseSchema strictly rejects leaked Tier-2+ fields
    const validSimRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        laneChanges: [{ laneId: orgALaneId, volumeSharePct: 50 }],
      }),
    });
    expect(validSimRes.status).toBe(200);
    const validSim = SimulateAnalyticsResponseSchema.parse(
      await validSimRes.json(),
    );
    expect(() =>
      SimulateAnalyticsResponseSchema.parse({
        ...validSim,
        leakedTier2Suppliers: ["Secret Upstream Co"],
      }),
    ).toThrow();
  });

  it("enforces Org A -> Org B -> Org C hidden Tier-2 privacy boundary across analytics, simulation, workspace, invites, and directory", async () => {
    const app = createTestApp();

    // Unauthenticated M3 endpoints must return 401
    expect((await app.request("/api/v1/invites")).status).toBe(401);
    expect(
      (await app.request("/api/v1/directory/alternatives")).status,
    ).toBe(401);

    const orgA = await registerOrg(app, "buyer-a@estonia-mfg.ee", "Estonia Buyer AS");
    const orgB = await registerOrg(app, "tier1-b@nordic-tier1.fi", "Nordic Tier1 Oy");
    const orgC = await registerOrg(
      app,
      "ops@secret-kremlin-alloys.ru",
      "Secret Kremlin Alloys LLC",
    );

    // 1. Org A creates its own HQ + a Tier-1 supplier facility representing Org B + an active lane
    const aHqRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Tallinn Assembly HQ",
        kind: "HQ",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: true,
        estimatedScope12Tco2e: 120,
      }),
    });
    expect(aHqRes.status).toBe(201);
    const { facility: aHq } = (await aHqRes.json()) as {
      facility: { facilityId: string };
    };

    const aTier1Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Nordic Tier1 Partner",
        kind: "HQ",
        locationPrecision: "HQ_ESTIMATED",
        countryCode: "FI",
        lat: 60.1699,
        lng: 24.9384,
        isOwnFacility: false,
        sector: "Metals",
        estimatedScope12Tco2e: 150,
      }),
    });
    expect(aTier1Res.status).toBe(201);
    const { facility: aTier1 } = (await aTier1Res.json()) as {
      facility: { facilityId: string };
    };

    const aLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        fromFacilityId: aTier1.facilityId,
        toFacilityId: aHq.facilityId,
        materialCategory: "Specialty Alloys",
        transportMode: "SEA",
        volumeSharePct: 100,
        annualVolume: 500,
        volumeUnit: "TONNES",
        annualSpendEur: 750000,
        riskStatus: "GREEN",
      }),
    });
    expect(aLaneRes.status).toBe(201);
    const { lane: aLane } = (await aLaneRes.json()) as {
      lane: { laneId: string };
    };

    // Baseline Org A summary before partner verification (no hidden upstream Scope 3 or sanction alert)
    const beforeSummaryRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: orgA.cookie },
    });
    expect(beforeSummaryRes.status).toBe(200);
    const beforeSummary = AnalyticsSummarySchema.parse(
      await beforeSummaryRes.json(),
    );
    expect(
      beforeSummary.alerts.some((a) => a.category === "SECONDARY_SANCTION"),
    ).toBe(false);
    const baselineUpstreamScope3 = beforeSummary.esg.upstreamScope3Tco2e;

    // 2. Org B maps its own private upstream network with hidden Tier-2 supplier Org C (in sanctioned RU)
    const bOwnRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        name: "Tampere Processing Plant",
        kind: "FACTORY",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "FI",
        lat: 61.4978,
        lng: 23.761,
        isOwnFacility: true,
        estimatedScope12Tco2e: 200,
      }),
    });
    expect(bOwnRes.status).toBe(201);
    const { facility: bOwn } = (await bOwnRes.json()) as {
      facility: { facilityId: string };
    };

    const bSecretTier2Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        name: "Secret Kremlin Alloys LLC",
        kind: "EXTRACTION",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "RU",
        lat: 55.7558,
        lng: 37.6173,
        isOwnFacility: false,
        sector: "Mining",
        estimatedScope12Tco2e: 640,
      }),
    });
    expect(bSecretTier2Res.status).toBe(201);
    const { facility: bSecretTier2 } = (await bSecretTier2Res.json()) as {
      facility: { facilityId: string };
    };

    const bLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        fromFacilityId: bSecretTier2.facilityId,
        toFacilityId: bOwn.facilityId,
        materialCategory: "Raw Nickel Ore",
        transportMode: "RAIL",
        volumeSharePct: 100,
        annualVolume: 400,
        volumeUnit: "TONNES",
        riskStatus: "RED",
        riskReason: "Secondary sanctions risk from Secret Kremlin Alloys LLC",
      }),
    });
    expect(bLaneRes.status).toBe(201);

    // 3. Org A invites Org B for aTier1; Org B accepts, refines site, and opts into directory
    const createInviteRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: aTier1.facilityId,
        inviteeEmail: "tier1-b@nordic-tier1.fi",
      }),
    });
    expect(createInviteRes.status).toBe(201);
    const createdInvite = (await createInviteRes.json()) as {
      invitation: { inviteId: string };
      inviteToken: string;
    };

    // Org B cannot revoke Org A's invite (must return 404)
    expect(
      (
        await app.request(`/api/v1/invites/${createdInvite.invitation.inviteId}`, {
          method: "DELETE",
          headers: { Cookie: orgB.cookie },
        })
      ).status,
    ).toBe(404);

    const acceptRes = await app.request(
      `/api/v1/invites/${createdInvite.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({
          openToNewBuyers: true,
          capabilities: ["Specialty Alloys", "Nordic Metallurgy"],
          refinedSite: {
            kind: "FACTORY",
            lat: 61.4978,
            lng: 23.761,
            countryCode: "FI",
          },
        }),
      },
    );
    expect(acceptRes.status).toBe(200);

    // 4. Org A queries ALL its endpoints after verification (including M4 export & CSRD report)
    const [
      afterNetworkRes,
      afterSummaryRes,
      afterSimRes,
      invitesRes,
      dirRes,
      reportRes,
      exportJsonRes,
      exportCsvRes,
    ] = await Promise.all([
      app.request("/api/v1/workspace/network", {
        headers: { Cookie: orgA.cookie },
      }),
      app.request("/api/v1/analytics/summary", {
        headers: { Cookie: orgA.cookie },
      }),
      app.request("/api/v1/analytics/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
        body: JSON.stringify({
          laneChanges: [{ laneId: aLane.laneId, transportMode: "RAIL" }],
        }),
      }),
      app.request("/api/v1/invites", {
        headers: { Cookie: orgA.cookie },
      }),
      app.request("/api/v1/directory/alternatives", {
        headers: { Cookie: orgA.cookie },
      }),
      app.request("/api/v1/analytics/report", {
        headers: { Cookie: orgA.cookie },
      }),
      app.request("/api/v1/workspace/export?format=json", {
        headers: { Cookie: orgA.cookie },
      }),
      app.request("/api/v1/workspace/export?format=csv", {
        headers: { Cookie: orgA.cookie },
      }),
    ]);

    expect(afterNetworkRes.status).toBe(200);
    expect(afterSummaryRes.status).toBe(200);
    expect(afterSimRes.status).toBe(200);
    expect(invitesRes.status).toBe(200);
    expect(dirRes.status).toBe(200);
    expect(reportRes.status).toBe(200);
    expect(exportJsonRes.status).toBe(200);
    expect(exportCsvRes.status).toBe(200);

    const afterNetwork = WorkspaceNetworkResponseSchema.parse(
      await afterNetworkRes.json(),
    );
    const afterSummary = AnalyticsSummarySchema.parse(
      await afterSummaryRes.json(),
    );
    const afterSim = SimulateAnalyticsResponseSchema.parse(
      await afterSimRes.json(),
    );
    const invitesJson = await invitesRes.json();
    const dirJson = await dirRes.json();
    const reportJson = ExecutiveReportSchema.parse(await reportRes.json());
    const exportJson = WorkspaceExportJsonSchema.parse(
      await exportJsonRes.json(),
    );
    const exportCsv = await exportCsvRes.text();

    // ExecutiveReportSchema strictly rejects any leaked Tier-2+ fields
    expect(() =>
      ExecutiveReportSchema.parse({
        ...reportJson,
        hiddenTier2Suppliers: ["Secret Kremlin Alloys LLC"],
      }),
    ).toThrow();

    // Org A's Tier-1 facility is now marked Network-Verified & SITE_VERIFIED
    const verifiedTier1 = afterNetwork.facilities.find(
      (f) => f.facilityId === aTier1.facilityId,
    );
    expect(verifiedTier1?.isPartnerVerified).toBe(true);
    expect(verifiedTier1?.locationPrecision).toBe("SITE_VERIFIED");

    // Org A receives anonymized hidden-upstream secondary-sanction alert referencing ONLY aTier1
    const hiddenSanctionAlert = afterSummary.alerts.find(
      (a) => a.category === "SECONDARY_SANCTION",
    );
    expect(hiddenSanctionAlert).toBeDefined();
    expect(hiddenSanctionAlert?.confidence).toBe("NETWORK_VERIFIED");
    expect(hiddenSanctionAlert?.affectedTier1FacilityIds).toEqual([
      aTier1.facilityId,
    ]);

    // Org A's Scope 3 upstream rolled up Org B's hidden Tier-2 emissions
    expect(afterSummary.esg.upstreamScope3Tco2e).toBeGreaterThan(
      baselineUpstreamScope3,
    );
    expect(afterSummary.verifiedCoveragePct).toBe(100);
    expect(afterSummary.confidence).toBe("NETWORK_VERIFIED");

    // CRITICAL PRIVACY ASSERTION: ZERO Org C identifiers, names, emails, or coordinates
    // may appear ANYWHERE in any of Org A's API responses (including exports & CSRD report)!
    const allOrgAPayloads = JSON.stringify({
      afterNetwork,
      afterSummary,
      afterSim,
      invitesJson,
      dirJson,
      reportJson,
      exportJson,
      exportCsv,
    });

    const forbiddenSecrets = [
      orgC.orgId,
      bSecretTier2.facilityId,
      "Secret Kremlin Alloys",
      "secret-kremlin-alloys.ru",
      "ops@secret-kremlin-alloys.ru",
      "55.7558",
      "37.6173",
      "Raw Nickel Ore",
      "Tampere Processing Plant",
      bOwn.facilityId,
    ];

    for (const secret of forbiddenSecrets) {
      expect(allOrgAPayloads).not.toContain(secret);
    }
  });

  it("enforces auth and strict org isolation on M4 endpoints (org profile, bulk import, export, CSRD report)", async () => {
    const app = createTestApp();

    // Unauthenticated requests return 401
    expect(
      (
        await app.request("/api/v1/auth/organization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope1Tco2e: 100 }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/v1/workspace/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facilities: [] }),
        })
      ).status,
    ).toBe(401);
    expect((await app.request("/api/v1/workspace/export?format=json")).status).toBe(
      401,
    );
    expect((await app.request("/api/v1/analytics/report")).status).toBe(401);

    const orgA = await registerOrg(app, "m4-a@org-a.ee", "M4 Alpha AS");
    const orgB = await registerOrg(app, "m4-b@org-b.ee", "M4 Beta AS");

    const seedARes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: orgA.cookie },
    });
    const networkA = WorkspaceNetworkResponseSchema.parse(await seedARes.json());
    const orgAFacId = networkA.facilities[0]!.facilityId;

    // Org B cannot bulk-import a lane referencing Org A's facilityId
    const crossOrgImport = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        facilities: [
          {
            refKey: "b-hq",
            ownerOrgId: orgA.orgId,
            name: "Org B Own HQ",
            countryCode: "EE",
            lat: 59.437,
            lng: 24.7536,
          },
        ],
        lanes: [
          {
            fromFacilityId: orgAFacId,
            toFacilityRef: "b-hq",
            materialCategory: "Cross-Org Attempt",
          },
        ],
      }),
    });
    expect(crossOrgImport.status).toBe(200);
    const importSummary = (await crossOrgImport.json()) as {
      createdFacilities: number;
      createdLanes: number;
      errors: Array<{ entity: string }>;
    };
    expect(importSummary.createdFacilities).toBe(1);
    expect(importSummary.createdLanes).toBe(0);
    expect(importSummary.errors).toHaveLength(1);
    expect(importSummary.errors[0]?.entity).toBe("LANE");
  });

  it("enforces cross-org member isolation and OWNER-only RBAC on /api/v1/auth/members and /api/v1/auth/organization", async () => {
    const app = createTestApp();

    // Unauthenticated requests to member management endpoints return 401
    expect((await app.request("/api/v1/auth/members")).status).toBe(401);
    expect(
      (
        await app.request("/api/v1/auth/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "anon@org.ee",
            password: "PrivacyBoundaryPassword2026!",
            role: "MEMBER",
          }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          "/api/v1/auth/members/11111111-1111-4111-8111-111111111111",
          { method: "DELETE" },
        )
      ).status,
    ).toBe(401);

    const orgA = await registerOrg(app, "m5-a@org-a.ee", "M5 Alpha AS");
    const orgB = await registerOrg(app, "m5-b@org-b.ee", "M5 Beta AS");

    // Org A adds a MEMBER
    const addRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        email: "member-a@org-a.ee",
        password: "PrivacyBoundaryPassword2026!",
        role: "MEMBER",
      }),
    });
    expect(addRes.status).toBe(201);
    const { member: memberA } = (await addRes.json()) as {
      member: { userId: string; orgId: string };
    };
    expect(memberA.orgId).toBe(orgA.orgId);

    // Org B cannot see Org A's members
    const orgBMembersRes = await app.request("/api/v1/auth/members", {
      headers: { Cookie: orgB.cookie },
    });
    expect(orgBMembersRes.status).toBe(200);
    const orgBMembersRaw = await orgBMembersRes.text();
    expect(orgBMembersRaw).not.toContain("member-a@org-a.ee");
    expect(orgBMembersRaw).not.toContain("m5-a@org-a.ee");
    expect(orgBMembersRaw).not.toContain("passwordHash");

    // Org B's OWNER cannot delete Org A's member (must return 404, never leak existence)
    const crossOrgDeleteRes = await app.request(
      `/api/v1/auth/members/${memberA.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: orgB.cookie },
      },
    );
    expect(crossOrgDeleteRes.status).toBe(404);

    // Org A's MEMBER logs in: cannot mutate Org A's org settings or manage members (403)
    const memberALogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "member-a@org-a.ee",
        password: "PrivacyBoundaryPassword2026!",
      }),
    });
    expect(memberALogin.status).toBe(200);
    const memberACookie = extractCookie(memberALogin);

    expect(
      (
        await app.request("/api/v1/auth/organization", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: memberACookie,
          },
          body: JSON.stringify({ scope1Tco2e: 999 }),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await app.request("/api/v1/auth/members", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: memberACookie,
          },
          body: JSON.stringify({
            email: "escalate@org-a.ee",
            password: "PrivacyBoundaryPassword2026!",
            role: "OWNER",
          }),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await app.request(`/api/v1/auth/members/${memberA.userId}`, {
          method: "DELETE",
          headers: { Cookie: memberACookie },
        })
      ).status,
    ).toBe(403);
  });

  it("enforces two-org audit log isolation and zero Tier-2+ partner leakage in audit events", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, "audit-alpha@org-a.ee", "Audit Alpha OU");
    const orgB = await registerOrg(app, "audit-beta@org-b.ee", "Audit Beta OU");

    // Org A creates its own factory + Tier-1 supplier facility
    const ownFacARes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Tallinn Assembly A",
        kind: "FACTORY",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: true,
      }),
    });
    expect(ownFacARes.status).toBe(201);
    const { facility: ownFacA } = (await ownFacARes.json()) as {
      facility: { facilityId: string };
    };

    const tier1FacARes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Nordic Tier-1 Supplier B",
        kind: "FACTORY",
        countryCode: "FI",
        lat: 60.1699,
        lng: 24.9384,
        isOwnFacility: false,
      }),
    });
    expect(tier1FacARes.status).toBe(201);
    const { facility: tier1FacA } = (await tier1FacARes.json()) as {
      facility: { facilityId: string };
    };

    await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        fromFacilityId: tier1FacA.facilityId,
        toFacilityId: ownFacA.facilityId,
        materialCategory: "Battery Cells",
        transportMode: "SEA",
        volumeSharePct: 100,
      }),
    });

    // Org A invites Org B to verify Tier-1 node
    const inviteRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: tier1FacA.facilityId,
        inviteeEmail: "audit-beta@org-b.ee",
      }),
    });
    expect(inviteRes.status).toBe(201);
    const { inviteToken } = (await inviteRes.json()) as { inviteToken: string };

    // Org B accepts invite and maps a SECRET Tier-2 upstream supplier
    const acceptRes = await app.request(`/api/v1/invites/${inviteToken}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({ openToNewBuyers: false }),
    });
    expect(acceptRes.status).toBe(200);

    const secretTier2Name = "TOP_SECRET_TIER2_SMELTER_RU";
    const orgBImportRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        facilities: [
          {
            name: "Helsinki Hub B",
            kind: "FACTORY",
            countryCode: "FI",
            lat: 60.1699,
            lng: 24.9384,
            isOwnFacility: true,
          },
          {
            name: secretTier2Name,
            kind: "MINE",
            countryCode: "RU",
            lat: 55.7558,
            lng: 37.6173,
            isOwnFacility: false,
          },
        ],
      }),
    });
    expect(orgBImportRes.status).toBe(200);

    // Org B also updates its own org profile
    await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({ scope1Tco2e: 888, scope2Tco2e: 444 }),
    });

    // Org A exports its CSRD report (triggers hidden Tier-2+ traversal server-side)
    const reportARes = await app.request("/api/v1/analytics/report", {
      headers: { Cookie: orgA.cookie },
    });
    expect(reportARes.status).toBe(200);

    // Fetch Org A's audit log
    const auditARes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: orgA.cookie },
    });
    expect(auditARes.status).toBe(200);
    const auditA = (await auditARes.json()) as {
      events: Array<{ orgId: string; action: string }>;
    };
    expect(auditA.events.length).toBeGreaterThanOrEqual(2);
    expect(auditA.events.every((e) => e.orgId === orgA.orgId)).toBe(true);
    expect(auditA.events.some((e) => e.action === "CSRD_REPORT_EXPORTED")).toBe(
      true,
    );

    const serializedA = JSON.stringify(auditA);
    expect(serializedA).not.toContain(orgB.orgId);
    expect(serializedA).not.toContain(secretTier2Name);
    expect(serializedA).not.toContain("55.7558");
    expect(serializedA).not.toContain("37.6173");
    expect(serializedA).not.toContain(inviteToken);
    expect(serializedA).not.toContain("888");

    // Fetch Org B's audit log -> strictly scoped to Org B, zero Org A events
    const auditBRes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: orgB.cookie },
    });
    expect(auditBRes.status).toBe(200);
    const auditB = (await auditBRes.json()) as {
      events: Array<{ orgId: string; action: string }>;
    };
    expect(auditB.events.length).toBeGreaterThanOrEqual(3);
    expect(auditB.events.every((e) => e.orgId === orgB.orgId)).toBe(true);
    expect(JSON.stringify(auditB)).not.toContain(orgA.orgId);
    expect(JSON.stringify(auditB)).not.toContain("CSRD_REPORT_EXPORTED");
  });

  it("prevents single-partner Tier-2 country inference leaks across product filters, 0% simulations, and duplicate partnerOrgId links", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, "leak-a@buyer.ee", "Leak Check Buyer AS");
    const orgB = await registerOrg(app, "leak-b@tier1.fi", "Single Partner Oy");

    // Org B sets up its own HQ + secret Tier-2 supplier in CN
    const bOwnRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        name: "Partner B Plant",
        kind: "FACTORY",
        countryCode: "FI",
        lat: 60.17,
        lng: 24.94,
        isOwnFacility: true,
      }),
    });
    const { facility: bOwn } = (await bOwnRes.json()) as {
      facility: { facilityId: string };
    };
    const bTier2Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        name: "Secret Shenzhen Tier2",
        kind: "FACTORY",
        countryCode: "CN",
        lat: 22.54,
        lng: 114.05,
        isOwnFacility: false,
      }),
    });
    const { facility: bTier2 } = (await bTier2Res.json()) as {
      facility: { facilityId: string };
    };
    await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        fromFacilityId: bTier2.facilityId,
        toFacilityId: bOwn.facilityId,
        materialCategory: "Wafers",
        transportMode: "SEA",
        volumeSharePct: 100,
      }),
    });

    // Org A sets up Product 1 + HQ + TWO Tier-1 facility nodes both linked to the SAME orgB
    const prod1Res = await app.request("/api/v1/workspace/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({ name: "Filtered Product 1" }),
    });
    const { product: prod1 } = (await prod1Res.json()) as {
      product: { productId: string };
    };
    const input1Res = await app.request("/api/v1/workspace/inputs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        productId: prod1.productId,
        name: "Input 1",
        category: "Chips",
      }),
    });
    const { input: input1 } = (await input1Res.json()) as {
      input: { inputId: string };
    };

    const createAFac = async (name: string, isOwn = false) => {
      const res = await app.request("/api/v1/workspace/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
        body: JSON.stringify({
          name,
          kind: "FACTORY",
          countryCode: isOwn ? "EE" : "FI",
          lat: 59.43,
          lng: 24.75,
          isOwnFacility: isOwn,
        }),
      });
      return ((await res.json()) as { facility: { facilityId: string } }).facility
        .facilityId;
    };

    const aHqId = await createAFac("Org A HQ", true);
    const aTier1Node1 = await createAFac("Partner B Site North");
    const aTier1Node2 = await createAFac("Partner B Site South");

    const lane1Res = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        fromFacilityId: aTier1Node1,
        toFacilityId: aHqId,
        inputId: input1.inputId,
        materialCategory: "Chips",
        volumeSharePct: 50,
      }),
    });
    const { lane: lane1 } = (await lane1Res.json()) as {
      lane: { laneId: string };
    };
    await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        fromFacilityId: aTier1Node2,
        toFacilityId: aHqId,
        materialCategory: "Casing",
        volumeSharePct: 100,
      }),
    });

    // Verify both Tier-1 nodes against the SAME partner organization orgB
    for (const targetFacilityId of [aTier1Node1, aTier1Node2]) {
      const invRes = await app.request("/api/v1/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
        body: JSON.stringify({
          targetFacilityId,
          inviteeEmail: "leak-b@tier1.fi",
        }),
      });
      const { inviteToken } = (await invRes.json()) as { inviteToken: string };
      const accRes = await app.request(`/api/v1/invites/${inviteToken}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({}),
      });
      expect(accRes.status).toBe(200);
    }

    // 1. Even with 2 facilities linked to the SAME partnerOrgId, SHARED_UPSTREAM_CHOKEPOINT must NOT be emitted
    const summaryRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: orgA.cookie },
    });
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());
    expect(
      summary.alerts.some((a) => a.category === "SHARED_UPSTREAM_CHOKEPOINT"),
    ).toBe(false);

    // 2. Filtering to product 1 (only 1 partner) must NOT emit SHARED_UPSTREAM_CHOKEPOINT
    const filteredRes = await app.request(
      `/api/v1/analytics/summary?productId=${prod1.productId}`,
      { headers: { Cookie: orgA.cookie } },
    );
    const filteredSummary = AnalyticsSummarySchema.parse(
      await filteredRes.json(),
    );
    expect(
      filteredSummary.alerts.some(
        (a) => a.category === "SHARED_UPSTREAM_CHOKEPOINT",
      ),
    ).toBe(false);

    // 3. Simulating lane1 at 0% volumeSharePct excludes it from active partner resolution
    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        laneChanges: [{ laneId: lane1.laneId, volumeSharePct: 0 }],
      }),
    });
    expect(simRes.status).toBe(200);
    const sim = SimulateAnalyticsResponseSchema.parse(await simRes.json());
    expect(
      sim.simulated.alerts.some(
        (a) => a.category === "SHARED_UPSTREAM_CHOKEPOINT",
      ),
    ).toBe(false);
    // When lane1 is simulated at 0%, aTier1Node1 is inactive so Org B's Tier-2 geopolitical alert from aTier1Node1 does not appear
    expect(
      sim.simulated.alerts.some((a) =>
        a.affectedTier1FacilityIds.includes(aTier1Node1),
      ),
    ).toBe(false);
  });
});

describe("Privacy Boundary Contract (Live Disruption Monitoring & Alerts)", () => {
  it("enforces 401 auth and two-org isolation on /api/v1/alerts/* and strips all Tier-2+ identity from live partner alerts", async () => {
    const app = createTestApp();

    // 1. Unauthenticated access rejected
    expect((await app.request("/api/v1/alerts/feed")).status).toBe(401);
    expect((await app.request("/api/v1/alerts/preferences")).status).toBe(401);

    const orgA = await registerOrg(app, "alerts-a@privacy.eu", "Org A Buyer");
    const orgB = await registerOrg(
      app,
      "alerts-b@privacy.eu",
      "Org B Tier1 Partner",
    );

    // 2. Org A sets preferences & acks; Org B must never see them
    await app.request("/api/v1/alerts/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        emailRecipients: ["secret-ops@orga.eu"],
        webhookSecret: "orga-super-secret-signing-key-999",
      }),
    });
    await app.request("/api/v1/alerts/sig-latvia-sanctions-01/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({ status: "MUTED", note: "Org A internal note" }),
    });

    const orgBPrefsRes = await app.request("/api/v1/alerts/preferences", {
      headers: { Cookie: orgB.cookie },
    });
    const orgBPrefsText = await orgBPrefsRes.text();
    expect(orgBPrefsText).not.toContain("secret-ops@orga.eu");
    expect(orgBPrefsText).not.toContain("orga-super-secret-signing-key-999");

    // 3. Link Org A -> Org B and give Org B a secret Tier-2 facility in LV (matches sig-latvia-sanctions-01)
    const facARes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Tier-1 Partner Node",
        kind: "FACTORY",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: false,
      }),
    });
    expect(facARes.status).toBe(201);
    const facA = (
      (await facARes.json()) as { facility: { facilityId: string } }
    ).facility;

    const invRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: facA.facilityId,
        inviteeEmail: "alerts-b@privacy.eu",
      }),
    });
    expect(invRes.status).toBe(201);
    const inv = (await invRes.json()) as { inviteToken: string };

    const acceptRes = await app.request(
      `/api/v1/invites/${inv.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({}),
      },
    );
    expect(acceptRes.status).toBe(200);

    const secretTier2Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        name: "Secret Riga Chemical Plant LLC",
        kind: "FACTORY",
        countryCode: "LV",
        lat: 56.9496,
        lng: 24.1052,
        isOwnFacility: false,
      }),
    });
    expect(secretTier2Res.status).toBe(201);
    const secretTier2 = (
      (await secretTier2Res.json()) as { facility: { facilityId: string } }
    ).facility;

    // 4. Org A fetches live alert feed: receives anonymized LV partner alert with ZERO Tier-2+ leakage
    const feedRes = await app.request("/api/v1/alerts/feed", {
      headers: { Cookie: orgA.cookie },
    });
    expect(feedRes.status).toBe(200);
    const feedText = await feedRes.text();
    const feed = JSON.parse(feedText) as {
      partnerRegionAlerts: Array<{ signalId: string; countryCode: string | null }>;
    };

    expect(
      feed.partnerRegionAlerts.some(
        (a) => a.signalId === "sig-latvia-sanctions-01" && a.countryCode === "LV",
      ),
    ).toBe(true);
    expect(feedText).not.toContain("Secret Riga Chemical Plant LLC");
    expect(feedText).not.toContain(secretTier2.facilityId);
    expect(feedText).not.toContain(orgB.orgId);
    expect(feedText).not.toContain("56.9496");
    expect(feedText).not.toContain("24.1052");
  });
});

