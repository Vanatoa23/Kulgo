import { randomUUID } from "node:crypto";
import {
  OrganizationSchema,
  UserSchema,
  type Organization,
  type UpdateOrganizationProfileInput,
  type User,
} from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";

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
  openToNewBuyers: boolean;
  capabilities: string[];
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<User | null>;
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

  async findOrganizationById(orgId: string): Promise<Organization | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT orgId, name, slug, countryCode, sector, esgBadges, scope1Tco2e, scope2Tco2e, openToNewBuyers, capabilities, createdAt FROM Organization WHERE orgId = :orgId LIMIT 1",
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
        esgBadges = :esgBadges,
        openToNewBuyers = :openToNewBuyers,
        capabilities = :capabilities
       WHERE orgId = :orgId`,
      {
        scope1Tco2e: nextScope1,
        scope2Tco2e: nextScope2,
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
}

/**
 * In-memory AuthRepository for fast, deterministic Vitest / CI tests without Docker.
 */
export class InMemoryAuthRepository implements AuthRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly users = new Map<string, StoredUser>();
  private readonly emailToUserId = new Map<string, string>();
  private readonly sessions = new Map<string, StoredSession>();

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
}
