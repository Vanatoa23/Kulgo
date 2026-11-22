import {
  BulkImportFacilityRowSchema,
  CreateProductInputSchema,
  CreateSupplyInputInputSchema,
  BulkImportLaneRowSchema,
  BulkImportSummarySchema,
  WorkspaceExportJsonSchema,
  type BulkImportError,
  type BulkImportSummary,
  type Organization,
  type WorkspaceExportJson,
  type WorkspaceNetworkResponse,
} from "@kulgo/shared";
import {
  WorkspaceValidationError,
  type WorkspaceRepository,
} from "./repository.js";

const MAX_IMPORT_FACILITIES = 500;
const MAX_IMPORT_LANES = 1000;
export const MAX_CSV_ROWS = 1505;
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
const FINITE_NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * RFC-4180 compliant CSV parser supporting quoted fields, escaped quotes (""),
 * embedded commas/newlines, and UTF-8 BOM.
 */
export function parseCsvRecords(csvText: string): string[][] {
  const text = csvText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      if (rows.length > MAX_CSV_ROWS + 1) {
        break;
      }
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      if (rows.length > MAX_CSV_ROWS + 1) {
        break;
      }
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function neutralizeCsvFormula(str: string): string {
  if (!FORMULA_PREFIX_RE.test(str)) {
    return str;
  }
  if (str.startsWith("-") && FINITE_NUMBER_RE.test(str.trim())) {
    return str;
  }
  return `'${str}`;
}

function stripFormulaGuardOnImport(str: string): string {
  if (str.length >= 2 && str.startsWith("'") && FORMULA_PREFIX_RE.test(str.slice(1))) {
    return str.slice(1);
  }
  return str;
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str =
    typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : neutralizeCsvFormula(String(value));
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const num = Number(trimmed);
  return num;
}

function parseOptionalBoolean(
  raw: string | undefined,
): { value: boolean | undefined; error?: string } {
  if (raw === undefined) return { value: undefined };
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return { value: undefined };
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return { value: true };
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return { value: false };
  }
  return {
    value: undefined,
    error: `Invalid boolean value "${raw.trim()}". Expected true/false, yes/no, or 1/0.`,
  };
}

function parseBadgeList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed
    .split(/[|;]/)
    .map((item) => stripFormulaGuardOnImport(item.trim()))
    .filter((item) => item.length > 0);
}

function normalizeHeaderKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

interface ParsedCsvPayload {
  facilities: Array<{ rowNumber: number; raw: Record<string, unknown> }>;
  lanes: Array<{ rowNumber: number; raw: Record<string, unknown> }>;
  errors: BulkImportError[];
}

