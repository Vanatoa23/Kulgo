import {
  BulkImportFacilityRowSchema,
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
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
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

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
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

function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function parseBadgeList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed
    .split(/[|;]/)
    .map((item) => item.trim())
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
        record[key] = (cells[col] ?? "").trim();
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
          isOwnFacility: parseOptionalBoolean(record.isownfacility) ?? false,
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

export async function executeBulkImport(
  workspaceRepo: WorkspaceRepository,
  orgId: string,
  payload: {
    facilities: Array<{ rowNumber: number; raw: unknown }>;
    lanes: Array<{ rowNumber: number; raw: unknown }>;
    initialErrors?: BulkImportError[];
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

  // Load org's existing facilities strictly scoped to orgId so lanes can reference
  // either newly imported facilities (by refKey or name) or existing org facilities.
  const existingFacilities = await workspaceRepo.listFacilities(orgId);
  const refToFacilityId = new Map<string, string>();
  for (const fac of existingFacilities) {
    refToFacilityId.set(fac.facilityId, fac.facilityId);
    refToFacilityId.set(fac.name.trim().toLowerCase(), fac.facilityId);
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

    const { refKey, ...createInput } = parsed.data;
    try {
      const created = await workspaceRepo.createFacility(orgId, createInput);
      createdFacilities += 1;
      refToFacilityId.set(created.facilityId, created.facilityId);
      refToFacilityId.set(created.name.trim().toLowerCase(), created.facilityId);
      if (refKey) {
        refToFacilityId.set(refKey.trim().toLowerCase(), created.facilityId);
      }
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
      return refToFacilityId.get(explicitId) ?? null;
    }
    if (ref) {
      return (
        refToFacilityId.get(ref.trim()) ??
        refToFacilityId.get(ref.trim().toLowerCase()) ??
        null
      );
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
        inputId: row.inputId ?? null,
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
  "materialCategory",
  "transportMode",
  "volumeSharePct",
  "annualVolume",
  "volumeUnit",
  "annualSpendEur",
  "contractEndDate",
  "contractTerms",
  "leadTimeDays",
  "riskStatus",
  "riskReason",
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
        lane.materialCategory,
        lane.transportMode,
        lane.volumeSharePct,
        lane.annualVolume ?? "",
        lane.volumeUnit,
        lane.annualSpendEur ?? "",
        lane.contractEndDate ?? "",
        lane.contractTerms ?? "",
        lane.leadTimeDays ?? "",
        lane.riskStatus,
        lane.riskReason ?? "",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
