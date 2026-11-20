import {
  AuthMeResponseSchema,
  LoginInputSchema,
  RegisterInputSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import { createRequireAuth, type AuthVariables } from "./middleware.js";
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
  const requireAuth = createRequireAuth(authRepo);

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
      tokenHash: hashSessionToken(sessionToken),
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

    const sessionToken = generateSessionToken();
    await authRepo.createSession({
      userId: storedUser.userId,
      orgId: organization.orgId,
      tokenHash: hashSessionToken(sessionToken),
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
      await authRepo.deleteSessionByTokenHash(hashSessionToken(token));
    }
    clearSessionCookie(c, config);
    return c.json({ ok: true }, 200);
  });

  routes.get("/me", requireAuth, (c) => {
    const auth = c.get("auth");
    const payload = AuthMeResponseSchema.parse(auth);
    return c.json(payload, 200);
  });

  return routes;
}
