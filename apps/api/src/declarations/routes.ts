import {
  CreateRelationshipDeclarationInputSchema,
  CreateRelationshipDeclarationResponseSchema,
  ListRelationshipDeclarationsResponseSchema,
} from "@kulgo/shared";

import { Hono } from "hono";

import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";

import type { AuthRepository } from "../auth/repository.js";
import type { OutreachService } from "../outreach/service.js";

import type { RelationshipDeclarationRepository } from "./repository.js";
import type { CompanyRegistrySearchService } from "../registry/service.js";

export interface DeclarationRoutesDependencies {
  authRepo: AuthRepository;
  declarationRepo: RelationshipDeclarationRepository;
  outreachService?: OutreachService;
  registrySearch?: CompanyRegistrySearchService;
}

/**
 * Authenticated create/list endpoints for private supplier and buyer
 * declarations. Mounted at /api/v1/workspace/relationship-declarations.
 * The owner organization always comes from the session, never the payload.
 */
export function createDeclarationRoutes({
  authRepo,
  declarationRepo,
  outreachService,
}: DeclarationRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  routes.post("/", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateRelationshipDeclarationInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const declaration = await declarationRepo.createDeclaration(orgId, parsed.data);

    // Automatic background outreach for declared suppliers with a contact email
    // (strict dedupe, global suppression, rate limits; never blocks declaration save).
    if (
      outreachService &&
      declaration.role === "SUPPLIER" &&
      declaration.contactEmail
    ) {
      void outreachService
        .dispatchSupplierOutreach({
          fromOrgId: orgId,
          fromOrgName: auth.organization.name,
          actorUserId: auth.user.userId,
          actorEmail: auth.user.email,
          supplierName: declaration.name,
          recipientEmail: declaration.contactEmail,
          referenceId: declaration.declarationId,
        })
        .catch(() => {
          // Non-fatal: outreach failures never disrupt declaration creation
        });
    }

    return c.json(
      CreateRelationshipDeclarationResponseSchema.parse({ declaration }),
      201,
    );
  });

  routes.get("/", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const declarations = await declarationRepo.listDeclarations(orgId);
    return c.json(
      ListRelationshipDeclarationsResponseSchema.parse({ declarations }),
      200,
    );
  });

  return routes;
}
