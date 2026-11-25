import { randomUUID } from "node:crypto";
import {
  CatalogueItemSchema,
  KULGO_TAXONOMY_BY_CODE,
  inferUnitFamilyFromVolumeUnit,
  type CatalogueItem,
  type CreateCatalogueItemInput,
  type UpdateCatalogueItemInput,
} from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";

export class CatalogueNotFoundError extends Error {
  constructor(message = "Catalogue item not found") {
    super(message);
    this.name = "CatalogueNotFoundError";
  }
}

export interface CatalogueRepository {
  listByOrg(orgId: string): Promise<CatalogueItem[]>;
  listByOrgIds(orgIds: readonly string[]): Promise<CatalogueItem[]>;
  create(orgId: string, input: CreateCatalogueItemInput): Promise<CatalogueItem>;
  update(
    orgId: string,
    itemId: string,
    input: UpdateCatalogueItemInput,
  ): Promise<CatalogueItem>;
  delete(orgId: string, itemId: string): Promise<boolean>;
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
}

function parseCatalogueRow(row: Record<string, unknown>): CatalogueItem {
  return CatalogueItemSchema.parse({
    itemId: String(row.itemId),
    orgId: String(row.orgId),
    standardizedCategory: String(row.standardizedCategory),
    productTitle: String(row.productTitle),
    sku:
      typeof row.sku === "string" && row.sku.trim().length > 0
        ? row.sku.trim()
        : null,
    baseUnit: String(row.baseUnit ?? "TONNES"),
    unitFamily: String(row.unitFamily ?? "MASS"),
    productEmissionFactorTco2ePerUnit:
      row.productEmissionFactorTco2ePerUnit !== null &&
      row.productEmissionFactorTco2ePerUnit !== undefined
        ? Number(row.productEmissionFactorTco2ePerUnit)
        : null,
    pcfVerified: Boolean(row.pcfVerified ?? false),
    specs: normalizeStringList(row.specs),
    leadTimeDays:
      row.leadTimeDays !== null && row.leadTimeDays !== undefined
        ? Number(row.leadTimeDays)
        : null,
    moq:
      row.moq !== null && row.moq !== undefined ? Number(row.moq) : null,
    capacityBand:
      typeof row.capacityBand === "string" && row.capacityBand.length > 0
        ? row.capacityBand
        : null,
    certifications: normalizeStringList(row.certifications),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  });
}

