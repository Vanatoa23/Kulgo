import { randomUUID } from "node:crypto";
import {
  AuditEventSchema,
  OrganizationSchema,
  UserSchema,
  type AuditEvent,
  type Organization,
  type UpdateOrganizationProfileInput,
  type User,
  type UserRole,
} from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";
import {
  sanitizeAuditMetadata,
  type RecordAuditEventInput,
} from "./audit.js";

export interface StoredUser extends User {
  passwordHash: string;
}

export interface StoredSession {
  sessionId: string;
  userId: string;
  orgId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreateOrgAndOwnerInput {
  email: string;
  passwordHash: string;
  organizationName: string;
  countryCode: string;
  sector: string;
}

export interface CreateOrgMemberInput {
  orgId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface CreateSessionInput {
  userId: string;
  orgId: string;
  tokenHash: string;
  expiresAt: string;
}

export class DuplicateEmailError extends Error {
  constructor(message = "An account with this email already exists") {
    super(message);
    this.name = "DuplicateEmailError";
  }
}

export interface UpdateOrganizationDirectoryInput {
  openToNewBuyers?: boolean;
  capabilities?: string[];
}

export type RemoveOrgMemberResult = "deleted" | "not_found" | "last_owner";
export type RemovalActor = Pick<User, "userId" | "email">;

export interface AuthRepository {
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<User | null>;
  listOrgMembers(orgId: string): Promise<User[]>;
  createOrgMember(input: CreateOrgMemberInput): Promise<User>;
  /** Atomically protects the last owner, revokes sessions, and records removal. */
  deleteOrgMember(
    orgId: string,
    userId: string,
    actor: RemovalActor,
  ): Promise<RemoveOrgMemberResult>;
  findOrganizationById(orgId: string): Promise<Organization | null>;
  updateOrganizationProfile(
    orgId: string,
    input: UpdateOrganizationProfileInput,
  ): Promise<Organization | null>;
  updateOrganizationDirectoryProfile(
    orgId: string,
    input: UpdateOrganizationDirectoryInput,
  ): Promise<Organization | null>;
  listDirectoryOrganizations(): Promise<Organization[]>;
  createOrganizationAndOwner(
    input: CreateOrgAndOwnerInput,
  ): Promise<{ user: User; organization: Organization }>;
  createSession(input: CreateSessionInput): Promise<StoredSession>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  deleteExpiredSessions(nowIso: string): Promise<number>;
  recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEvent>;
  listAuditEvents(orgId: string, limit?: number): Promise<AuditEvent[]>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildOrgSlug(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const suffix = randomUUID().slice(0, 8);
  return `${base || "org"}-${suffix}`;
}

function mapOrganizationRow(row: Record<string, unknown>): Organization {
  return OrganizationSchema.parse({
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    countryCode: row.countryCode,
    sector: row.sector,
    esgBadges: Array.isArray(row.esgBadges) ? row.esgBadges : [],
    scope1Tco2e:
      typeof row.scope1Tco2e === "number" ? row.scope1Tco2e : null,
    scope2Tco2e:
      typeof row.scope2Tco2e === "number" ? row.scope2Tco2e : null,
    scope2MarketTco2e:
      typeof row.scope2MarketTco2e === "number" ? row.scope2MarketTco2e : null,
    annualRevenueEur:
      typeof row.annualRevenueEur === "number" ? row.annualRevenueEur : null,
    targetMarkets: Array.isArray(row.targetMarkets) ? row.targetMarkets : [],
    enabledCompliancePacks: Array.isArray(row.enabledCompliancePacks)
      ? row.enabledCompliancePacks
      : [],
    openToNewBuyers: Boolean(row.openToNewBuyers),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    createdAt: row.createdAt,
  });
}

function mapUserRow(row: Record<string, unknown>): User {
  return UserSchema.parse({
    userId: row.userId,
    orgId: row.orgId,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
  });
}

function mapStoredUserRow(row: Record<string, unknown>): StoredUser {
  const user = mapUserRow(row);
  if (typeof row.passwordHash !== "string" || row.passwordHash.length === 0) {
    throw new Error("Stored user record is missing passwordHash");
  }
  return {
    ...user,
    passwordHash: row.passwordHash,
  };
}

function mapSessionRow(row: Record<string, unknown>): StoredSession {
  return {
    sessionId: String(row.sessionId),
    userId: String(row.userId),
    orgId: String(row.orgId),
    tokenHash: String(row.tokenHash),
    expiresAt: String(row.expiresAt),
    createdAt: String(row.createdAt),
  };
}

function clampAuditLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function mapAuditEventRow(row: Record<string, unknown>): AuditEvent {
  let rawMetadata: Record<string, unknown> = {};
  if (typeof row.metadataJson === "string" && row.metadataJson.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.metadataJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rawMetadata = parsed as Record<string, unknown>;
      }
    } catch {
      rawMetadata = {};
    }
  } else if (
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
  ) {
    rawMetadata = row.metadata as Record<string, unknown>;
  }

