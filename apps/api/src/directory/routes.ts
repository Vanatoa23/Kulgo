import {
  BulkCatalogueImportResultSchema,
  CatalogueItemResponseSchema,
  CreateCatalogueItemInputSchema,
  DirectoryAlternativesResponseSchema,
  FacilityAlternativesResponseSchema,
  IntroRequestInputSchema,
  IntroRequestResponseSchema,
  KULGO_MATERIAL_TAXONOMY,
  ListCatalogueItemsResponseSchema,
  TaxonomyResponseSchema,
  UpdateCatalogueItemInputSchema,
  resolveStandardizedCategory,
  type BulkCatalogueImportError,
  type CatalogueItem,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import type { OutreachService } from "../outreach/service.js";
import { parseCsvRecords } from "../workspace/import-export.js";
import { buildXlsxBuffer, parseXlsxBuffer } from "../workspace/xlsx.js";
import {
  CatalogueNotFoundError,
  type CatalogueRepository,
} from "./catalogue-repository.js";
import {
  SEEDED_EU_ALTERNATIVES,
  type DirectoryRepository,
} from "./repository.js";

export interface DirectoryRoutesDependencies {
  authRepo: AuthRepository;
  directoryRepo: DirectoryRepository;
  catalogueRepo?: CatalogueRepository;
  outreachService?: OutreachService;
}

const DirectoryQuerySchema = z.object({
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{2}$/.test(v), "countryCode must be a 2-letter ISO code")
    .optional(),
  capability: z.string().trim().min(1).max(100).optional(),
  excludeRed: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
});

const CATALOGUE_TEMPLATE_ROWS: readonly (readonly string[])[] = [
  [
    "standardized_category",
    "product_title",
    "sku",
    "base_unit",
    "product_emission_factor_tco2e_per_unit",
    "pcf_verified",
    "specs",
    "lead_time_days",
    "moq",
    "capacity_band",
    "certifications",
  ],
  [
    "ALUMINUM_EXTRUSIONS",
    "6061-T6 Recycled Aluminum Extrusion Profile",
    "ALU-6061-REC",
    "TONNES",
    "4.15",
    "true",
    "EN AW-6061|Anodized|80% Recycled",
    "14",
    "5",
    "LARGE",
    "ISO 14001|ASI Performance",
  ],
  [
    "PCB_ASSEMBLY",
    "4-Layer Industrial Control PCBA",
    "PCBA-IND-04",
    "UNITS",
    "0.012",
    "false",
    "RoHS|IPC-A-610 Class 3|SMT",
    "21",
    "100",
    "MEDIUM",
    "ISO 9001|EcoVadis Gold",
  ],
];

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function parsePipeList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseOptionalNum(raw: string | undefined): number | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

function parseOptionalBool(raw: string | undefined): boolean | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const norm = raw.trim().toLowerCase();
  if (norm === "true" || norm === "1" || norm === "yes") return true;
  if (norm === "false" || norm === "0" || norm === "no") return false;
  return undefined;
}

