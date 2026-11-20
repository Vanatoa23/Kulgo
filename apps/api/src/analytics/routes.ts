import {
  AnalyticsSummarySchema,
  SimulateAnalyticsRequestSchema,
  SimulateAnalyticsResponseSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import {
  AnalyticsValidationError,
  type AnalyticsRepository,
} from "./repository.js";

export interface AnalyticsRoutesDependencies {
  authRepo: AuthRepository;
  analyticsRepo: AnalyticsRepository;
}

const AnalyticsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  inputId: z.string().uuid().optional(),
});

export function createAnalyticsRoutes({
  authRepo,
  analyticsRepo,
}: AnalyticsRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  routes.get("/summary", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const rawProductId = c.req.query("productId");
    const rawInputId = c.req.query("inputId");

    const parsedQuery = AnalyticsQuerySchema.safeParse({
      productId: rawProductId || undefined,
      inputId: rawInputId || undefined,
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

    const summary = await analyticsRepo.getSummary(orgId, parsedQuery.data);
    return c.json(AnalyticsSummarySchema.parse(summary), 200);
  });

  routes.post("/simulate", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = SimulateAnalyticsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await analyticsRepo.simulate(orgId, parsed.data);
      return c.json(SimulateAnalyticsResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof AnalyticsValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  return routes;
}
