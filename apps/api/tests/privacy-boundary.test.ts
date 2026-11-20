import {
  AnalyticsSummarySchema,
  AnonymizedRiskAlertSchema,
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
});
