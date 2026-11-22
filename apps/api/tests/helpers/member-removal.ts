import { randomUUID } from "node:crypto";
import { AddOrgMemberResponseSchema, AuthMeResponseSchema, ListAuditEventsResponseSchema, ListOrgMembersResponseSchema } from "@kulgo/shared";
import type { Hono } from "hono";
import { expect } from "vitest";

function cookie(response: Response): string {
  const token = /kulgo_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error("Expected session cookie");
  return `kulgo_session=${token}`;
}

// Shared opaque-box regression for memory and live ArcadeDB, including separate
// app instances so database safety cannot depend on an application-local mutex.
export async function verifyConcurrentOwnerRemoval(app: Hono, otherApp = app): Promise<void> {
  const suffix = randomUUID();
  const password = "ConcurrentOwnerPassword2026!";
  const registration = await app.request("/api/v1/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `owner-${suffix}@example.ee`, password,
      organizationName: "Concurrent owners", countryCode: "EE", sector: "Electronics" }),
  });
  expect(registration.status).toBe(201);
  const first = AuthMeResponseSchema.parse(await registration.json()).user;
  const firstCookie = cookie(registration);
  const email = `co-owner-${suffix}@example.ee`;
  const added = await app.request("/api/v1/auth/members", {
    method: "POST", headers: { Cookie: firstCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, role: "OWNER" }),
  });
  expect(added.status).toBe(201);
  const second = AddOrgMemberResponseSchema.parse(await added.json()).member;
  const login = await otherApp.request("/api/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const secondCookie = cookie(login);

  const results = await Promise.all([
    app.request(`/api/v1/auth/members/${second.userId}`, { method: "DELETE", headers: { Cookie: firstCookie } }),
    otherApp.request(`/api/v1/auth/members/${first.userId}`, { method: "DELETE", headers: { Cookie: secondCookie } }),
  ]);
  expect(results.filter((res) => res.status === 200)).toHaveLength(1);
  // The loser can reach the invariant check, or find its session already revoked.
  expect([400, 401]).toContain(results.find((res) => res.status !== 200)?.status);
  const survivorCookie = results[0]!.status === 200 ? firstCookie : secondCookie;
  const removedCookie = results[0]!.status === 200 ? secondCookie : firstCookie;
  const removed = results[0]!.status === 200 ? second : first;
  expect((await app.request("/api/v1/auth/me", { headers: { Cookie: survivorCookie } })).status).toBe(200);
  expect((await otherApp.request("/api/v1/auth/me", { headers: { Cookie: removedCookie } })).status).toBe(401);
  const members = ListOrgMembersResponseSchema.parse(await (await app.request("/api/v1/auth/members", { headers: { Cookie: survivorCookie } })).json()).members;
  expect(members).toHaveLength(1);
  expect(members[0]!.role).toBe("OWNER");
  expect((await app.request(`/api/v1/auth/members/${members[0]!.userId}`, { method: "DELETE", headers: { Cookie: survivorCookie } })).status).toBe(400);
  const events = ListAuditEventsResponseSchema.parse(await (await app.request("/api/v1/auth/audit-log", { headers: { Cookie: survivorCookie } })).json()).events.filter((event) => event.action === "MEMBER_REMOVED");
  expect(events).toHaveLength(1);
  expect(events[0]!.metadata).toEqual({ removedUserId: removed.userId, removedEmail: removed.email, role: "OWNER" });
}
