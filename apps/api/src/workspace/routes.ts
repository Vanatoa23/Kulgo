import {
  clusterErpPoHistoryToDraftContracts,
  type ErpPoHistoryRow,
} from "@kulgo/engine";
import {
  BulkImportJsonRequestSchema,
  CreateContractInputSchema,
  CreateContractLineInputBaseSchema,
  CreateFacilityInputSchema,
  CreateProductInputSchema,
  CreateSupplyInputInputSchema,
  CreateSupplyLaneInputSchema,
  UpdateContractInputSchema,
  UpdateContractLineInputSchema,
  UpdateFacilityInputSchema,
  UpdateProductInputSchema,
  UpdateSupplyInputInputSchema,
  UpdateSupplyLaneInputSchema,
  WorkspaceNetworkResponseSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import type { RiskSignalRepository } from "../analytics/risk-signals.js";
import type { OutreachService } from "../outreach/service.js";
import type { CompanyRegistrySearchService } from "../registry/service.js";
import {
  buildWorkspaceExportJson,
  executeBulkImport,
  parseBulkImportCsv,
  parseBulkImportMatrix,
  serializeNetworkToCsv,
  SUPPLIER_ONBOARDING_TEMPLATE_ROWS,
} from "./import-export.js";
import { buildXlsxBuffer, parseXlsxBuffer } from "./xlsx.js";
import {
  WorkspaceConflictError,
  WorkspaceValidationError,
  type WorkspaceRepository,
} from "./repository.js";
import { seedEstoniaProductXDemo } from "./seed-demo.js";

export interface WorkspaceRoutesDependencies {
  authRepo: AuthRepository;
  workspaceRepo: WorkspaceRepository;
  riskSignalRepo?: RiskSignalRepository;
  outreachService?: OutreachService;
  registrySearch?: CompanyRegistrySearchService;
}

const NetworkQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  inputId: z.string().uuid().optional(),
});

