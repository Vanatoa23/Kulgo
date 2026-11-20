import { randomUUID } from "node:crypto";
import { estimateLaneCo2eTonnes, haversineDistanceKm } from "@kulgo/engine";
import {
  FacilitySchema,
  ProductSchema,
  SupplyInputSchema,
  SupplyLaneSchema,
  WorkspaceNetworkResponseSchema,
  type CreateFacilityInput,
  type CreateProductInput,
  type CreateSupplyInputInput,
  type CreateSupplyLaneInput,
  type Facility,
  type Product,
  type SupplyInput,
  type SupplyLane,
  type TransportMode,
  type UpdateFacilityInput,
  type UpdateProductInput,
  type UpdateSupplyInputInput,
  type UpdateSupplyLaneInput,
  type VolumeUnit,
  type WorkspaceNetworkResponse,
} from "@kulgo/shared";
import type { ArcadeDbClient } from "../db/client.js";

export interface NetworkFilters {
  productId?: string;
  inputId?: string;
}

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNotFoundError";
  }
}

export function assertOrgId(orgId: string): string {
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw new Error("Authenticated orgId is required for all workspace queries");
  }
  return orgId.trim();
}

/**
 * Formats coordinates as WKT POINT with longitude first, latitude second.
 */
export function formatPointWkt(lng: number, lat: number): string {
  return `POINT (${lng} ${lat})`;
}

function toAnnualTonnes(
  annualVolume: number | null,
  volumeUnit: VolumeUnit,
): number | null {
  if (annualVolume === null || annualVolume <= 0) {
    return null;
  }
  if (volumeUnit === "TONNES") {
    return annualVolume;
  }
  if (volumeUnit === "KG") {
    return annualVolume / 1000;
  }
  return null;
}

function computeLaneMetrics(params: {
  from: Pick<Facility, "lat" | "lng">;
  to: Pick<Facility, "lat" | "lng">;
  transportMode: TransportMode;
  annualVolume: number | null;
  volumeUnit: VolumeUnit;
  explicitDistanceKm?: number | null;
  explicitEstimatedLaneCo2e?: number | null;
}): { distanceKm: number; estimatedLaneCo2e: number | null } {
  const distanceKm =
    params.explicitDistanceKm !== undefined &&
    params.explicitDistanceKm !== null
      ? params.explicitDistanceKm
      : haversineDistanceKm(
          params.from.lat,
          params.from.lng,
          params.to.lat,
          params.to.lng,
        );

  let estimatedLaneCo2e: number | null;
  if (
    params.explicitEstimatedLaneCo2e !== undefined &&
    params.explicitEstimatedLaneCo2e !== null
  ) {
    estimatedLaneCo2e = params.explicitEstimatedLaneCo2e;
  } else {
    const annualTonnes = toAnnualTonnes(params.annualVolume, params.volumeUnit);
    estimatedLaneCo2e =
      annualTonnes !== null
        ? estimateLaneCo2eTonnes({
            distanceKm,
            annualTonnes,
            transportMode: params.transportMode,
          })
        : null;
  }

  return { distanceKm, estimatedLaneCo2e };
}

function filterNetwork(
  network: WorkspaceNetworkResponse,
  filters?: NetworkFilters,
): WorkspaceNetworkResponse {
  const productId = filters?.productId;
  const inputId = filters?.inputId;

  if (!productId && !inputId) {
    return WorkspaceNetworkResponseSchema.parse(network);
  }

  let inputs = network.inputs;
  if (productId) {
    inputs = inputs.filter((i) => i.productId === productId);
  }
  if (inputId) {
    inputs = inputs.filter((i) => i.inputId === inputId);
  }

  const inputIds = new Set(inputs.map((i) => i.inputId));
  const lanes = network.lanes.filter(
    (l) => l.inputId !== null && inputIds.has(l.inputId),
  );

  const facilityIds = new Set<string>();
  for (const lane of lanes) {
    facilityIds.add(lane.fromFacilityId);
    facilityIds.add(lane.toFacilityId);
  }
  const facilities = network.facilities.filter((f) =>
    facilityIds.has(f.facilityId),
  );

  const matchedProductIds = new Set<string>();
  if (productId) {
    matchedProductIds.add(productId);
  }
  for (const input of inputs) {
    if (input.productId) {
      matchedProductIds.add(input.productId);
    }
  }
  const products = network.products.filter((p) =>
    matchedProductIds.has(p.productId),
  );

  return WorkspaceNetworkResponseSchema.parse({
    products,
    inputs,
    facilities,
    lanes,
    riskSignals: network.riskSignals,
  });
}

export interface WorkspaceRepository {
  getNetwork(
    orgId: string,
    filters?: NetworkFilters,
  ): Promise<WorkspaceNetworkResponse>;

