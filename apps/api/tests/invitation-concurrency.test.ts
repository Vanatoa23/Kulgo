import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";
import { InMemoryInvitationRepository, InviteStateError } from "../src/invites/repository.js";
import { createInvitationFixture, invitationConcurrencyCases } from "./invitation-concurrency-cases.js";

function setup() {
  const auth = new InMemoryAuthRepository();
  const workspace = new InMemoryWorkspaceRepository();
  return { auth, workspace, invites: new InMemoryInvitationRepository({ authRepo: auth, workspaceRepo: workspace }) };
}

afterEach(() => vi.restoreAllMocks());

describe("In-memory invitation concurrency", () => {
  invitationConcurrencyCases(setup);

  it("rechecks expiry after asynchronous validation", async () => {
    const f = await createInvitationFixture(setup());
    const invite = await f.create();
    const findOrg = f.auth.findOrganizationById.bind(f.auth);
    vi.spyOn(f.auth, "findOrganizationById").mockImplementation(async orgId => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(invite.invitation.expiresAt));
      return findOrg(orgId);
    });
    await expect(f.invites.acceptInvite(invite.inviteToken, f.supplier1, {})).rejects.toBeInstanceOf(InviteStateError);
    expect(await f.invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(0);
    expect((await f.workspace.getFacilityById(f.buyer, f.facility.facilityId))!.isPartnerVerified).toBe(false);
  });

  it("does not consume an invite when facility verification fails, and releases the transition lock", async () => {
    const f = await createInvitationFixture(setup());
    const invite = await f.create();
    vi.spyOn(f.workspace, "markFacilityPartnerVerified").mockRejectedValueOnce(new Error("verification failed"));
    await expect(f.invites.acceptInvite(invite.inviteToken, f.supplier1, {})).rejects.toThrow("verification failed");
    expect((await f.invites.listInvitesByOrg(f.buyer))[0]!.status).toBe("PENDING");
    expect(await f.invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(0);
    await f.invites.acceptInvite(invite.inviteToken, f.supplier1, {});
    expect(await f.invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(1);
  });
});
