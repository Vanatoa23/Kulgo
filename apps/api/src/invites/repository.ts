import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AcceptInviteResponseSchema,
  CreateInviteResponseSchema,
  InvitationSchema,
  type AcceptInviteInput,
  type AcceptInviteResponse,
  type CreateInviteInput,
  type CreateInviteResponse,
  type Invitation,
} from "@kulgo/shared";
import { normalizeEmail, type AuthRepository } from "../auth/repository.js";
import type { ArcadeDbClient } from "../db/client.js";
import {
  assertOrgId,
  type WorkspaceRepository,
} from "../workspace/repository.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export class InviteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteValidationError";
  }
}

export class InviteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteNotFoundError";
  }
}

export class InviteStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteStateError";
  }
}

export interface VerifiedPartnerLinkRecord {
  inviteId: string;
  fromOrgId: string;
  targetFacilityId: string;
  partnerOrgId: string;
  linkedAt: string;
}

export interface InvitationRepository {
  createInvite(
    fromOrgId: string,
    input: CreateInviteInput,
    webOrigin: string,
  ): Promise<CreateInviteResponse>;

  listInvitesByOrg(fromOrgId: string): Promise<Invitation[]>;

  acceptInvite(
    rawToken: string,
    acceptingOrgId: string,
    input: AcceptInviteInput,
  ): Promise<AcceptInviteResponse>;

  revokeInvite(fromOrgId: string, inviteId: string): Promise<Invitation>;

  /**
   * Strictly server-side traversal helper used ONLY by AnalyticsRepository
   * to resolve anonymized Tier-2+ partner summaries. Never exposed directly
   * via public API routes.
   */
  listVerifiedPartnerLinksForOrg(
    fromOrgId: string,
  ): Promise<VerifiedPartnerLinkRecord[]>;
}

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function buildInviteLink(webOrigin: string, rawToken: string): string {
  const trimmedOrigin = webOrigin.trim().replace(/\/+$/, "");
  return `${trimmedOrigin}/?invite=${encodeURIComponent(rawToken)}`;
}

function resolveEffectiveStatus(
  invitation: Invitation,
  nowMs: number = Date.now(),
): Invitation {
  if (
    invitation.status === "PENDING" &&
    Date.parse(invitation.expiresAt) <= nowMs
  ) {
    return {
      ...invitation,
      status: "EXPIRED",
    };
  }
  return invitation;
}

function mapInvitationRow(row: Record<string, unknown>): Invitation {
  return resolveEffectiveStatus(
    InvitationSchema.parse({
      inviteId: row.inviteId,
      fromOrgId: row.fromOrgId,
      targetFacilityId: row.targetFacilityId,
      inviteeEmail: row.inviteeEmail,
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }),
  );
}

export interface InvitationRepositoryDeps {
  authRepo: AuthRepository;
  workspaceRepo: WorkspaceRepository;
}

/**
 * ArcadeDB-backed InvitationRepository using parameterized SQL queries
 * and VERIFIED_PARTNER_LINK graph edges.
 */
export class ArcadeDbInvitationRepository implements InvitationRepository {
  private readonly db: ArcadeDbClient;
  private readonly authRepo: AuthRepository;
  private readonly workspaceRepo: WorkspaceRepository;

  constructor(db: ArcadeDbClient, deps: InvitationRepositoryDeps) {
    this.db = db;
    this.authRepo = deps.authRepo;
    this.workspaceRepo = deps.workspaceRepo;
  }

