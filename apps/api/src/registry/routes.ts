import {
  CompanyRegistrySearchInputSchema,
  CompanyRegistrySearchResponseSchema,
} from "@kulgo/shared";

import { Hono } from "hono";

import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";

import type { AuthRepository } from "../auth/repository.js";

import type { CompanyRegistrySearchService } from "./service.js";

export interface CompanyRegistryRoutesDependencies {
  authRepo: AuthRepository;
  registrySearch: CompanyRegistrySearchService;
}

/**
 * Strict authenticated company-registry search, mounted at
 * /api/v1/workspace/company-registry. The only endpoint is POST /search.
 * The search terms come from the request body; the caller's organization is
 * taken from the session and is never forwarded to the registry service.
 */
export function createCompanyRegistryRoutes({
  authRepo,
  registrySearch,
}: CompanyRegistryRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  routes.post("/search", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CompanyRegistrySearchInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const result = await registrySearch.search(parsed.data);
    return c.json(CompanyRegistrySearchResponseSchema.parse(result), 200);
  });

  return routes;
}
