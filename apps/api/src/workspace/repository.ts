import { randomUUID } from "node:crypto";
import { estimateLaneCo2eTonnes, haversineDistanceKm } from "@kulgo/engine";
import {
  ContractLineSchema,
  ContractSchema,
  FacilitySchema,
  ProductSchema,
  SupplyInputSchema,
  SupplyLaneSchema,
  WorkspaceNetworkResponseSchema,
  type Contract,
  type ContractLine,
  type CreateContractInput,
  type CreateContractLineInput,
  type CreateFacilityInput,
  type CreateProductInput,
  type CreateSupplyInputInput,
  type CreateSupplyLaneInput,
  type Facility,
  type Product,
  type SupplyInput,
  type SupplyLane,
  type TransportMode,
  type UpdateContractInput,
  type UpdateContractLineInput,
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
  const facilities = network.facilities.filter(
    (f) => f.isOwnFacility || facilityIds.has(f.facilityId),
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

  const laneIdSet = new Set(lanes.map((l) => l.laneId));
  const contractLines = network.contractLines?.filter((cl) =>
    laneIdSet.has(cl.laneId),
  );
  const contractIdSet = new Set(contractLines?.map((cl) => cl.contractId) ?? []);
  const contracts = network.contracts?.filter(
    (c) =>
      contractIdSet.has(c.contractId) || facilityIds.has(c.supplierFacilityId),
  );

  return WorkspaceNetworkResponseSchema.parse({
    products,
    inputs,
    facilities,
    lanes,
    riskSignals: network.riskSignals,
    ...(contracts ? { contracts } : {}),
    ...(contractLines ? { contractLines } : {}),
  });
}

export interface WorkspaceRepositoryHooks {
  onFacilityDeleted?: (orgId: string, facilityId: string) => Promise<void>;
}

export interface WorkspaceRepository {
  getNetwork(
    orgId: string,
    filters?: NetworkFilters,
  ): Promise<WorkspaceNetworkResponse>;

  listProducts(orgId: string): Promise<Product[]>;
  createProduct(orgId: string, input: CreateProductInput, importedId?: string): Promise<Product>;
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
    importedId?: string,
  ): Promise<SupplyInput>;
  updateInput(
    orgId: string,
    inputId: string,
    input: UpdateSupplyInputInput,
  ): Promise<SupplyInput | null>;
  deleteInput(orgId: string, inputId: string): Promise<boolean>;

  listFacilities(orgId: string): Promise<Facility[]>;
  getFacilityById(orgId: string, facilityId: string): Promise<Facility | null>;
  createFacility(orgId: string, input: CreateFacilityInput, importedId?: string): Promise<Facility>;
  updateFacility(
    orgId: string,
    facilityId: string,
    input: UpdateFacilityInput,
  ): Promise<Facility | null>;
  markFacilityPartnerVerified(
    ownerOrgId: string,
    facilityId: string,
    partnerOrgId: string,
    refinedSite?: {
      kind: Facility["kind"];
      lat: number;
      lng: number;
      countryCode: string;
    },
  ): Promise<Facility | null>;
  deleteFacility(orgId: string, facilityId: string): Promise<boolean>;
  getFacilityWkt(orgId: string, facilityId: string): Promise<string | null>;

  listLanes(orgId: string): Promise<SupplyLane[]>;
  createLane(orgId: string, input: CreateSupplyLaneInput, importedId?: string): Promise<SupplyLane>;
  updateLane(
    orgId: string,
    laneId: string,
    input: UpdateSupplyLaneInput,
  ): Promise<SupplyLane | null>;
  deleteLane(orgId: string, laneId: string): Promise<boolean>;

  listContracts(orgId: string): Promise<Contract[]>;
  listContractLines(orgId: string): Promise<ContractLine[]>;
  createContract(orgId: string, input: CreateContractInput): Promise<Contract>;
  updateContract(
    orgId: string,
    contractId: string,
    input: UpdateContractInput,
  ): Promise<Contract | null>;
  createContractLine(
    orgId: string,
    input: CreateContractLineInput,
  ): Promise<ContractLine>;
  updateContractLine(
    orgId: string,
    contractLineId: string,
    input: UpdateContractLineInput,
  ): Promise<ContractLine | null>;
}

function parseConversionFactorsJson(
  raw: unknown,
): Record<string, number> | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    // ignore malformed json
  }
  return undefined;
}

function mapProductRow(row: Record<string, unknown>): Product {
  return ProductSchema.parse({
    productId: row.productId,
    ownerOrgId: row.ownerOrgId,
    name: row.name,
    sku: typeof row.sku === "string" ? row.sku : null,
    description: typeof row.description === "string" ? row.description : null,
    ...(typeof row.annualRevenueEur === "number"
      ? { annualRevenueEur: row.annualRevenueEur }
      : {}),
    ...(typeof row.grossMarginPct === "number"
      ? { grossMarginPct: row.grossMarginPct }
      : {}),
  });
}

function mapSupplyInputRow(row: Record<string, unknown>): SupplyInput {
  const unitConversionFactors = parseConversionFactorsJson(
    row.unitConversionFactorsJson,
  );
  return SupplyInputSchema.parse({
    inputId: row.inputId,
    ownerOrgId: row.ownerOrgId,
    productId: typeof row.productId === "string" ? row.productId : null,
    name: row.name,
    category: row.category,
    unit: row.unit ?? "TONNES",
    ...(typeof row.baseUnit === "string" ? { baseUnit: row.baseUnit } : {}),
    ...(typeof row.unitFamily === "string"
      ? { unitFamily: row.unitFamily }
      : {}),
    ...(unitConversionFactors ? { unitConversionFactors } : {}),
    ...(typeof row.totalAnnualDemand === "number"
      ? { totalAnnualDemand: row.totalAnnualDemand }
      : {}),
    ...(typeof row.materialCriticality === "number"
      ? { materialCriticality: row.materialCriticality }
      : {}),
    ...(typeof row.cnCode === "string" ? { cnCode: row.cnCode } : {}),
    ...(typeof row.materialArchetype === "string"
      ? { materialArchetype: row.materialArchetype }
      : {}),
    ...(typeof row.unitMassKg === "number" ? { unitMassKg: row.unitMassKg } : {}),
    ...(typeof row.productEmissionFactorTco2ePerUnit === "number"
      ? { productEmissionFactorTco2ePerUnit: row.productEmissionFactorTco2ePerUnit }
      : {}),
    ...(typeof row.pcfVerified === "boolean"
      ? { pcfVerified: row.pcfVerified }
      : {}),
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
    ...(typeof row.defaultCarryingCostPct === "number"
      ? { defaultCarryingCostPct: row.defaultCarryingCostPct }
      : {}),
    ...(typeof row.annualElectricityMwh === "number"
      ? { annualElectricityMwh: row.annualElectricityMwh }
      : {}),
    ...(typeof row.renewableElectricityPct === "number"
      ? { renewableElectricityPct: row.renewableElectricityPct }
      : {}),
    ...(typeof row.renewableInstrumentsVerified === "boolean"
      ? { renewableInstrumentsVerified: row.renewableInstrumentsVerified }
      : {}),
    ...(typeof row.annualRevenueEur === "number"
      ? { annualRevenueEur: row.annualRevenueEur }
      : {}),
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
    ...(typeof row.safetyStockDays === "number"
      ? { safetyStockDays: row.safetyStockDays }
      : {}),
    ...(typeof row.defectRatePct === "number"
      ? { defectRatePct: row.defectRatePct }
      : {}),
    ...(typeof row.carryingCostPct === "number"
      ? { carryingCostPct: row.carryingCostPct }
      : {}),
    ...(typeof row.unitLandedCostEur === "number"
      ? { unitLandedCostEur: row.unitLandedCostEur }
      : {}),
    ...(typeof row.ordinaryFreightCostPerUnitEur === "number"
      ? { ordinaryFreightCostPerUnitEur: row.ordinaryFreightCostPerUnitEur }
      : {}),
    ...(typeof row.customAnnualDisruptionProb === "number"
      ? { customAnnualDisruptionProb: row.customAnnualDisruptionProb }
      : {}),
    ...(typeof row.customTtrDays === "number"
      ? { customTtrDays: row.customTtrDays }
      : {}),
    ...(typeof row.productEmissionFactorTco2ePerUnit === "number"
      ? { productEmissionFactorTco2ePerUnit: row.productEmissionFactorTco2ePerUnit }
      : {}),
    ...(typeof row.pcfVerified === "boolean"
      ? { pcfVerified: row.pcfVerified }
      : {}),
    ...(typeof row.economicAttributionRatio === "number"
      ? { economicAttributionRatio: row.economicAttributionRatio }
      : {}),
  });
}