export function parseBulkImportCsv(csvText: string): ParsedCsvPayload {
  const matrix = parseCsvRecords(csvText);
  if (matrix.length < 2) {
    return {
      facilities: [],
      lanes: [],
      errors: [
        {
          row: 1,
          entity: "ROW",
          message:
            "CSV must include a header row and at least one data row.",
        },
      ],
    };
  }

  const dataRowCount = matrix.length - 1;
  if (dataRowCount > MAX_CSV_ROWS) {
    throw new WorkspaceValidationError(
      `Row limit exceeded: maximum ${MAX_CSV_ROWS} CSV rows allowed`,
    );
  }

  const headers = matrix[0]!.map(normalizeHeaderKey);
  const facilities: Array<{ rowNumber: number; raw: Record<string, unknown> }> =
    [];
  const lanes: Array<{ rowNumber: number; raw: Record<string, unknown> }> = [];
  const errors: BulkImportError[] = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const rowNumber = i + 1;
    const cells = matrix[i]!;
    const record: Record<string, string> = {};
    for (let col = 0; col < headers.length; col += 1) {
      const key = headers[col];
      if (key) {
        record[key] = stripFormulaGuardOnImport((cells[col] ?? "").trim());
      }
    }

    const explicitType = (
      record.recordtype ||
      record.type ||
      ""
    ).toUpperCase();

    const inferredType =
      explicitType ||
      (record.fromfacility ||
      record.fromfacilityref ||
      record.fromfacilityid ||
      record.tofacility ||
      record.tofacilityref ||
      record.tofacilityid
        ? "LANE"
        : record.name || record.lat || record.lng
          ? "FACILITY"
          : "");

    if (inferredType === "FACILITY") {
      const ownFlag = parseOptionalBoolean(record.isownfacility);
      if (ownFlag.error) {
        errors.push({
          row: rowNumber,
          entity: "FACILITY",
          field: "isOwnFacility",
          message: ownFlag.error,
        });
        continue;
      }

      facilities.push({
        rowNumber,
        raw: {
          refKey: record.refkey || undefined,
          name: record.name,
          kind: (record.kind || "FACTORY").toUpperCase(),
          locationPrecision: (
            record.locationprecision || "HQ_ESTIMATED"
          ).toUpperCase(),
          countryCode: record.countrycode,
          regionCode: record.regioncode || null,
          lat: parseOptionalNumber(record.lat),
          lng: parseOptionalNumber(record.lng),
          isOwnFacility: ownFlag.value ?? false,
          sector: record.sector || null,
          esgBadges: parseBadgeList(record.esgbadges),
          estimatedScope12Tco2e:
            parseOptionalNumber(record.estimatedscope12tco2e) ?? null,
        },
      });
    } else if (inferredType === "LANE") {
      const fromRef =
        record.fromfacilityref || record.fromfacility || undefined;
      const toRef = record.tofacilityref || record.tofacility || undefined;
      const pcfVerified = parseOptionalBoolean(record.pcfverified);
      if (pcfVerified.error) {
        errors.push({ row: rowNumber, entity: "LANE", field: "pcfVerified", message: pcfVerified.error });
        continue;
      }
      lanes.push({
        rowNumber,
        raw: {
          fromFacilityId: record.fromfacilityid || undefined,
          toFacilityId: record.tofacilityid || undefined,
          fromFacilityRef: fromRef,
          toFacilityRef: toRef,
          inputId: record.inputid || null,
          materialCategory: record.materialcategory,
          transportMode: (record.transportmode || "ROAD").toUpperCase(),
          volumeSharePct: parseOptionalNumber(record.volumesharepct) ?? 100,
          annualVolume: parseOptionalNumber(record.annualvolume) ?? null,
          volumeUnit: (record.volumeunit || "TONNES").toUpperCase(),
          annualSpendEur: parseOptionalNumber(record.annualspendeur) ?? null,
          contractEndDate: record.contractenddate || null,
          contractTerms: record.contractterms || null,
          leadTimeDays: parseOptionalNumber(record.leadtimedays) ?? null,
          safetyStockDays: parseOptionalNumber(record.safetystockdays),
          defectRatePct: parseOptionalNumber(record.defectratepct),
          carryingCostPct: parseOptionalNumber(record.carryingcostpct),
          unitLandedCostEur: parseOptionalNumber(record.unitlandedcosteur),
          ordinaryFreightCostPerUnitEur: parseOptionalNumber(record.ordinaryfreightcostperuniteur),
          customAnnualDisruptionProb: parseOptionalNumber(record.customannualdisruptionprob),
          customTtrDays: parseOptionalNumber(record.customttrdays),
          productEmissionFactorTco2ePerUnit: parseOptionalNumber(record.productemissionfactortco2eperunit),
          economicAttributionRatio: parseOptionalNumber(record.economicattributionratio),
          pcfVerified: pcfVerified.value,
          distanceKm: parseOptionalNumber(record.distancekm) ?? null,
          estimatedLaneCo2e:
            parseOptionalNumber(record.estimatedlaneco2e) ?? null,
          riskStatus: (record.riskstatus || "GREEN").toUpperCase(),
          riskReason: record.riskreason || null,
        },
      });
    } else {
      errors.push({
        row: rowNumber,
        entity: "ROW",
        field: "recordType",
        message: `Unsupported or missing recordType "${explicitType || "(empty)"}". Expected FACILITY or LANE.`,
      });
    }
  }

  return { facilities, lanes, errors };
}

function facilityDedupeKey(input: {
  name: string;
  kind: string;
  countryCode: string;
}): string {
  return `${input.name.trim().toLowerCase()}|${input.kind.toUpperCase()}|${input.countryCode.trim().toUpperCase()}`;
}

