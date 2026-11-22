import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AuthRepository } from "../src/auth/repository.js";
import { InviteStateError, type InvitationRepository } from "../src/invites/repository.js";
import type { WorkspaceRepository } from "../src/workspace/repository.js";

export type InvitationTestRepos = {
  auth: AuthRepository;
  workspace: WorkspaceRepository;
  invites: InvitationRepository;
  competingInvites?: InvitationRepository;
};

export async function createInvitationFixture(repos: InvitationTestRepos) {
  const orgs = await Promise.all(["buyer", "supplier1", "supplier2"].map(async (name) => {
    const result = await repos.auth.createOrganizationAndOwner({
      email: `${name}-${randomUUID()}@test.ee`, passwordHash: "unused",
      organizationName: name, countryCode: "EE", sector: "Manufacturing",
    });
    return result.organization.orgId;
  }));
  const [buyer, supplier1, supplier2] = orgs as [string, string, string];
  const facility = await repos.workspace.createFacility(buyer, {
    name: "Supplier placeholder", kind: "HQ", locationPrecision: "HQ_ESTIMATED",
    countryCode: "EE", lat: 59, lng: 24, isOwnFacility: false,
  });
  const create = () => repos.invites.createInvite(buyer, {
    targetFacilityId: facility.facilityId, inviteeEmail: "supplier@test.ee",
  }, "http://localhost");
  return { ...repos, competitor: repos.competingInvites ?? repos.invites,
    buyer, supplier1, supplier2, facility, create };
}

export function invitationConcurrencyCases(setup: (race?: boolean) => InvitationTestRepos) {
  const fixture = (race = false) => createInvitationFixture(setup(race));

  it("preserves fulfilling-facility binding, refined coordinates, and directory opt-in", async () => {
    const f = await fixture();
    const own = await f.workspace.createFacility(f.supplier1, {
      name: "Fulfilling site", kind: "FACTORY", locationPrecision: "SITE_VERIFIED",
      countryCode: "FI", lat: 60, lng: 25, isOwnFacility: true,
    });
    const invite = await f.create();
    const accepted = await f.invites.acceptInvite(invite.inviteToken, f.supplier1, {
      fulfilledByFacilityId: own.facilityId, openToNewBuyers: true,
      capabilities: ["Precision assembly"],
      refinedSite: { kind: "FACTORY", countryCode: "FI", lat: 60, lng: 25 },
    });
    expect(accepted.organization.openToNewBuyers).toBe(true);
    expect(accepted.organization.capabilities).toEqual(["Precision assembly"]);
    const [link] = await f.invites.listVerifiedPartnerLinksForOrg(f.buyer);
    expect(link!.fulfilledByFacilityId).toBe(own.facilityId);
    expect(await f.workspace.getFacilityById(f.buyer, f.facility.facilityId)).toMatchObject({
      isPartnerVerified: true, kind: "FACTORY", locationPrecision: "SITE_VERIFIED",
      lat: 60, lng: 25, countryCode: "FI",
    });
  });

  it("rejects a revoked token without consuming another invitation to the facility", async () => {
    const f = await fixture();
    const revoked = await f.create();
    const pending = await f.create();
    await f.invites.revokeInvite(f.buyer, revoked.invitation.inviteId);
    await expect(f.invites.acceptInvite(revoked.inviteToken, f.supplier1, {})).rejects.toBeInstanceOf(InviteStateError);
    expect(await f.invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(0);
    await f.invites.acceptInvite(pending.inviteToken, f.supplier2, {});
    expect((await f.invites.listVerifiedPartnerLinksForOrg(f.buyer))[0]!.partnerOrgId).toBe(f.supplier2);
  });

  for (const distinctTokens of [false, true]) {
    it(`atomically accepts ${distinctTokens ? "distinct tokens for one facility" : "the same token"} only once`, async () => {
      const f = await fixture(true);
      const first = await f.create();
      const second = distinctTokens ? await f.create() : first;
      const results = await Promise.allSettled([
        f.invites.acceptInvite(first.inviteToken, f.supplier1, {}),
        f.competitor.acceptInvite(second.inviteToken, f.supplier2, {}),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(InviteStateError);
      const invitations = await f.invites.listInvitesByOrg(f.buyer);
      expect(invitations.filter(i => i.status === "ACCEPTED")).toHaveLength(1);
      if (distinctTokens) expect(invitations.filter(i => i.status === "PENDING")).toHaveLength(1);
      const links = await f.invites.listVerifiedPartnerLinksForOrg(f.buyer);
      expect(links).toHaveLength(1);
      expect(links[0]!.inviteId).toBe(invitations.find(i => i.status === "ACCEPTED")!.inviteId);
      const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<InvitationRepository["acceptInvite"]>>>;
      expect(links[0]!.partnerOrgId).toBe(winner.value.organization.orgId);
      expect((await f.workspace.getFacilityById(f.buyer, f.facility.facilityId))!.isPartnerVerified).toBe(true);
    });
  }

  for (const revokeFirst of [false, true]) {
    it(`commits only one accept/revoke transition (${revokeFirst ? "revoke" : "accept"} starts first)`, async () => {
      const f = await fixture(true);
      const invite = await f.create();
      const accept = () => f.invites.acceptInvite(invite.inviteToken, f.supplier1, {});
      const revoke = () => f.competitor.revokeInvite(f.buyer, invite.invitation.inviteId);
      const results = await Promise.allSettled(revokeFirst ? [revoke(), accept()] : [accept(), revoke()]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(InviteStateError);
      const [stored] = await f.invites.listInvitesByOrg(f.buyer);
      const links = await f.invites.listVerifiedPartnerLinksForOrg(f.buyer);
      expect(["ACCEPTED", "REVOKED"]).toContain(stored!.status);
      expect(links).toHaveLength(stored!.status === "ACCEPTED" ? 1 : 0);
      expect((await f.workspace.getFacilityById(f.buyer, f.facility.facilityId))!.isPartnerVerified).toBe(stored!.status === "ACCEPTED");
    });
  }
}