export function createDirectoryRoutes({
  authRepo,
  directoryRepo,
  catalogueRepo,
  outreachService,
}: DirectoryRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  // --- Standardized Material Taxonomy ---
  routes.get("/taxonomy", (c) => {
    return c.json(
      TaxonomyResponseSchema.parse({
        categories: KULGO_MATERIAL_TAXONOMY.map((cat) => ({
          ...cat,
          keywords: [...cat.keywords],
        })),
      }),
      200,
    );
  });

  // --- General Directory Alternatives ---
  routes.get("/alternatives", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const rawCountryCode = c.req.query("countryCode");
    const rawCapability = c.req.query("capability");
    const rawExcludeRed = c.req.query("excludeRed");

    const parsed = DirectoryQuerySchema.safeParse({
      countryCode: rawCountryCode || undefined,
      capability: rawCapability || undefined,
      excludeRed: rawExcludeRed || undefined,
    });

    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const candidates = await directoryRepo.listAlternatives(orgId, parsed.data);
    return c.json(
      DirectoryAlternativesResponseSchema.parse({ candidates }),
      200,
    );
  });

  // --- Node Inspector "See alternatives (x)" ---
  routes.get("/alternatives/for-facility/:facilityId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const facilityId = c.req.param("facilityId");
    if (!z.string().uuid().safeParse(facilityId).success) {
      return c.json({ error: "Invalid facilityId" }, 400);
    }

    const result = await directoryRepo.listAlternativesForFacility(
      orgId,
      facilityId,
    );
    if (!result) {
      return c.json({ error: "Facility not found" }, 404);
    }

    return c.json(FacilityAlternativesResponseSchema.parse(result), 200);
  });

  // --- 1-Click Request Intro / Quote ---
  routes.post("/request-intro", async (c) => {
    const auth = c.get("auth");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = IntroRequestInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    if (parsed.data.targetOrgId === auth.organization.orgId) {
      return c.json(
        { error: "Cannot request an introduction to your own organization" },
        400,
      );
    }

    // Resolve target org (must be an opt-in Kulgo org or a seeded EU directory supplier)
    const seededTarget = SEEDED_EU_ALTERNATIVES.find(
      (s) => s.orgId === parsed.data.targetOrgId,
    );
    let targetOrgName: string | null = seededTarget?.name ?? null;
    let targetContactEmail: string | null = null;

    if (!seededTarget) {
      const targetOrg = await authRepo.findOrganizationById(
        parsed.data.targetOrgId,
      );
      if (!targetOrg || !targetOrg.openToNewBuyers) {
        return c.json(
          { error: "Alternative supplier not found or not open to introductions" },
          404,
        );
      }
      targetOrgName = targetOrg.name;
      const members = await authRepo.listOrgMembers(targetOrg.orgId);
      const owner = members.find((m) => m.role === "OWNER") ?? members[0];
      targetContactEmail = owner?.email ?? null;
    }

    if (!outreachService) {
      return c.json(
        IntroRequestResponseSchema.parse({
          requestId: crypto.randomUUID(),
          targetOrgId: parsed.data.targetOrgId,
          targetOrgName: targetOrgName!,
          status: "RECORDED",
          sentAt: new Date().toISOString(),
        }),
        201,
      );
    }

    try {
      const dispatch = await outreachService.dispatchIntroRequest({
        fromOrgId: auth.organization.orgId,
        fromOrgName: auth.organization.name,
        fromCountryCode: auth.organization.countryCode,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        targetOrgId: parsed.data.targetOrgId,
        targetOrgName: targetOrgName!,
        targetContactEmail,
        materialCategory: parsed.data.materialCategory,
        volumeBand: parsed.data.volumeBand,
        unit: parsed.data.unit,
        note: parsed.data.note,
      });

      return c.json(
        IntroRequestResponseSchema.parse({
          requestId: dispatch.requestId,
          targetOrgId: parsed.data.targetOrgId,
          targetOrgName: targetOrgName!,
          status: dispatch.status,
          sentAt: dispatch.sentAt,
        }),
        201,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to dispatch intro request";
      if (message.toLowerCase().includes("rate limit")) {
        return c.json({ error: message }, 429);
      }
      throw err;
    }
  });

  // --- Supplier Product Catalogue CRUD & Bulk Import ---
  routes.get("/catalogue/template.csv", (c) => {
    const csv = CATALOGUE_TEMPLATE_ROWS.map((row) => row.join(",")).join("\n");
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      'attachment; filename="kulgo-catalogue-template.csv"',
    );
    return c.body(csv, 200);
  });

  routes.get("/catalogue/template.xlsx", (c) => {
    const xlsx = buildXlsxBuffer("Product Catalogue", CATALOGUE_TEMPLATE_ROWS);
    c.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    c.header(
      "Content-Disposition",
      'attachment; filename="kulgo-catalogue-template.xlsx"',
    );
    return c.body(new Uint8Array(xlsx), 200);
  });

  routes.get("/catalogue", async (c) => {
    if (!catalogueRepo) {
      return c.json(ListCatalogueItemsResponseSchema.parse({ items: [] }), 200);
    }
    const orgId = c.get("auth").organization.orgId;
    const items = await catalogueRepo.listByOrg(orgId);
    return c.json(ListCatalogueItemsResponseSchema.parse({ items }), 200);
  });

  routes.post("/catalogue", async (c) => {
    if (!catalogueRepo) {
      return c.json({ error: "Catalogue repository not configured" }, 503);
    }
    const auth = c.get("auth");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateCatalogueItemInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const item = await catalogueRepo.create(auth.organization.orgId, parsed.data);
    await authRepo.recordAuditEvent({
      orgId: auth.organization.orgId,
      actorUserId: auth.user.userId,
      actorEmail: auth.user.email,
      action: "CATALOGUE_UPDATED",
      summary: `Added catalogue item "${item.productTitle}" (${item.standardizedCategory})`,
      metadata: {
        itemId: item.itemId,
        standardizedCategory: item.standardizedCategory,
      },
    });

    return c.json(CatalogueItemResponseSchema.parse({ item }), 201);
  });

  routes.patch("/catalogue/:itemId", async (c) => {
    if (!catalogueRepo) {
      return c.json({ error: "Catalogue repository not configured" }, 503);
    }
    const auth = c.get("auth");
    const itemId = c.req.param("itemId");
    if (!z.string().uuid().safeParse(itemId).success) {
      return c.json({ error: "Invalid itemId" }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateCatalogueItemInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const item = await catalogueRepo.update(
        auth.organization.orgId,
        itemId,
        parsed.data,
      );
      await authRepo.recordAuditEvent({
        orgId: auth.organization.orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "CATALOGUE_UPDATED",
        summary: `Updated catalogue item "${item.productTitle}"`,
        metadata: {
          itemId: item.itemId,
          standardizedCategory: item.standardizedCategory,
        },
      });
      return c.json(CatalogueItemResponseSchema.parse({ item }), 200);
    } catch (err) {
      if (err instanceof CatalogueNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  routes.delete("/catalogue/:itemId", async (c) => {
    if (!catalogueRepo) {
      return c.json({ error: "Catalogue repository not configured" }, 503);
    }
    const auth = c.get("auth");
    const itemId = c.req.param("itemId");
    if (!z.string().uuid().safeParse(itemId).success) {
      return c.json({ error: "Invalid itemId" }, 400);
    }

    const deleted = await catalogueRepo.delete(auth.organization.orgId, itemId);
    if (!deleted) {
      return c.json({ error: "Catalogue item not found" }, 404);
    }

    await authRepo.recordAuditEvent({
      orgId: auth.organization.orgId,
      actorUserId: auth.user.userId,
      actorEmail: auth.user.email,
      action: "CATALOGUE_UPDATED",
      summary: `Deleted catalogue item ${itemId}`,
      metadata: { itemId },
    });

    return c.json({ ok: true, deletedItemId: itemId }, 200);
  });

  routes.post("/catalogue/import", async (c) => {
    if (!catalogueRepo) {
      return c.json({ error: "Catalogue repository not configured" }, 503);
    }
    const auth = c.get("auth");
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();

    let matrix: string[][] = [];
    try {
      if (
        contentType.includes(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ) ||
        contentType.includes("application/octet-stream")
      ) {
        const buf = Buffer.from(await c.req.arrayBuffer());
        matrix = parseXlsxBuffer(buf);
      } else if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
        const text = await c.req.text();
        matrix = parseCsvRecords(text);
      } else {
        const body = (await c.req.json()) as {
          csv?: unknown;
          xlsxBase64?: unknown;
        };
        if (typeof body.xlsxBase64 === "string" && body.xlsxBase64.length > 0) {
          matrix = parseXlsxBuffer(Buffer.from(body.xlsxBase64, "base64"));
        } else if (typeof body.csv === "string" && body.csv.length > 0) {
          matrix = parseCsvRecords(body.csv);
        } else {
          return c.json(
            { error: "Provide CSV text or xlsxBase64 spreadsheet data" },
            400,
          );
        }
      }
    } catch (err) {
      return c.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Failed to parse catalogue spreadsheet",
        },
        400,
      );
    }

    if (matrix.length < 2) {
      return c.json(
        BulkCatalogueImportResultSchema.parse({
          createdCount: 0,
          items: [],
          errors: [
            {
              row: 1,
              message:
                "Spreadsheet must include a header row and at least one data row.",
            },
          ],
        }),
        200,
      );
    }

    const headers = matrix[0]!.map(normalizeHeader);
    const created: CatalogueItem[] = [];
    const errors: BulkCatalogueImportError[] = [];

    for (let i = 1; i < matrix.length; i += 1) {
      const rowNumber = i + 1;
      const cells = matrix[i]!;
      const rec: Record<string, string> = {};
      for (let col = 0; col < headers.length; col += 1) {
        const h = headers[col];
        if (h) rec[h] = (cells[col] ?? "").trim();
      }

      const rawCategory =
        rec.standardizedcategory || rec.category || rec.materialcategory || "";
      const resolvedCategory = resolveStandardizedCategory(rawCategory);
      if (!resolvedCategory) {
        errors.push({
          row: rowNumber,
          field: "standardized_category",
          message: `Unrecognized standardized category "${rawCategory}".`,
        });
        continue;
      }

      const productTitle = rec.producttitle || rec.title || rec.name || "";
      if (!productTitle) {
        errors.push({
          row: rowNumber,
          field: "product_title",
          message: "product_title is required.",
        });
        continue;
      }

      const rawBaseUnit = (rec.baseunit || rec.unit || "").toUpperCase();
      const rawCapBand = (rec.capacityband || "").toUpperCase();

      const parsedRow = CreateCatalogueItemInputSchema.safeParse({
        standardizedCategory: resolvedCategory,
        productTitle,
        sku: rec.sku || undefined,
        baseUnit: rawBaseUnit || undefined,
        productEmissionFactorTco2ePerUnit: parseOptionalNum(
          rec.productemissionfactortco2eperunit || rec.pcf,
        ),
        pcfVerified: parseOptionalBool(rec.pcfverified),
        specs: parsePipeList(rec.specs || rec.tags),
        leadTimeDays: parseOptionalNum(rec.leadtimedays),
        moq: parseOptionalNum(rec.moq),
        capacityBand: rawCapBand || undefined,
        certifications: parsePipeList(rec.certifications || rec.esgbadges),
      });

      if (!parsedRow.success) {
        const issue = parsedRow.error.issues[0];
        errors.push({
          row: rowNumber,
          field: issue?.path.join(".") || undefined,
          message: issue?.message ?? "Invalid catalogue row.",
        });
        continue;
      }

      const item = await catalogueRepo.create(
        auth.organization.orgId,
        parsedRow.data,
      );
      created.push(item);
    }

    if (created.length > 0) {
      await authRepo.recordAuditEvent({
        orgId: auth.organization.orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "CATALOGUE_UPDATED",
        summary: `Imported ${created.length} product catalogue item(s)`,
        metadata: { createdCount: created.length, errorCount: errors.length },
      });
    }

    return c.json(
      BulkCatalogueImportResultSchema.parse({
        createdCount: created.length,
        items: created,
        errors,
      }),
      200,
    );
  });

  return routes;
}