  async createInvite(
    fromOrgId: string,
    input: CreateInviteInput,
    webOrigin: string,
  ): Promise<CreateInviteResponse> {
    const safeOrgId = assertOrgId(fromOrgId);
    const targetFacility = await this.workspaceRepo.getFacilityById(
      safeOrgId,
      input.targetFacilityId,
    );
    if (!targetFacility) {
      throw new InviteValidationError(
        "targetFacilityId does not exist in this organization's workspace",
      );
    }
    if (targetFacility.isOwnFacility) {
      throw new InviteValidationError(
        "Cannot send a partner invitation for your own facility",
      );
    }

    const nowMs = Date.now();
    const inviteToken = generateInviteToken();
    const tokenHash = hashInviteToken(inviteToken);
    const invitation = InvitationSchema.parse({
      inviteId: randomUUID(),
      fromOrgId: safeOrgId,
      targetFacilityId: input.targetFacilityId,
      inviteeEmail: normalizeEmail(input.inviteeEmail),
      status: "PENDING",
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + INVITE_TTL_MS).toISOString(),
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX Invitation SET
        inviteId = :inviteId,
        fromOrgId = :fromOrgId,
        targetFacilityId = :targetFacilityId,
        inviteeEmail = :inviteeEmail,
        tokenHash = :tokenHash,
        status = :status,
        expiresAt = :expiresAt,
        createdAt = :createdAt`,
      {
        inviteId: invitation.inviteId,
        fromOrgId: invitation.fromOrgId,
        targetFacilityId: invitation.targetFacilityId,
        inviteeEmail: invitation.inviteeEmail,
        tokenHash,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
    );

    return CreateInviteResponseSchema.parse({
      invitation,
      inviteToken,
      inviteLink: buildInviteLink(webOrigin, inviteToken),
    });
  }

  async listInvitesByOrg(fromOrgId: string): Promise<Invitation[]> {
    const safeOrgId = assertOrgId(fromOrgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT inviteId, fromOrgId, targetFacilityId, inviteeEmail, status, expiresAt, createdAt
       FROM Invitation
       WHERE fromOrgId = :fromOrgId
       ORDER BY createdAt DESC`,
      { fromOrgId: safeOrgId },
    );
    return rows.map(mapInvitationRow);
  }

  async acceptInvite(
    rawToken: string,
    acceptingOrgId: string,
    input: AcceptInviteInput,
  ): Promise<AcceptInviteResponse> {
    const safeAcceptingOrgId = assertOrgId(acceptingOrgId);
    const trimmedToken = rawToken.trim();
    if (trimmedToken.length === 0) {
      throw new InviteNotFoundError("Invitation not found");
    }

    const tokenHash = hashInviteToken(trimmedToken);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT inviteId, fromOrgId, targetFacilityId, inviteeEmail, status, expiresAt, createdAt
       FROM Invitation
       WHERE tokenHash = :tokenHash
       LIMIT 1`,
      { tokenHash },
    );
    const row = rows[0];
    if (!row) {
      throw new InviteNotFoundError("Invitation not found");
    }

    const existing = mapInvitationRow(row);
    if (existing.fromOrgId === safeAcceptingOrgId) {
      throw new InviteValidationError(
        "An organization cannot accept its own partner invitation",
      );
    }
    if (existing.status === "EXPIRED") {
      await this.db.command(
        "sql",
        "UPDATE Invitation SET status = 'EXPIRED' WHERE inviteId = :inviteId",
        { inviteId: existing.inviteId },
      );
      throw new InviteStateError("This invitation has expired");
    }
    if (existing.status !== "PENDING") {
      throw new InviteStateError(
        `This invitation is already ${existing.status.toLowerCase()}`,
      );
    }

    const linkedAt = new Date().toISOString();

    await this.db.command(
      "sql",
      "UPDATE Invitation SET status = 'ACCEPTED' WHERE inviteId = :inviteId",
      { inviteId: existing.inviteId },
    );

    await this.db.command(
      "sql",
      `CREATE EDGE VERIFIED_PARTNER_LINK
       FROM (SELECT FROM Facility WHERE facilityId = :targetFacilityId AND ownerOrgId = :fromOrgId)
       TO (SELECT FROM Organization WHERE orgId = :partnerOrgId)
       SET inviteId = :inviteId, linkedAt = :linkedAt`,
      {
        targetFacilityId: existing.targetFacilityId,
        fromOrgId: existing.fromOrgId,
        partnerOrgId: safeAcceptingOrgId,
        inviteId: existing.inviteId,
        linkedAt,
      },
    );

    await this.workspaceRepo.markFacilityPartnerVerified(
      existing.fromOrgId,
      existing.targetFacilityId,
      safeAcceptingOrgId,
      input.refinedSite,
    );

    const updatedOrg = await this.authRepo.updateOrganizationDirectoryProfile(
      safeAcceptingOrgId,
      {
        openToNewBuyers: input.openToNewBuyers,
        capabilities: input.capabilities,
      },
    );
    if (!updatedOrg) {
      throw new InviteValidationError("Accepting organization not found");
    }

    const acceptedInvitation = InvitationSchema.parse({
      ...existing,
      status: "ACCEPTED",
    });

    return AcceptInviteResponseSchema.parse({
      invitation: acceptedInvitation,
      verifiedPartnerLink: {
        inviteId: existing.inviteId,
        linkedAt,
      },
      organization: {
        orgId: updatedOrg.orgId,
        openToNewBuyers: updatedOrg.openToNewBuyers,
        capabilities: updatedOrg.capabilities,
      },
    });
  }

  async revokeInvite(fromOrgId: string, inviteId: string): Promise<Invitation> {
    const safeOrgId = assertOrgId(fromOrgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT inviteId, fromOrgId, targetFacilityId, inviteeEmail, status, expiresAt, createdAt
       FROM Invitation
       WHERE inviteId = :inviteId AND fromOrgId = :fromOrgId
       LIMIT 1`,
      { inviteId, fromOrgId: safeOrgId },
    );
    const row = rows[0];
    if (!row) {
      throw new InviteNotFoundError("Invitation not found");
    }

