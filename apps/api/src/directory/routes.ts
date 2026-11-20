import { DirectoryAlternativesResponseSchema } from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import type { DirectoryRepository } from "./repository.js";

export interface DirectoryRoutesDependencies {
  authRepo: AuthRepository;
  directoryRepo: DirectoryRepository;
}

const DirectoryQuerySchema = z.object({
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{2}$/.test(v), "countryCode must be a 2-letter ISO code")
    .optional(),
  capability: z.string().trim().min(1).max(100).optional(),
  excludeRed: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
});

export function createDirectoryRoutes({
  authRepo,
  directoryRepo,
}: DirectoryRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  routes.get("/alternatives", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const rawCountryCode = c.req.query("countryCode");
    const rawCapability = c.req.query("capability");
    const rawExcludeRed = c.req.query("excludeRed");

    const parsed = DirectoryQuerySchema.safeParse({
      countryCode: rawCountryCode || undefined,
      capability: rawCapability || undefined,
      excludeRed: rawExcludeRed || undefined,
    });

    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const candidates = await directoryRepo.listAlternatives(orgId, parsed.data);
    return c.json(
      DirectoryAlternativesResponseSchema.parse({ candidates }),
      200,
    );
  });

  return routes;
}
