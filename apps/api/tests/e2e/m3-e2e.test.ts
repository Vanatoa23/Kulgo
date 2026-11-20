import {
  AcceptInviteResponseSchema,
  AnalyticsSummarySchema,
  CreateInviteResponseSchema,
  DirectoryAlternativesResponseSchema,
  ListInvitesResponseSchema,
  RevokeInviteResponseSchema,
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

async function registerOrg(
  app: ReturnType<typeof createTestApp>,
  params: {
    email: string;
    organizationName: string;
    countryCode?: string;
    sector?: string;
  },
): Promise<{ cookie: string; orgId: string }> {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: params.email,
      password: "M3PartnerNetworkPassword2026!",
      organizationName: params.organizationName,
      countryCode: params.countryCode ?? "EE",
      sector: params.sector ?? "Manufacturing",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { organization: { orgId: string } };
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

describe("Milestone 3 E2E — Partner Invitations, Hidden Tier-2+ Risk & Alternative Supplier Directory", () => {
  it("completes the invite lifecycle: create, list, revoke, reject replay/self-accept, accept with site refinement & directory opt-in", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      email: "buyer@tallinn-electronics.ee",
      organizationName: "Tallinn Electronics AS",
      countryCode: "EE",
      sector: "Electronics",
    });
    const orgB = await registerOrg(app, {
      email: "partner@helsinki-alloys.fi",
      organizationName: "Helsinki Alloys Oy",
      countryCode: "FI",
      sector: "Metals",
    });

    // Org A seeds Estonia Product X demo
    const seedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: orgA.cookie },
    });
    expect(seedRes.status).toBe(201);
    const networkA = WorkspaceNetworkResponseSchema.parse(await seedRes.json());
    const ownFac = networkA.facilities.find((f) => f.isOwnFacility)!;
    const tier1Fac = networkA.facilities.find((f) => !f.isOwnFacility)!;

    // Cannot invite own facility
    const ownInviteRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: ownFac.facilityId,
        inviteeEmail: "self@tallinn-electronics.ee",
      }),
    });
    expect(ownInviteRes.status).toBe(400);

    // 1. Create first invite and revoke it
    const inv1Res = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: tier1Fac.facilityId,
        inviteeEmail: "wrong@helsinki-alloys.fi",
      }),
    });
    expect(inv1Res.status).toBe(201);
    const inv1 = CreateInviteResponseSchema.parse(await inv1Res.json());
    expect(inv1.invitation.status).toBe("PENDING");
    expect(inv1.inviteLink).toContain(`?invite=${inv1.inviteToken}`);

    const revokeRes = await app.request(
      `/api/v1/invites/${inv1.invitation.inviteId}`,
      {
        method: "DELETE",
        headers: { Cookie: orgA.cookie },
      },
    );
    expect(revokeRes.status).toBe(200);
    const revoked = RevokeInviteResponseSchema.parse(await revokeRes.json());
    expect(revoked.invitation.status).toBe("REVOKED");

    // Accepting a revoked invite fails with 409
    const acceptRevokedRes = await app.request(
      `/api/v1/invites/${inv1.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({ openToNewBuyers: true }),
      },
    );
    expect(acceptRevokedRes.status).toBe(409);

    // 2. Create second invite, verify self-accept rejected (400), then Org B accepts
    const inv2Res = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: tier1Fac.facilityId,
        inviteeEmail: "partner@helsinki-alloys.fi",
      }),
    });
    expect(inv2Res.status).toBe(201);
    const inv2 = CreateInviteResponseSchema.parse(await inv2Res.json());

    // Self-acceptance by Org A is rejected with 400
    const selfAcceptRes = await app.request(
      `/api/v1/invites/${inv2.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
        body: JSON.stringify({ openToNewBuyers: true }),
      },
    );
    expect(selfAcceptRes.status).toBe(400);

    // Org B accepts with refined coordinates and directory opt-in
    const acceptRes = await app.request(
      `/api/v1/invites/${inv2.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({
          openToNewBuyers: true,
          capabilities: ["Precision CNC", "Nordic Aluminum"],
          refinedSite: {
            kind: "FACTORY",
            lat: 60.2055,
            lng: 24.6559,
            countryCode: "FI",
          },
        }),
      },
    );
    expect(acceptRes.status).toBe(200);
    const accepted = AcceptInviteResponseSchema.parse(await acceptRes.json());
    expect(accepted.invitation.status).toBe("ACCEPTED");
    expect(accepted.organization.openToNewBuyers).toBe(true);
    expect(accepted.organization.capabilities).toEqual([
      "Precision CNC",
      "Nordic Aluminum",
    ]);

    // Replaying the one-time token fails with 409
    const replayRes = await app.request(
      `/api/v1/invites/${inv2.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({ openToNewBuyers: true }),
      },
    );
    expect(replayRes.status).toBe(409);

    // Revoking an already accepted invite fails with 409
    const revokeAcceptedRes = await app.request(
      `/api/v1/invites/${inv2.invitation.inviteId}`,
      {
        method: "DELETE",
        headers: { Cookie: orgA.cookie },
      },
    );
    expect(revokeAcceptedRes.status).toBe(409);

    // GET /api/v1/invites lists Org A's invites without exposing raw tokens
    const listRes = await app.request("/api/v1/invites", {
      headers: { Cookie: orgA.cookie },
    });
    expect(listRes.status).toBe(200);
    const rawListText = await listRes.text();
    expect(rawListText).not.toContain(inv2.inviteToken);
    const listed = ListInvitesResponseSchema.parse(JSON.parse(rawListText));
    expect(listed.invitations).toHaveLength(2);

    // Org A's Tier-1 facility now has isPartnerVerified = true and refined coordinates
    const updatedNetRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: orgA.cookie },
    });
    const updatedNet = WorkspaceNetworkResponseSchema.parse(
      await updatedNetRes.json(),
    );
    const verifiedFac = updatedNet.facilities.find(
      (f) => f.facilityId === tier1Fac.facilityId,
    )!;
    expect(verifiedFac.isPartnerVerified).toBe(true);
    expect(verifiedFac.locationPrecision).toBe("SITE_VERIFIED");
    expect(verifiedFac.lat).toBeCloseTo(60.2055, 4);
    expect(verifiedFac.lng).toBeCloseTo(24.6559, 4);
  });

  it("detects shared hidden upstream chokepoint across two verified Tier-1 partners without leaking Tier-2 identities", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      email: "chokepoint-a@buyer.ee",
      organizationName: "Baltic Assembly AS",
    });
    const orgB1 = await registerOrg(app, {
      email: "b1@supplier1.de",
      organizationName: "Munich Assemblies GmbH",
      countryCode: "DE",
    });
    const orgB2 = await registerOrg(app, {
      email: "b2@supplier2.pl",
      organizationName: "Gdansk Modules Sp. z o.o.",
      countryCode: "PL",
    });

    // Org A sets up HQ + 2 Tier-1 partners (B1 & B2)
    const createFac = async (
      cookie: string,
      payload: Record<string, unknown>,
    ): Promise<string> => {
      const res = await app.request("/api/v1/workspace/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(201);
      const { facility } = (await res.json()) as {
        facility: { facilityId: string };
      };
      return facility.facilityId;
    };

    const aHqId = await createFac(orgA.cookie, {
      name: "Baltic HQ",
      kind: "HQ",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
    });
    const aB1Id = await createFac(orgA.cookie, {
      name: "Munich Assemblies",
      kind: "FACTORY",
      countryCode: "DE",
      lat: 48.1351,
      lng: 11.582,
      isOwnFacility: false,
    });
    const aB2Id = await createFac(orgA.cookie, {
      name: "Gdansk Modules",
      kind: "FACTORY",
      countryCode: "PL",
      lat: 54.352,
      lng: 18.6466,
      isOwnFacility: false,
    });

    for (const fromId of [aB1Id, aB2Id]) {
      const laneRes = await app.request("/api/v1/workspace/lanes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
        body: JSON.stringify({
          fromFacilityId: fromId,
          toFacilityId: aHqId,
          materialCategory: "Control Boards",
          transportMode: "ROAD",
          volumeSharePct: 50,
          annualVolume: 200,
          volumeUnit: "TONNES",
          riskStatus: "GREEN",
        }),
      });
      expect(laneRes.status).toBe(201);
    }

    // Both B1 and B2 secretly source from CN (shared upstream chokepoint)
    for (const [partner, secretName] of [
      [orgB1, "Hidden Shenzhen Fab Alpha"],
      [orgB2, "Hidden Shenzhen Fab Beta"],
    ] as const) {
      const ownId = await createFac(partner.cookie, {
        name: "Partner Factory",
        kind: "FACTORY",
        countryCode: "DE",
        lat: 50.0,
        lng: 10.0,
        isOwnFacility: true,
      });
      const hiddenId = await createFac(partner.cookie, {
        name: secretName,
        kind: "FACTORY",
        countryCode: "CN",
        lat: 22.5431,
        lng: 114.0579,
        isOwnFacility: false,
        estimatedScope12Tco2e: 310,
      });
      const laneRes = await app.request("/api/v1/workspace/lanes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: partner.cookie,
        },
        body: JSON.stringify({
          fromFacilityId: hiddenId,
          toFacilityId: ownId,
          materialCategory: "Microcontrollers",
          transportMode: "SEA",
          volumeSharePct: 100,
          annualVolume: 150,
          volumeUnit: "TONNES",
          riskStatus: "GREEN",
        }),
      });
      expect(laneRes.status).toBe(201);
    }

    // Org A invites both B1 and B2 and both accept
    for (const [targetFacilityId, partner, email] of [
      [aB1Id, orgB1, "b1@supplier1.de"],
      [aB2Id, orgB2, "b2@supplier2.pl"],
    ] as const) {
      const invRes = await app.request("/api/v1/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
        body: JSON.stringify({ targetFacilityId, inviteeEmail: email }),
      });
      const { inviteToken } = CreateInviteResponseSchema.parse(
        await invRes.json(),
      );
      const accRes = await app.request(`/api/v1/invites/${inviteToken}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: partner.cookie,
        },
        body: JSON.stringify({ openToNewBuyers: false }),
      });
      expect(accRes.status).toBe(200);
    }

    // Org A's analytics summary should surface a RED SHARED_UPSTREAM_CHOKEPOINT alert
    const summaryRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: orgA.cookie },
    });
    expect(summaryRes.status).toBe(200);
    const rawText = await summaryRes.text();
    const summary = AnalyticsSummarySchema.parse(JSON.parse(rawText));

    const chokepointAlert = summary.alerts.find(
      (a) => a.category === "SHARED_UPSTREAM_CHOKEPOINT",
    );
    expect(chokepointAlert).toBeDefined();
    expect(chokepointAlert?.severity).toBe("RED");
    expect(chokepointAlert?.confidence).toBe("NETWORK_VERIFIED");
    expect(chokepointAlert?.affectedRegionCode).toBe("CN");
    expect(chokepointAlert?.affectedTier1FacilityIds).toHaveLength(2);
    expect(chokepointAlert?.affectedTier1FacilityIds).toContain(aB1Id);
    expect(chokepointAlert?.affectedTier1FacilityIds).toContain(aB2Id);

    // Zero leakage of hidden Tier-2 names or coordinates
    expect(rawText).not.toContain("Hidden Shenzhen Fab Alpha");
    expect(rawText).not.toContain("Hidden Shenzhen Fab Beta");
    expect(rawText).not.toContain("22.5431");
    expect(rawText).not.toContain("114.0579");
  });

  it("queries GET /api/v1/directory/alternatives with seeded EU/Nordic & opt-in Kulgo orgs and filters", async () => {
    const app = createTestApp();
    const buyer = await registerOrg(app, {
      email: "buyer@estonia-dir.ee",
      organizationName: "Estonia Buyer Dir AS",
      countryCode: "EE",
    });
    const optInSupplier = await registerOrg(app, {
      email: "sales@nordic-pcb.fi",
      organizationName: "Nordic Opt-In PCB Oy",
      countryCode: "FI",
      sector: "Electronics",
    });

    // Buyer creates a Tier-1 facility & invites optInSupplier so it opts into the directory
    const facRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        name: "Nordic PCB Placeholder",
        kind: "FACTORY",
        countryCode: "FI",
        lat: 60.17,
        lng: 24.94,
        isOwnFacility: false,
      }),
    });
    const { facility } = (await facRes.json()) as {
      facility: { facilityId: string };
    };
    const invRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        targetFacilityId: facility.facilityId,
        inviteeEmail: "sales@nordic-pcb.fi",
      }),
    });
    const { inviteToken } = CreateInviteResponseSchema.parse(await invRes.json());
    await app.request(`/api/v1/invites/${inviteToken}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: optInSupplier.cookie,
      },
      body: JSON.stringify({
        openToNewBuyers: true,
        capabilities: ["High-Density PCB", "Precision Electronics"],
      }),
    });

    // Query all alternatives as buyer
    const allRes = await app.request("/api/v1/directory/alternatives", {
      headers: { Cookie: buyer.cookie },
    });
    expect(allRes.status).toBe(200);
    const allDir = DirectoryAlternativesResponseSchema.parse(await allRes.json());
    expect(
      allDir.candidates.some(
        (c) =>
          c.orgId === optInSupplier.orgId && c.source === "KULGO_DIRECTORY",
      ),
    ).toBe(true);
    expect(
      allDir.candidates.some((c) => c.source === "SEEDED_DIRECTORY"),
    ).toBe(true);
    // Buyer never sees itself
    expect(allDir.candidates.some((c) => c.orgId === buyer.orgId)).toBe(false);

    // Filter by countryCode=FI and capability=PCB
    const filteredRes = await app.request(
      "/api/v1/directory/alternatives?countryCode=FI&capability=PCB&excludeRed=true",
      { headers: { Cookie: buyer.cookie } },
    );
    expect(filteredRes.status).toBe(200);
    const filtered = DirectoryAlternativesResponseSchema.parse(
      await filteredRes.json(),
    );
    expect(filtered.candidates.length).toBeGreaterThanOrEqual(2);
    for (const candidate of filtered.candidates) {
      expect(candidate.countryCode).toBe("FI");
      expect(candidate.riskStatus).not.toBe("RED");
    }

    // Invalid countryCode returns 400
    const badRes = await app.request(
      "/api/v1/directory/alternatives?countryCode=INVALID",
      { headers: { Cookie: buyer.cookie } },
    );
    expect(badRes.status).toBe(400);
  });
});
