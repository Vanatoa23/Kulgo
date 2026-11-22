import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AuthRepository } from "../../src/auth/repository.js";

export function memberRemovalCases(createRepositories: () => [AuthRepository, AuthRepository]): void {
  async function fixture(ownerCount: number) {
    const [repo, competitor] = createRepositories();
    const { user: owner, organization } = await repo.createOrganizationAndOwner({
      email: `${randomUUID()}@example.ee`, passwordHash: "test-only",
      organizationName: "Owner invariant", countryCode: "EE", sector: "Electronics",
    });
    const owners = [owner];
    for (let i = 1; i < ownerCount; i++) {
      owners.push(await repo.createOrgMember({ orgId: organization.orgId,
        email: `${randomUUID()}@example.ee`, passwordHash: "test-only", role: "OWNER" }));
    }
    const sessions = [];
    for (const user of owners) {
      sessions.push(await repo.createSession({ userId: user.userId, orgId: user.orgId,
        tokenHash: randomUUID(), expiresAt: "2099-01-01T00:00:00.000Z" }));
    }
    return { repo, competitor, owners, sessions, owner, orgId: organization.orgId };
  }

  it("protects a sole owner at the repository boundary without changing sessions or audit", async () => {
    const f = await fixture(1);
    expect(await f.repo.deleteOrgMember(f.orgId, f.owner.userId, f.owner)).toBe("last_owner");
    expect(await f.repo.deleteOrgMember(randomUUID(), f.owner.userId, f.owner)).toBe("not_found");
    expect(await f.repo.findUserById(f.owner.userId)).toEqual(f.owner);
    expect(await f.repo.findSessionByTokenHash(f.sessions[0]!.tokenHash)).not.toBeNull();
    expect(await f.repo.listAuditEvents(f.orgId)).toEqual([]);
  });

  it.each([2, 3, 6])("preserves exactly one owner under %i concurrent repository removals", async (count) => {
    const f = await fixture(count);
    const results = await Promise.all(f.owners.map((user, i) =>
      (i % 2 ? f.competitor : f.repo).deleteOrgMember(f.orgId, user.userId, user)));
    expect(results.filter((result) => result === "deleted")).toHaveLength(count - 1);
    expect(results.filter((result) => result === "last_owner")).toHaveLength(1);
    const remaining = await f.repo.listOrgMembers(f.orgId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.role).toBe("OWNER");
    for (const session of f.sessions) {
      const stored = await f.repo.findSessionByTokenHash(session.tokenHash);
      expect(stored !== null).toBe(session.userId === remaining[0]!.userId);
    }
    const events = await f.repo.listAuditEvents(f.orgId);
    expect(events).toHaveLength(count - 1);
    expect(new Set(events.map((event) => event.metadata.removedUserId)).size).toBe(count - 1);
    expect(events.every((event) => event.action === "MEMBER_REMOVED")).toBe(true);
  });

  it("removes a non-owner only once under duplicate requests, revoking all its sessions", async () => {
    const f = await fixture(1);
    const member = await f.repo.createOrgMember({ orgId: f.orgId,
      email: `${randomUUID()}@example.ee`, passwordHash: "test-only", role: "MEMBER" });
    const sessions = [];
    for (let i = 0; i < 2; i++) sessions.push(await f.repo.createSession({
      userId: member.userId, orgId: f.orgId, tokenHash: randomUUID(), expiresAt: "2099-01-01T00:00:00.000Z" }));
    const results = await Promise.all([f.repo, f.competitor].map((repo) =>
      repo.deleteOrgMember(f.orgId, member.userId, f.owner)));
    expect(results.sort()).toEqual(["deleted", "not_found"]);
    for (const session of sessions) expect(await f.repo.findSessionByTokenHash(session.tokenHash)).toBeNull();
    expect(await f.repo.listOrgMembers(f.orgId)).toEqual([f.owner]);
    const events = await f.repo.listAuditEvents(f.orgId);
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ removedUserId: member.userId, removedEmail: member.email, role: "MEMBER" });
  });
}