function mapContractRow(row: Record<string, unknown>): Contract {
  return ContractSchema.parse({
    contractId: row.contractId,
    ownerOrgId: row.ownerOrgId,
    supplierFacilityId: row.supplierFacilityId,
    title: row.title,
    contractType: row.contractType ?? "FRAMEWORK",
    pricingModel: row.pricingModel ?? "FIXED",
    expiryBehavior: row.expiryBehavior ?? "HOLDOVER",
    confidence: row.confidence ?? "CONTRACTED",
    startDate: row.startDate,
    endDate: typeof row.endDate === "string" ? row.endDate : null,
    noticePeriodDays:
      typeof row.noticePeriodDays === "number" ? row.noticePeriodDays : 0,
    nonRenewalNoticeGiven: Boolean(row.nonRenewalNoticeGiven),
    archiveEffectiveDate:
      typeof row.archiveEffectiveDate === "string"
        ? row.archiveEffectiveDate
        : null,
    isManuallyArchived: Boolean(row.isManuallyArchived),
    incoterms: typeof row.incoterms === "string" ? row.incoterms : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  });
}

function mapContractLineRow(row: Record<string, unknown>): ContractLine {
  return ContractLineSchema.parse({
    contractLineId: row.contractLineId,
    contractId: row.contractId,
    ownerOrgId: row.ownerOrgId,
    laneId: row.laneId,
    inputId: typeof row.inputId === "string" ? row.inputId : null,
    cadence: row.cadence ?? "PER_YEAR",
    committedVolume:
      typeof row.committedVolume === "number" ? row.committedVolume : null,
    unit: typeof row.unit === "string" ? row.unit : "TONNES",
    committedSpend:
      typeof row.committedSpend === "number" ? row.committedSpend : null,
    unitPrice: typeof row.unitPrice === "number" ? row.unitPrice : null,
    currency: typeof row.currency === "string" ? row.currency : "EUR",
    startDateOverride:
      typeof row.startDateOverride === "string" ? row.startDateOverride : null,
    endDateOverride:
      typeof row.endDateOverride === "string" ? row.endDateOverride : null,
  });
}

/**
 * Strictly org-scoped ArcadeDB WorkspaceRepository.
 * Every query and mutation filters by `ownerOrgId = :orgId` using parameterized SQL.
 */
export class ArcadeDbWorkspaceRepository implements WorkspaceRepository {
  private onFacilityDeleted?: (
    orgId: string,
    facilityId: string,
  ) => Promise<void>;

  constructor(
    private readonly db: ArcadeDbClient,
    hooks?: WorkspaceRepositoryHooks,
  ) {
    this.onFacilityDeleted = hooks?.onFacilityDeleted;
  }

  setOnFacilityDeleted(
    hook: (orgId: string, facilityId: string) => Promise<void>,
  ): void {
    this.onFacilityDeleted = hook;
  }

  async getNetwork(
    orgId: string,
    filters?: NetworkFilters,
  ): Promise<WorkspaceNetworkResponse> {
    const safeOrgId = assertOrgId(orgId);
    const [products, inputs, facilities, lanes, contracts, contractLines] =
      await Promise.all([
        this.listProducts(safeOrgId),
        this.listInputs(safeOrgId),
        this.listFacilities(safeOrgId),
        this.listLanes(safeOrgId),
        this.listContracts(safeOrgId),
        this.listContractLines(safeOrgId),
      ]);
    return filterNetwork(
      {
        products,
        inputs,
        facilities,
        lanes,
        riskSignals: [],
        contracts,
        contractLines,
      },
      filters,
    );
  }

