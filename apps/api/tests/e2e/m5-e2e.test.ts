import {
  AddOrgMemberResponseSchema,
  AnalyticsSummarySchema,
  AuthMeResponseSchema,
  ListOrgMembersResponseSchema,
  RemoveOrgMemberResponseSchema,
  UpdateOrganizationProfileResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../src/app.js";
import {
  DEFAULT_ARCADEDB_PASSWORD,
  DEFAULT_SESSION_SECRET,
  loadConfig,
} from "../../src/config.js";
import type { RequestLogEntry } from "../../src/middleware/security.js";

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
      password: "M5MilestonePassword2026!",
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

describe("Milestone 5 E2E — Production Hardening, Security & Org Team RBAC", () => {
  it("enforces strong non-default SESSION_SECRET and ARCADEDB_PASSWORD when NODE_ENV=production", () => {
    // Rejects default values in production
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        SESSION_SECRET: DEFAULT_SESSION_SECRET,
        ARCADEDB_PASSWORD: DEFAULT_ARCADEDB_PASSWORD,
      }),
    ).toThrow(/SESSION_SECRET/);

    // Rejects weak/short SESSION_SECRET
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "too-short-secret-123",
        ARCADEDB_PASSWORD: "V3ryStr0ng!ArcadeDb#2026",
      }),
    ).toThrow(/SESSION_SECRET/);

    // Rejects weak/placeholder ARCADEDB_PASSWORD
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "9f8c2a7e4b1d6f3a8c5e2b7d9a4f1c6e8b3d5a7f2c4e",
        ARCADEDB_PASSWORD: "ci-test-password",
      }),
    ).toThrow(/ARCADEDB_PASSWORD/);

    // Accepts strong production credentials
    const prodConfig = loadConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "9f8c2a7e4b1d6f3a8c5e2b7d9a4f1c6e8b3d5a7f2c4e",
      ARCADEDB_PASSWORD: "V3ryStr0ng!ArcadeDb#2026",
    });
    expect(prodConfig.NODE_ENV).toBe("production");
    expect(prodConfig.RATE_LIMIT_AUTH_MAX).toBeGreaterThan(0);
    expect(prodConfig.RATE_LIMIT_IMPORT_MAX).toBeGreaterThan(0);

    // Defaults to disabled rate limiting in NODE_ENV=test
    const testConfig = loadConfig({ NODE_ENV: "test" });
    expect(testConfig.RATE_LIMIT_AUTH_MAX).toBe(0);
    expect(testConfig.RATE_LIMIT_IMPORT_MAX).toBe(0);
  });

  it("enforces configurable in-memory rate limits on auth login, auth register, and bulk import", async () => {
    const app = createTestApp({
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_AUTH_MAX: 2,
      RATE_LIMIT_IMPORT_MAX: 1,
    });

    // 1. Rate-limit /api/v1/auth/register after 2 attempts from same IP
    const reg1 = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({
        email: "rl1@estonia-ops.ee",
        password: "RateLimitPassword2026!",
        organizationName: "RateLimit Org 1",
      }),
    });
    expect(reg1.status).toBe(201);
    expect(reg1.headers.get("x-ratelimit-limit")).toBe("2");
    expect(reg1.headers.get("x-ratelimit-remaining")).toBe("1");
    const cookie = extractCookie(reg1);

    const reg2 = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({
        email: "rl2@estonia-ops.ee",
        password: "RateLimitPassword2026!",
        organizationName: "RateLimit Org 2",
      }),
    });
    expect(reg2.status).toBe(201);
    expect(reg2.headers.get("x-ratelimit-remaining")).toBe("0");

    const reg3 = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({
        email: "rl3@estonia-ops.ee",
        password: "RateLimitPassword2026!",
        organizationName: "RateLimit Org 3",
      }),
    });
    expect(reg3.status).toBe(429);
    expect(Number(reg3.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // 2. Rate-limit /api/v1/auth/login independently
    for (let i = 0; i < 2; i++) {
      const loginAttempt = await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.20",
        },
        body: JSON.stringify({
          email: "rl1@estonia-ops.ee",
          password: "WrongPassword123!",
        }),
      });
      expect(loginAttempt.status).toBe(401);
    }
    const loginBlocked = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.20",
      },
      body: JSON.stringify({
        email: "rl1@estonia-ops.ee",
        password: "RateLimitPassword2026!",
      }),
    });
    expect(loginBlocked.status).toBe(429);

    // 3. Rate-limit /api/v1/workspace/import after 1 attempt
    const importPayload = JSON.stringify({
      facilities: [
        {
          name: "Tallinn Hub",
          countryCode: "EE",
          lat: 59.437,
          lng: 24.7536,
        },
      ],
    });
    const imp1 = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-Forwarded-For": "203.0.113.30",
      },
      body: importPayload,
    });
    expect(imp1.status).toBe(200);

    const imp2 = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-Forwarded-For": "203.0.113.30",
      },
      body: importPayload,
    });
    expect(imp2.status).toBe(429);
  });

  it("enforces JSON and CSV/import payload byte size limits with 413 Payload Too Large", async () => {
    const app = createTestApp({
      MAX_JSON_BODY_BYTES: 1024,
      MAX_IMPORT_BODY_BYTES: 2048,
    });
    const org = await registerOrg(app, "size@tallinn-ops.ee", "Size Limit AS");

    // Oversized standard JSON payload -> 413
    const hugeDescription = "A".repeat(1500);
    const oversizedJsonRes = await app.request("/api/v1/workspace/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org.cookie },
      body: JSON.stringify({ name: "Widget", description: hugeDescription }),
    });
    expect(oversizedJsonRes.status).toBe(413);

    // Oversized CSV import payload -> 413
    const hugeCsv =
      "recordType,name,countryCode,lat,lng\n" +
      "FACILITY,Tallinn Hub,EE,59.437,24.7536\n".repeat(80);
    const oversizedCsvRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: org.cookie },
      body: hugeCsv,
    });
    expect(oversizedCsvRes.status).toBe(413);
  });

  it("emits structured JSON request logs and never logs passwords, session cookies, or invite tokens", async () => {
    const logs: RequestLogEntry[] = [];
    const app = createTestApp({}, { onRequestLog: (entry) => logs.push(entry) });

    const secretPassword = "SuperSecretPasswordDoNotLog99!";
    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "logger@estonia-ops.ee",
        password: secretPassword,
        organizationName: "Structured Log AS",
      }),
    });
    expect(regRes.status).toBe(201);
    const cookie = extractCookie(regRes);
    const sessionTokenValue = cookie.replace("kulgo_session=", "");

    // Create facility + partner invite, then attempt accept with token in path
    const facRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Supplier Node",
        countryCode: "FI",
        lat: 60.1699,
        lng: 24.9384,
        isOwnFacility: false,
      }),
    });
    const { facility } = (await facRes.json()) as {
      facility: { facilityId: string };
    };

    const invRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        targetFacilityId: facility.facilityId,
        inviteeEmail: "partner@nordic.fi",
      }),
    });
    const { inviteToken } = (await invRes.json()) as { inviteToken: string };

    await app.request(`/api/v1/invites/${inviteToken}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });

    expect(logs.length).toBeGreaterThanOrEqual(4);
    for (const entry of logs) {
      expect(entry.event).toBe("http_request");
      expect(typeof entry.method).toBe("string");
      expect(typeof entry.path).toBe("string");
      expect(typeof entry.status).toBe("number");
      expect(typeof entry.latencyMs).toBe("number");
      expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
    }

    const acceptLog = logs.find((l) => l.path.includes("/accept"));
    expect(acceptLog?.path).toBe("/api/v1/invites/[REDACTED]/accept");

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(secretPassword);
    expect(serializedLogs).not.toContain(sessionTokenValue);
    expect(serializedLogs).not.toContain(inviteToken);
  });

  it("supports Org Team Members lifecycle, OWNER/MEMBER RBAC, last-OWNER protection, and session revocation on removal", async () => {
    const app = createTestApp();
    const owner = await registerOrg(
      app,
      "owner@tallinn-team.ee",
      "Tallinn Team AS",
    );

    // 1. GET /api/v1/auth/members returns initial OWNER (without passwordHash)
    const initialListRes = await app.request("/api/v1/auth/members", {
      headers: { Cookie: owner.cookie },
    });
    expect(initialListRes.status).toBe(200);
    const initialRaw = await initialListRes.text();
    expect(initialRaw).not.toContain("passwordHash");
    const initialList = ListOrgMembersResponseSchema.parse(
      JSON.parse(initialRaw),
    );
    expect(initialList.members).toHaveLength(1);
    expect(initialList.members[0]?.role).toBe("OWNER");

    // 2. Last OWNER cannot remove themselves -> 400
    const selfRemoveRes = await app.request(
      `/api/v1/auth/members/${owner.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      },
    );
    expect(selfRemoveRes.status).toBe(400);

    // 3. OWNER adds a MEMBER and a second OWNER
    const addMemberRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        email: "analyst@tallinn-team.ee",
        password: "AnalystSecurePassword2026!",
        role: "MEMBER",
      }),
    });
    expect(addMemberRes.status).toBe(201);
    const { member: analyst } = AddOrgMemberResponseSchema.parse(
      await addMemberRes.json(),
    );
    expect(analyst.orgId).toBe(owner.orgId);
    expect(analyst.role).toBe("MEMBER");

    const addSecondOwnerRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        email: "co-owner@tallinn-team.ee",
        password: "CoOwnerSecurePassword2026!",
        role: "OWNER",
      }),
    });
    expect(addSecondOwnerRes.status).toBe(201);
    const { member: coOwner } = AddOrgMemberResponseSchema.parse(
      await addSecondOwnerRes.json(),
    );
    expect(coOwner.role).toBe("OWNER");

    // 4. MEMBER logs in and can view/edit org workspace & analytics
    const memberLoginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "analyst@tallinn-team.ee",
        password: "AnalystSecurePassword2026!",
      }),
    });
    expect(memberLoginRes.status).toBe(200);
    const memberCookie = extractCookie(memberLoginRes);

    const memberSeedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: memberCookie },
    });
    expect(memberSeedRes.status).toBe(201);

    const memberAnalyticsRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: memberCookie },
    });
    expect(memberAnalyticsRes.status).toBe(200);
    AnalyticsSummarySchema.parse(await memberAnalyticsRes.json());

    const memberListRes = await app.request("/api/v1/auth/members", {
      headers: { Cookie: memberCookie },
    });
    expect(memberListRes.status).toBe(200);
    const memberList = ListOrgMembersResponseSchema.parse(
      await memberListRes.json(),
    );
    expect(memberList.members).toHaveLength(3);

    // 5. MEMBER is forbidden (403) from OWNER-only endpoints
    const memberPatchOrgRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: JSON.stringify({ scope1Tco2e: 500 }),
    });
    expect(memberPatchOrgRes.status).toBe(403);

    const memberAddRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: JSON.stringify({
        email: "unauth-add@tallinn-team.ee",
        password: "AnotherPassword2026!",
        role: "MEMBER",
      }),
    });
    expect(memberAddRes.status).toBe(403);

    const memberDelRes = await app.request(
      `/api/v1/auth/members/${coOwner.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: memberCookie },
      },
    );
    expect(memberDelRes.status).toBe(403);

    // 6. OWNER can update Org ESG settings
    const ownerPatchOrgRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ scope1Tco2e: 250, scope2Tco2e: 90 }),
    });
    expect(ownerPatchOrgRes.status).toBe(200);
    const patchedOrg = UpdateOrganizationProfileResponseSchema.parse(
      await ownerPatchOrgRes.json(),
    );
    expect(patchedOrg.organization.scope1Tco2e).toBe(250);

    // 7. OWNER removes MEMBER -> MEMBER's existing session is immediately invalidated (401)
    const removeMemberRes = await app.request(
      `/api/v1/auth/members/${analyst.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      },
    );
    expect(removeMemberRes.status).toBe(200);
    const removed = RemoveOrgMemberResponseSchema.parse(
      await removeMemberRes.json(),
    );
    expect(removed.removedUserId).toBe(analyst.userId);

    const revokedMemberMe = await app.request("/api/v1/auth/me", {
      headers: { Cookie: memberCookie },
    });
    expect(revokedMemberMe.status).toBe(401);

    // 8. OWNER removes co-owner (succeeds because 2 owners exist), then cannot remove self (last owner)
    const removeCoOwnerRes = await app.request(
      `/api/v1/auth/members/${coOwner.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      },
    );
    expect(removeCoOwnerRes.status).toBe(200);

    const lastOwnerRemoveRes = await app.request(
      `/api/v1/auth/members/${owner.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      },
    );
    expect(lastOwnerRemoveRes.status).toBe(400);
  });
});