function buildNewCatalogueItem(
  orgId: string,
  input: CreateCatalogueItemInput,
): CatalogueItem {
  const now = new Date().toISOString();
  const taxonomyDef = KULGO_TAXONOMY_BY_CODE.get(input.standardizedCategory);
  const baseUnit =
    input.baseUnit ?? taxonomyDef?.defaultBaseUnit ?? "TONNES";
  const unitFamily =
    input.unitFamily ?? inferUnitFamilyFromVolumeUnit(baseUnit);

  return CatalogueItemSchema.parse({
    itemId: randomUUID(),
    orgId,
    standardizedCategory: input.standardizedCategory,
    productTitle: input.productTitle,
    sku: input.sku ?? null,
    baseUnit,
    unitFamily,
    productEmissionFactorTco2ePerUnit:
      input.productEmissionFactorTco2ePerUnit ?? null,
    pcfVerified: input.pcfVerified ?? false,
    specs: input.specs ?? [],
    leadTimeDays: input.leadTimeDays ?? null,
    moq: input.moq ?? null,
    capacityBand: input.capacityBand ?? null,
    certifications: input.certifications ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

export class InMemoryCatalogueRepository implements CatalogueRepository {
  private readonly items = new Map<string, CatalogueItem>();

  async listByOrg(orgId: string): Promise<CatalogueItem[]> {
    return Array.from(this.items.values())
      .filter((item) => item.orgId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByOrgIds(orgIds: readonly string[]): Promise<CatalogueItem[]> {
    const idSet = new Set(orgIds);
    return Array.from(this.items.values()).filter((item) =>
      idSet.has(item.orgId),
    );
  }

  async create(
    orgId: string,
    input: CreateCatalogueItemInput,
  ): Promise<CatalogueItem> {
    const item = buildNewCatalogueItem(orgId, input);
    this.items.set(item.itemId, item);
    return item;
  }

  async update(
    orgId: string,
    itemId: string,
    input: UpdateCatalogueItemInput,
  ): Promise<CatalogueItem> {
    const existing = this.items.get(itemId);
    if (!existing || existing.orgId !== orgId) {
      throw new CatalogueNotFoundError();
    }
    const baseUnit = input.baseUnit ?? existing.baseUnit;
    const unitFamily =
      input.unitFamily ??
      (input.baseUnit ? inferUnitFamilyFromVolumeUnit(baseUnit) : existing.unitFamily);

    const updated = CatalogueItemSchema.parse({
      ...existing,
      standardizedCategory:
        input.standardizedCategory ?? existing.standardizedCategory,
      productTitle: input.productTitle ?? existing.productTitle,
      sku: input.sku !== undefined ? input.sku : existing.sku,
      baseUnit,
      unitFamily,
      productEmissionFactorTco2ePerUnit:
        input.productEmissionFactorTco2ePerUnit !== undefined
          ? input.productEmissionFactorTco2ePerUnit
          : existing.productEmissionFactorTco2ePerUnit,
      pcfVerified:
        input.pcfVerified !== undefined
          ? input.pcfVerified
          : existing.pcfVerified,
      specs: input.specs !== undefined ? input.specs : existing.specs,
      leadTimeDays:
        input.leadTimeDays !== undefined
          ? input.leadTimeDays
          : existing.leadTimeDays,
      moq: input.moq !== undefined ? input.moq : existing.moq,
      capacityBand:
        input.capacityBand !== undefined
          ? input.capacityBand
          : existing.capacityBand,
      certifications:
        input.certifications !== undefined
          ? input.certifications
          : existing.certifications,
      updatedAt: new Date().toISOString(),
    });
    this.items.set(itemId, updated);
    return updated;
  }

  async delete(orgId: string, itemId: string): Promise<boolean> {
    const existing = this.items.get(itemId);
    if (!existing || existing.orgId !== orgId) {
      return false;
    }
    this.items.delete(itemId);
    return true;
  }
}

export class ArcadeDbCatalogueRepository implements CatalogueRepository {
  constructor(private readonly db: ArcadeDbClient) {}

  async listByOrg(orgId: string): Promise<CatalogueItem[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT * FROM CatalogueItem WHERE orgId = :orgId ORDER BY createdAt DESC",
      { orgId },
    );
    return rows.map(parseCatalogueRow);
  }

  async listByOrgIds(orgIds: readonly string[]): Promise<CatalogueItem[]> {
    if (orgIds.length === 0) return [];
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT * FROM CatalogueItem WHERE orgId IN :orgIds",
      { orgIds: Array.from(orgIds) },
    );
    return rows.map(parseCatalogueRow);
  }

  async create(
    orgId: string,
    input: CreateCatalogueItemInput,
  ): Promise<CatalogueItem> {
    const item = buildNewCatalogueItem(orgId, input);
    await this.db.command(
      "sql",
      `CREATE VERTEX CatalogueItem SET
        itemId = :itemId,
        orgId = :orgId,
        standardizedCategory = :standardizedCategory,
        productTitle = :productTitle,
        sku = :sku,
        baseUnit = :baseUnit,
        unitFamily = :unitFamily,
        productEmissionFactorTco2ePerUnit = :productEmissionFactorTco2ePerUnit,
        pcfVerified = :pcfVerified,
        specs = :specs,
        leadTimeDays = :leadTimeDays,
        moq = :moq,
        capacityBand = :capacityBand,
        certifications = :certifications,
        createdAt = :createdAt,
        updatedAt = :updatedAt`,
      { ...item },
    );
    return item;
  }

  async update(
    orgId: string,
    itemId: string,
    input: UpdateCatalogueItemInput,
  ): Promise<CatalogueItem> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT * FROM CatalogueItem WHERE itemId = :itemId AND orgId = :orgId LIMIT 1",
      { itemId, orgId },
    );
    if (!rows[0]) {
      throw new CatalogueNotFoundError();
    }
    const existing = parseCatalogueRow(rows[0]);
    const baseUnit = input.baseUnit ?? existing.baseUnit;
    const unitFamily =
      input.unitFamily ??
      (input.baseUnit ? inferUnitFamilyFromVolumeUnit(baseUnit) : existing.unitFamily);

    const updated = CatalogueItemSchema.parse({
      ...existing,
      standardizedCategory:
        input.standardizedCategory ?? existing.standardizedCategory,
      productTitle: input.productTitle ?? existing.productTitle,
      sku: input.sku !== undefined ? input.sku : existing.sku,
      baseUnit,
      unitFamily,
      productEmissionFactorTco2ePerUnit:
        input.productEmissionFactorTco2ePerUnit !== undefined
          ? input.productEmissionFactorTco2ePerUnit
          : existing.productEmissionFactorTco2ePerUnit,
      pcfVerified:
        input.pcfVerified !== undefined
          ? input.pcfVerified
          : existing.pcfVerified,
      specs: input.specs !== undefined ? input.specs : existing.specs,
      leadTimeDays:
        input.leadTimeDays !== undefined
          ? input.leadTimeDays
          : existing.leadTimeDays,
      moq: input.moq !== undefined ? input.moq : existing.moq,
      capacityBand:
        input.capacityBand !== undefined
          ? input.capacityBand
          : existing.capacityBand,
      certifications:
        input.certifications !== undefined
          ? input.certifications
          : existing.certifications,
      updatedAt: new Date().toISOString(),
    });

    await this.db.command(
      "sql",
      `UPDATE CatalogueItem SET
        standardizedCategory = :standardizedCategory,
        productTitle = :productTitle,
        sku = :sku,
        baseUnit = :baseUnit,
        unitFamily = :unitFamily,
        productEmissionFactorTco2ePerUnit = :productEmissionFactorTco2ePerUnit,
        pcfVerified = :pcfVerified,
        specs = :specs,
        leadTimeDays = :leadTimeDays,
        moq = :moq,
        capacityBand = :capacityBand,
        certifications = :certifications,
        updatedAt = :updatedAt
       WHERE itemId = :itemId AND orgId = :orgId`,
      { ...updated },
    );
    return updated;
  }

  async delete(orgId: string, itemId: string): Promise<boolean> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT itemId FROM CatalogueItem WHERE itemId = :itemId AND orgId = :orgId LIMIT 1",
      { itemId, orgId },
    );
    if (rows.length === 0) {
      return false;
    }
    await this.db.command(
      "sql",
      "DELETE VERTEX CatalogueItem WHERE itemId = :itemId AND orgId = :orgId",
      { itemId, orgId },
    );
    return true;
  }
}
