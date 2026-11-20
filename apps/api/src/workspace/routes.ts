import {
  BulkImportJsonRequestSchema,
  CreateFacilityInputSchema,
  CreateProductInputSchema,
  CreateSupplyInputInputSchema,
  CreateSupplyLaneInputSchema,
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
import {
  buildWorkspaceExportJson,
  executeBulkImport,
  parseBulkImportCsv,
  serializeNetworkToCsv,
} from "./import-export.js";
import {
  WorkspaceValidationError,
  type WorkspaceRepository,
} from "./repository.js";
import { seedEstoniaProductXDemo } from "./seed-demo.js";

export interface WorkspaceRoutesDependencies {
  authRepo: AuthRepository;
  workspaceRepo: WorkspaceRepository;
  riskSignalRepo?: RiskSignalRepository;
}

const NetworkQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  inputId: z.string().uuid().optional(),
});

export function createWorkspaceRoutes({
  authRepo,
  workspaceRepo,
  riskSignalRepo,
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

  // --- Bulk Import (JSON or CSV) ---
  routes.post("/import", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();

    try {
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
        });
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

      if (parsedBody.data.csv) {
        const parsedCsv = parseBulkImportCsv(parsedBody.data.csv);
        const summary = await executeBulkImport(workspaceRepo, orgId, {
          facilities: parsedCsv.facilities,
          lanes: parsedCsv.lanes,
          initialErrors: parsedCsv.errors,
        });
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

      if (facilities.length === 0 && lanes.length === 0) {
        return c.json(
          {
            error:
              "Import payload must contain at least one facility, lane, or csv string",
          },
          400,
        );
      }

      const summary = await executeBulkImport(workspaceRepo, orgId, {
        facilities,
        lanes,
      });
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

  return routes;
}
