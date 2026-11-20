import {
  AnalyticsSummarySchema,
  AnonymizedRiskAlertSchema,
  SimulateAnalyticsResponseSchema,
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

    // 4. Org A queries ALL its endpoints after verification
    const [afterNetworkRes, afterSummaryRes, afterSimRes, invitesRes, dirRes] =
      await Promise.all([
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
      ]);

    expect(afterNetworkRes.status).toBe(200);
    expect(afterSummaryRes.status).toBe(200);
    expect(afterSimRes.status).toBe(200);
    expect(invitesRes.status).toBe(200);
    expect(dirRes.status).toBe(200);

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
    // may appear ANYWHERE in any of Org A's API responses!
    const allOrgAPayloads = JSON.stringify({
      afterNetwork,
      afterSummary,
      afterSim,
      invitesJson,
      dirJson,
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
});