    const existing = mapInvitationRow(row);
    if (existing.status !== "PENDING") {
      throw new InviteStateError(
        `Only pending invitations can be revoked (current status: ${existing.status})`,
      );
    }

    await this.db.command(
      "sql",
      "UPDATE Invitation SET status = 'REVOKED' WHERE inviteId = :inviteId AND fromOrgId = :fromOrgId",
      { inviteId, fromOrgId: safeOrgId },
    );

    return InvitationSchema.parse({
      ...existing,
      status: "REVOKED",
    });
  }

  async listVerifiedPartnerLinksForOrg(
    fromOrgId: string,
  ): Promise<VerifiedPartnerLinkRecord[]> {
    const safeOrgId = assertOrgId(fromOrgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT inviteId, linkedAt,
              out.facilityId AS targetFacilityId,
              out.ownerOrgId AS fromOrgId,
              in.orgId AS partnerOrgId
       FROM VERIFIED_PARTNER_LINK
       WHERE out.ownerOrgId = :fromOrgId`,
      { fromOrgId: safeOrgId },
    );

    return rows
      .filter(
        (row) =>
          typeof row.targetFacilityId === "string" &&
          typeof row.partnerOrgId === "string" &&
          typeof row.inviteId === "string",
      )
      .map((row) => ({
        inviteId: String(row.inviteId),
        fromOrgId: safeOrgId,
        targetFacilityId: String(row.targetFacilityId),
        partnerOrgId: String(row.partnerOrgId),
        linkedAt: String(row.linkedAt ?? new Date().toISOString()),
      }));
  }
}

interface StoredInMemoryInvitation {
  invitation: Invitation;
  tokenHash: string;
}

/**
 * In-memory InvitationRepository for deterministic zero-Docker unit, privacy,
 * and E2E tests.
 */
export class InMemoryInvitationRepository implements InvitationRepository {
  private readonly authRepo: AuthRepository;
  private readonly workspaceRepo: WorkspaceRepository;
  private readonly invitesById = new Map<string, StoredInMemoryInvitation>();
  private readonly inviteIdByTokenHash = new Map<string, string>();
  private readonly partnerLinks: VerifiedPartnerLinkRecord[] = [];

  constructor(deps: InvitationRepositoryDeps) {
    this.authRepo = deps.authRepo;
    this.workspaceRepo = deps.workspaceRepo;
  }

  async createInvite(
    fromOrgId: string,
    input: CreateInviteInput,
    webOrigin: string,
  ): Promise<CreateInviteResponse> {
    const safeOrgId = assertOrgId(fromOrgId);
    const targetFacility = await this.workspaceRepo.getFacilityById(
      safeOrgId,
      input.targetFacilityId,
    );
    if (!targetFacility) {
      throw new InviteValidationError(
        "targetFacilityId does not exist in this organization's workspace",
      );
    }
    if (targetFacility.isOwnFacility) {
      throw new InviteValidationError(
        "Cannot send a partner invitation for your own facility",
      );
    }

    const nowMs = Date.now();
    const inviteToken = generateInviteToken();
    const tokenHash = hashInviteToken(inviteToken);
    const invitation = InvitationSchema.parse({
      inviteId: randomUUID(),
      fromOrgId: safeOrgId,
      targetFacilityId: input.targetFacilityId,
      inviteeEmail: normalizeEmail(input.inviteeEmail),
      status: "PENDING",
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + INVITE_TTL_MS).toISOString(),
    });

    this.invitesById.set(invitation.inviteId, { invitation, tokenHash });
    this.inviteIdByTokenHash.set(tokenHash, invitation.inviteId);

    return CreateInviteResponseSchema.parse({
      invitation: { ...invitation },
      inviteToken,
      inviteLink: buildInviteLink(webOrigin, inviteToken),
    });
  }

  async listInvitesByOrg(fromOrgId: string): Promise<Invitation[]> {
    const safeOrgId = assertOrgId(fromOrgId);
    const nowMs = Date.now();
    return Array.from(this.invitesById.values())
      .filter((entry) => entry.invitation.fromOrgId === safeOrgId)
      .map((entry) => resolveEffectiveStatus({ ...entry.invitation }, nowMs))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async acceptInvite(
    rawToken: string,
    acceptingOrgId: string,
    input: AcceptInviteInput,
  ): Promise<AcceptInviteResponse> {
    const safeAcceptingOrgId = assertOrgId(acceptingOrgId);
    const trimmedToken = rawToken.trim();
    if (trimmedToken.length === 0) {
      throw new InviteNotFoundError("Invitation not found");
    }

    const tokenHash = hashInviteToken(trimmedToken);
    const inviteId = this.inviteIdByTokenHash.get(tokenHash);
    if (!inviteId) {
      throw new InviteNotFoundError("Invitation not found");
    }
    const stored = this.invitesById.get(inviteId);
    if (!stored) {
      throw new InviteNotFoundError("Invitation not found");
    }

    const existing = resolveEffectiveStatus(stored.invitation);
    if (existing.fromOrgId === safeAcceptingOrgId) {
      throw new InviteValidationError(
        "An organization cannot accept its own partner invitation",
      );
    }
    if (existing.status === "EXPIRED") {
      stored.invitation = existing;
      throw new InviteStateError("This invitation has expired");
    }
    if (existing.status !== "PENDING") {
      throw new InviteStateError(
        `This invitation is already ${existing.status.toLowerCase()}`,
      );
    }

    const linkedAt = new Date().toISOString();
    const acceptedInvitation = InvitationSchema.parse({
      ...existing,
      status: "ACCEPTED",
    });
    stored.invitation = acceptedInvitation;

    this.partnerLinks.push({
      inviteId: acceptedInvitation.inviteId,
      fromOrgId: acceptedInvitation.fromOrgId,
      targetFacilityId: acceptedInvitation.targetFacilityId,
      partnerOrgId: safeAcceptingOrgId,
      linkedAt,
    });

    await this.workspaceRepo.markFacilityPartnerVerified(
      acceptedInvitation.fromOrgId,
      acceptedInvitation.targetFacilityId,
      safeAcceptingOrgId,
      input.refinedSite,
    );

    const updatedOrg = await this.authRepo.updateOrganizationDirectoryProfile(
      safeAcceptingOrgId,
      {
        openToNewBuyers: input.openToNewBuyers,
        capabilities: input.capabilities,
      },
    );
    if (!updatedOrg) {
      throw new InviteValidationError("Accepting organization not found");
    }

    return AcceptInviteResponseSchema.parse({
      invitation: { ...acceptedInvitation },
      verifiedPartnerLink: {
        inviteId: acceptedInvitation.inviteId,
        linkedAt,
      },
      organization: {
        orgId: updatedOrg.orgId,
        openToNewBuyers: updatedOrg.openToNewBuyers,
        capabilities: [...updatedOrg.capabilities],
      },
    });
  }

  async revokeInvite(fromOrgId: string, inviteId: string): Promise<Invitation> {
    const safeOrgId = assertOrgId(fromOrgId);
    const stored = this.invitesById.get(inviteId);
    if (!stored || stored.invitation.fromOrgId !== safeOrgId) {
      throw new InviteNotFoundError("Invitation not found");
    }

    const existing = resolveEffectiveStatus(stored.invitation);
    if (existing.status !== "PENDING") {
      throw new InviteStateError(
        `Only pending invitations can be revoked (current status: ${existing.status})`,
      );
    }

    const revoked = InvitationSchema.parse({
      ...existing,
      status: "REVOKED",
    });
    stored.invitation = revoked;
    return { ...revoked };
  }

  async listVerifiedPartnerLinksForOrg(
    fromOrgId: string,
  ): Promise<VerifiedPartnerLinkRecord[]> {
    const safeOrgId = assertOrgId(fromOrgId);
    return this.partnerLinks
      .filter((link) => link.fromOrgId === safeOrgId)
      .map((link) => ({ ...link }));
  }
}