export function createWorkspaceRoutes({
  authRepo,
  workspaceRepo,
  riskSignalRepo,
  outreachService,
  registrySearch,
}: WorkspaceRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  // --- Network ---
  routes.get("/network", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const rawProductId = c.req.query("productId");
    const rawInputId = c.req.query("inputId");

    const parsedQuery = NetworkQuerySchema.safeParse({
      productId: rawProductId || undefined,
      inputId: rawInputId || undefined,
    });
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.flatten(),
        },
        400,
      );
    }

    const [network, riskSignals] = await Promise.all([
      workspaceRepo.getNetwork(orgId, parsedQuery.data),
      riskSignalRepo ? riskSignalRepo.listActive() : Promise.resolve([]),
    ]);
    return c.json(
      WorkspaceNetworkResponseSchema.parse({ ...network, riskSignals }),
      200,
    );
  });

  // --- Demo Seeder ---
  routes.post("/seed-demo", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const [network, riskSignals] = await Promise.all([
      seedEstoniaProductXDemo(workspaceRepo, orgId),
      riskSignalRepo
        ? riskSignalRepo.ensureDemoSignals()
        : Promise.resolve([]),
    ]);
    return c.json(
      WorkspaceNetworkResponseSchema.parse({ ...network, riskSignals }),
      201,
    );
  });

  // --- Supplier Onboarding Templates (CSV & Excel .xlsx) ---
  routes.get("/templates/suppliers.csv", (c) => {
    const csv = SUPPLIER_ONBOARDING_TEMPLATE_ROWS.map((row) =>
      row.join(","),
    ).join("\n");
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      'attachment; filename="kulgo-suppliers-template.csv"',
    );
    return c.body(csv, 200);
  });

  routes.get("/templates/suppliers.xlsx", (c) => {
    const xlsx = buildXlsxBuffer(
      "Suppliers",
      SUPPLIER_ONBOARDING_TEMPLATE_ROWS,
    );
    c.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    c.header(
      "Content-Disposition",
      'attachment; filename="kulgo-suppliers-template.xlsx"',
    );
    return c.body(new Uint8Array(xlsx), 200);
  });

  // --- Bulk Import (JSON, CSV, or Excel .xlsx) ---
  routes.post("/import", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();

    const triggerOutreachHints = (
      hints: ReadonlyArray<{ supplierName: string; email: string }>,
    ) => {
      if (!outreachService || hints.length === 0) return;
      for (const hint of hints) {
        void outreachService
          .dispatchSupplierOutreach({
            fromOrgId: orgId,
            fromOrgName: auth.organization.name,
            actorUserId: auth.user.userId,
            actorEmail: auth.user.email,
            supplierName: hint.supplierName,
            recipientEmail: hint.email,
          })
          .catch(() => {
            // Non-fatal
          });
      }
    };

    const recordBulkImportAudit = async (
      format: "csv" | "json" | "xlsx",
      summary: { createdFacilities: number; createdLanes: number; errors: unknown[] },
    ) => {
      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "BULK_IMPORT_EXECUTED",
        summary: `Executed ${format.toUpperCase()} bulk import (${summary.createdFacilities} facilities, ${summary.createdLanes} lanes, ${summary.errors.length} errors)`,
        metadata: {
          format,
          createdFacilities: summary.createdFacilities,
          createdLanes: summary.createdLanes,
          errorCount: summary.errors.length,
        },
      });
    };

    try {
      if (
        contentType.includes(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ) ||
        contentType.includes("application/octet-stream")
      ) {
        const buf = Buffer.from(await c.req.arrayBuffer());
        if (buf.length === 0) {
          return c.json({ error: "XLSX payload must not be empty" }, 400);
        }
        let matrix: string[][];
        try {
          matrix = parseXlsxBuffer(buf);
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : "Invalid XLSX file" },
            400,
          );
        }
        const parsedXlsx = parseBulkImportMatrix(matrix);
        const summary = await executeBulkImport(workspaceRepo, orgId, {
          facilities: parsedXlsx.facilities,
          lanes: parsedXlsx.lanes,
          initialErrors: parsedXlsx.errors,
          onboardingContracts: parsedXlsx.onboardingContracts,
          orgDefaults: {
            name: auth.organization.name,
            countryCode: auth.organization.countryCode,
          },
        });
        triggerOutreachHints(parsedXlsx.outreachHints);
        await recordBulkImportAudit("xlsx", summary);
        return c.json(summary, 200);
      }

      if (
        contentType.includes("text/csv") ||
        contentType.includes("text/plain")
      ) {
        const csvText = await c.req.text();
        if (csvText.trim().length === 0) {
          return c.json({ error: "CSV payload must not be empty" }, 400);
        }
        const parsedCsv = parseBulkImportCsv(csvText);
        const summary = await executeBulkImport(workspaceRepo, orgId, {
          facilities: parsedCsv.facilities,
          lanes: parsedCsv.lanes,
          initialErrors: parsedCsv.errors,
          onboardingContracts: parsedCsv.onboardingContracts,
          orgDefaults: {
            name: auth.organization.name,
            countryCode: auth.organization.countryCode,
          },
        });
        triggerOutreachHints(parsedCsv.outreachHints);
        await recordBulkImportAudit("csv", summary);
        return c.json(summary, 200);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON payload" }, 400);
      }

      const parsedBody = BulkImportJsonRequestSchema.safeParse(body);
      if (!parsedBody.success) {
        return c.json(
          { error: "Validation failed", details: parsedBody.error.flatten() },
          400,
        );
      }

      if (parsedBody.data.xlsxBase64) {
        let matrix: string[][];
        try {
          matrix = parseXlsxBuffer(
            Buffer.from(parsedBody.data.xlsxBase64, "base64"),
          );
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : "Invalid XLSX file" },
            400,
          );
        }
        const parsedXlsx = parseBulkImportMatrix(matrix);
        const summary = await executeBulkImport(workspaceRepo, orgId, {
          facilities: parsedXlsx.facilities,
          lanes: parsedXlsx.lanes,
          initialErrors: parsedXlsx.errors,
          onboardingContracts: parsedXlsx.onboardingContracts,
          orgDefaults: {
            name: auth.organization.name,
            countryCode: auth.organization.countryCode,
          },
        });
        triggerOutreachHints(parsedXlsx.outreachHints);
        await recordBulkImportAudit("xlsx", summary);
        return c.json(summary, 200);
      }

      if (parsedBody.data.csv) {
        const parsedCsv = parseBulkImportCsv(parsedBody.data.csv);
        const summary = await executeBulkImport(workspaceRepo, orgId, {
          facilities: parsedCsv.facilities,
          lanes: parsedCsv.lanes,
          initialErrors: parsedCsv.errors,
          onboardingContracts: parsedCsv.onboardingContracts,
          orgDefaults: {
            name: auth.organization.name,
            countryCode: auth.organization.countryCode,
          },
        });
        triggerOutreachHints(parsedCsv.outreachHints);
        await recordBulkImportAudit("csv", summary);
        return c.json(summary, 200);
      }

      const facilities = (parsedBody.data.facilities ?? []).map((raw, idx) => ({
        rowNumber: idx + 1,
        raw,
      }));
      const lanes = (parsedBody.data.lanes ?? []).map((raw, idx) => ({
        rowNumber: idx + 1,
        raw,
      }));

      const products = (parsedBody.data.products ?? []).map((raw, idx) => ({ rowNumber: idx + 1, raw }));
      const inputs = (parsedBody.data.inputs ?? []).map((raw, idx) => ({ rowNumber: idx + 1, raw }));

      if (facilities.length === 0 && lanes.length === 0 && products.length === 0 && inputs.length === 0 && !parsedBody.data.exportVersion) {
        return c.json(
          {
            error:
              "Import payload must contain at least one facility, lane, csv, or xlsxBase64 payload",
          },
          400,
        );
      }

      const summary = await executeBulkImport(workspaceRepo, orgId, {
        facilities,
        lanes,
        products,
        inputs,
      });
      await recordBulkImportAudit("json", summary);
      return c.json(summary, 200);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  // --- Network Export (JSON or CSV — strictly org's own visible network) ---
  routes.get("/export", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const format = (c.req.query("format") ?? "json").trim().toLowerCase();

    if (format !== "json" && format !== "csv") {
      return c.json(
        { error: 'Invalid export format. Expected "json" or "csv".' },
        400,
      );
    }

    const network = await workspaceRepo.getNetwork(orgId);
    const safeSlug = auth.organization.slug.replace(/[^a-zA-Z0-9_-]/g, "");

    if (format === "csv") {
      const csv = serializeNetworkToCsv(network);
      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kulgo-network-${safeSlug}.csv"`,
      });
    }

    const jsonExport = buildWorkspaceExportJson(auth.organization, network);
    c.header(
      "Content-Disposition",
      `attachment; filename="kulgo-network-${safeSlug}.json"`,
    );
    return c.json(jsonExport, 200);
  });

  // --- Products ---
  routes.get("/products", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const products = await workspaceRepo.listProducts(orgId);
    return c.json({ products }, 200);
  });

  routes.post("/products", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateProductInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const product = await workspaceRepo.createProduct(orgId, parsed.data);
    return c.json({ product }, 201);
  });

  routes.patch("/products/:productId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const productId = c.req.param("productId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateProductInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const product = await workspaceRepo.updateProduct(
      orgId,
      productId,
      parsed.data,
    );
    if (!product) {
      return c.json({ error: "Product not found" }, 404);
    }
    return c.json({ product }, 200);
  });

  routes.delete("/products/:productId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const productId = c.req.param("productId");
    const deleted = await workspaceRepo.deleteProduct(orgId, productId);
    if (!deleted) {
      return c.json({ error: "Product not found" }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  // --- SupplyInputs ---
  routes.get("/inputs", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const inputs = await workspaceRepo.listInputs(orgId);
    return c.json({ inputs }, 200);
  });

  routes.post("/inputs", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateSupplyInputInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const input = await workspaceRepo.createInput(orgId, parsed.data);
      return c.json({ input }, 201);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.patch("/inputs/:inputId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const inputId = c.req.param("inputId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateSupplyInputInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const input = await workspaceRepo.updateInput(
        orgId,
        inputId,
        parsed.data,
      );
      if (!input) {
        return c.json({ error: "Supply input not found" }, 404);
      }
      return c.json({ input }, 200);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.delete("/inputs/:inputId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const inputId = c.req.param("inputId");
    const deleted = await workspaceRepo.deleteInput(orgId, inputId);
    if (!deleted) {
      return c.json({ error: "Supply input not found" }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  // --- Facilities ---
  routes.get("/facilities", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const facilities = await workspaceRepo.listFacilities(orgId);
    return c.json({ facilities }, 200);
  });

  routes.post("/facilities", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateFacilityInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const facility = await workspaceRepo.createFacility(orgId, parsed.data);

    if (
      registrySearch &&
      !facility.isOwnFacility &&
      facility.countryCode === "EE" &&
      !facility.registryCode
    ) {
      void registrySearch
        .search({ name: facility.name, countryCode: "EE" })
        .then(async (res) => {
          if (res.outcome === "CONCLUSIVE_MATCH" && res.candidates[0]) {
            await workspaceRepo.updateFacility(orgId, facility.facilityId, {
              registryCode: res.candidates[0].registryId,
            });
          }
        })
        .catch(() => {});
    }

    return c.json({ facility }, 201);
  });

  routes.patch("/facilities/:facilityId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const facilityId = c.req.param("facilityId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateFacilityInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const facility = await workspaceRepo.updateFacility(
      orgId,
      facilityId,
      parsed.data,
    );
    if (!facility) {
      return c.json({ error: "Facility not found" }, 404);
    }
    return c.json({ facility }, 200);
  });

  routes.delete("/facilities/:facilityId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const facilityId = c.req.param("facilityId");
    const deleted = await workspaceRepo.deleteFacility(orgId, facilityId);
    if (!deleted) {
      return c.json({ error: "Facility not found" }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  // --- SupplyLanes ---
  routes.get("/lanes", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const lanes = await workspaceRepo.listLanes(orgId);
    return c.json({ lanes }, 200);
  });

  routes.post("/lanes", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateSupplyLaneInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const lane = await workspaceRepo.createLane(orgId, parsed.data);
      return c.json({ lane }, 201);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  const ApplyAllocationSplitsBodySchema = z.object({
    splits: z
      .array(
        z.object({
          laneId: z.string().uuid(),
          allocationSplitPct: z.number().finite().min(0).max(100),
        }),
      )
      .min(2)
      .max(50),
  });

  routes.patch("/lanes/allocation-splits", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = ApplyAllocationSplitsBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const normalizedSplits = parsed.data.splits.map((s) => ({
        laneId: s.laneId!,
        allocationSplitPct: s.allocationSplitPct!,
      }));
      const result = await workspaceRepo.applyAllocationSplitsAtomic(
        orgId,
        normalizedSplits,
      );
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.patch("/lanes/:laneId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const laneId = c.req.param("laneId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateSupplyLaneInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const lane = await workspaceRepo.updateLane(orgId, laneId, parsed.data);
      if (!lane) {
        return c.json({ error: "Supply lane not found" }, 404);
      }
      return c.json({ lane }, 200);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.delete("/lanes/:laneId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const laneId = c.req.param("laneId");
    const deleted = await workspaceRepo.deleteLane(orgId, laneId);
    if (!deleted) {
      return c.json({ error: "Supply lane not found" }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  // --- Contracts & ContractLines (Never delete expired contracts; archive instead) ---
  routes.get("/contracts", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const [contracts, contractLines] = await Promise.all([
      workspaceRepo.listContracts(orgId),
      workspaceRepo.listContractLines(orgId),
    ]);
    return c.json({ contracts, contractLines }, 200);
  });

  const CreateContractLineBodySchema = CreateContractLineInputBaseSchema.omit({
    contractId: true,
  }).refine(
    (data) => {
      if (
        data.committedVolume !== null &&
        data.committedVolume !== undefined &&
        data.unitPrice !== null &&
        data.unitPrice !== undefined &&
        data.committedSpend !== null &&
        data.committedSpend !== undefined
      ) {
        return (
          Math.abs(data.committedSpend - data.committedVolume * data.unitPrice) <=
          0.01
        );
      }
      return true;
    },
    {
      message:
        "AMOUNT_CONFLICT: committedSpend disagrees with committedVolume * unitPrice by more than 0.01",
      path: ["committedSpend"],
    },
  );

  const CreateContractWithLinesSchema = CreateContractInputSchema.extend({
    lines: z.array(CreateContractLineBodySchema).max(50).optional(),
    preserveLegacyBaseForLaneId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  }).refine(
    (data) => {
      if (data.endDate && data.startDate && data.endDate < data.startDate) {
        return false;
      }
      return true;
    },
    {
      message: "endDate must be on or after startDate",
      path: ["endDate"],
    },
  );

  routes.post("/contracts", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateContractWithLinesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const { lines, preserveLegacyBaseForLaneId, idempotencyKey, ...contractInput } =
        parsed.data;

      const result = await workspaceRepo.createContractWithLinesAtomic(orgId, {
        contract: contractInput as Parameters<
          typeof workspaceRepo.createContract
        >[1],
        lines: (lines ?? []) as Array<
          Omit<Parameters<typeof workspaceRepo.createContractLine>[1], "contractId">
        >,
        preserveLegacyBaseForLaneId,
        idempotencyKey,
      });

      return c.json(
        {
          contract: result.contract,
          lines: result.lines,
          ...(result.preservedBase ? { preservedBase: result.preservedBase } : {}),
        },
        result.deduplicated ? 200 : 201,
      );
    } catch (err) {
      if (err instanceof WorkspaceConflictError) {
        return c.json({ error: err.message }, 409);
      }
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.patch("/contracts/:contractId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const contractId = c.req.param("contractId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateContractInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const contract = await workspaceRepo.updateContract(
      orgId,
      contractId,
      parsed.data,
    );
    if (!contract) {
      return c.json({ error: "Contract not found" }, 404);
    }
    return c.json({ contract }, 200);
  });

  routes.post("/contracts/:contractId/lines", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const contractId = c.req.param("contractId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = CreateContractLineBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const line = await workspaceRepo.createContractLine(orgId, {
        ...(parsed.data as Omit<
          Parameters<typeof workspaceRepo.createContractLine>[1],
          "contractId"
        >),
        contractId,
      });
      return c.json({ line }, 201);
    } catch (err) {
      if (err instanceof WorkspaceValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.patch("/contract-lines/:contractLineId", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const contractLineId = c.req.param("contractLineId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = UpdateContractLineInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const line = await workspaceRepo.updateContractLine(
      orgId,
      contractLineId,
      parsed.data,
    );
    if (!line) {
      return c.json({ error: "Contract line not found" }, 404);
    }
    return c.json({ line }, 200);
  });

  // --- ERP 12-Month PO History CSV Auto-Clustering ---
  const PoRowSchema = z.object({
    supplierName: z.string().trim().min(1),
    materialName: z.string().trim().min(1),
    orderDate: z.string().date(),
    quantity: z.number().finite().positive(),
    unit: z.string().trim().min(1).max(32),
    unitPrice: z.number().finite().nonnegative(),
    currency: z.string().trim().length(3).default("EUR"),
  });

  routes.post("/contracts/import-po-csv", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = z
      .object({
        rows: z.array(PoRowSchema).max(5000).optional(),
        csv: z.string().min(1).max(2_000_000).optional(),
        priceOutlierTolerancePct: z.number().min(1).max(100).default(15),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    const poRows: ErpPoHistoryRow[] = [
      ...((parsed.data.rows ?? []) as ErpPoHistoryRow[]),
    ];
    if (parsed.data.csv) {
      const lines = parsed.data.csv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length >= 2) {
        const headers = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]!.split(",").map((v) => v.trim());
          const get = (key: string) => {
            const idx = headers.indexOf(key);
            return idx >= 0 ? (cols[idx] ?? "") : "";
          };
          const rowCandidate = PoRowSchema.safeParse({
            supplierName: get("suppliername") || get("supplier"),
            materialName: get("materialname") || get("material"),
            orderDate: get("orderdate") || get("date"),
            quantity: Number(get("quantity") || get("qty")),
            unit: get("unit") || "UNITS",
            unitPrice: Number(get("unitprice") || get("price")),
            currency: (get("currency") || "EUR").toUpperCase(),
          });
          if (rowCandidate.success) {
            poRows.push(rowCandidate.data as ErpPoHistoryRow);
          }
        }
      }
    }

    const drafts = clusterErpPoHistoryToDraftContracts(
      poRows,
      parsed.data.priceOutlierTolerancePct,
    );
    return c.json({ drafts, processedRowCount: poRows.length }, 200);
  });

  return routes;
}
