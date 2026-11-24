import { randomUUID } from "node:crypto";

import {
  RelationshipDeclarationSchema,
  type CreateRelationshipDeclarationInput,
  type RelationshipDeclaration,
} from "@kulgo/shared";

import { normalizeEmail } from "../auth/repository.js";

import type { ArcadeDbClient } from "../db/client.js";

import { assertOrgId } from "../workspace/repository.js";

export interface RelationshipDeclarationRepository {
  /**
   * Persists a private supplier/buyer declaration owned by the given
   * organization. The owner is always the authenticated caller's orgId;
   * client input can never set it.
   */
  createDeclaration(
    ownerOrgId: string,
    input: CreateRelationshipDeclarationInput,
  ): Promise<RelationshipDeclaration>;

  /** Lists only the declarations owned by the given organization. */
  listDeclarations(ownerOrgId: string): Promise<RelationshipDeclaration[]>;
}

function buildDeclaration(
  ownerOrgId: string,
  input: CreateRelationshipDeclarationInput,
  nowIso: string,
): RelationshipDeclaration {
  return RelationshipDeclarationSchema.parse({
    declarationId: randomUUID(),
    ownerOrgId,
    name: input.name,
    role: input.role,
    countryCode: input.countryCode ?? null,
    registryId: input.registryId ?? null,
    contactEmail: input.contactEmail ? normalizeEmail(input.contactEmail) : null,
    // A supplied registry ID is still only a client declaration at this stage.
    status: "DECLARED",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

function mapDeclarationRow(row: Record<string, unknown>): RelationshipDeclaration {
  return RelationshipDeclarationSchema.parse({
    declarationId: row.declarationId,
    ownerOrgId: row.ownerOrgId,
    name: row.name,
    role: row.role,
    countryCode: row.countryCode ?? null,
    registryId: row.registryId ?? null,
    contactEmail: row.contactEmail ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * ArcadeDB-backed RelationshipDeclarationRepository using parameterized SQL
 * and owner-scoped queries (ownerOrgId = :ownerOrgId on every read/write).
 */
export class ArcadeDbRelationshipDeclarationRepository
  implements RelationshipDeclarationRepository
{
  private readonly db: ArcadeDbClient;

  constructor(db: ArcadeDbClient) {
    this.db = db;
  }

  async createDeclaration(
    ownerOrgId: string,
    input: CreateRelationshipDeclarationInput,
  ): Promise<RelationshipDeclaration> {
    const safeOrgId = assertOrgId(ownerOrgId);
    const record = buildDeclaration(safeOrgId, input, new Date().toISOString());

    await this.db.command(
      "sql",
      `CREATE VERTEX RelationshipDeclaration SET
        declarationId = :declarationId,
        ownerOrgId = :ownerOrgId,
        name = :name,
        role = :role,
        countryCode = :countryCode,
        registryId = :registryId,
        contactEmail = :contactEmail,
        status = :status,
        createdAt = :createdAt,
        updatedAt = :updatedAt`,
      {
        declarationId: record.declarationId,
        ownerOrgId: record.ownerOrgId,
        name: record.name,
        role: record.role,
        countryCode: record.countryCode,
        registryId: record.registryId,
        contactEmail: record.contactEmail,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    );

    return record;
  }

  async listDeclarations(ownerOrgId: string): Promise<RelationshipDeclaration[]> {
    const safeOrgId = assertOrgId(ownerOrgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT declarationId, ownerOrgId, name, role, countryCode, registryId,
              contactEmail, status, createdAt, updatedAt
       FROM RelationshipDeclaration
       WHERE ownerOrgId = :ownerOrgId
       ORDER BY createdAt DESC`,
      { ownerOrgId: safeOrgId },
    );
    return rows.map(mapDeclarationRow);
  }
}

/**
 * In-memory RelationshipDeclarationRepository for deterministic zero-Docker
 * unit, privacy, and E2E tests.
 */
export class InMemoryRelationshipDeclarationRepository
  implements RelationshipDeclarationRepository
{
  private readonly declarations = new Map<string, RelationshipDeclaration>();

  async createDeclaration(
    ownerOrgId: string,
    input: CreateRelationshipDeclarationInput,
  ): Promise<RelationshipDeclaration> {
    const safeOrgId = assertOrgId(ownerOrgId);
    const record = buildDeclaration(safeOrgId, input, new Date().toISOString());
    this.declarations.set(record.declarationId, record);
    return { ...record };
  }

  async listDeclarations(ownerOrgId: string): Promise<RelationshipDeclaration[]> {
    const safeOrgId = assertOrgId(ownerOrgId);
    return Array.from(this.declarations.values())
      .filter((declaration) => declaration.ownerOrgId === safeOrgId)
      .map((declaration) => ({ ...declaration }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}
