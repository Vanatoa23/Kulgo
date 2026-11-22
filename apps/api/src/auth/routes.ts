import {
  AddOrgMemberInputSchema,
  AddOrgMemberResponseSchema,
  AuthMeResponseSchema,
  ListAuditEventsResponseSchema,
  ListOrgMembersResponseSchema,
  LoginInputSchema,
  RegisterInputSchema,
  RemoveOrgMemberResponseSchema,
  UpdateOrganizationProfileInputSchema,
  UpdateOrganizationProfileResponseSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  createRequireAuth,
  requireOwner,
  type AuthVariables,
} from "./middleware.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  DuplicateEmailError,
  normalizeEmail,
  type AuthRepository,
} from "./repository.js";
import {
  clearSessionCookie,
  computeSessionExpiryIso,
  generateSessionToken,
  getSessionTokenFromCookie,
  hashSessionToken,
  setSessionCookie,
} from "./session.js";

export interface AuthRoutesDependencies {
  authRepo: AuthRepository;
  config: AppConfig;
}

export function createAuthRoutes({
  authRepo,
  config,
}: AuthRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo, config.SESSION_SECRET);
  let dummyHashPromise: Promise<string> | null = null;
  const getDummyPasswordHash = () => {
    if (!dummyHashPromise) {
      dummyHashPromise = hashPassword("kulgo-timing-sidechannel-dummy-secret");
    }
    return dummyHashPromise;
  };

  routes.post("/register", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = RegisterInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const normalizedCountry = parsed.data.countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalizedCountry)) {
      return c.json(
        { error: "countryCode must be a 2-letter ISO code" },
        400,
      );
    }

    const email = normalizeEmail(parsed.data.email);
    const existing = await authRepo.findUserByEmail(email);
    if (existing) {
      return c.json(
        { error: "An account with this email already exists" },
        409,
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);

    let created: { user: AuthVariables["auth"]["user"]; organization: AuthVariables["auth"]["organization"] };
    try {
      created = await authRepo.createOrganizationAndOwner({
        email,
        passwordHash,
        organizationName: parsed.data.organizationName,
        countryCode: normalizedCountry,
        sector: parsed.data.sector,
      });
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }

    const sessionToken = generateSessionToken();
    await authRepo.createSession({
      userId: created.user.userId,
      orgId: created.organization.orgId,
      tokenHash: hashSessionToken(sessionToken, config.SESSION_SECRET),
      expiresAt: computeSessionExpiryIso(),
    });
    setSessionCookie(c, sessionToken, config);

    const payload = AuthMeResponseSchema.parse({
      user: created.user,
      organization: created.organization,
    });
    return c.json(payload, 201);
  });

  routes.post("/login", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = LoginInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const storedUser = await authRepo.findUserByEmail(parsed.data.email);
    if (!storedUser) {
      await verifyPassword(parsed.data.password, await getDummyPasswordHash());
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const valid = await verifyPassword(
      parsed.data.password,
      storedUser.passwordHash,
    );
    if (!valid) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const organization = await authRepo.findOrganizationById(storedUser.orgId);
    if (!organization) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    await authRepo.deleteExpiredSessions(new Date().toISOString());

    const sessionToken = generateSessionToken();
    await authRepo.createSession({
      userId: storedUser.userId,
      orgId: organization.orgId,
      tokenHash: hashSessionToken(sessionToken, config.SESSION_SECRET),
      expiresAt: computeSessionExpiryIso(),
    });
    setSessionCookie(c, sessionToken, config);

    const payload = AuthMeResponseSchema.parse({
      user: {
        userId: storedUser.userId,
        orgId: storedUser.orgId,
        email: storedUser.email,
        role: storedUser.role,
        createdAt: storedUser.createdAt,
      },
      organization,
    });
    return c.json(payload, 200);
  });

  routes.post("/logout", async (c) => {
    const token = getSessionTokenFromCookie(c);
    if (token) {
      await authRepo.deleteSessionByTokenHash(
        hashSessionToken(token, config.SESSION_SECRET),
      );
    }
    clearSessionCookie(c, config);
    return c.json({ ok: true }, 200);
  });

  routes.get("/me", requireAuth, (c) => {
    const auth = c.get("auth");
    const payload = AuthMeResponseSchema.parse(auth);
    return c.json(payload, 200);
  });

  routes.patch("/organization", requireAuth, requireOwner, async (c) => {
    const auth = c.get("auth");
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateOrganizationProfileInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const updated = await authRepo.updateOrganizationProfile(
      auth.organization.orgId,
      parsed.data,
    );
    if (!updated) {
      return c.json({ error: "Organization not found" }, 404);
    }

    await authRepo.recordAuditEvent({
      orgId: auth.organization.orgId,
      actorUserId: auth.user.userId,
      actorEmail: auth.user.email,
      action: "ORG_PROFILE_UPDATED",
      summary: `Updated organization ESG & directory profile (Scope 1: ${
        updated.scope1Tco2e ?? "unset"
      }, Scope 2: ${updated.scope2Tco2e ?? "unset"}, directory opt-in: ${
        updated.openToNewBuyers ? "on" : "off"
      })`,
      metadata: {
        scope1Tco2e: updated.scope1Tco2e,
        scope2Tco2e: updated.scope2Tco2e,
        esgBadgeCount: updated.esgBadges.length,
        openToNewBuyers: updated.openToNewBuyers,
        capabilityCount: updated.capabilities.length,
      },
    });

    const payload = UpdateOrganizationProfileResponseSchema.parse({
      organization: updated,
    });
    return c.json(payload, 200);
  });

  routes.get("/members", requireAuth, async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const members = await authRepo.listOrgMembers(orgId);
    const payload = ListOrgMembersResponseSchema.parse({ members });
    return c.json(payload, 200);
  });

  routes.post("/members", requireAuth, requireOwner, async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = AddOrgMemberInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const email = normalizeEmail(parsed.data.email);
    const existing = await authRepo.findUserByEmail(email);
    if (existing) {
      return c.json(
        { error: "An account with this email already exists" },
        409,
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);

    try {
      const member = await authRepo.createOrgMember({
        orgId,
        email,
        passwordHash,
        role: parsed.data.role,
      });

      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "MEMBER_ADDED",
        summary: `Added team member ${member.email} with role ${member.role}`,
        metadata: {
          targetUserId: member.userId,
          targetEmail: member.email,
          role: member.role,
        },
      });

      const payload = AddOrgMemberResponseSchema.parse({ member });
      return c.json(payload, 201);
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  routes.delete("/members/:userId", requireAuth, requireOwner, async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const targetUserId = c.req.param("userId");

    const result = await authRepo.deleteOrgMember(orgId, targetUserId, auth.user);
    if (result === "not_found") {
      return c.json({ error: "Member not found" }, 404);
    }
    if (result === "last_owner") {
      return c.json({ error: "Cannot remove the last organization owner" }, 400);
    }

    const payload = RemoveOrgMemberResponseSchema.parse({
      ok: true,
      removedUserId: targetUserId,
    });
    return c.json(payload, 200);
  });

  const AuditLogQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });

  routes.get("/audit-log", requireAuth, requireOwner, async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const rawLimit = c.req.query("limit");
    const parsedQuery = AuditLogQuerySchema.safeParse({
      limit: rawLimit !== undefined && rawLimit !== "" ? rawLimit : undefined,
    });
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.flatten(),
        },
        400,
      );
    }

    const events = await authRepo.listAuditEvents(
      orgId,
      parsedQuery.data.limit,
    );
    const payload = ListAuditEventsResponseSchema.parse({ events });
    return c.json(payload, 200);
  });

  return routes;
}