  return AuditEventSchema.parse({
    eventId: row.eventId,
    orgId: row.orgId,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    action: row.action,
    summary: row.summary,
    metadata: sanitizeAuditMetadata(rawMetadata),
    createdAt: row.createdAt,
  });
}

/**
 * ArcadeDB-backed AuthRepository using exclusively parameterized SQL queries.
 */
export class ArcadeDbAuthRepository implements AuthRepository {
  constructor(private readonly db: ArcadeDbClient) {}

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const normalized = normalizeEmail(email);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT userId, orgId, email, passwordHash, role, createdAt FROM User WHERE email = :email LIMIT 1",
      { email: normalized },
    );
    const row = rows[0];
    return row ? mapStoredUserRow(row) : null;
  }

  async findUserById(userId: string): Promise<User | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT userId, orgId, email, role, createdAt FROM User WHERE userId = :userId LIMIT 1",
      { userId },
    );
    const row = rows[0];
    return row ? mapUserRow(row) : null;
  }

  async listOrgMembers(orgId: string): Promise<User[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT userId, orgId, email, role, createdAt FROM User WHERE orgId = :orgId ORDER BY createdAt ASC",
      { orgId },
    );
    return rows.map(mapUserRow);
  }

  async createOrgMember(input: CreateOrgMemberInput): Promise<User> {
    const email = normalizeEmail(input.email);
    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new DuplicateEmailError();
    }

    const user = UserSchema.parse({
      userId: randomUUID(),
      orgId: input.orgId,
      email,
      role: input.role,
      createdAt: new Date().toISOString(),
    });

    try {
      await this.db.command(
        "sql",
        `CREATE VERTEX User SET
          userId = :userId,
          orgId = :orgId,
          email = :email,
          passwordHash = :passwordHash,
          role = :role,
          createdAt = :createdAt`,
        {
          userId: user.userId,
          orgId: user.orgId,
          email: user.email,
          passwordHash: input.passwordHash,
          role: user.role,
          createdAt: user.createdAt,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicated|unique/i.test(message)) {
        throw new DuplicateEmailError();
      }
      throw err;
    }

    return user;
  }

  async deleteOrgMember(
    orgId: string,
    userId: string,
    actor: RemovalActor,
  ): Promise<RemoveOrgMemberResult> {
    // Lock all written types before reading the owner set. A transaction alone
    // would allow write skew when concurrent requests delete different owners.
    // These database locks also work across API processes/repository instances.
    // Declare the outcome outside BEGIN so SELECT can read it after COMMIT RETRY;
    // reset it inside the block so each retry computes a fresh outcome.
    const rows = await this.db.command<{ status: RemoveOrgMemberResult }>(
      "sqlscript",
      `LET removalStatus = 'not_found';
       BEGIN;
       LOCK TYPE User, Session, AuditEvent;
       LET removalStatus = 'not_found';
       LET target = SELECT userId, email, role FROM User WHERE userId = :userId AND orgId = :orgId;
       IF ($target.size() > 0) {
         LET owners = SELECT userId FROM User WHERE orgId = :orgId AND role = 'OWNER';
         IF ($target[0].role = 'OWNER' AND $owners.size() <= 1) {
           LET removalStatus = 'last_owner';
         } ELSE {
           DELETE VERTEX FROM Session WHERE userId = :userId AND orgId = :orgId;
           DELETE VERTEX FROM User WHERE userId = :userId AND orgId = :orgId;
           CREATE VERTEX AuditEvent SET
             eventId = :eventId, orgId = :orgId,
             actorUserId = :actorUserId, actorEmail = :actorEmail,
             action = 'MEMBER_REMOVED',
             summary = 'Removed team member ' + $target[0].email + ' (' + $target[0].role + ')',
             metadataJson = convert.toJson({'removedUserId': :userId, 'removedEmail': $target[0].email.substring(0, 240), 'role': $target[0].role}),
             createdAt = :createdAt;
           LET removalStatus = 'deleted';
         }
       }
       COMMIT RETRY 10;
       RETURN (SELECT $removalStatus AS status);`,
      {
        orgId,
        userId,
        eventId: randomUUID(),
        actorUserId: actor.userId,
        actorEmail: normalizeEmail(actor.email),
        createdAt: new Date().toISOString(),
      },
    );
    const result = rows[0]?.status;
    if (result !== "deleted" && result !== "not_found" && result !== "last_owner") {
      throw new Error("Invalid atomic member removal result");
    }
    return result;
  }

  async findOrganizationById(orgId: string): Promise<Organization | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT orgId, name, slug, countryCode, sector, esgBadges, scope1Tco2e, scope2Tco2e, scope2MarketTco2e, annualRevenueEur, targetMarkets, enabledCompliancePacks, openToNewBuyers, capabilities, createdAt FROM Organization WHERE orgId = :orgId LIMIT 1",
      { orgId },
    );
    const row = rows[0];
    return row ? mapOrganizationRow(row) : null;
  }

  async updateOrganizationProfile(
    orgId: string,
    input: UpdateOrganizationProfileInput,
  ): Promise<Organization | null> {
    const existing = await this.findOrganizationById(orgId);
    if (!existing) return null;

    const dedupeList = (items: string[]): string[] =>
      Array.from(
        new Set(
          items.map((item) => item.trim()).filter((item) => item.length > 0),
        ),
      );

    const nextScope1 =
      input.scope1Tco2e !== undefined
        ? input.scope1Tco2e
        : existing.scope1Tco2e;
    const nextScope2 =
      input.scope2Tco2e !== undefined
        ? input.scope2Tco2e
        : existing.scope2Tco2e;
    const nextScope2Market =
      input.scope2MarketTco2e !== undefined
        ? input.scope2MarketTco2e
        : (existing.scope2MarketTco2e ?? null);
    const nextAnnualRevenueEur =
      input.annualRevenueEur !== undefined
        ? input.annualRevenueEur
        : (existing.annualRevenueEur ?? null);
    const nextTargetMarkets =
      input.targetMarkets !== undefined
        ? Array.from(new Set(input.targetMarkets))
        : (existing.targetMarkets ?? []);
    const nextEnabledCompliancePacks =
      input.enabledCompliancePacks !== undefined
        ? Array.from(new Set(input.enabledCompliancePacks))
        : (existing.enabledCompliancePacks ?? []);
    const nextEsgBadges =
      input.esgBadges !== undefined
        ? dedupeList(input.esgBadges)
        : existing.esgBadges;
    const nextOpenToNewBuyers =
      input.openToNewBuyers !== undefined
        ? input.openToNewBuyers
        : existing.openToNewBuyers;
    const nextCapabilities =
      input.capabilities !== undefined
        ? dedupeList(input.capabilities)
        : existing.capabilities;

    await this.db.command(
      "sql",
      `UPDATE Organization SET
        scope1Tco2e = :scope1Tco2e,
        scope2Tco2e = :scope2Tco2e,
        scope2MarketTco2e = :scope2MarketTco2e,
        annualRevenueEur = :annualRevenueEur,
        targetMarkets = :targetMarkets,
        enabledCompliancePacks = :enabledCompliancePacks,
        esgBadges = :esgBadges,
        openToNewBuyers = :openToNewBuyers,
        capabilities = :capabilities
       WHERE orgId = :orgId`,
      {
        scope1Tco2e: nextScope1,
        scope2Tco2e: nextScope2,
        scope2MarketTco2e: nextScope2Market,
        annualRevenueEur: nextAnnualRevenueEur,
        targetMarkets: nextTargetMarkets,
        enabledCompliancePacks: nextEnabledCompliancePacks,
        esgBadges: nextEsgBadges,
        openToNewBuyers: nextOpenToNewBuyers,
        capabilities: nextCapabilities,
        orgId,
      },
    );

    return this.findOrganizationById(orgId);
  }

  async updateOrganizationDirectoryProfile(
    orgId: string,
    input: UpdateOrganizationDirectoryInput,
  ): Promise<Organization | null> {
    return this.updateOrganizationProfile(orgId, {
      openToNewBuyers: input.openToNewBuyers,
      capabilities: input.capabilities,
    });
  }

  async listDirectoryOrganizations(): Promise<Organization[]> {
    // Privacy invariant: NEVER select annualRevenueEur for cross-org directory listings
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT orgId, name, slug, countryCode, sector, esgBadges, scope1Tco2e, scope2Tco2e, openToNewBuyers, capabilities, createdAt FROM Organization WHERE openToNewBuyers = true",
    );
    return rows.map(mapOrganizationRow);
  }

  async createOrganizationAndOwner(
    input: CreateOrgAndOwnerInput,
  ): Promise<{ user: User; organization: Organization }> {
    const email = normalizeEmail(input.email);
    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new DuplicateEmailError();
    }

    const now = new Date().toISOString();
    const orgId = randomUUID();
    const userId = randomUUID();
    const slug = buildOrgSlug(input.organizationName);
    const countryCode = input.countryCode.trim().toUpperCase();

    const organization = OrganizationSchema.parse({
      orgId,
      name: input.organizationName.trim(),
      slug,
      countryCode,
      sector: input.sector.trim(),
      esgBadges: [],
      scope1Tco2e: null,
      scope2Tco2e: null,
      openToNewBuyers: false,
      capabilities: [],
      createdAt: now,
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX Organization SET
        orgId = :orgId,
        name = :name,
        slug = :slug,
        countryCode = :countryCode,
        sector = :sector,
        esgBadges = :esgBadges,
        scope1Tco2e = :scope1Tco2e,
        scope2Tco2e = :scope2Tco2e,
        openToNewBuyers = :openToNewBuyers,
        capabilities = :capabilities,
        createdAt = :createdAt`,
      {
        orgId: organization.orgId,
        name: organization.name,
        slug: organization.slug,
        countryCode: organization.countryCode,
        sector: organization.sector,
        esgBadges: organization.esgBadges,
        scope1Tco2e: organization.scope1Tco2e,
        scope2Tco2e: organization.scope2Tco2e,
        openToNewBuyers: organization.openToNewBuyers,
        capabilities: organization.capabilities,
        createdAt: organization.createdAt,
      },
    );

    const user = UserSchema.parse({
      userId,
      orgId,
      email,
      role: "OWNER",
      createdAt: now,
    });

    try {
      await this.db.command(
        "sql",
        `CREATE VERTEX User SET
          userId = :userId,
          orgId = :orgId,
          email = :email,
          passwordHash = :passwordHash,
          role = :role,
          createdAt = :createdAt`,
        {
          userId: user.userId,
          orgId: user.orgId,
          email: user.email,
          passwordHash: input.passwordHash,
          role: user.role,
          createdAt: user.createdAt,
        },
      );
    } catch (err) {
      await this.db.command(
        "sql",
        "DELETE VERTEX FROM Organization WHERE orgId = :orgId",
        { orgId },
      );
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicated|unique/i.test(message)) {
        throw new DuplicateEmailError();
      }
      throw err;
    }

    return { user, organization };
  }

  async createSession(input: CreateSessionInput): Promise<StoredSession> {
    const session: StoredSession = {
      sessionId: randomUUID(),
      userId: input.userId,
      orgId: input.orgId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };

    await this.db.command(
      "sql",
      `CREATE VERTEX Session SET
        sessionId = :sessionId,
        userId = :userId,
        orgId = :orgId,
        tokenHash = :tokenHash,
        expiresAt = :expiresAt,
        createdAt = :createdAt`,
      {
        sessionId: session.sessionId,
        userId: session.userId,
        orgId: session.orgId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
    );

    return session;
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT sessionId, userId, orgId, tokenHash, expiresAt, createdAt FROM Session WHERE tokenHash = :tokenHash LIMIT 1",
      { tokenHash },
    );
    const row = rows[0];
    return row ? mapSessionRow(row) : null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db.command(
      "sql",
      "DELETE VERTEX FROM Session WHERE tokenHash = :tokenHash",
      { tokenHash },
    );
  }

  async deleteExpiredSessions(nowIso: string): Promise<number> {
    const result = await this.db.command<Record<string, unknown>>(
      "sql",
      "DELETE VERTEX FROM Session WHERE expiresAt <= :nowIso",
      { nowIso },
    );
    const first = result[0];
    if (first && typeof first.count === "number") {
      return first.count;
    }
    return result.length;
  }

  async recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEvent> {
    const event = AuditEventSchema.parse({
      eventId: randomUUID(),
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      actorEmail: normalizeEmail(input.actorEmail),
      action: input.action,
      summary: input.summary.trim().slice(0, 500),
      metadata: sanitizeAuditMetadata(input.metadata),
      createdAt: new Date().toISOString(),
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX AuditEvent SET
        eventId = :eventId,
        orgId = :orgId,
        actorUserId = :actorUserId,
        actorEmail = :actorEmail,
        action = :action,
        summary = :summary,
        metadataJson = :metadataJson,
        createdAt = :createdAt`,
      {
        eventId: event.eventId,
        orgId: event.orgId,
        actorUserId: event.actorUserId,
        actorEmail: event.actorEmail,
        action: event.action,
        summary: event.summary,
        metadataJson: JSON.stringify(event.metadata),
        createdAt: event.createdAt,
      },
    );

    return event;
  }

  async listAuditEvents(orgId: string, limit = 50): Promise<AuditEvent[]> {
    const safeLimit = clampAuditLimit(limit);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT eventId, orgId, actorUserId, actorEmail, action, summary, metadataJson, createdAt
       FROM AuditEvent
       WHERE orgId = :orgId
       ORDER BY createdAt DESC
       LIMIT ${safeLimit}`,
      { orgId },
    );
    return rows.map(mapAuditEventRow);
  }
}

/**
 * In-memory AuthRepository for fast, deterministic Vitest / CI tests without Docker.
 */
export class InMemoryAuthRepository implements AuthRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly users = new Map<string, StoredUser>();
  private readonly emailToUserId = new Map<string, string>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly auditEvents: Array<{ seq: number; event: AuditEvent }> = [];
  private auditSeq = 0;

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const userId = this.emailToUserId.get(normalizeEmail(email));
    if (!userId) return null;
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  async findUserById(userId: string): Promise<User | null> {
    const stored = this.users.get(userId);
    if (!stored) return null;
    return UserSchema.parse({
      userId: stored.userId,
      orgId: stored.orgId,
      email: stored.email,
      role: stored.role,
      createdAt: stored.createdAt,
    });
  }

  async listOrgMembers(orgId: string): Promise<User[]> {
    return Array.from(this.users.values())
      .filter((u) => u.orgId === orgId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((stored) =>
        UserSchema.parse({
          userId: stored.userId,
          orgId: stored.orgId,
          email: stored.email,
          role: stored.role,
          createdAt: stored.createdAt,
        }),
      );
  }

  async createOrgMember(input: CreateOrgMemberInput): Promise<User> {
    const email = normalizeEmail(input.email);
    if (this.emailToUserId.has(email)) {
      throw new DuplicateEmailError();
    }

    const user = UserSchema.parse({
      userId: randomUUID(),
      orgId: input.orgId,
      email,
      role: input.role,
      createdAt: new Date().toISOString(),
    });

    this.users.set(user.userId, { ...user, passwordHash: input.passwordHash });
    this.emailToUserId.set(email, user.userId);
    return { ...user };
  }

  async deleteOrgMember(
    orgId: string,
    userId: string,
    actor: RemovalActor,
  ): Promise<RemoveOrgMemberResult> {
    // No awaits in this critical section: validation, audit, and mutation happen
    // in one turn, so concurrent requests cannot observe the same owner set.
    const stored = this.users.get(userId);
    if (!stored || stored.orgId !== orgId) return "not_found";
    const ownerCount = Array.from(this.users.values()).filter(
      (user) => user.orgId === orgId && user.role === "OWNER",
    ).length;
    if (stored.role === "OWNER" && ownerCount <= 1) return "last_owner";

    this.storeAuditEvent({
      orgId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "MEMBER_REMOVED",
      summary: `Removed team member ${stored.email} (${stored.role})`,
      metadata: {
        removedUserId: stored.userId,
        removedEmail: stored.email,
        role: stored.role,
      },
    });
    this.users.delete(userId);
    this.emailToUserId.delete(stored.email);
    for (const [tokenHash, session] of this.sessions.entries()) {
      if (session.userId === userId && session.orgId === orgId) {
        this.sessions.delete(tokenHash);
      }
    }
    return "deleted";
  }

  async findOrganizationById(orgId: string): Promise<Organization | null> {
    const org = this.organizations.get(orgId);
    if (!org) return null;
    return OrganizationSchema.parse({
      ...org,
      esgBadges: [...org.esgBadges],
      capabilities: [...org.capabilities],
    });
  }

  async updateOrganizationProfile(
    orgId: string,
    input: UpdateOrganizationProfileInput,
  ): Promise<Organization | null> {
    const existing = this.organizations.get(orgId);
    if (!existing) return null;

    const dedupeList = (items: string[]): string[] =>
      Array.from(
        new Set(
          items.map((item) => item.trim()).filter((item) => item.length > 0),
        ),
      );

    const updated = OrganizationSchema.parse({
      ...existing,
      scope1Tco2e:
        input.scope1Tco2e !== undefined
          ? input.scope1Tco2e
          : existing.scope1Tco2e,
      scope2Tco2e:
        input.scope2Tco2e !== undefined
          ? input.scope2Tco2e
          : existing.scope2Tco2e,
      scope2MarketTco2e:
        input.scope2MarketTco2e !== undefined
          ? input.scope2MarketTco2e
          : (existing.scope2MarketTco2e ?? null),
      annualRevenueEur:
        input.annualRevenueEur !== undefined
          ? input.annualRevenueEur
          : (existing.annualRevenueEur ?? null),
      targetMarkets:
        input.targetMarkets !== undefined
          ? Array.from(new Set(input.targetMarkets))
          : (existing.targetMarkets ?? []),
      enabledCompliancePacks:
        input.enabledCompliancePacks !== undefined
          ? Array.from(new Set(input.enabledCompliancePacks))
          : (existing.enabledCompliancePacks ?? []),
      esgBadges:
        input.esgBadges !== undefined
          ? dedupeList(input.esgBadges)
          : existing.esgBadges,
      openToNewBuyers:
        input.openToNewBuyers !== undefined
          ? input.openToNewBuyers
          : existing.openToNewBuyers,
      capabilities:
        input.capabilities !== undefined
          ? dedupeList(input.capabilities)
          : existing.capabilities,
    });
    this.organizations.set(orgId, updated);
    return {
      ...updated,
      esgBadges: [...updated.esgBadges],
      capabilities: [...updated.capabilities],
      targetMarkets: [...(updated.targetMarkets ?? [])],
      enabledCompliancePacks: [...(updated.enabledCompliancePacks ?? [])],
    };
  }

  async updateOrganizationDirectoryProfile(
    orgId: string,
    input: UpdateOrganizationDirectoryInput,
  ): Promise<Organization | null> {
    return this.updateOrganizationProfile(orgId, {
      openToNewBuyers: input.openToNewBuyers,
      capabilities: input.capabilities,
    });
  }

  async listDirectoryOrganizations(): Promise<Organization[]> {
    return Array.from(this.organizations.values())
      .filter((org) => org.openToNewBuyers)
      .map((org) =>
        OrganizationSchema.parse({
          ...org,
          // Privacy invariant: NEVER expose annualRevenueEur in directory listings
          annualRevenueEur: null,
          esgBadges: [...org.esgBadges],
          capabilities: [...org.capabilities],
        }),
      );
  }

  async createOrganizationAndOwner(
    input: CreateOrgAndOwnerInput,
  ): Promise<{ user: User; organization: Organization }> {
    const email = normalizeEmail(input.email);
    if (this.emailToUserId.has(email)) {
      throw new DuplicateEmailError();
    }

    const now = new Date().toISOString();
    const orgId = randomUUID();
    const userId = randomUUID();

    const organization = OrganizationSchema.parse({
      orgId,
      name: input.organizationName.trim(),
      slug: buildOrgSlug(input.organizationName),
      countryCode: input.countryCode.trim().toUpperCase(),
      sector: input.sector.trim(),
      esgBadges: [],
      scope1Tco2e: null,
      scope2Tco2e: null,
      openToNewBuyers: false,
      capabilities: [],
      createdAt: now,
    });

    const user = UserSchema.parse({
      userId,
      orgId,
      email,
      role: "OWNER",
      createdAt: now,
    });

    this.organizations.set(orgId, organization);
    this.users.set(userId, { ...user, passwordHash: input.passwordHash });
    this.emailToUserId.set(email, userId);

    return {
      user: { ...user },
      organization: {
        ...organization,
        esgBadges: [...organization.esgBadges],
        capabilities: [...organization.capabilities],
      },
    };
  }

  async createSession(input: CreateSessionInput): Promise<StoredSession> {
    const session: StoredSession = {
      sessionId: randomUUID(),
      userId: input.userId,
      orgId: input.orgId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.tokenHash, session);
    return { ...session };
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const session = this.sessions.get(tokenHash);
    return session ? { ...session } : null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteExpiredSessions(nowIso: string): Promise<number> {
    const nowMs = Date.parse(nowIso);
    let deleted = 0;
    for (const [tokenHash, session] of this.sessions.entries()) {
      const expiresAtMs = Date.parse(session.expiresAt);
      if (
        !Number.isFinite(expiresAtMs) ||
        (Number.isFinite(nowMs) ? expiresAtMs <= nowMs : session.expiresAt <= nowIso)
      ) {
        this.sessions.delete(tokenHash);
        deleted += 1;
      }
    }
    return deleted;
  }

  async recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEvent> {
    return this.storeAuditEvent(input);
  }

  private storeAuditEvent(input: RecordAuditEventInput): AuditEvent {
    const event = AuditEventSchema.parse({
      eventId: randomUUID(),
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      actorEmail: normalizeEmail(input.actorEmail),
      action: input.action,
      summary: input.summary.trim().slice(0, 500),
      metadata: sanitizeAuditMetadata(input.metadata),
      createdAt: new Date().toISOString(),
    });
    this.auditSeq += 1;
    this.auditEvents.push({
      seq: this.auditSeq,
      event: { ...event, metadata: { ...event.metadata } },
    });
    return { ...event, metadata: { ...event.metadata } };
  }

  async listAuditEvents(orgId: string, limit = 50): Promise<AuditEvent[]> {
    const safeLimit = clampAuditLimit(limit);
    return this.auditEvents
      .filter((entry) => entry.event.orgId === orgId)
      .sort((a, b) => {
        const cmp = b.event.createdAt.localeCompare(a.event.createdAt);
        return cmp !== 0 ? cmp : b.seq - a.seq;
      })
      .slice(0, safeLimit)
      .map((entry) =>
        AuditEventSchema.parse({
          ...entry.event,
          metadata: { ...entry.event.metadata },
        }),
      );
  }
}