  listProducts(orgId: string): Promise<Product[]>;
  createProduct(orgId: string, input: CreateProductInput): Promise<Product>;
  updateProduct(
    orgId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<Product | null>;
  deleteProduct(orgId: string, productId: string): Promise<boolean>;

  listInputs(orgId: string): Promise<SupplyInput[]>;
  createInput(
    orgId: string,
    input: CreateSupplyInputInput,
  ): Promise<SupplyInput>;
  updateInput(
    orgId: string,
    inputId: string,
    input: UpdateSupplyInputInput,
  ): Promise<SupplyInput | null>;
  deleteInput(orgId: string, inputId: string): Promise<boolean>;

  listFacilities(orgId: string): Promise<Facility[]>;
  createFacility(orgId: string, input: CreateFacilityInput): Promise<Facility>;
  updateFacility(
    orgId: string,
    facilityId: string,
    input: UpdateFacilityInput,
  ): Promise<Facility | null>;
  deleteFacility(orgId: string, facilityId: string): Promise<boolean>;
  getFacilityWkt(orgId: string, facilityId: string): Promise<string | null>;

  listLanes(orgId: string): Promise<SupplyLane[]>;
  createLane(orgId: string, input: CreateSupplyLaneInput): Promise<SupplyLane>;
  updateLane(
    orgId: string,
    laneId: string,
    input: UpdateSupplyLaneInput,
  ): Promise<SupplyLane | null>;
  deleteLane(orgId: string, laneId: string): Promise<boolean>;
}

function mapProductRow(row: Record<string, unknown>): Product {
  return ProductSchema.parse({
    productId: row.productId,
    ownerOrgId: row.ownerOrgId,
    name: row.name,
    sku: typeof row.sku === "string" ? row.sku : null,
    description: typeof row.description === "string" ? row.description : null,
  });
}

function mapSupplyInputRow(row: Record<string, unknown>): SupplyInput {
  return SupplyInputSchema.parse({
    inputId: row.inputId,
    ownerOrgId: row.ownerOrgId,
    productId: typeof row.productId === "string" ? row.productId : null,
    name: row.name,
    category: row.category,
    unit: row.unit ?? "TONNES",
  });
}

function mapFacilityRow(row: Record<string, unknown>): Facility {
  return FacilitySchema.parse({
    facilityId: row.facilityId,
    ownerOrgId: row.ownerOrgId,
    name: row.name,
    kind: row.kind,
    locationPrecision: row.locationPrecision ?? "HQ_ESTIMATED",
    countryCode: row.countryCode,
    regionCode: typeof row.regionCode === "string" ? row.regionCode : null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    isOwnFacility: Boolean(row.isOwnFacility),
    isPartnerVerified: Boolean(row.isPartnerVerified),
    sector: typeof row.sector === "string" ? row.sector : null,
    esgBadges: Array.isArray(row.esgBadges) ? row.esgBadges : [],
    estimatedScope12Tco2e:
      typeof row.estimatedScope12Tco2e === "number"
        ? row.estimatedScope12Tco2e
        : null,
  });
}

function mapSupplyLaneRow(row: Record<string, unknown>): SupplyLane {
  return SupplyLaneSchema.parse({
    laneId: row.laneId,
    ownerOrgId: row.ownerOrgId,
    fromFacilityId: row.fromFacilityId,
    toFacilityId: row.toFacilityId,
    inputId: typeof row.inputId === "string" ? row.inputId : null,
    materialCategory: row.materialCategory,
    transportMode: row.transportMode,
    volumeSharePct: Number(row.volumeSharePct),
    annualVolume:
      typeof row.annualVolume === "number" ? row.annualVolume : null,
    volumeUnit: row.volumeUnit ?? "TONNES",
    annualSpendEur:
      typeof row.annualSpendEur === "number" ? row.annualSpendEur : null,
    contractEndDate:
      typeof row.contractEndDate === "string" ? row.contractEndDate : null,
    contractTerms:
      typeof row.contractTerms === "string" ? row.contractTerms : null,
    leadTimeDays:
      typeof row.leadTimeDays === "number" ? row.leadTimeDays : null,
    distanceKm: typeof row.distanceKm === "number" ? row.distanceKm : null,
    estimatedLaneCo2e:
      typeof row.estimatedLaneCo2e === "number" ? row.estimatedLaneCo2e : null,
    riskStatus: row.riskStatus ?? "GREEN",
    riskReason: typeof row.riskReason === "string" ? row.riskReason : null,
  });
}

/**
 * Strictly org-scoped ArcadeDB WorkspaceRepository.
 * Every query and mutation filters by `ownerOrgId = :orgId` using parameterized SQL.
 */
export class ArcadeDbWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: ArcadeDbClient) {}

  async getNetwork(
    orgId: string,
    filters?: NetworkFilters,
  ): Promise<WorkspaceNetworkResponse> {
    const safeOrgId = assertOrgId(orgId);
    const [products, inputs, facilities, lanes] = await Promise.all([
      this.listProducts(safeOrgId),
      this.listInputs(safeOrgId),
      this.listFacilities(safeOrgId),
      this.listLanes(safeOrgId),
    ]);
    return filterNetwork({ products, inputs, facilities, lanes, riskSignals: [] }, filters);
  }

  async listProducts(orgId: string): Promise<Product[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT productId, ownerOrgId, name, sku, description FROM Product WHERE ownerOrgId = :orgId",
      { orgId: safeOrgId },
    );
    return rows.map(mapProductRow);
  }

  private async findProduct(
    orgId: string,
    productId: string,
  ): Promise<Product | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT productId, ownerOrgId, name, sku, description FROM Product WHERE productId = :productId AND ownerOrgId = :orgId LIMIT 1",
      { productId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapProductRow(row) : null;
  }

  async createProduct(
    orgId: string,
    input: CreateProductInput,
  ): Promise<Product> {
    const safeOrgId = assertOrgId(orgId);
    const product = ProductSchema.parse({
      productId: randomUUID(),
      ownerOrgId: safeOrgId,
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX Product SET
        productId = :productId,
        ownerOrgId = :ownerOrgId,
        name = :name,
        sku = :sku,
        description = :description`,
      {
        productId: product.productId,
        ownerOrgId: product.ownerOrgId,
        name: product.name,
        sku: product.sku,
        description: product.description,
      },
    );

    return product;
  }

  async updateProduct(
    orgId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<Product | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findProduct(safeOrgId, productId);
    if (!existing) return null;

    const updated = ProductSchema.parse({
      ...existing,
      name: input.name !== undefined ? input.name : existing.name,
      sku: input.sku !== undefined ? input.sku : existing.sku,
      description:
        input.description !== undefined
          ? input.description
          : existing.description,
    });

    await this.db.command(
      "sql",
      `UPDATE Product SET
        name = :name,
        sku = :sku,
        description = :description
       WHERE productId = :productId AND ownerOrgId = :orgId`,
      {
        name: updated.name,
        sku: updated.sku,
        description: updated.description,
        productId,
        orgId: safeOrgId,
      },
    );

    return updated;
  }

  async deleteProduct(orgId: string, productId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findProduct(safeOrgId, productId);
    if (!existing) return false;

    await this.db.command(
      "sql",
      "UPDATE SupplyInput SET productId = null WHERE productId = :productId AND ownerOrgId = :orgId",
      { productId, orgId: safeOrgId },
    );
    await this.db.command(
      "sql",
      "DELETE VERTEX FROM Product WHERE productId = :productId AND ownerOrgId = :orgId",
      { productId, orgId: safeOrgId },
    );
    return true;
  }

  async listInputs(orgId: string): Promise<SupplyInput[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT inputId, ownerOrgId, productId, name, category, unit FROM SupplyInput WHERE ownerOrgId = :orgId",
      { orgId: safeOrgId },
    );
    return rows.map(mapSupplyInputRow);
  }

  private async findInput(
    orgId: string,
    inputId: string,
  ): Promise<SupplyInput | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT inputId, ownerOrgId, productId, name, category, unit FROM SupplyInput WHERE inputId = :inputId AND ownerOrgId = :orgId LIMIT 1",
      { inputId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapSupplyInputRow(row) : null;
  }

  async createInput(
    orgId: string,
    input: CreateSupplyInputInput,
  ): Promise<SupplyInput> {
    const safeOrgId = assertOrgId(orgId);
    const productId = input.productId ?? null;
    if (productId) {
      const product = await this.findProduct(safeOrgId, productId);
      if (!product) {
        throw new WorkspaceValidationError(
          "Referenced productId does not exist in this organization",
        );
      }
    }

    const created = SupplyInputSchema.parse({
      inputId: randomUUID(),
      ownerOrgId: safeOrgId,
      productId,
      name: input.name,
      category: input.category,
      unit: input.unit,
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX SupplyInput SET
        inputId = :inputId,
        ownerOrgId = :ownerOrgId,
        productId = :productId,
        name = :name,
        category = :category,
        unit = :unit`,
      {
        inputId: created.inputId,
        ownerOrgId: created.ownerOrgId,
        productId: created.productId,
        name: created.name,
        category: created.category,
        unit: created.unit,
      },
    );

    return created;
  }

  async updateInput(
    orgId: string,
    inputId: string,
    input: UpdateSupplyInputInput,
  ): Promise<SupplyInput | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findInput(safeOrgId, inputId);
    if (!existing) return null;

    const nextProductId =
      input.productId !== undefined ? input.productId : existing.productId;
    if (nextProductId) {
      const product = await this.findProduct(safeOrgId, nextProductId);
      if (!product) {
        throw new WorkspaceValidationError(
          "Referenced productId does not exist in this organization",
        );
      }
    }

    const updated = SupplyInputSchema.parse({
      ...existing,
      productId: nextProductId,
      name: input.name !== undefined ? input.name : existing.name,
      category:
        input.category !== undefined ? input.category : existing.category,
      unit: input.unit !== undefined ? input.unit : existing.unit,
    });

    await this.db.command(
      "sql",
      `UPDATE SupplyInput SET
        productId = :productId,
        name = :name,
        category = :category,
        unit = :unit
       WHERE inputId = :inputId AND ownerOrgId = :orgId`,
      {
        productId: updated.productId,
        name: updated.name,
        category: updated.category,
        unit: updated.unit,
        inputId,
        orgId: safeOrgId,
      },
    );

    return updated;
  }

  async deleteInput(orgId: string, inputId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findInput(safeOrgId, inputId);
    if (!existing) return false;

    await this.db.command(
      "sql",
      "UPDATE SUPPLIES_LANE SET inputId = null WHERE inputId = :inputId AND ownerOrgId = :orgId",
      { inputId, orgId: safeOrgId },
    );
    await this.db.command(
      "sql",
      "DELETE VERTEX FROM SupplyInput WHERE inputId = :inputId AND ownerOrgId = :orgId",
      { inputId, orgId: safeOrgId },
    );
    return true;
  }

  async listFacilities(orgId: string): Promise<Facility[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT facilityId, ownerOrgId, name, kind, locationPrecision, countryCode, regionCode,
              lat, lng, isOwnFacility, isPartnerVerified, sector, esgBadges, estimatedScope12Tco2e
       FROM Facility WHERE ownerOrgId = :orgId`,
      { orgId: safeOrgId },
    );
    return rows.map(mapFacilityRow);
  }

  private async findFacility(
    orgId: string,
    facilityId: string,
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT facilityId, ownerOrgId, name, kind, locationPrecision, countryCode, regionCode,
              lat, lng, isOwnFacility, isPartnerVerified, sector, esgBadges, estimatedScope12Tco2e
       FROM Facility WHERE facilityId = :facilityId AND ownerOrgId = :orgId LIMIT 1`,
      { facilityId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapFacilityRow(row) : null;
  }

  async getFacilityWkt(
    orgId: string,
    facilityId: string,
  ): Promise<string | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT locationWkt FROM Facility WHERE facilityId = :facilityId AND ownerOrgId = :orgId LIMIT 1",
      { facilityId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row && typeof row.locationWkt === "string" ? row.locationWkt : null;
  }

  async createFacility(
    orgId: string,
    input: CreateFacilityInput,
  ): Promise<Facility> {
    const safeOrgId = assertOrgId(orgId);
    const facility = FacilitySchema.parse({
      facilityId: randomUUID(),
      ownerOrgId: safeOrgId,
      name: input.name,
      kind: input.kind,
      locationPrecision: input.locationPrecision,
      countryCode: input.countryCode,
      regionCode: input.regionCode ?? null,
      lat: input.lat,
      lng: input.lng,
      isOwnFacility: input.isOwnFacility,
      isPartnerVerified: false,
      sector: input.sector ?? null,
      esgBadges: input.esgBadges ?? [],
      estimatedScope12Tco2e: input.estimatedScope12Tco2e ?? null,
    });

    const locationWkt = formatPointWkt(facility.lng, facility.lat);

    await this.db.command(
      "sql",
      `CREATE VERTEX Facility SET
        facilityId = :facilityId,
        ownerOrgId = :ownerOrgId,
        name = :name,
        kind = :kind,
        locationPrecision = :locationPrecision,
        countryCode = :countryCode,
        regionCode = :regionCode,
        lat = :lat,
        lng = :lng,
        locationWkt = :locationWkt,
        isOwnFacility = :isOwnFacility,
        isPartnerVerified = :isPartnerVerified,
        sector = :sector,
        esgBadges = :esgBadges,
        estimatedScope12Tco2e = :estimatedScope12Tco2e`,
      {
        facilityId: facility.facilityId,
        ownerOrgId: facility.ownerOrgId,
        name: facility.name,
        kind: facility.kind,
        locationPrecision: facility.locationPrecision,
        countryCode: facility.countryCode,
        regionCode: facility.regionCode,
        lat: facility.lat,
        lng: facility.lng,
        locationWkt,
        isOwnFacility: facility.isOwnFacility,
        isPartnerVerified: facility.isPartnerVerified,
        sector: facility.sector,
        esgBadges: facility.esgBadges,
        estimatedScope12Tco2e: facility.estimatedScope12Tco2e,
      },
    );

    return facility;
  }

  async updateFacility(
    orgId: string,
    facilityId: string,
    input: UpdateFacilityInput,
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findFacility(safeOrgId, facilityId);
    if (!existing) return null;

    const updated = FacilitySchema.parse({
      ...existing,
      name: input.name !== undefined ? input.name : existing.name,
      kind: input.kind !== undefined ? input.kind : existing.kind,
      locationPrecision:
        input.locationPrecision !== undefined
          ? input.locationPrecision
          : existing.locationPrecision,
      countryCode:
        input.countryCode !== undefined
          ? input.countryCode
          : existing.countryCode,
      regionCode:
        input.regionCode !== undefined ? input.regionCode : existing.regionCode,
      lat: input.lat !== undefined ? input.lat : existing.lat,
      lng: input.lng !== undefined ? input.lng : existing.lng,
      isOwnFacility:
        input.isOwnFacility !== undefined
          ? input.isOwnFacility
          : existing.isOwnFacility,
      sector: input.sector !== undefined ? input.sector : existing.sector,
      esgBadges:
        input.esgBadges !== undefined ? input.esgBadges : existing.esgBadges,
      estimatedScope12Tco2e:
        input.estimatedScope12Tco2e !== undefined
          ? input.estimatedScope12Tco2e
          : existing.estimatedScope12Tco2e,
    });

    const locationWkt = formatPointWkt(updated.lng, updated.lat);
    await this.db.command(
      "sql",
      `UPDATE Facility SET
        name = :name,
        kind = :kind,
        locationPrecision = :locationPrecision,
        countryCode = :countryCode,
        regionCode = :regionCode,
        lat = :lat,
        lng = :lng,
        locationWkt = :locationWkt,
        isOwnFacility = :isOwnFacility,
        sector = :sector,
        esgBadges = :esgBadges,
        estimatedScope12Tco2e = :estimatedScope12Tco2e
       WHERE facilityId = :facilityId AND ownerOrgId = :orgId`,
      {
        name: updated.name,
        kind: updated.kind,
        locationPrecision: updated.locationPrecision,
        countryCode: updated.countryCode,
        regionCode: updated.regionCode,
        lat: updated.lat,
        lng: updated.lng,
        locationWkt,
        isOwnFacility: updated.isOwnFacility,
        sector: updated.sector,
        esgBadges: updated.esgBadges,
        estimatedScope12Tco2e: updated.estimatedScope12Tco2e,
        facilityId,
        orgId: safeOrgId,
      },
    );

    const coordsChanged =
      updated.lat !== existing.lat || updated.lng !== existing.lng;
    if (coordsChanged) {
      await this.recomputeConnectedLanes(safeOrgId, updated);
    }

    return updated;
  }

  private async recomputeConnectedLanes(
    orgId: string,
    updatedFacility: Facility,
  ): Promise<void> {
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT laneId, ownerOrgId, fromFacilityId, toFacilityId, inputId, materialCategory,
              transportMode, volumeSharePct, annualVolume, volumeUnit, annualSpendEur,
              contractEndDate, contractTerms, leadTimeDays, distanceKm, estimatedLaneCo2e,
              riskStatus, riskReason
       FROM SUPPLIES_LANE
       WHERE ownerOrgId = :orgId AND (fromFacilityId = :facilityId OR toFacilityId = :facilityId)`,
      { orgId, facilityId: updatedFacility.facilityId },
    );

    for (const row of rows) {
      const lane = mapSupplyLaneRow(row);
      const from =
        lane.fromFacilityId === updatedFacility.facilityId
          ? updatedFacility
          : await this.findFacility(orgId, lane.fromFacilityId);
      const to =
        lane.toFacilityId === updatedFacility.facilityId
          ? updatedFacility
          : await this.findFacility(orgId, lane.toFacilityId);
      if (!from || !to) continue;

      const metrics = computeLaneMetrics({
        from,
        to,
        transportMode: lane.transportMode,
        annualVolume: lane.annualVolume,
        volumeUnit: lane.volumeUnit,
      });

      await this.db.command(
        "sql",
        `UPDATE SUPPLIES_LANE SET
          distanceKm = :distanceKm,
          estimatedLaneCo2e = :estimatedLaneCo2e
         WHERE laneId = :laneId AND ownerOrgId = :orgId`,
        {
          distanceKm: metrics.distanceKm,
          estimatedLaneCo2e: metrics.estimatedLaneCo2e,
          laneId: lane.laneId,
          orgId,
        },
      );
    }
  }

  async deleteFacility(orgId: string, facilityId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findFacility(safeOrgId, facilityId);
    if (!existing) return false;

    await this.db.command(
      "sql",
      "DELETE EDGE SUPPLIES_LANE WHERE ownerOrgId = :orgId AND (fromFacilityId = :facilityId OR toFacilityId = :facilityId)",
      { orgId: safeOrgId, facilityId },
    );
    await this.db.command(
      "sql",
      "DELETE VERTEX FROM Facility WHERE facilityId = :facilityId AND ownerOrgId = :orgId",
      { facilityId, orgId: safeOrgId },
    );
    return true;
  }

  async listLanes(orgId: string): Promise<SupplyLane[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT laneId, ownerOrgId, fromFacilityId, toFacilityId, inputId, materialCategory,
              transportMode, volumeSharePct, annualVolume, volumeUnit, annualSpendEur,
              contractEndDate, contractTerms, leadTimeDays, distanceKm, estimatedLaneCo2e,
              riskStatus, riskReason
       FROM SUPPLIES_LANE WHERE ownerOrgId = :orgId`,
      { orgId: safeOrgId },
    );
    return rows.map(mapSupplyLaneRow);
  }

  private async findLane(
    orgId: string,
    laneId: string,
  ): Promise<SupplyLane | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT laneId, ownerOrgId, fromFacilityId, toFacilityId, inputId, materialCategory,
              transportMode, volumeSharePct, annualVolume, volumeUnit, annualSpendEur,
              contractEndDate, contractTerms, leadTimeDays, distanceKm, estimatedLaneCo2e,
              riskStatus, riskReason
       FROM SUPPLIES_LANE WHERE laneId = :laneId AND ownerOrgId = :orgId LIMIT 1`,
      { laneId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapSupplyLaneRow(row) : null;
  }

  async createLane(
    orgId: string,
    input: CreateSupplyLaneInput,
  ): Promise<SupplyLane> {
    const safeOrgId = assertOrgId(orgId);
    if (input.fromFacilityId === input.toFacilityId) {
      throw new WorkspaceValidationError(
        "Supply lane cannot connect a facility to itself",
      );
    }

    const [fromFacility, toFacility] = await Promise.all([
      this.findFacility(safeOrgId, input.fromFacilityId),
      this.findFacility(safeOrgId, input.toFacilityId),
    ]);
    if (!fromFacility || !toFacility) {
      throw new WorkspaceValidationError(
        "Both fromFacilityId and toFacilityId must belong to this organization",
      );
    }

    const inputId = input.inputId ?? null;
    if (inputId) {
      const supplyInput = await this.findInput(safeOrgId, inputId);
      if (!supplyInput) {
        throw new WorkspaceValidationError(
          "Referenced inputId does not exist in this organization",
        );
      }
    }

    const annualVolume = input.annualVolume ?? null;
    const metrics = computeLaneMetrics({
      from: fromFacility,
      to: toFacility,
      transportMode: input.transportMode,
      annualVolume,
      volumeUnit: input.volumeUnit,
      explicitDistanceKm: input.distanceKm,
      explicitEstimatedLaneCo2e: input.estimatedLaneCo2e,
    });

    const lane = SupplyLaneSchema.parse({
      laneId: randomUUID(),
      ownerOrgId: safeOrgId,
      fromFacilityId: input.fromFacilityId,
      toFacilityId: input.toFacilityId,
      inputId,
      materialCategory: input.materialCategory,
      transportMode: input.transportMode,
      volumeSharePct: input.volumeSharePct,
      annualVolume,
      volumeUnit: input.volumeUnit,
      annualSpendEur: input.annualSpendEur ?? null,
      contractEndDate: input.contractEndDate ?? null,
      contractTerms: input.contractTerms ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      distanceKm: metrics.distanceKm,
      estimatedLaneCo2e: metrics.estimatedLaneCo2e,
      riskStatus: input.riskStatus,
      riskReason: input.riskReason ?? null,
    });

    await this.insertLaneEdge(lane);
    return lane;
  }

  private async insertLaneEdge(lane: SupplyLane): Promise<void> {
    await this.db.command(
      "sql",
      `CREATE EDGE SUPPLIES_LANE
       FROM (SELECT FROM Facility WHERE facilityId = :fromFacilityId AND ownerOrgId = :ownerOrgId)
       TO (SELECT FROM Facility WHERE facilityId = :toFacilityId AND ownerOrgId = :ownerOrgId)
       SET
         laneId = :laneId,
         ownerOrgId = :ownerOrgId,
         fromFacilityId = :fromFacilityId,
         toFacilityId = :toFacilityId,
         inputId = :inputId,
         materialCategory = :materialCategory,
         transportMode = :transportMode,
         volumeSharePct = :volumeSharePct,
         annualVolume = :annualVolume,
         volumeUnit = :volumeUnit,
         annualSpendEur = :annualSpendEur,
         contractEndDate = :contractEndDate,
         contractTerms = :contractTerms,
         leadTimeDays = :leadTimeDays,
         distanceKm = :distanceKm,
         estimatedLaneCo2e = :estimatedLaneCo2e,
         riskStatus = :riskStatus,
         riskReason = :riskReason`,
      {
        laneId: lane.laneId,
        ownerOrgId: lane.ownerOrgId,
        fromFacilityId: lane.fromFacilityId,
        toFacilityId: lane.toFacilityId,
        inputId: lane.inputId,
        materialCategory: lane.materialCategory,
        transportMode: lane.transportMode,
        volumeSharePct: lane.volumeSharePct,
        annualVolume: lane.annualVolume,
        volumeUnit: lane.volumeUnit,
        annualSpendEur: lane.annualSpendEur,
        contractEndDate: lane.contractEndDate,
        contractTerms: lane.contractTerms,
        leadTimeDays: lane.leadTimeDays,
        distanceKm: lane.distanceKm,
        estimatedLaneCo2e: lane.estimatedLaneCo2e,
        riskStatus: lane.riskStatus,
        riskReason: lane.riskReason,
      },
    );
  }

  async updateLane(
    orgId: string,
    laneId: string,
    input: UpdateSupplyLaneInput,
  ): Promise<SupplyLane | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findLane(safeOrgId, laneId);
    if (!existing) return null;

    const nextFromId =
      input.fromFacilityId !== undefined
        ? input.fromFacilityId
        : existing.fromFacilityId;
    const nextToId =
      input.toFacilityId !== undefined
        ? input.toFacilityId
        : existing.toFacilityId;

    if (nextFromId === nextToId) {
      throw new WorkspaceValidationError(
        "Supply lane cannot connect a facility to itself",
      );
    }

    const [fromFacility, toFacility] = await Promise.all([
      this.findFacility(safeOrgId, nextFromId),
      this.findFacility(safeOrgId, nextToId),
    ]);
    if (!fromFacility || !toFacility) {
      throw new WorkspaceValidationError(
        "Both fromFacilityId and toFacilityId must belong to this organization",
      );
    }

    const nextInputId =
      input.inputId !== undefined ? input.inputId : existing.inputId;
    if (nextInputId) {
      const supplyInput = await this.findInput(safeOrgId, nextInputId);
      if (!supplyInput) {
        throw new WorkspaceValidationError(
          "Referenced inputId does not exist in this organization",
        );
      }
    }

    const nextTransportMode =
      input.transportMode !== undefined
        ? input.transportMode
        : existing.transportMode;
    const nextAnnualVolume =
      input.annualVolume !== undefined
        ? input.annualVolume
        : existing.annualVolume;
    const nextVolumeUnit =
      input.volumeUnit !== undefined ? input.volumeUnit : existing.volumeUnit;

    const endpointsChanged =
      nextFromId !== existing.fromFacilityId ||
      nextToId !== existing.toFacilityId;
    const emissionsInputChanged =
      endpointsChanged ||
      nextTransportMode !== existing.transportMode ||
      nextAnnualVolume !== existing.annualVolume ||
      nextVolumeUnit !== existing.volumeUnit;

    const metrics = computeLaneMetrics({
      from: fromFacility,
      to: toFacility,
      transportMode: nextTransportMode,
      annualVolume: nextAnnualVolume,
      volumeUnit: nextVolumeUnit,
      explicitDistanceKm:
        input.distanceKm !== undefined
          ? input.distanceKm
          : endpointsChanged
            ? undefined
            : existing.distanceKm,
      explicitEstimatedLaneCo2e:
        input.estimatedLaneCo2e !== undefined
          ? input.estimatedLaneCo2e
          : emissionsInputChanged
            ? undefined
            : existing.estimatedLaneCo2e,
    });

    const updated = SupplyLaneSchema.parse({
      ...existing,
      fromFacilityId: nextFromId,
      toFacilityId: nextToId,
      inputId: nextInputId,
      materialCategory:
        input.materialCategory !== undefined
          ? input.materialCategory
          : existing.materialCategory,
      transportMode: nextTransportMode,
      volumeSharePct:
        input.volumeSharePct !== undefined
          ? input.volumeSharePct
          : existing.volumeSharePct,
      annualVolume: nextAnnualVolume,
      volumeUnit: nextVolumeUnit,
      annualSpendEur:
        input.annualSpendEur !== undefined
          ? input.annualSpendEur
          : existing.annualSpendEur,
      contractEndDate:
        input.contractEndDate !== undefined
          ? input.contractEndDate
          : existing.contractEndDate,
      contractTerms:
        input.contractTerms !== undefined
          ? input.contractTerms
          : existing.contractTerms,
      leadTimeDays:
        input.leadTimeDays !== undefined
          ? input.leadTimeDays
          : existing.leadTimeDays,
      distanceKm: metrics.distanceKm,
      estimatedLaneCo2e: metrics.estimatedLaneCo2e,
      riskStatus:
        input.riskStatus !== undefined ? input.riskStatus : existing.riskStatus,
      riskReason:
        input.riskReason !== undefined ? input.riskReason : existing.riskReason,
    });

    if (endpointsChanged) {
      await this.db.command(
        "sql",
        "DELETE EDGE SUPPLIES_LANE WHERE laneId = :laneId AND ownerOrgId = :orgId",
        { laneId, orgId: safeOrgId },
      );
      await this.insertLaneEdge(updated);
    } else {
      await this.db.command(
        "sql",
        `UPDATE SUPPLIES_LANE SET
          inputId = :inputId,
          materialCategory = :materialCategory,
          transportMode = :transportMode,
          volumeSharePct = :volumeSharePct,
          annualVolume = :annualVolume,
          volumeUnit = :volumeUnit,
          annualSpendEur = :annualSpendEur,
          contractEndDate = :contractEndDate,
          contractTerms = :contractTerms,
          leadTimeDays = :leadTimeDays,
          distanceKm = :distanceKm,
          estimatedLaneCo2e = :estimatedLaneCo2e,
          riskStatus = :riskStatus,
          riskReason = :riskReason
         WHERE laneId = :laneId AND ownerOrgId = :orgId`,
        {
          inputId: updated.inputId,
          materialCategory: updated.materialCategory,
          transportMode: updated.transportMode,
          volumeSharePct: updated.volumeSharePct,
          annualVolume: updated.annualVolume,
          volumeUnit: updated.volumeUnit,
          annualSpendEur: updated.annualSpendEur,
          contractEndDate: updated.contractEndDate,
          contractTerms: updated.contractTerms,
          leadTimeDays: updated.leadTimeDays,
          distanceKm: updated.distanceKm,
          estimatedLaneCo2e: updated.estimatedLaneCo2e,
          riskStatus: updated.riskStatus,
          riskReason: updated.riskReason,
          laneId,
          orgId: safeOrgId,
        },
      );
    }

    return updated;
  }

  async deleteLane(orgId: string, laneId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findLane(safeOrgId, laneId);
    if (!existing) return false;

    await this.db.command(
      "sql",
      "DELETE EDGE SUPPLIES_LANE WHERE laneId = :laneId AND ownerOrgId = :orgId",
      { laneId, orgId: safeOrgId },
    );
    return true;
  }
}

interface StoredFacilityRecord {
  facility: Facility;
  locationWkt: string;
}

/**
 * Strictly org-scoped In-Memory WorkspaceRepository for deterministic Vitest / CI tests.
 */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly products = new Map<string, Product>();
  private readonly inputs = new Map<string, SupplyInput>();
  private readonly facilities = new Map<string, StoredFacilityRecord>();
  private readonly lanes = new Map<string, SupplyLane>();

  async getNetwork(
    orgId: string,
    filters?: NetworkFilters,
  ): Promise<WorkspaceNetworkResponse> {
    const safeOrgId = assertOrgId(orgId);
    const [products, inputs, facilities, lanes] = await Promise.all([
      this.listProducts(safeOrgId),
      this.listInputs(safeOrgId),
      this.listFacilities(safeOrgId),
      this.listLanes(safeOrgId),
    ]);
    return filterNetwork({ products, inputs, facilities, lanes, riskSignals: [] }, filters);
  }

  async listProducts(orgId: string): Promise<Product[]> {
    const safeOrgId = assertOrgId(orgId);
    return Array.from(this.products.values())
      .filter((p) => p.ownerOrgId === safeOrgId)
      .map((p) => ({ ...p }));
  }

  async createProduct(
    orgId: string,
    input: CreateProductInput,
  ): Promise<Product> {
    const safeOrgId = assertOrgId(orgId);
    const product = ProductSchema.parse({
      productId: randomUUID(),
      ownerOrgId: safeOrgId,
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
    });
    this.products.set(product.productId, product);
    return { ...product };
  }

  async updateProduct(
    orgId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<Product | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.products.get(productId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return null;

    const updated = ProductSchema.parse({
      ...existing,
      name: input.name !== undefined ? input.name : existing.name,
      sku: input.sku !== undefined ? input.sku : existing.sku,
      description:
        input.description !== undefined
          ? input.description
          : existing.description,
    });
    this.products.set(productId, updated);
    return { ...updated };
  }

  async deleteProduct(orgId: string, productId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.products.get(productId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return false;

    for (const [id, supplyInput] of this.inputs.entries()) {
      if (
        supplyInput.ownerOrgId === safeOrgId &&
        supplyInput.productId === productId
      ) {
        this.inputs.set(id, { ...supplyInput, productId: null });
      }
    }
    this.products.delete(productId);
    return true;
  }

  async listInputs(orgId: string): Promise<SupplyInput[]> {
    const safeOrgId = assertOrgId(orgId);
    return Array.from(this.inputs.values())
      .filter((i) => i.ownerOrgId === safeOrgId)
      .map((i) => ({ ...i }));
  }

  async createInput(
    orgId: string,
    input: CreateSupplyInputInput,
  ): Promise<SupplyInput> {
    const safeOrgId = assertOrgId(orgId);
    const productId = input.productId ?? null;
    if (productId) {
      const product = this.products.get(productId);
      if (!product || product.ownerOrgId !== safeOrgId) {
        throw new WorkspaceValidationError(
          "Referenced productId does not exist in this organization",
        );
      }
    }

    const created = SupplyInputSchema.parse({
      inputId: randomUUID(),
      ownerOrgId: safeOrgId,
      productId,
      name: input.name,
      category: input.category,
      unit: input.unit,
    });
    this.inputs.set(created.inputId, created);
    return { ...created };
  }

  async updateInput(
    orgId: string,
    inputId: string,
    input: UpdateSupplyInputInput,
  ): Promise<SupplyInput | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.inputs.get(inputId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return null;

    const nextProductId =
      input.productId !== undefined ? input.productId : existing.productId;
    if (nextProductId) {
      const product = this.products.get(nextProductId);
      if (!product || product.ownerOrgId !== safeOrgId) {
        throw new WorkspaceValidationError(
          "Referenced productId does not exist in this organization",
        );
      }
    }

    const updated = SupplyInputSchema.parse({
      ...existing,
      productId: nextProductId,
      name: input.name !== undefined ? input.name : existing.name,
      category:
        input.category !== undefined ? input.category : existing.category,
      unit: input.unit !== undefined ? input.unit : existing.unit,
    });
    this.inputs.set(inputId, updated);
    return { ...updated };
  }

  async deleteInput(orgId: string, inputId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.inputs.get(inputId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return false;

    for (const [id, lane] of this.lanes.entries()) {
      if (lane.ownerOrgId === safeOrgId && lane.inputId === inputId) {
        this.lanes.set(id, { ...lane, inputId: null });
      }
    }
    this.inputs.delete(inputId);
    return true;
  }

  async listFacilities(orgId: string): Promise<Facility[]> {
    const safeOrgId = assertOrgId(orgId);
    return Array.from(this.facilities.values())
      .filter((rec) => rec.facility.ownerOrgId === safeOrgId)
      .map((rec) => ({
        ...rec.facility,
        esgBadges: [...rec.facility.esgBadges],
      }));
  }

  async getFacilityWkt(
    orgId: string,
    facilityId: string,
  ): Promise<string | null> {
    const safeOrgId = assertOrgId(orgId);
    const record = this.facilities.get(facilityId);
    if (!record || record.facility.ownerOrgId !== safeOrgId) return null;
    return record.locationWkt;
  }

  async createFacility(
    orgId: string,
    input: CreateFacilityInput,
  ): Promise<Facility> {
    const safeOrgId = assertOrgId(orgId);
    const facility = FacilitySchema.parse({
      facilityId: randomUUID(),
      ownerOrgId: safeOrgId,
      name: input.name,
      kind: input.kind,
      locationPrecision: input.locationPrecision,
      countryCode: input.countryCode,
      regionCode: input.regionCode ?? null,
      lat: input.lat,
      lng: input.lng,
      isOwnFacility: input.isOwnFacility,
      isPartnerVerified: false,
      sector: input.sector ?? null,
      esgBadges: input.esgBadges ?? [],
      estimatedScope12Tco2e: input.estimatedScope12Tco2e ?? null,
    });
    this.facilities.set(facility.facilityId, {
      facility,
      locationWkt: formatPointWkt(facility.lng, facility.lat),
    });
    return { ...facility, esgBadges: [...facility.esgBadges] };
  }

  async updateFacility(
    orgId: string,
    facilityId: string,
    input: UpdateFacilityInput,
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(orgId);
    const record = this.facilities.get(facilityId);
    if (!record || record.facility.ownerOrgId !== safeOrgId) return null;

    const existing = record.facility;
    const updated = FacilitySchema.parse({
      ...existing,
      name: input.name !== undefined ? input.name : existing.name,
      kind: input.kind !== undefined ? input.kind : existing.kind,
      locationPrecision:
        input.locationPrecision !== undefined
          ? input.locationPrecision
          : existing.locationPrecision,
      countryCode:
        input.countryCode !== undefined
          ? input.countryCode
          : existing.countryCode,
      regionCode:
        input.regionCode !== undefined ? input.regionCode : existing.regionCode,
      lat: input.lat !== undefined ? input.lat : existing.lat,
      lng: input.lng !== undefined ? input.lng : existing.lng,
      isOwnFacility:
        input.isOwnFacility !== undefined
          ? input.isOwnFacility
          : existing.isOwnFacility,
      sector: input.sector !== undefined ? input.sector : existing.sector,
      esgBadges:
        input.esgBadges !== undefined ? input.esgBadges : existing.esgBadges,
      estimatedScope12Tco2e:
        input.estimatedScope12Tco2e !== undefined
          ? input.estimatedScope12Tco2e
          : existing.estimatedScope12Tco2e,
    });

    this.facilities.set(facilityId, {
      facility: updated,
      locationWkt: formatPointWkt(updated.lng, updated.lat),
    });

    const coordsChanged =
      updated.lat !== existing.lat || updated.lng !== existing.lng;
    if (coordsChanged) {
      for (const [laneId, lane] of this.lanes.entries()) {
        if (
          lane.ownerOrgId === safeOrgId &&
          (lane.fromFacilityId === facilityId ||
            lane.toFacilityId === facilityId)
        ) {
          const from = this.facilities.get(lane.fromFacilityId)?.facility;
          const to = this.facilities.get(lane.toFacilityId)?.facility;
          if (!from || !to) continue;
          const metrics = computeLaneMetrics({
            from,
            to,
            transportMode: lane.transportMode,
            annualVolume: lane.annualVolume,
            volumeUnit: lane.volumeUnit,
          });
          this.lanes.set(laneId, {
            ...lane,
            distanceKm: metrics.distanceKm,
            estimatedLaneCo2e: metrics.estimatedLaneCo2e,
          });
        }
      }
    }

    return { ...updated, esgBadges: [...updated.esgBadges] };
  }

  async deleteFacility(orgId: string, facilityId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const record = this.facilities.get(facilityId);
    if (!record || record.facility.ownerOrgId !== safeOrgId) return false;

    for (const [laneId, lane] of this.lanes.entries()) {
      if (
        lane.ownerOrgId === safeOrgId &&
        (lane.fromFacilityId === facilityId || lane.toFacilityId === facilityId)
      ) {
        this.lanes.delete(laneId);
      }
    }
    this.facilities.delete(facilityId);
    return true;
  }

  async listLanes(orgId: string): Promise<SupplyLane[]> {
    const safeOrgId = assertOrgId(orgId);
    return Array.from(this.lanes.values())
      .filter((l) => l.ownerOrgId === safeOrgId)
      .map((l) => ({ ...l }));
  }

  async createLane(
    orgId: string,
    input: CreateSupplyLaneInput,
  ): Promise<SupplyLane> {
    const safeOrgId = assertOrgId(orgId);
    if (input.fromFacilityId === input.toFacilityId) {
      throw new WorkspaceValidationError(
        "Supply lane cannot connect a facility to itself",
      );
    }

    const fromRecord = this.facilities.get(input.fromFacilityId);
    const toRecord = this.facilities.get(input.toFacilityId);
    if (
      !fromRecord ||
      fromRecord.facility.ownerOrgId !== safeOrgId ||
      !toRecord ||
      toRecord.facility.ownerOrgId !== safeOrgId
    ) {
      throw new WorkspaceValidationError(
        "Both fromFacilityId and toFacilityId must belong to this organization",
      );
    }

    const inputId = input.inputId ?? null;
    if (inputId) {
      const supplyInput = this.inputs.get(inputId);
      if (!supplyInput || supplyInput.ownerOrgId !== safeOrgId) {
        throw new WorkspaceValidationError(
          "Referenced inputId does not exist in this organization",
        );
      }
    }

    const annualVolume = input.annualVolume ?? null;
    const metrics = computeLaneMetrics({
      from: fromRecord.facility,
      to: toRecord.facility,
      transportMode: input.transportMode,
      annualVolume,
      volumeUnit: input.volumeUnit,
      explicitDistanceKm: input.distanceKm,
      explicitEstimatedLaneCo2e: input.estimatedLaneCo2e,
    });

    const lane = SupplyLaneSchema.parse({
      laneId: randomUUID(),
      ownerOrgId: safeOrgId,
      fromFacilityId: input.fromFacilityId,
      toFacilityId: input.toFacilityId,
      inputId,
      materialCategory: input.materialCategory,
      transportMode: input.transportMode,
      volumeSharePct: input.volumeSharePct,
      annualVolume,
      volumeUnit: input.volumeUnit,
      annualSpendEur: input.annualSpendEur ?? null,
      contractEndDate: input.contractEndDate ?? null,
      contractTerms: input.contractTerms ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      distanceKm: metrics.distanceKm,
      estimatedLaneCo2e: metrics.estimatedLaneCo2e,
      riskStatus: input.riskStatus,
      riskReason: input.riskReason ?? null,
    });

    this.lanes.set(lane.laneId, lane);
    return { ...lane };
  }

  async updateLane(
    orgId: string,
    laneId: string,
    input: UpdateSupplyLaneInput,
  ): Promise<SupplyLane | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.lanes.get(laneId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return null;

    const nextFromId =
      input.fromFacilityId !== undefined
        ? input.fromFacilityId
        : existing.fromFacilityId;
    const nextToId =
      input.toFacilityId !== undefined
        ? input.toFacilityId
        : existing.toFacilityId;

    if (nextFromId === nextToId) {
      throw new WorkspaceValidationError(
        "Supply lane cannot connect a facility to itself",
      );
    }

    const fromRecord = this.facilities.get(nextFromId);
    const toRecord = this.facilities.get(nextToId);
    if (
      !fromRecord ||
      fromRecord.facility.ownerOrgId !== safeOrgId ||
      !toRecord ||
      toRecord.facility.ownerOrgId !== safeOrgId
    ) {
      throw new WorkspaceValidationError(
        "Both fromFacilityId and toFacilityId must belong to this organization",
      );
    }

    const nextInputId =
      input.inputId !== undefined ? input.inputId : existing.inputId;
    if (nextInputId) {
      const supplyInput = this.inputs.get(nextInputId);
      if (!supplyInput || supplyInput.ownerOrgId !== safeOrgId) {
        throw new WorkspaceValidationError(
          "Referenced inputId does not exist in this organization",
        );
      }
    }

    const nextTransportMode =
      input.transportMode !== undefined
        ? input.transportMode
        : existing.transportMode;
    const nextAnnualVolume =
      input.annualVolume !== undefined
        ? input.annualVolume
        : existing.annualVolume;
    const nextVolumeUnit =
      input.volumeUnit !== undefined ? input.volumeUnit : existing.volumeUnit;

    const endpointsChanged =
      nextFromId !== existing.fromFacilityId ||
      nextToId !== existing.toFacilityId;
    const emissionsInputChanged =
      endpointsChanged ||
      nextTransportMode !== existing.transportMode ||
      nextAnnualVolume !== existing.annualVolume ||
      nextVolumeUnit !== existing.volumeUnit;

    const metrics = computeLaneMetrics({
      from: fromRecord.facility,
      to: toRecord.facility,
      transportMode: nextTransportMode,
      annualVolume: nextAnnualVolume,
      volumeUnit: nextVolumeUnit,
      explicitDistanceKm:
        input.distanceKm !== undefined
          ? input.distanceKm
          : endpointsChanged
            ? undefined
            : existing.distanceKm,
      explicitEstimatedLaneCo2e:
        input.estimatedLaneCo2e !== undefined
          ? input.estimatedLaneCo2e
          : emissionsInputChanged
            ? undefined
            : existing.estimatedLaneCo2e,
    });

    const updated = SupplyLaneSchema.parse({
      ...existing,
      fromFacilityId: nextFromId,
      toFacilityId: nextToId,
      inputId: nextInputId,
      materialCategory:
        input.materialCategory !== undefined
          ? input.materialCategory
          : existing.materialCategory,
      transportMode: nextTransportMode,
      volumeSharePct:
        input.volumeSharePct !== undefined
          ? input.volumeSharePct
          : existing.volumeSharePct,
      annualVolume: nextAnnualVolume,
      volumeUnit: nextVolumeUnit,
      annualSpendEur:
        input.annualSpendEur !== undefined
          ? input.annualSpendEur
          : existing.annualSpendEur,
      contractEndDate:
        input.contractEndDate !== undefined
          ? input.contractEndDate
          : existing.contractEndDate,
      contractTerms:
        input.contractTerms !== undefined
          ? input.contractTerms
          : existing.contractTerms,
      leadTimeDays:
        input.leadTimeDays !== undefined
          ? input.leadTimeDays
          : existing.leadTimeDays,
      distanceKm: metrics.distanceKm,
      estimatedLaneCo2e: metrics.estimatedLaneCo2e,
      riskStatus:
        input.riskStatus !== undefined ? input.riskStatus : existing.riskStatus,
      riskReason:
        input.riskReason !== undefined ? input.riskReason : existing.riskReason,
    });

    this.lanes.set(laneId, updated);
    return { ...updated };
  }

  async deleteLane(orgId: string, laneId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.lanes.get(laneId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return false;
    this.lanes.delete(laneId);
    return true;
  }
}