export async function executeBulkImport(
  workspaceRepo: WorkspaceRepository,
  orgId: string,
  payload: {
    facilities: Array<{ rowNumber: number; raw: unknown }>;
    lanes: Array<{ rowNumber: number; raw: unknown }>;
    initialErrors?: BulkImportError[];
    products?: Array<{ rowNumber: number; raw: unknown }>;
    inputs?: Array<{ rowNumber: number; raw: unknown }>;
  },
): Promise<BulkImportSummary> {
  const errors: BulkImportError[] = [...(payload.initialErrors ?? [])];

  if (payload.facilities.length > MAX_IMPORT_FACILITIES) {
    throw new WorkspaceValidationError(
      `Bulk import exceeds maximum of ${MAX_IMPORT_FACILITIES} facilities per request`,
    );
  }
  if (payload.lanes.length > MAX_IMPORT_LANES) {
    throw new WorkspaceValidationError(
      `Bulk import exceeds maximum of ${MAX_IMPORT_LANES} lanes per request`,
    );
  }

  const productIds = new Map((await workspaceRepo.listProducts(orgId)).map(p => [p.productId, p.productId]));
  const inputIds = new Map((await workspaceRepo.listInputs(orgId)).map(i => [i.inputId, i.inputId]));
  for (const item of payload.products ?? []) {
    const raw = item.raw as Record<string, unknown> | null;
    const parsed = CreateProductInputSchema.safeParse(raw);
    if (!parsed.success || !raw || typeof raw.productId !== "string") {
      errors.push({ row: item.rowNumber, entity: "PRODUCT", message: "Invalid product or missing productId" });
      continue;
    }
    try {
      const created = await workspaceRepo.createProduct(orgId, parsed.data);
      productIds.set(raw.productId, created.productId);
    } catch (err) {
      errors.push({ row: item.rowNumber, entity: "PRODUCT", message: err instanceof Error ? err.message : "Failed to create product" });
    }
  }
  for (const item of payload.inputs ?? []) {
    const raw = item.raw as Record<string, unknown> | null;
    const parsed = CreateSupplyInputInputSchema.safeParse(raw);
    if (!parsed.success || !raw || typeof raw.inputId !== "string") {
      errors.push({ row: item.rowNumber, entity: "INPUT", message: "Invalid input or missing inputId" });
      continue;
    }
    const productId = parsed.data.productId ? productIds.get(parsed.data.productId) : null;
    if (parsed.data.productId && !productId) {
      errors.push({ row: item.rowNumber, entity: "INPUT", field: "productId", message: "Referenced product was not found in this organization or import" });
      continue;
    }
    try {
      const created = await workspaceRepo.createInput(orgId, { ...parsed.data, productId });
      inputIds.set(raw.inputId, created.inputId);
    } catch (err) {
      errors.push({ row: item.rowNumber, entity: "INPUT", message: err instanceof Error ? err.message : "Failed to create input" });
    }
  }

  // Load org's existing facilities strictly scoped to orgId so lanes can reference
  // either newly imported facilities (by refKey, facilityId, or name) or existing org facilities.
  const existingFacilities = await workspaceRepo.listFacilities(orgId);
  const existingByDedupeKey = new Map<string, string>();
  const refToFacilityId = new Map<string, string>();
  const nameToFacilityIds = new Map<string, string[]>();

  const registerFacilityRef = (
    facilityId: string,
    name: string,
    refKey?: string,
  ) => {
    refToFacilityId.set(facilityId, facilityId);
    const nameKey = name.trim().toLowerCase();
    const list = nameToFacilityIds.get(nameKey) ?? [];
    if (!list.includes(facilityId)) {
      list.push(facilityId);
      nameToFacilityIds.set(nameKey, list);
    }
    if (refKey) {
      refToFacilityId.set(refKey.trim(), facilityId);
      refToFacilityId.set(refKey.trim().toLowerCase(), facilityId);
    }
  };

  for (const fac of existingFacilities) {
    registerFacilityRef(fac.facilityId, fac.name);
    existingByDedupeKey.set(
      facilityDedupeKey({
        name: fac.name,
        kind: fac.kind,
        countryCode: fac.countryCode,
      }),
      fac.facilityId,
    );
  }

  let createdFacilities = 0;
  for (const item of payload.facilities) {
    const parsed = BulkImportFacilityRowSchema.safeParse(item.raw);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      errors.push({
        row: item.rowNumber,
        entity: "FACILITY",
        field: firstIssue?.path.join(".") || undefined,
        message: firstIssue?.message ?? "Invalid facility row",
      });
      continue;
    }

    const { refKey, facilityId: exportedId, ...createInput } = parsed.data;
    const dedupeKey = facilityDedupeKey(createInput);
    const existingMatchId =
      (refKey ? refToFacilityId.get(refKey.trim()) : undefined) ??
      existingByDedupeKey.get(dedupeKey);

    if (existingMatchId) {
      registerFacilityRef(existingMatchId, createInput.name, refKey);
      if (exportedId) refToFacilityId.set(exportedId, existingMatchId);
      continue;
    }

    try {
      const created = await workspaceRepo.createFacility(orgId, createInput);
      createdFacilities += 1;
      if (!exportedId && !refKey) existingByDedupeKey.set(dedupeKey, created.facilityId);
      registerFacilityRef(created.facilityId, created.name, refKey);
      if (exportedId) refToFacilityId.set(exportedId, created.facilityId);
    } catch (err) {
      errors.push({
        row: item.rowNumber,
        entity: "FACILITY",
        message:
          err instanceof Error ? err.message : "Failed to create facility",
      });
    }
  }

  const resolveFacilityRef = (
    explicitId: string | undefined,
    ref: string | undefined,
  ): string | null => {
    if (explicitId) {
      const direct = refToFacilityId.get(explicitId);
      if (direct) return direct;
      const lower = refToFacilityId.get(explicitId.toLowerCase());
      if (lower) return lower;
    }
    if (ref) {
      const trimmed = ref.trim();
      const byRef =
        refToFacilityId.get(trimmed) ??
        refToFacilityId.get(trimmed.toLowerCase());
      if (byRef) return byRef;
      const byName = nameToFacilityIds.get(trimmed.toLowerCase());
      if (byName && byName.length > 0) {
        return byName[0]!;
      }
    }
    return null;
  };

  let createdLanes = 0;
  for (const item of payload.lanes) {
    const parsed = BulkImportLaneRowSchema.safeParse(item.raw);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      errors.push({
        row: item.rowNumber,
        entity: "LANE",
        field: firstIssue?.path.join(".") || undefined,
        message: firstIssue?.message ?? "Invalid lane row",
      });
      continue;
    }

    const row = parsed.data;
    const fromFacilityId = resolveFacilityRef(
      row.fromFacilityId,
      row.fromFacilityRef,
    );
    const toFacilityId = resolveFacilityRef(
      row.toFacilityId,
      row.toFacilityRef,
    );

    if (!fromFacilityId) {
      errors.push({
        row: item.rowNumber,
        entity: "LANE",
        field: "fromFacility",
        message: `Source facility "${row.fromFacilityId ?? row.fromFacilityRef ?? "(missing)"}" was not found in this organization's workspace`,
      });
      continue;
    }

    if (!toFacilityId) {
      errors.push({
        row: item.rowNumber,
        entity: "LANE",
        field: "toFacility",
        message: `Destination facility "${row.toFacilityId ?? row.toFacilityRef ?? "(missing)"}" was not found in this organization's workspace`,
      });
      continue;
    }

    try {
      await workspaceRepo.createLane(orgId, {
        fromFacilityId,
        toFacilityId,
        inputId: row.inputId ? (inputIds.get(row.inputId) ?? row.inputId) : null,
        materialCategory: row.materialCategory,
        transportMode: row.transportMode,
        volumeSharePct: row.volumeSharePct,
        annualVolume: row.annualVolume ?? null,
        volumeUnit: row.volumeUnit,
        annualSpendEur: row.annualSpendEur ?? null,
        contractEndDate: row.contractEndDate ?? null,
        contractTerms: row.contractTerms ?? null,
        leadTimeDays: row.leadTimeDays ?? null,
        distanceKm: row.distanceKm ?? null,
        estimatedLaneCo2e: row.estimatedLaneCo2e ?? null,
        riskStatus: row.riskStatus,
        riskReason: row.riskReason ?? null,
        safetyStockDays: row.safetyStockDays,
        defectRatePct: row.defectRatePct,
        carryingCostPct: row.carryingCostPct,
        unitLandedCostEur: row.unitLandedCostEur,
        ordinaryFreightCostPerUnitEur: row.ordinaryFreightCostPerUnitEur,
        customAnnualDisruptionProb: row.customAnnualDisruptionProb,
        customTtrDays: row.customTtrDays,
        productEmissionFactorTco2ePerUnit: row.productEmissionFactorTco2ePerUnit,
        economicAttributionRatio: row.economicAttributionRatio,
        pcfVerified: row.pcfVerified,
      });
      createdLanes += 1;
    } catch (err) {
      errors.push({
        row: item.rowNumber,
        entity: "LANE",
        message: err instanceof Error ? err.message : "Failed to create lane",
      });
    }
  }

  return BulkImportSummarySchema.parse({
    createdFacilities,
    createdLanes,
    errors,
  });
}

