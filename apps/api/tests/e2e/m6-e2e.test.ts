import {
  AcceptInviteResponseSchema,
  AddOrgMemberResponseSchema,
  AuditEventSchema,
  AuthMeResponseSchema,
  BulkImportSummarySchema,
  CreateInviteResponseSchema,
  ExecutiveReportSchema,
  ListAuditEventsResponseSchema,
  RevokeInviteResponseSchema,
  UpdateOrganizationProfileResponseSchema,
  WorkspaceNetworkResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../src/app.js";
import { sanitizeAuditMetadata } from "../../src/auth/audit.js";

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
): Promise<{ cookie: string; orgId: string; userId: string }> {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "M6MilestonePassword2026!",
      organizationName,
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(res.status).toBe(201);
  const body = AuthMeResponseSchema.parse(await res.json());
  return {
    cookie: extractCookie(res),
    orgId: body.organization.orgId,
    userId: body.user.userId,
  };
}

describe("Milestone 6 E2E — Org-Scoped Compliance Audit Log", () => {
  it("records immutable audit events for all 8 compliance & security actions without leaking secrets", async () => {
    const app = createTestApp();
    const owner = await registerOrg(app, "owner@audit-estonia.ee", "Audit Estonia AS");
    const partner = await registerOrg(app, "partner@nordic-supplier.fi", "Nordic Supplier Oy");

    // Seed demo workspace for owner so we have facilities to invite & report on
    const seedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: owner.cookie },
    });
    expect(seedRes.status).toBe(201);
    const network = WorkspaceNetworkResponseSchema.parse(await seedRes.json());
    const supplierFacilities = network.facilities.filter((f) => !f.isOwnFacility);
    expect(supplierFacilities.length).toBeGreaterThanOrEqual(2);
    const targetFacilityA = supplierFacilities[0]!;
    const targetFacilityB = supplierFacilities[1]!;

    // 1. ORG_PROFILE_UPDATED
    const patchRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
      },
      body: JSON.stringify({
        scope1Tco2e: 410,
        scope2Tco2e: 190,
        esgBadges: ["ISO 14001", "CSRD Ready"],
        openToNewBuyers: true,
        capabilities: ["Precision Electronics"],
      }),
    });
    expect(patchRes.status).toBe(200);
    UpdateOrganizationProfileResponseSchema.parse(await patchRes.json());

    // 2. MEMBER_ADDED (secret password must never appear in audit log)
    const memberSecretPassword = "SuperSecretMemberPassword99!";
    const addMemberRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
      },
      body: JSON.stringify({
        email: "analyst@audit-estonia.ee",
        password: memberSecretPassword,
        role: "MEMBER",
      }),
    });
    expect(addMemberRes.status).toBe(201);
    const { member } = AddOrgMemberResponseSchema.parse(await addMemberRes.json());

    // 3. MEMBER_REMOVED
    const removeMemberRes = await app.request(
      `/api/v1/auth/members/${member.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      },
    );
    expect(removeMemberRes.status).toBe(200);

    // 4. BULK_IMPORT_EXECUTED (JSON format — summary counts only)
    const importRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
      },
      body: JSON.stringify({
        facilities: [
          {
            name: "Imported Baltic Hub",
            kind: "WAREHOUSE",
            countryCode: "EE",
            lat: 59.437,
            lng: 24.7536,
            isOwnFacility: false,
          },
        ],
      }),
    });
    expect(importRes.status).toBe(200);
    const importSummary = BulkImportSummarySchema.parse(await importRes.json());
    expect(importSummary.createdFacilities).toBe(1);

    // 5. INVITE_CREATED (invite A to be accepted, invite B to be revoked)
    const inviteARes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
      },
      body: JSON.stringify({
        targetFacilityId: targetFacilityA.facilityId,
        inviteeEmail: "partner@nordic-supplier.fi",
      }),
    });
    expect(inviteARes.status).toBe(201);
    const inviteA = CreateInviteResponseSchema.parse(await inviteARes.json());

    const inviteBRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
      },
      body: JSON.stringify({
        targetFacilityId: targetFacilityB.facilityId,
        inviteeEmail: "revoked@supplier.de",
      }),
    });
    expect(inviteBRes.status).toBe(201);
    const inviteB = CreateInviteResponseSchema.parse(await inviteBRes.json());

    // 6. INVITE_ACCEPTED (by partner org)
    const acceptRes = await app.request(
      `/api/v1/invites/${inviteA.inviteToken}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: partner.cookie,
        },
        body: JSON.stringify({ openToNewBuyers: false }),
      },
    );
    expect(acceptRes.status).toBe(200);
    AcceptInviteResponseSchema.parse(await acceptRes.json());

    // 7. INVITE_REVOKED (by owner org)
    const revokeRes = await app.request(
      `/api/v1/invites/${inviteB.invitation.inviteId}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      },
    );
    expect(revokeRes.status).toBe(200);
    RevokeInviteResponseSchema.parse(await revokeRes.json());

    // 8. CSRD_REPORT_EXPORTED
    const reportRes = await app.request("/api/v1/analytics/report", {
      headers: { Cookie: owner.cookie },
    });
    expect(reportRes.status).toBe(200);
    ExecutiveReportSchema.parse(await reportRes.json());

    // Query Owner's audit log
    const ownerAuditRes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: owner.cookie },
    });
    expect(ownerAuditRes.status).toBe(200);
    const ownerAudit = ListAuditEventsResponseSchema.parse(
      await ownerAuditRes.json(),
    );

    const ownerActions = ownerAudit.events.map((e) => e.action);
    // Newest-first ordering: CSRD_REPORT_EXPORTED should be first, ORG_PROFILE_UPDATED last
    expect(ownerActions[0]).toBe("CSRD_REPORT_EXPORTED");
    expect(ownerActions).toContain("INVITE_REVOKED");
    expect(ownerActions).toContain("INVITE_CREATED");
    expect(ownerActions).toContain("BULK_IMPORT_EXECUTED");
    expect(ownerActions).toContain("MEMBER_REMOVED");
    expect(ownerActions).toContain("MEMBER_ADDED");
    expect(ownerActions[ownerActions.length - 1]).toBe("ORG_PROFILE_UPDATED");

    // Verify ?limit= works and respects newest-first
    const limitedRes = await app.request("/api/v1/auth/audit-log?limit=2", {
      headers: { Cookie: owner.cookie },
    });
    expect(limitedRes.status).toBe(200);
    const limited = ListAuditEventsResponseSchema.parse(await limitedRes.json());
    expect(limited.events).toHaveLength(2);
    expect(limited.events[0]!.action).toBe("CSRD_REPORT_EXPORTED");
    expect(limited.events[1]!.action).toBe("INVITE_REVOKED");

    // Verify invalid ?limit= values return 400
    expect(
      (
        await app.request("/api/v1/auth/audit-log?limit=0", {
          headers: { Cookie: owner.cookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/v1/auth/audit-log?limit=101", {
          headers: { Cookie: owner.cookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/v1/auth/audit-log?limit=abc", {
          headers: { Cookie: owner.cookie },
        })
      ).status,
    ).toBe(400);

    // Verify BULK_IMPORT_EXECUTED stores summary counts only (no facility names/coordinates)
    const bulkEvent = ownerAudit.events.find(
      (e) => e.action === "BULK_IMPORT_EXECUTED",
    );
    expect(bulkEvent).toBeDefined();
    expect(bulkEvent!.metadata).toEqual({
      format: "json",
      createdFacilities: 1,
      createdLanes: 0,
      errorCount: 0,
    });

    // Verify zero secrets in serialized owner audit log
    const serializedOwnerAudit = JSON.stringify(ownerAudit);
    expect(serializedOwnerAudit).not.toContain(memberSecretPassword);
    expect(serializedOwnerAudit).not.toContain(inviteA.inviteToken);
    expect(serializedOwnerAudit).not.toContain(inviteB.inviteToken);
    expect(serializedOwnerAudit).not.toContain(owner.cookie.replace("kulgo_session=", ""));
    expect(serializedOwnerAudit).not.toContain("Imported Baltic Hub");

    // Query Partner's audit log -> must contain INVITE_ACCEPTED and never raw inviteToken
    const partnerAuditRes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: partner.cookie },
    });
    expect(partnerAuditRes.status).toBe(200);
    const partnerAudit = ListAuditEventsResponseSchema.parse(
      await partnerAuditRes.json(),
    );
    expect(partnerAudit.events.map((e) => e.action)).toEqual(["INVITE_ACCEPTED"]);
    expect(JSON.stringify(partnerAudit)).not.toContain(inviteA.inviteToken);
  });

  it("enforces OWNER-only access to GET /api/v1/auth/audit-log (401 unauthenticated, 403 for MEMBER)", async () => {
    const app = createTestApp();

    // Unauthenticated -> 401
    const unauthRes = await app.request("/api/v1/auth/audit-log");
    expect(unauthRes.status).toBe(401);

    // Register OWNER and create a MEMBER
    const owner = await registerOrg(app, "rbac-owner@kulgo.ee", "RBAC Audit OU");
    const addRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
      },
      body: JSON.stringify({
        email: "rbac-member@kulgo.ee",
        password: "MemberPassword2026!",
        role: "MEMBER",
      }),
    });
    expect(addRes.status).toBe(201);

    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rbac-member@kulgo.ee",
        password: "MemberPassword2026!",
      }),
    });
    expect(loginRes.status).toBe(200);
    const memberCookie = extractCookie(loginRes);

    // MEMBER -> 403 Forbidden
    const memberAuditRes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: memberCookie },
    });
    expect(memberAuditRes.status).toBe(403);

    // OWNER -> 200 OK
    const ownerAuditRes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: owner.cookie },
    });
    expect(ownerAuditRes.status).toBe(200);
    const audit = ListAuditEventsResponseSchema.parse(await ownerAuditRes.json());
    expect(audit.events.some((e) => e.action === "MEMBER_ADDED")).toBe(true);
  });

  it("sanitizes audit metadata and structurally rejects unexpected fields via strict AuditEventSchema", () => {
    const cleaned = sanitizeAuditMetadata({
      format: "csv",
      createdFacilities: 5,
      // Forbidden keys that must all be stripped:
      password: "raw-password",
      passwordHash: "$argon2id$...",
      inviteToken: "secret-invite-token",
      sessionToken: "secret-session-token",
      cookie: "kulgo_session=abc",
      tier2SupplierName: "Hidden Tier-2 Plant",
      upstreamOrgId: "org-secret",
      partnerOrgId: "partner-secret",
      lat: 59.437,
      lng: 24.7536,
      locationWkt: "POINT(24.7536 59.437)",
      nestedObject: { shouldBeDropped: true },
    });

    expect(cleaned).toEqual({
      format: "csv",
      createdFacilities: 5,
    });

    // Strict AuditEventSchema must reject any extra top-level leaked field
    expect(() =>
      AuditEventSchema.parse({
        eventId: "11111111-1111-4111-8111-111111111111",
        orgId: "22222222-2222-4222-8222-222222222222",
        actorUserId: "33333333-3333-4333-8333-333333333333",
        actorEmail: "owner@example.ee",
        action: "CSRD_REPORT_EXPORTED",
        summary: "Exported CSRD report",
        metadata: {},
        createdAt: new Date().toISOString(),
        leakedTier2Partner: "Forbidden Corp",
      }),
    ).toThrow();
  });
});
