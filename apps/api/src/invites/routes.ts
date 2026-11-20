import {
  AcceptInviteInputSchema,
  AcceptInviteResponseSchema,
  CreateInviteInputSchema,
  CreateInviteResponseSchema,
  ListInvitesResponseSchema,
  RevokeInviteResponseSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import type { AppConfig } from "../config.js";
import {
  InviteNotFoundError,
  InviteStateError,
  InviteValidationError,
  type InvitationRepository,
} from "./repository.js";

export interface InviteRoutesDependencies {
  authRepo: AuthRepository;
  inviteRepo: InvitationRepository;
  config: AppConfig;
}

export function createInviteRoutes({
  authRepo,
  inviteRepo,
  config,
}: InviteRoutesDependencies): Hono<{ Variables: AuthVariables }> {
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

    const parsed = CreateInviteInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await inviteRepo.createInvite(
        orgId,
        parsed.data,
        config.WEB_ORIGIN,
      );

      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "INVITE_CREATED",
        summary: `Created partner invitation for ${result.invitation.inviteeEmail}`,
        metadata: {
          inviteId: result.invitation.inviteId,
          targetFacilityId: result.invitation.targetFacilityId,
          inviteeEmail: result.invitation.inviteeEmail,
        },
      });

      return c.json(CreateInviteResponseSchema.parse(result), 201);
    } catch (err) {
      if (err instanceof InviteValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.get("/", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const invitations = await inviteRepo.listInvitesByOrg(orgId);
    return c.json(ListInvitesResponseSchema.parse({ invitations }), 200);
  });

  routes.post("/:token/accept", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const token = c.req.param("token");

    let body: unknown = {};
    const rawText = await c.req.text();
    if (rawText.trim().length > 0) {
      try {
        body = JSON.parse(rawText) as unknown;
      } catch {
        return c.json({ error: "Invalid JSON payload" }, 400);
      }
    }

    const parsed = AcceptInviteInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await inviteRepo.acceptInvite(token, orgId, parsed.data);

      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "INVITE_ACCEPTED",
        summary: `Accepted partner invitation ${result.invitation.inviteId}`,
        metadata: {
          inviteId: result.invitation.inviteId,
          openToNewBuyers: parsed.data.openToNewBuyers ?? false,
        },
      });

      return c.json(AcceptInviteResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof InviteNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof InviteValidationError) {
        return c.json({ error: err.message }, 400);
      }
      if (err instanceof InviteStateError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  routes.delete("/:inviteId", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const inviteId = c.req.param("inviteId");

    try {
      const invitation = await inviteRepo.revokeInvite(orgId, inviteId);

      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "INVITE_REVOKED",
        summary: `Revoked partner invitation ${invitation.inviteId}`,
        metadata: {
          inviteId: invitation.inviteId,
          targetFacilityId: invitation.targetFacilityId,
        },
      });

      return c.json(
        RevokeInviteResponseSchema.parse({ ok: true, invitation }),
        200,
      );
    } catch (err) {
      if (err instanceof InviteNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof InviteStateError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  return routes;
}
