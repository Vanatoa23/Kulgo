import { AsyncLocalStorage } from "node:async_hooks";
import type { Organization, User } from "@kulgo/shared";
import { createMiddleware } from "hono/factory";
import type { AuthRepository } from "./repository.js";
import { getSessionTokenFromCookie, hashSessionToken } from "./session.js";

const sessionSecretStorage = new AsyncLocalStorage<string>();

export function withSessionSecret<T>(
  sessionSecret: string,
  fn: () => Promise<T>,
): Promise<T> {
  return sessionSecretStorage.run(sessionSecret, fn);
}

export interface AuthContext {
  user: User;
  organization: Organization;
}

export interface AuthVariables {
  auth: AuthContext;
  sessionTokenHash: string;
}

export function createRequireAuth(
  authRepo: AuthRepository,
  sessionSecret?: string,
) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const token = getSessionTokenFromCookie(c);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const effectiveSecret =
      sessionSecret ?? sessionSecretStorage.getStore();
    const tokenHash = hashSessionToken(token, effectiveSecret);
    const session = await authRepo.findSessionByTokenHash(tokenHash);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const expiresAtMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await authRepo.deleteSessionByTokenHash(tokenHash);
      return c.json({ error: "Unauthorized" }, 401);
    }

    const [user, organization] = await Promise.all([
      authRepo.findUserById(session.userId),
      authRepo.findOrganizationById(session.orgId),
    ]);

    if (!user || !organization || user.orgId !== organization.orgId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("auth", { user, organization });
    c.set("sessionTokenHash", tokenHash);
    await next();
  });
}

export const requireOwner = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const auth = c.get("auth");
    if (!auth || auth.user.role !== "OWNER") {
      return c.json(
        { error: "Forbidden: organization owner role required" },
        403,
      );
    }
    await next();
  },
);