export function buildWorkspaceExportJson(
  organization: Organization,
  network: WorkspaceNetworkResponse,
): WorkspaceExportJson {
  return WorkspaceExportJsonSchema.parse({
    exportVersion: "1.0",
    exportedAt: new Date().toISOString(),
    organization: {
      orgId: organization.orgId,
      name: organization.name,
      countryCode: organization.countryCode,
      sector: organization.sector,
    },
    products: network.products,
    inputs: network.inputs,
    facilities: network.facilities,
    lanes: network.lanes,
  });
}

const EXPORT_CSV_HEADERS = [
  "recordType",
  "refKey",
  "name",
  "kind",
  "locationPrecision",
  "countryCode",
  "regionCode",
  "lat",
  "lng",
  "isOwnFacility",
  "sector",
  "esgBadges",
  "estimatedScope12Tco2e",
  "fromFacility",
  "toFacility",
  "fromFacilityId",
  "toFacilityId",
  "materialCategory",
  "transportMode",
  "volumeSharePct",
  "annualVolume",
  "volumeUnit",
  "annualSpendEur",
  "contractEndDate",
  "contractTerms",
  "leadTimeDays",
  "distanceKm",
  "estimatedLaneCo2e",
  "riskStatus",
  "riskReason",
  "safetyStockDays",
  "defectRatePct",
  "carryingCostPct",
  "unitLandedCostEur",
  "ordinaryFreightCostPerUnitEur",
  "customAnnualDisruptionProb",
  "customTtrDays",
  "productEmissionFactorTco2ePerUnit",
  "economicAttributionRatio",
  "pcfVerified",
] as const;

