import { AuthMeResponseSchema } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected Set-Cookie header");
  }
  const match = /kulgo_session=([^;]+)/.exec(setCookie);
  if (!match?.[1]) {
    throw new Error(`kulgo_session cookie not found in: ${setCookie}`);
  }
  return `kulgo_session=${match[1]}`;
}

describe("Argon2id password hashing", () => {
  it("hashes in PHC argon2id format and verifies with timing-safe comparison", async () => {
    const hash = await hashPassword("SuperSecretPassword123!");
    expect(hash.startsWith("$argon2id$v=19$")).toBe(true);
    expect(await verifyPassword("SuperSecretPassword123!", hash)).toBe(true);
    expect(await verifyPassword("WrongPassword123!", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-valid-phc-hash")).toBe(false);
  });
});

describe("Auth HTTP API (/api/v1/auth)", () => {
  it("registers a new org and owner, sets HttpOnly session cookie, and never leaks passwordHash", async () => {
    const app = createTestApp();
    const res = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "Founder@Kulgo.ee",
        password: "TallinnSecurePassword2026!",
        organizationName: "Kulgo Precision OU",
        countryCode: "EE",
        sector: "Electronics",
      }),
    });

    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kulgo_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    const rawBody = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(rawBody)).not.toContain("passwordHash");
    const parsed = AuthMeResponseSchema.parse(rawBody);
    expect(parsed.user.email).toBe("founder@kulgo.ee");
    expect(parsed.user.role).toBe("OWNER");
    expect(parsed.organization.name).toBe("Kulgo Precision OU");
    expect(parsed.organization.countryCode).toBe("EE");
  });

  it("rejects duplicate normalized email with 409 and short password with 400", async () => {
    const app = createTestApp();

    const shortPwRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "short@kulgo.ee",
        password: "short",
        organizationName: "Short PW Corp",
      }),
    });
    expect(shortPwRes.status).toBe(400);

    const firstRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ops@baltic-mfg.ee",
        password: "ValidPassword12345!",
        organizationName: "Baltic Mfg",
      }),
    });
    expect(firstRes.status).toBe(201);

    const duplicateRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "OPS@BALTIC-MFG.EE",
        password: "AnotherValidPassword123!",
        organizationName: "Baltic Mfg Clone",
      }),
    });
    expect(duplicateRes.status).toBe(409);
  });

  it("supports login, rejects wrong password with 401, authenticates /auth/me, and revokes session on logout", async () => {
    const app = createTestApp();

    const registerRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "lead@tallinn-tech.ee",
        password: "CorrectHorseBatteryStaple99!",
        organizationName: "Tallinn Tech",
      }),
    });
    expect(registerRes.status).toBe(201);

    const unauthMe = await app.request("/api/v1/auth/me");
    expect(unauthMe.status).toBe(401);

    const wrongPwRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "lead@tallinn-tech.ee",
        password: "WrongPassword99!",
      }),
    });
    expect(wrongPwRes.status).toBe(401);

    const unknownUserRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nobody@tallinn-tech.ee",
        password: "WrongPassword99!",
      }),
    });
    expect(unknownUserRes.status).toBe(401);
    expect(await wrongPwRes.json()).toEqual(await unknownUserRes.json());

    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "LEAD@TALLINN-TECH.EE",
        password: "CorrectHorseBatteryStaple99!",
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(JSON.stringify(loginBody)).not.toContain("passwordHash");
    const cookie = extractSessionCookie(loginRes);

    const meRes = await app.request("/api/v1/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(JSON.stringify(meBody)).not.toContain("passwordHash");
    const parsedMe = AuthMeResponseSchema.parse(meBody);
    expect(parsedMe.user.email).toBe("lead@tallinn-tech.ee");

    const logoutRes = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");

    const revokedMeRes = await app.request("/api/v1/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(revokedMeRes.status).toBe(401);
  });
});