  async listProducts(orgId: string): Promise<Product[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT productId, ownerOrgId, name, sku, description, annualRevenueEur, grossMarginPct FROM Product WHERE ownerOrgId = :orgId",
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
      "SELECT productId, ownerOrgId, name, sku, description, annualRevenueEur, grossMarginPct FROM Product WHERE productId = :productId AND ownerOrgId = :orgId LIMIT 1",
      { productId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapProductRow(row) : null;
  }

  async createProduct(
    orgId: string,
    input: CreateProductInput,
    importedId?: string,
  ): Promise<Product> {
    const safeOrgId = assertOrgId(orgId);
    const product = ProductSchema.parse({
      productId: importedId ?? randomUUID(),
      ownerOrgId: safeOrgId,
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
      ...(input.grossMarginPct !== undefined
        ? { grossMarginPct: input.grossMarginPct }
        : {}),
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX Product SET
        productId = :productId,
        ownerOrgId = :ownerOrgId,
        name = :name,
        sku = :sku,
        description = :description,
        annualRevenueEur = :annualRevenueEur,
        grossMarginPct = :grossMarginPct`,
      {
        productId: product.productId,
        ownerOrgId: product.ownerOrgId,
        name: product.name,
        sku: product.sku,
        description: product.description,
        annualRevenueEur: product.annualRevenueEur ?? null,
        grossMarginPct: product.grossMarginPct ?? null,
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
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
      ...(input.grossMarginPct !== undefined
        ? { grossMarginPct: input.grossMarginPct }
        : {}),
    });

    await this.db.command(
      "sql",
      `UPDATE Product SET
        name = :name,
        sku = :sku,
        description = :description,
        annualRevenueEur = :annualRevenueEur,
        grossMarginPct = :grossMarginPct
       WHERE productId = :productId AND ownerOrgId = :orgId`,
      {
        name: updated.name,
        sku: updated.sku,
        description: updated.description,
        annualRevenueEur: updated.annualRevenueEur ?? null,
        grossMarginPct: updated.grossMarginPct ?? null,
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
      "SELECT inputId, ownerOrgId, productId, name, category, unit, baseUnit, unitFamily, unitConversionFactorsJson, totalAnnualDemand, materialCriticality, cnCode, materialArchetype, unitMassKg, productEmissionFactorTco2ePerUnit, pcfVerified FROM SupplyInput WHERE ownerOrgId = :orgId",
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
      "SELECT inputId, ownerOrgId, productId, name, category, unit, baseUnit, unitFamily, unitConversionFactorsJson, totalAnnualDemand, materialCriticality, cnCode, materialArchetype, unitMassKg, productEmissionFactorTco2ePerUnit, pcfVerified FROM SupplyInput WHERE inputId = :inputId AND ownerOrgId = :orgId LIMIT 1",
      { inputId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapSupplyInputRow(row) : null;
  }

  async createInput(
    orgId: string,
    input: CreateSupplyInputInput,
    importedId?: string,
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
      inputId: importedId ?? randomUUID(),
      ownerOrgId: safeOrgId,
      productId,
      name: input.name,
      category: input.category,
      unit: input.unit,
      ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit } : {}),
      ...(input.unitFamily !== undefined ? { unitFamily: input.unitFamily } : {}),
      ...(input.unitConversionFactors !== undefined
        ? { unitConversionFactors: input.unitConversionFactors }
        : {}),
      ...(input.totalAnnualDemand !== undefined
        ? { totalAnnualDemand: input.totalAnnualDemand }
        : {}),
      ...(input.materialCriticality !== undefined
        ? { materialCriticality: input.materialCriticality }
        : {}),
      ...(input.cnCode !== undefined ? { cnCode: input.cnCode } : {}),
      ...(input.materialArchetype !== undefined
        ? { materialArchetype: input.materialArchetype }
        : {}),
      ...(input.unitMassKg !== undefined ? { unitMassKg: input.unitMassKg } : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX SupplyInput SET
        inputId = :inputId,
        ownerOrgId = :ownerOrgId,
        productId = :productId,
        name = :name,
        category = :category,
        unit = :unit,
        baseUnit = :baseUnit,
        unitFamily = :unitFamily,
        unitConversionFactorsJson = :unitConversionFactorsJson,
        totalAnnualDemand = :totalAnnualDemand,
        materialCriticality = :materialCriticality,
        cnCode = :cnCode,
        materialArchetype = :materialArchetype,
        unitMassKg = :unitMassKg,
        productEmissionFactorTco2ePerUnit = :productEmissionFactorTco2ePerUnit,
        pcfVerified = :pcfVerified`,
      {
        inputId: created.inputId,
        ownerOrgId: created.ownerOrgId,
        productId: created.productId,
        name: created.name,
        category: created.category,
        unit: created.unit,
        baseUnit: created.baseUnit ?? null,
        unitFamily: created.unitFamily ?? null,
        unitConversionFactorsJson: created.unitConversionFactors
          ? JSON.stringify(created.unitConversionFactors)
          : null,
        totalAnnualDemand: created.totalAnnualDemand ?? null,
        materialCriticality: created.materialCriticality ?? null,
        cnCode: created.cnCode ?? null,
        materialArchetype: created.materialArchetype ?? null,
        unitMassKg: created.unitMassKg ?? null,
        productEmissionFactorTco2ePerUnit:
          created.productEmissionFactorTco2ePerUnit ?? null,
        pcfVerified: created.pcfVerified ?? null,
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
      ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit } : {}),
      ...(input.unitFamily !== undefined ? { unitFamily: input.unitFamily } : {}),
      ...(input.unitConversionFactors !== undefined
        ? { unitConversionFactors: input.unitConversionFactors }
        : {}),
      ...(input.totalAnnualDemand !== undefined
        ? { totalAnnualDemand: input.totalAnnualDemand }
        : {}),
      ...(input.materialCriticality !== undefined
        ? { materialCriticality: input.materialCriticality }
        : {}),
      ...(input.cnCode !== undefined ? { cnCode: input.cnCode } : {}),
      ...(input.materialArchetype !== undefined
        ? { materialArchetype: input.materialArchetype }
        : {}),
      ...(input.unitMassKg !== undefined ? { unitMassKg: input.unitMassKg } : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
    });

    await this.db.command(
      "sql",
      `UPDATE SupplyInput SET
        productId = :productId,
        name = :name,
        category = :category,
        unit = :unit,
        baseUnit = :baseUnit,
        unitFamily = :unitFamily,
        unitConversionFactorsJson = :unitConversionFactorsJson,
        totalAnnualDemand = :totalAnnualDemand,
        materialCriticality = :materialCriticality,
        cnCode = :cnCode,
        materialArchetype = :materialArchetype,
        unitMassKg = :unitMassKg,
        productEmissionFactorTco2ePerUnit = :productEmissionFactorTco2ePerUnit,
        pcfVerified = :pcfVerified
       WHERE inputId = :inputId AND ownerOrgId = :orgId`,
      {
        productId: updated.productId,
        name: updated.name,
        category: updated.category,
        unit: updated.unit,
        baseUnit: updated.baseUnit ?? null,
        unitFamily: updated.unitFamily ?? null,
        unitConversionFactorsJson: updated.unitConversionFactors
          ? JSON.stringify(updated.unitConversionFactors)
          : null,
        totalAnnualDemand: updated.totalAnnualDemand ?? null,
        materialCriticality: updated.materialCriticality ?? null,
        cnCode: updated.cnCode ?? null,
        materialArchetype: updated.materialArchetype ?? null,
        unitMassKg: updated.unitMassKg ?? null,
        productEmissionFactorTco2ePerUnit:
          updated.productEmissionFactorTco2ePerUnit ?? null,
        pcfVerified: updated.pcfVerified ?? null,
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
      "UPDATE ContractLine SET inputId = null WHERE inputId = :inputId AND ownerOrgId = :orgId",
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
              lat, lng, isOwnFacility, isPartnerVerified, sector, esgBadges, estimatedScope12Tco2e,
              defaultCarryingCostPct, annualElectricityMwh, renewableElectricityPct,
              renewableInstrumentsVerified, annualRevenueEur
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
              lat, lng, isOwnFacility, isPartnerVerified, sector, esgBadges, estimatedScope12Tco2e,
              defaultCarryingCostPct, annualElectricityMwh, renewableElectricityPct,
              renewableInstrumentsVerified, annualRevenueEur
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
    importedId?: string,
  ): Promise<Facility> {
    const safeOrgId = assertOrgId(orgId);
    const facility = FacilitySchema.parse({
      facilityId: importedId ?? randomUUID(),
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
      ...(input.defaultCarryingCostPct !== undefined
        ? { defaultCarryingCostPct: input.defaultCarryingCostPct }
        : {}),
      ...(input.annualElectricityMwh !== undefined
        ? { annualElectricityMwh: input.annualElectricityMwh }
        : {}),
      ...(input.renewableElectricityPct !== undefined
        ? { renewableElectricityPct: input.renewableElectricityPct }
        : {}),
      ...(input.renewableInstrumentsVerified !== undefined
        ? { renewableInstrumentsVerified: input.renewableInstrumentsVerified }
        : {}),
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
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
        estimatedScope12Tco2e = :estimatedScope12Tco2e,
        defaultCarryingCostPct = :defaultCarryingCostPct,
        annualElectricityMwh = :annualElectricityMwh,
        renewableElectricityPct = :renewableElectricityPct,
        renewableInstrumentsVerified = :renewableInstrumentsVerified,
        annualRevenueEur = :annualRevenueEur`,
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
        defaultCarryingCostPct: facility.defaultCarryingCostPct ?? null,
        annualElectricityMwh: facility.annualElectricityMwh ?? null,
        renewableElectricityPct: facility.renewableElectricityPct ?? null,
        renewableInstrumentsVerified:
          facility.renewableInstrumentsVerified ?? null,
        annualRevenueEur: facility.annualRevenueEur ?? null,
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
      ...(input.defaultCarryingCostPct !== undefined
        ? { defaultCarryingCostPct: input.defaultCarryingCostPct }
        : {}),
      ...(input.annualElectricityMwh !== undefined
        ? { annualElectricityMwh: input.annualElectricityMwh }
        : {}),
      ...(input.renewableElectricityPct !== undefined
        ? { renewableElectricityPct: input.renewableElectricityPct }
        : {}),
      ...(input.renewableInstrumentsVerified !== undefined
        ? { renewableInstrumentsVerified: input.renewableInstrumentsVerified }
        : {}),
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
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
        estimatedScope12Tco2e = :estimatedScope12Tco2e,
        defaultCarryingCostPct = :defaultCarryingCostPct,
        annualElectricityMwh = :annualElectricityMwh,
        renewableElectricityPct = :renewableElectricityPct,
        renewableInstrumentsVerified = :renewableInstrumentsVerified,
        annualRevenueEur = :annualRevenueEur
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
        defaultCarryingCostPct: updated.defaultCarryingCostPct ?? null,
        annualElectricityMwh: updated.annualElectricityMwh ?? null,
        renewableElectricityPct: updated.renewableElectricityPct ?? null,
        renewableInstrumentsVerified:
          updated.renewableInstrumentsVerified ?? null,
        annualRevenueEur: updated.annualRevenueEur ?? null,
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

  async getFacilityById(
    orgId: string,
    facilityId: string,
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(orgId);
    return this.findFacility(safeOrgId, facilityId);
  }

  async markFacilityPartnerVerified(
    ownerOrgId: string,
    facilityId: string,
    partnerOrgId: string,
    refinedSite?: {
      kind: Facility["kind"];
      lat: number;
      lng: number;
      countryCode: string;
    },
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(ownerOrgId);
    const safePartnerOrgId = assertOrgId(partnerOrgId);
    const existing = await this.findFacility(safeOrgId, facilityId);
    if (!existing) return null;

    const updated = FacilitySchema.parse({
      ...existing,
      isPartnerVerified: true,
      kind: refinedSite ? refinedSite.kind : existing.kind,
      lat: refinedSite ? refinedSite.lat : existing.lat,
      lng: refinedSite ? refinedSite.lng : existing.lng,
      countryCode: refinedSite
        ? refinedSite.countryCode.trim().toUpperCase()
        : existing.countryCode,
      locationPrecision: refinedSite
        ? "SITE_VERIFIED"
        : existing.locationPrecision,
    });

    const locationWkt = formatPointWkt(updated.lng, updated.lat);
    await this.db.command(
      "sql",
      `UPDATE Facility SET
        isPartnerVerified = true,
        partnerOrgId = :partnerOrgId,
        kind = :kind,
        locationPrecision = :locationPrecision,
        countryCode = :countryCode,
        lat = :lat,
        lng = :lng,
        locationWkt = :locationWkt
       WHERE facilityId = :facilityId AND ownerOrgId = :orgId`,
      {
        partnerOrgId: safePartnerOrgId,
        kind: updated.kind,
        locationPrecision: updated.locationPrecision,
        countryCode: updated.countryCode,
        lat: updated.lat,
        lng: updated.lng,
        locationWkt,
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
      `UPDATE Invitation SET status = 'REVOKED'
       WHERE fromOrgId = :orgId
         AND targetFacilityId = :facilityId
         AND status = 'PENDING'`,
      { orgId: safeOrgId, facilityId },
    );
    await this.db.command(
      "sql",
      "DELETE EDGE VERIFIED_PARTNER_LINK WHERE out.facilityId = :facilityId AND out.ownerOrgId = :orgId",
      { orgId: safeOrgId, facilityId },
    );
    const connectedLanes = await this.db.query<Record<string, unknown>>(
      "sql",
      "SELECT laneId FROM SUPPLIES_LANE WHERE ownerOrgId = :orgId AND (fromFacilityId = :facilityId OR toFacilityId = :facilityId)",
      { orgId: safeOrgId, facilityId },
    );
    for (const laneRow of connectedLanes) {
      if (typeof laneRow.laneId === "string") {
        await this.db.command(
          "sql",
          "DELETE VERTEX FROM ContractLine WHERE laneId = :laneId AND ownerOrgId = :orgId",
          { laneId: laneRow.laneId, orgId: safeOrgId },
        );
      }
    }
    await this.db.command(
      "sql",
      "DELETE VERTEX FROM Contract WHERE supplierFacilityId = :facilityId AND ownerOrgId = :orgId",
      { orgId: safeOrgId, facilityId },
    );
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
    if (this.onFacilityDeleted) {
      await this.onFacilityDeleted(safeOrgId, facilityId);
    }
    return true;
  }

  async listLanes(orgId: string): Promise<SupplyLane[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT laneId, ownerOrgId, fromFacilityId, toFacilityId, inputId, materialCategory,
              transportMode, volumeSharePct, annualVolume, volumeUnit, annualSpendEur,
              contractEndDate, contractTerms, leadTimeDays, distanceKm, estimatedLaneCo2e,
              riskStatus, riskReason, safetyStockDays, defectRatePct, carryingCostPct,
              unitLandedCostEur, ordinaryFreightCostPerUnitEur, customAnnualDisruptionProb, customTtrDays,
              productEmissionFactorTco2ePerUnit, pcfVerified, economicAttributionRatio
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
              riskStatus, riskReason, safetyStockDays, defectRatePct, carryingCostPct,
              unitLandedCostEur, ordinaryFreightCostPerUnitEur, customAnnualDisruptionProb, customTtrDays,
              productEmissionFactorTco2ePerUnit, pcfVerified, economicAttributionRatio
       FROM SUPPLIES_LANE WHERE laneId = :laneId AND ownerOrgId = :orgId LIMIT 1`,
      { laneId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapSupplyLaneRow(row) : null;
  }

  async createLane(
    orgId: string,
    input: CreateSupplyLaneInput,
    importedId?: string,
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
      laneId: importedId ?? randomUUID(),
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
      ...(input.safetyStockDays !== undefined
        ? { safetyStockDays: input.safetyStockDays }
        : {}),
      ...(input.defectRatePct !== undefined
        ? { defectRatePct: input.defectRatePct }
        : {}),
      ...(input.carryingCostPct !== undefined
        ? { carryingCostPct: input.carryingCostPct }
        : {}),
      ...(input.unitLandedCostEur !== undefined
        ? { unitLandedCostEur: input.unitLandedCostEur }
        : {}),
      ...(input.ordinaryFreightCostPerUnitEur !== undefined
        ? { ordinaryFreightCostPerUnitEur: input.ordinaryFreightCostPerUnitEur }
        : {}),
      ...(input.customAnnualDisruptionProb !== undefined
        ? { customAnnualDisruptionProb: input.customAnnualDisruptionProb }
        : {}),
      ...(input.customTtrDays !== undefined
        ? { customTtrDays: input.customTtrDays }
        : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
      ...(input.economicAttributionRatio !== undefined
        ? { economicAttributionRatio: input.economicAttributionRatio }
        : {}),
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
         riskReason = :riskReason,
         safetyStockDays = :safetyStockDays,
         defectRatePct = :defectRatePct,
         carryingCostPct = :carryingCostPct,
         unitLandedCostEur = :unitLandedCostEur,
         ordinaryFreightCostPerUnitEur = :ordinaryFreightCostPerUnitEur,
         customAnnualDisruptionProb = :customAnnualDisruptionProb,
         customTtrDays = :customTtrDays,
         productEmissionFactorTco2ePerUnit = :productEmissionFactorTco2ePerUnit,
         pcfVerified = :pcfVerified,
         economicAttributionRatio = :economicAttributionRatio`,
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
        safetyStockDays: lane.safetyStockDays ?? null,
        defectRatePct: lane.defectRatePct ?? null,
        carryingCostPct: lane.carryingCostPct ?? null,
        unitLandedCostEur: lane.unitLandedCostEur ?? null,
        ordinaryFreightCostPerUnitEur:
          lane.ordinaryFreightCostPerUnitEur ?? null,
        customAnnualDisruptionProb: lane.customAnnualDisruptionProb ?? null,
        customTtrDays: lane.customTtrDays ?? null,
        productEmissionFactorTco2ePerUnit:
          lane.productEmissionFactorTco2ePerUnit ?? null,
        pcfVerified: lane.pcfVerified ?? null,
        economicAttributionRatio: lane.economicAttributionRatio ?? null,
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
      ...(input.safetyStockDays !== undefined
        ? { safetyStockDays: input.safetyStockDays }
        : {}),
      ...(input.defectRatePct !== undefined
        ? { defectRatePct: input.defectRatePct }
        : {}),
      ...(input.carryingCostPct !== undefined
        ? { carryingCostPct: input.carryingCostPct }
        : {}),
      ...(input.unitLandedCostEur !== undefined
        ? { unitLandedCostEur: input.unitLandedCostEur }
        : {}),
      ...(input.ordinaryFreightCostPerUnitEur !== undefined
        ? { ordinaryFreightCostPerUnitEur: input.ordinaryFreightCostPerUnitEur }
        : {}),
      ...(input.customAnnualDisruptionProb !== undefined
        ? { customAnnualDisruptionProb: input.customAnnualDisruptionProb }
        : {}),
      ...(input.customTtrDays !== undefined
        ? { customTtrDays: input.customTtrDays }
        : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
      ...(input.economicAttributionRatio !== undefined
        ? { economicAttributionRatio: input.economicAttributionRatio }
        : {}),
    });

    if (endpointsChanged) {
      const existingRidRows = await this.db.query<Record<string, unknown>>(
        "sql",
        "SELECT @rid AS rid FROM SUPPLIES_LANE WHERE laneId = :laneId AND ownerOrgId = :ownerOrgId LIMIT 1",
        { laneId, ownerOrgId: safeOrgId },
      );
      const oldRid = existingRidRows[0]?.rid;
      if (typeof oldRid === "string" && oldRid.length > 0) {
        const tempLaneId = `${laneId}::replacing::${randomUUID()}`;
        await this.db.command(
          "sql",
          "UPDATE SUPPLIES_LANE SET laneId = :tempLaneId WHERE @rid = :oldRid AND ownerOrgId = :ownerOrgId",
          { tempLaneId, oldRid, ownerOrgId: safeOrgId },
        );
        try {
          await this.insertLaneEdge(updated);
        } catch (err) {
          await this.db.command(
            "sql",
            "UPDATE SUPPLIES_LANE SET laneId = :laneId WHERE @rid = :oldRid AND ownerOrgId = :ownerOrgId",
            { laneId, oldRid, ownerOrgId: safeOrgId },
          );
          throw err;
        }
        await this.db.command(
          "sql",
          "DELETE EDGE FROM SUPPLIES_LANE WHERE @rid = :oldRid AND ownerOrgId = :ownerOrgId",
          { oldRid, ownerOrgId: safeOrgId },
        );
      } else {
        await this.insertLaneEdge(updated);
      }
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
          riskReason = :riskReason,
          safetyStockDays = :safetyStockDays,
          defectRatePct = :defectRatePct,
          carryingCostPct = :carryingCostPct,
          unitLandedCostEur = :unitLandedCostEur,
          ordinaryFreightCostPerUnitEur = :ordinaryFreightCostPerUnitEur,
          customAnnualDisruptionProb = :customAnnualDisruptionProb,
          customTtrDays = :customTtrDays,
          productEmissionFactorTco2ePerUnit = :productEmissionFactorTco2ePerUnit,
          pcfVerified = :pcfVerified,
          economicAttributionRatio = :economicAttributionRatio
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
          safetyStockDays: updated.safetyStockDays ?? null,
          defectRatePct: updated.defectRatePct ?? null,
          carryingCostPct: updated.carryingCostPct ?? null,
          unitLandedCostEur: updated.unitLandedCostEur ?? null,
          ordinaryFreightCostPerUnitEur:
            updated.ordinaryFreightCostPerUnitEur ?? null,
          customAnnualDisruptionProb:
            updated.customAnnualDisruptionProb ?? null,
          customTtrDays: updated.customTtrDays ?? null,
          productEmissionFactorTco2ePerUnit:
            updated.productEmissionFactorTco2ePerUnit ?? null,
          pcfVerified: updated.pcfVerified ?? null,
          economicAttributionRatio: updated.economicAttributionRatio ?? null,
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
      "DELETE VERTEX FROM ContractLine WHERE laneId = :laneId AND ownerOrgId = :orgId",
      { laneId, orgId: safeOrgId },
    );
    await this.db.command(
      "sql",
      "DELETE EDGE SUPPLIES_LANE WHERE laneId = :laneId AND ownerOrgId = :orgId",
      { laneId, orgId: safeOrgId },
    );
    return true;
  }

  async listContracts(orgId: string): Promise<Contract[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT contractId, ownerOrgId, supplierFacilityId, title, contractType, pricingModel,
              expiryBehavior, confidence, startDate, endDate, noticePeriodDays,
              nonRenewalNoticeGiven, archiveEffectiveDate, isManuallyArchived, incoterms, notes
       FROM Contract WHERE ownerOrgId = :orgId`,
      { orgId: safeOrgId },
    );
    return rows.map(mapContractRow);
  }

  private async findContract(
    orgId: string,
    contractId: string,
  ): Promise<Contract | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT contractId, ownerOrgId, supplierFacilityId, title, contractType, pricingModel,
              expiryBehavior, confidence, startDate, endDate, noticePeriodDays,
              nonRenewalNoticeGiven, archiveEffectiveDate, isManuallyArchived, incoterms, notes
       FROM Contract WHERE contractId = :contractId AND ownerOrgId = :orgId LIMIT 1`,
      { contractId, orgId: safeOrgId },
    );
    const row = rows[0];
    return row ? mapContractRow(row) : null;
  }

  async listContractLines(orgId: string): Promise<ContractLine[]> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT contractLineId, contractId, ownerOrgId, laneId, inputId, cadence,
              committedVolume, unit, committedSpend, unitPrice, currency,
              startDateOverride, endDateOverride
       FROM ContractLine WHERE ownerOrgId = :orgId`,
      { orgId: safeOrgId },
    );
    return rows.map(mapContractLineRow);
  }

  async createContract(
    orgId: string,
    input: CreateContractInput,
  ): Promise<Contract> {
    const safeOrgId = assertOrgId(orgId);
    const supplier = await this.findFacility(safeOrgId, input.supplierFacilityId);
    if (!supplier) {
      throw new WorkspaceValidationError(
        "Referenced supplierFacilityId does not exist in this organization",
      );
    }

    const defaultExpiry =
      input.contractType === "SPOT_PO" ? "AUTO_ARCHIVE" : "HOLDOVER";
    const contract = ContractSchema.parse({
      contractId: randomUUID(),
      ownerOrgId: safeOrgId,
      supplierFacilityId: input.supplierFacilityId,
      title: input.title,
      contractType: input.contractType,
      pricingModel: input.pricingModel,
      expiryBehavior: input.expiryBehavior ?? defaultExpiry,
      confidence: input.confidence,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      noticePeriodDays: input.noticePeriodDays,
      nonRenewalNoticeGiven: input.nonRenewalNoticeGiven,
      archiveEffectiveDate: null,
      isManuallyArchived: false,
      incoterms: input.incoterms ?? null,
      notes: input.notes ?? null,
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX Contract SET
        contractId = :contractId,
        ownerOrgId = :ownerOrgId,
        supplierFacilityId = :supplierFacilityId,
        title = :title,
        contractType = :contractType,
        pricingModel = :pricingModel,
        expiryBehavior = :expiryBehavior,
        confidence = :confidence,
        startDate = :startDate,
        endDate = :endDate,
        noticePeriodDays = :noticePeriodDays,
        nonRenewalNoticeGiven = :nonRenewalNoticeGiven,
        archiveEffectiveDate = :archiveEffectiveDate,
        isManuallyArchived = :isManuallyArchived,
        incoterms = :incoterms,
        notes = :notes`,
      { ...contract },
    );

    return contract;
  }

  async updateContract(
    orgId: string,
    contractId: string,
    input: UpdateContractInput,
  ): Promise<Contract | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = await this.findContract(safeOrgId, contractId);
    if (!existing) return null;

    const updated = ContractSchema.parse({
      ...existing,
      title: input.title !== undefined ? input.title : existing.title,
      contractType:
        input.contractType !== undefined
          ? input.contractType
          : existing.contractType,
      pricingModel:
        input.pricingModel !== undefined
          ? input.pricingModel
          : existing.pricingModel,
      expiryBehavior:
        input.expiryBehavior !== undefined
          ? input.expiryBehavior
          : existing.expiryBehavior,
      confidence:
        input.confidence !== undefined ? input.confidence : existing.confidence,
      startDate:
        input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      noticePeriodDays:
        input.noticePeriodDays !== undefined
          ? input.noticePeriodDays
          : existing.noticePeriodDays,
      nonRenewalNoticeGiven:
        input.nonRenewalNoticeGiven !== undefined
          ? input.nonRenewalNoticeGiven
          : existing.nonRenewalNoticeGiven,
      archiveEffectiveDate:
        input.archiveEffectiveDate !== undefined
          ? input.archiveEffectiveDate
          : existing.archiveEffectiveDate,
      isManuallyArchived:
        input.isManuallyArchived !== undefined
          ? input.isManuallyArchived
          : existing.isManuallyArchived,
      incoterms:
        input.incoterms !== undefined ? input.incoterms : existing.incoterms,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    });

    await this.db.command(
      "sql",
      `UPDATE Contract SET
        title = :title,
        contractType = :contractType,
        pricingModel = :pricingModel,
        expiryBehavior = :expiryBehavior,
        confidence = :confidence,
        startDate = :startDate,
        endDate = :endDate,
        noticePeriodDays = :noticePeriodDays,
        nonRenewalNoticeGiven = :nonRenewalNoticeGiven,
        archiveEffectiveDate = :archiveEffectiveDate,
        isManuallyArchived = :isManuallyArchived,
        incoterms = :incoterms,
        notes = :notes
       WHERE contractId = :contractId AND ownerOrgId = :ownerOrgId`,
      { ...updated },
    );

    return updated;
  }

  async createContractLine(
    orgId: string,
    input: CreateContractLineInput,
  ): Promise<ContractLine> {
    const safeOrgId = assertOrgId(orgId);
    const [contract, lane] = await Promise.all([
      this.findContract(safeOrgId, input.contractId),
      this.findLane(safeOrgId, input.laneId),
    ]);
    if (!contract) {
      throw new WorkspaceValidationError(
        "Referenced contractId does not exist in this organization",
      );
    }
    if (!lane) {
      throw new WorkspaceValidationError(
        "Referenced laneId does not exist in this organization",
      );
    }

    const line = ContractLineSchema.parse({
      contractLineId: randomUUID(),
      contractId: input.contractId,
      ownerOrgId: safeOrgId,
      laneId: input.laneId,
      inputId: input.inputId ?? lane.inputId,
      cadence: input.cadence,
      committedVolume: input.committedVolume ?? null,
      unit: input.unit,
      committedSpend: input.committedSpend ?? null,
      unitPrice: input.unitPrice ?? null,
      currency: input.currency,
      startDateOverride: input.startDateOverride ?? null,
      endDateOverride: input.endDateOverride ?? null,
    });

    await this.db.command(
      "sql",
      `CREATE VERTEX ContractLine SET
        contractLineId = :contractLineId,
        contractId = :contractId,
        ownerOrgId = :ownerOrgId,
        laneId = :laneId,
        inputId = :inputId,
        cadence = :cadence,
        committedVolume = :committedVolume,
        unit = :unit,
        committedSpend = :committedSpend,
        unitPrice = :unitPrice,
        currency = :currency,
        startDateOverride = :startDateOverride,
        endDateOverride = :endDateOverride`,
      { ...line },
    );

    // Double-counting guardrail: archive any active ESTIMATE contract on the same lane
    if (
      contract.contractType === "FRAMEWORK" ||
      contract.contractType === "SPOT_PO"
    ) {
      const existingLines = await this.listContractLines(safeOrgId);
      const siblingContractIds = new Set(
        existingLines
          .filter(
            (l) => l.laneId === input.laneId && l.contractId !== contract.contractId,
          )
          .map((l) => l.contractId),
      );
      for (const siblingId of siblingContractIds) {
        const sibling = await this.findContract(safeOrgId, siblingId);
        if (sibling && sibling.contractType === "ESTIMATE" && !sibling.isManuallyArchived) {
          await this.updateContract(safeOrgId, siblingId, {
            isManuallyArchived: true,
            archiveEffectiveDate: contract.startDate,
          });
        }
      }
    }

    return line;
  }

  async updateContractLine(
    orgId: string,
    contractLineId: string,
    input: UpdateContractLineInput,
  ): Promise<ContractLine | null> {
    const safeOrgId = assertOrgId(orgId);
    const rows = await this.db.query<Record<string, unknown>>(
      "sql",
      `SELECT contractLineId, contractId, ownerOrgId, laneId, inputId, cadence,
              committedVolume, unit, committedSpend, unitPrice, currency,
              startDateOverride, endDateOverride
       FROM ContractLine WHERE contractLineId = :contractLineId AND ownerOrgId = :orgId LIMIT 1`,
      { contractLineId, orgId: safeOrgId },
    );
    const row = rows[0];
    if (!row) return null;
    const existing = mapContractLineRow(row);

    const updated = ContractLineSchema.parse({
      ...existing,
      laneId: input.laneId !== undefined ? input.laneId : existing.laneId,
      inputId: input.inputId !== undefined ? input.inputId : existing.inputId,
      cadence: input.cadence !== undefined ? input.cadence : existing.cadence,
      committedVolume:
        input.committedVolume !== undefined
          ? input.committedVolume
          : existing.committedVolume,
      unit: input.unit !== undefined ? input.unit : existing.unit,
      committedSpend:
        input.committedSpend !== undefined
          ? input.committedSpend
          : existing.committedSpend,
      unitPrice:
        input.unitPrice !== undefined ? input.unitPrice : existing.unitPrice,
      currency:
        input.currency !== undefined ? input.currency : existing.currency,
      startDateOverride:
        input.startDateOverride !== undefined
          ? input.startDateOverride
          : existing.startDateOverride,
      endDateOverride:
        input.endDateOverride !== undefined
          ? input.endDateOverride
          : existing.endDateOverride,
    });

    await this.db.command(
      "sql",
      `UPDATE ContractLine SET
        laneId = :laneId,
        inputId = :inputId,
        cadence = :cadence,
        committedVolume = :committedVolume,
        unit = :unit,
        committedSpend = :committedSpend,
        unitPrice = :unitPrice,
        currency = :currency,
        startDateOverride = :startDateOverride,
        endDateOverride = :endDateOverride
       WHERE contractLineId = :contractLineId AND ownerOrgId = :ownerOrgId`,
      { ...updated },
    );

    return updated;
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
  private readonly contracts = new Map<string, Contract>();
  private readonly contractLines = new Map<string, ContractLine>();
  private onFacilityDeleted?: (
    orgId: string,
    facilityId: string,
  ) => Promise<void>;

  constructor(hooks?: WorkspaceRepositoryHooks) {
    this.onFacilityDeleted = hooks?.onFacilityDeleted;
  }

  setOnFacilityDeleted(
    hook: (orgId: string, facilityId: string) => Promise<void>,
  ): void {
    this.onFacilityDeleted = hook;
  }

  async getNetwork(
    orgId: string,
    filters?: NetworkFilters,
  ): Promise<WorkspaceNetworkResponse> {
    const safeOrgId = assertOrgId(orgId);
    const [products, inputs, facilities, lanes, contracts, contractLines] =
      await Promise.all([
        this.listProducts(safeOrgId),
        this.listInputs(safeOrgId),
        this.listFacilities(safeOrgId),
        this.listLanes(safeOrgId),
        this.listContracts(safeOrgId),
        this.listContractLines(safeOrgId),
      ]);
    return filterNetwork(
      {
        products,
        inputs,
        facilities,
        lanes,
        riskSignals: [],
        contracts,
        contractLines,
      },
      filters,
    );
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
    importedId?: string,
  ): Promise<Product> {
    const safeOrgId = assertOrgId(orgId);
    const product = ProductSchema.parse({
      productId: importedId ?? randomUUID(),
      ownerOrgId: safeOrgId,
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
      ...(input.grossMarginPct !== undefined
        ? { grossMarginPct: input.grossMarginPct }
        : {}),
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
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
      ...(input.grossMarginPct !== undefined
        ? { grossMarginPct: input.grossMarginPct }
        : {}),
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
    importedId?: string,
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
      inputId: importedId ?? randomUUID(),
      ownerOrgId: safeOrgId,
      productId,
      name: input.name,
      category: input.category,
      unit: input.unit,
      ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit } : {}),
      ...(input.unitFamily !== undefined ? { unitFamily: input.unitFamily } : {}),
      ...(input.unitConversionFactors !== undefined
        ? { unitConversionFactors: input.unitConversionFactors }
        : {}),
      ...(input.totalAnnualDemand !== undefined
        ? { totalAnnualDemand: input.totalAnnualDemand }
        : {}),
      ...(input.materialCriticality !== undefined
        ? { materialCriticality: input.materialCriticality }
        : {}),
      ...(input.cnCode !== undefined ? { cnCode: input.cnCode } : {}),
      ...(input.materialArchetype !== undefined
        ? { materialArchetype: input.materialArchetype }
        : {}),
      ...(input.unitMassKg !== undefined ? { unitMassKg: input.unitMassKg } : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
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
      ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit } : {}),
      ...(input.unitFamily !== undefined ? { unitFamily: input.unitFamily } : {}),
      ...(input.unitConversionFactors !== undefined
        ? { unitConversionFactors: input.unitConversionFactors }
        : {}),
      ...(input.totalAnnualDemand !== undefined
        ? { totalAnnualDemand: input.totalAnnualDemand }
        : {}),
      ...(input.materialCriticality !== undefined
        ? { materialCriticality: input.materialCriticality }
        : {}),
      ...(input.cnCode !== undefined ? { cnCode: input.cnCode } : {}),
      ...(input.materialArchetype !== undefined
        ? { materialArchetype: input.materialArchetype }
        : {}),
      ...(input.unitMassKg !== undefined ? { unitMassKg: input.unitMassKg } : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
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
    for (const [id, line] of this.contractLines.entries()) {
      if (line.ownerOrgId === safeOrgId && line.inputId === inputId) {
        this.contractLines.set(id, { ...line, inputId: null });
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
    importedId?: string,
  ): Promise<Facility> {
    const safeOrgId = assertOrgId(orgId);
    const facility = FacilitySchema.parse({
      facilityId: importedId ?? randomUUID(),
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
      ...(input.defaultCarryingCostPct !== undefined
        ? { defaultCarryingCostPct: input.defaultCarryingCostPct }
        : {}),
      ...(input.annualElectricityMwh !== undefined
        ? { annualElectricityMwh: input.annualElectricityMwh }
        : {}),
      ...(input.renewableElectricityPct !== undefined
        ? { renewableElectricityPct: input.renewableElectricityPct }
        : {}),
      ...(input.renewableInstrumentsVerified !== undefined
        ? { renewableInstrumentsVerified: input.renewableInstrumentsVerified }
        : {}),
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
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
      ...(input.defaultCarryingCostPct !== undefined
        ? { defaultCarryingCostPct: input.defaultCarryingCostPct }
        : {}),
      ...(input.annualElectricityMwh !== undefined
        ? { annualElectricityMwh: input.annualElectricityMwh }
        : {}),
      ...(input.renewableElectricityPct !== undefined
        ? { renewableElectricityPct: input.renewableElectricityPct }
        : {}),
      ...(input.renewableInstrumentsVerified !== undefined
        ? { renewableInstrumentsVerified: input.renewableInstrumentsVerified }
        : {}),
      ...(input.annualRevenueEur !== undefined
        ? { annualRevenueEur: input.annualRevenueEur }
        : {}),
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

  async getFacilityById(
    orgId: string,
    facilityId: string,
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(orgId);
    const record = this.facilities.get(facilityId);
    if (!record || record.facility.ownerOrgId !== safeOrgId) return null;
    return {
      ...record.facility,
      esgBadges: [...record.facility.esgBadges],
    };
  }

  async markFacilityPartnerVerified(
    ownerOrgId: string,
    facilityId: string,
    partnerOrgId: string,
    refinedSite?: {
      kind: Facility["kind"];
      lat: number;
      lng: number;
      countryCode: string;
    },
  ): Promise<Facility | null> {
    const safeOrgId = assertOrgId(ownerOrgId);
    assertOrgId(partnerOrgId);
    const record = this.facilities.get(facilityId);
    if (!record || record.facility.ownerOrgId !== safeOrgId) return null;

    const existing = record.facility;
    const updated = FacilitySchema.parse({
      ...existing,
      isPartnerVerified: true,
      kind: refinedSite ? refinedSite.kind : existing.kind,
      lat: refinedSite ? refinedSite.lat : existing.lat,
      lng: refinedSite ? refinedSite.lng : existing.lng,
      countryCode: refinedSite
        ? refinedSite.countryCode.trim().toUpperCase()
        : existing.countryCode,
      locationPrecision: refinedSite
        ? "SITE_VERIFIED"
        : existing.locationPrecision,
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

    const deletedLaneIds = new Set<string>();
    for (const [laneId, lane] of this.lanes.entries()) {
      if (
        lane.ownerOrgId === safeOrgId &&
        (lane.fromFacilityId === facilityId || lane.toFacilityId === facilityId)
      ) {
        deletedLaneIds.add(laneId);
        this.lanes.delete(laneId);
      }
    }
    for (const [lineId, line] of this.contractLines.entries()) {
      if (line.ownerOrgId === safeOrgId && deletedLaneIds.has(line.laneId)) {
        this.contractLines.delete(lineId);
      }
    }
    for (const [contractId, contract] of this.contracts.entries()) {
      if (
        contract.ownerOrgId === safeOrgId &&
        contract.supplierFacilityId === facilityId
      ) {
        this.contracts.delete(contractId);
      }
    }
    this.facilities.delete(facilityId);
    if (this.onFacilityDeleted) {
      await this.onFacilityDeleted(safeOrgId, facilityId);
    }
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
    importedId?: string,
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
      laneId: importedId ?? randomUUID(),
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
      ...(input.safetyStockDays !== undefined
        ? { safetyStockDays: input.safetyStockDays }
        : {}),
      ...(input.defectRatePct !== undefined
        ? { defectRatePct: input.defectRatePct }
        : {}),
      ...(input.carryingCostPct !== undefined
        ? { carryingCostPct: input.carryingCostPct }
        : {}),
      ...(input.unitLandedCostEur !== undefined
        ? { unitLandedCostEur: input.unitLandedCostEur }
        : {}),
      ...(input.ordinaryFreightCostPerUnitEur !== undefined
        ? { ordinaryFreightCostPerUnitEur: input.ordinaryFreightCostPerUnitEur }
        : {}),
      ...(input.customAnnualDisruptionProb !== undefined
        ? { customAnnualDisruptionProb: input.customAnnualDisruptionProb }
        : {}),
      ...(input.customTtrDays !== undefined
        ? { customTtrDays: input.customTtrDays }
        : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
      ...(input.economicAttributionRatio !== undefined
        ? { economicAttributionRatio: input.economicAttributionRatio }
        : {}),
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
      ...(input.safetyStockDays !== undefined
        ? { safetyStockDays: input.safetyStockDays }
        : {}),
      ...(input.defectRatePct !== undefined
        ? { defectRatePct: input.defectRatePct }
        : {}),
      ...(input.carryingCostPct !== undefined
        ? { carryingCostPct: input.carryingCostPct }
        : {}),
      ...(input.unitLandedCostEur !== undefined
        ? { unitLandedCostEur: input.unitLandedCostEur }
        : {}),
      ...(input.ordinaryFreightCostPerUnitEur !== undefined
        ? { ordinaryFreightCostPerUnitEur: input.ordinaryFreightCostPerUnitEur }
        : {}),
      ...(input.customAnnualDisruptionProb !== undefined
        ? { customAnnualDisruptionProb: input.customAnnualDisruptionProb }
        : {}),
      ...(input.customTtrDays !== undefined
        ? { customTtrDays: input.customTtrDays }
        : {}),
      ...(input.productEmissionFactorTco2ePerUnit !== undefined
        ? { productEmissionFactorTco2ePerUnit: input.productEmissionFactorTco2ePerUnit }
        : {}),
      ...(input.pcfVerified !== undefined ? { pcfVerified: input.pcfVerified } : {}),
      ...(input.economicAttributionRatio !== undefined
        ? { economicAttributionRatio: input.economicAttributionRatio }
        : {}),
    });

    this.lanes.set(laneId, updated);
    return { ...updated };
  }

  async deleteLane(orgId: string, laneId: string): Promise<boolean> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.lanes.get(laneId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return false;
    for (const [lineId, line] of this.contractLines.entries()) {
      if (line.ownerOrgId === safeOrgId && line.laneId === laneId) {
        this.contractLines.delete(lineId);
      }
    }
    this.lanes.delete(laneId);
    return true;
  }

  async listContracts(orgId: string): Promise<Contract[]> {
    const safeOrgId = assertOrgId(orgId);
    return Array.from(this.contracts.values())
      .filter((c) => c.ownerOrgId === safeOrgId)
      .map((c) => ({ ...c }));
  }

  async listContractLines(orgId: string): Promise<ContractLine[]> {
    const safeOrgId = assertOrgId(orgId);
    return Array.from(this.contractLines.values())
      .filter((l) => l.ownerOrgId === safeOrgId)
      .map((l) => ({ ...l }));
  }

  async createContract(
    orgId: string,
    input: CreateContractInput,
  ): Promise<Contract> {
    const safeOrgId = assertOrgId(orgId);
    const supplier = this.facilities.get(input.supplierFacilityId);
    if (!supplier || supplier.facility.ownerOrgId !== safeOrgId) {
      throw new WorkspaceValidationError(
        "Referenced supplierFacilityId does not exist in this organization",
      );
    }

    const defaultExpiry =
      input.contractType === "SPOT_PO" ? "AUTO_ARCHIVE" : "HOLDOVER";
    const contract = ContractSchema.parse({
      contractId: randomUUID(),
      ownerOrgId: safeOrgId,
      supplierFacilityId: input.supplierFacilityId,
      title: input.title,
      contractType: input.contractType,
      pricingModel: input.pricingModel,
      expiryBehavior: input.expiryBehavior ?? defaultExpiry,
      confidence: input.confidence,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      noticePeriodDays: input.noticePeriodDays,
      nonRenewalNoticeGiven: input.nonRenewalNoticeGiven,
      archiveEffectiveDate: null,
      isManuallyArchived: false,
      incoterms: input.incoterms ?? null,
      notes: input.notes ?? null,
    });
    this.contracts.set(contract.contractId, contract);
    return { ...contract };
  }

  async updateContract(
    orgId: string,
    contractId: string,
    input: UpdateContractInput,
  ): Promise<Contract | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.contracts.get(contractId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return null;

    const updated = ContractSchema.parse({
      ...existing,
      title: input.title !== undefined ? input.title : existing.title,
      contractType:
        input.contractType !== undefined
          ? input.contractType
          : existing.contractType,
      pricingModel:
        input.pricingModel !== undefined
          ? input.pricingModel
          : existing.pricingModel,
      expiryBehavior:
        input.expiryBehavior !== undefined
          ? input.expiryBehavior
          : existing.expiryBehavior,
      confidence:
        input.confidence !== undefined ? input.confidence : existing.confidence,
      startDate:
        input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      noticePeriodDays:
        input.noticePeriodDays !== undefined
          ? input.noticePeriodDays
          : existing.noticePeriodDays,
      nonRenewalNoticeGiven:
        input.nonRenewalNoticeGiven !== undefined
          ? input.nonRenewalNoticeGiven
          : existing.nonRenewalNoticeGiven,
      archiveEffectiveDate:
        input.archiveEffectiveDate !== undefined
          ? input.archiveEffectiveDate
          : existing.archiveEffectiveDate,
      isManuallyArchived:
        input.isManuallyArchived !== undefined
          ? input.isManuallyArchived
          : existing.isManuallyArchived,
      incoterms:
        input.incoterms !== undefined ? input.incoterms : existing.incoterms,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    });
    this.contracts.set(contractId, updated);
    return { ...updated };
  }

  async createContractLine(
    orgId: string,
    input: CreateContractLineInput,
  ): Promise<ContractLine> {
    const safeOrgId = assertOrgId(orgId);
    const contract = this.contracts.get(input.contractId);
    if (!contract || contract.ownerOrgId !== safeOrgId) {
      throw new WorkspaceValidationError(
        "Referenced contractId does not exist in this organization",
      );
    }
    const lane = this.lanes.get(input.laneId);
    if (!lane || lane.ownerOrgId !== safeOrgId) {
      throw new WorkspaceValidationError(
        "Referenced laneId does not exist in this organization",
      );
    }

    const line = ContractLineSchema.parse({
      contractLineId: randomUUID(),
      contractId: input.contractId,
      ownerOrgId: safeOrgId,
      laneId: input.laneId,
      inputId: input.inputId ?? lane.inputId,
      cadence: input.cadence,
      committedVolume: input.committedVolume ?? null,
      unit: input.unit,
      committedSpend: input.committedSpend ?? null,
      unitPrice: input.unitPrice ?? null,
      currency: input.currency,
      startDateOverride: input.startDateOverride ?? null,
      endDateOverride: input.endDateOverride ?? null,
    });
    this.contractLines.set(line.contractLineId, line);

    // Double-counting guardrail: archive any active ESTIMATE contract on the same lane
    if (
      contract.contractType === "FRAMEWORK" ||
      contract.contractType === "SPOT_PO"
    ) {
      for (const existingLine of this.contractLines.values()) {
        if (
          existingLine.ownerOrgId === safeOrgId &&
          existingLine.laneId === input.laneId &&
          existingLine.contractId !== contract.contractId
        ) {
          const sibling = this.contracts.get(existingLine.contractId);
          if (
            sibling &&
            sibling.contractType === "ESTIMATE" &&
            !sibling.isManuallyArchived
          ) {
            this.contracts.set(sibling.contractId, {
              ...sibling,
              isManuallyArchived: true,
              archiveEffectiveDate: contract.startDate,
            });
          }
        }
      }
    }

    return { ...line };
  }

  async updateContractLine(
    orgId: string,
    contractLineId: string,
    input: UpdateContractLineInput,
  ): Promise<ContractLine | null> {
    const safeOrgId = assertOrgId(orgId);
    const existing = this.contractLines.get(contractLineId);
    if (!existing || existing.ownerOrgId !== safeOrgId) return null;

    const updated = ContractLineSchema.parse({
      ...existing,
      laneId: input.laneId !== undefined ? input.laneId : existing.laneId,
      inputId: input.inputId !== undefined ? input.inputId : existing.inputId,
      cadence: input.cadence !== undefined ? input.cadence : existing.cadence,
      committedVolume:
        input.committedVolume !== undefined
          ? input.committedVolume
          : existing.committedVolume,
      unit: input.unit !== undefined ? input.unit : existing.unit,
      committedSpend:
        input.committedSpend !== undefined
          ? input.committedSpend
          : existing.committedSpend,
      unitPrice:
        input.unitPrice !== undefined ? input.unitPrice : existing.unitPrice,
      currency:
        input.currency !== undefined ? input.currency : existing.currency,
      startDateOverride:
        input.startDateOverride !== undefined
          ? input.startDateOverride
          : existing.startDateOverride,
      endDateOverride:
        input.endDateOverride !== undefined
          ? input.endDateOverride
          : existing.endDateOverride,
    });
    this.contractLines.set(contractLineId, updated);
    return { ...updated };
  }
}