/**
 * Serializes ONLY the authenticated organization's visible facilities and lanes
 * to RFC-4180 CSV (round-trip compatible with POST /api/v1/workspace/import).
 */
export function serializeNetworkToCsv(
  network: WorkspaceNetworkResponse,
): string {
  const facilityNameById = new Map(
    network.facilities.map((f) => [f.facilityId, f.name]),
  );

  const lines: string[] = [EXPORT_CSV_HEADERS.join(",")];

  for (const fac of network.facilities) {
    lines.push(
      [
        "FACILITY",
        fac.facilityId,
        fac.name,
        fac.kind,
        fac.locationPrecision,
        fac.countryCode,
        fac.regionCode ?? "",
        fac.lat,
        fac.lng,
        fac.isOwnFacility,
        fac.sector ?? "",
        fac.esgBadges.join("|"),
        fac.estimatedScope12Tco2e ?? "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  for (const lane of network.lanes) {
    lines.push(
      [
        "LANE",
        lane.laneId,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        facilityNameById.get(lane.fromFacilityId) ?? lane.fromFacilityId,
        facilityNameById.get(lane.toFacilityId) ?? lane.toFacilityId,
        lane.fromFacilityId,
        lane.toFacilityId,
        lane.materialCategory,
        lane.transportMode,
        lane.volumeSharePct,
        lane.annualVolume ?? "",
        lane.volumeUnit,
        lane.annualSpendEur ?? "",
        lane.contractEndDate ?? "",
        lane.contractTerms ?? "",
        lane.leadTimeDays ?? "",
        lane.distanceKm ?? "",
        lane.estimatedLaneCo2e ?? "",
        lane.riskStatus,
        lane.riskReason ?? "",
        lane.safetyStockDays ?? "",
        lane.defectRatePct ?? "",
        lane.carryingCostPct ?? "",
        lane.unitLandedCostEur ?? "",
        lane.ordinaryFreightCostPerUnitEur ?? "",
        lane.customAnnualDisruptionProb ?? "",
        lane.customTtrDays ?? "",
        lane.productEmissionFactorTco2ePerUnit ?? "",
        lane.economicAttributionRatio ?? "",
        lane.pcfVerified ?? "",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
