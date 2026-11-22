import { formatEsgLedgerCsv } from "@kulgo/engine";
import {
  AnalyticsSummarySchema,
  EsgLedgerResponseSchema,
  ExecutiveReportSchema,
  FinancialViewModeSchema,
  SimulateAnalyticsRequestSchema,
  SimulateAnalyticsResponseSchema,
} from "@kulgo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createRequireAuth, type AuthVariables } from "../auth/middleware.js";
import type { AuthRepository } from "../auth/repository.js";
import {
  AnalyticsValidationError,
  type AnalyticsRepository,
} from "./repository.js";

export interface AnalyticsRoutesDependencies {
  authRepo: AuthRepository;
  analyticsRepo: AnalyticsRepository;
}

const AnalyticsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  inputId: z.string().uuid().optional(),
  viewMode: FinancialViewModeSchema.optional(),
});

const EsgLedgerQuerySchema = AnalyticsQuerySchema.extend({
  format: z.enum(["json", "csv"]).default("json"),
});

export function createAnalyticsRoutes({
  authRepo,
  analyticsRepo,
}: AnalyticsRoutesDependencies): Hono<{ Variables: AuthVariables }> {
  const routes = new Hono<{ Variables: AuthVariables }>();
  const requireAuth = createRequireAuth(authRepo);

  routes.use("*", requireAuth);

  routes.get("/summary", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    const rawProductId = c.req.query("productId");
    const rawInputId = c.req.query("inputId");
    const rawViewMode = c.req.query("viewMode");

    const parsedQuery = AnalyticsQuerySchema.safeParse({
      productId: rawProductId || undefined,
      inputId: rawInputId || undefined,
      viewMode: rawViewMode || undefined,
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

    const summary = await analyticsRepo.getSummary(
      orgId,
      { productId: parsedQuery.data.productId, inputId: parsedQuery.data.inputId },
      undefined,
      parsedQuery.data.viewMode,
    );
    return c.json(AnalyticsSummarySchema.parse(summary), 200);
  });

  routes.get("/esg-ledger", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const parsedQuery = EsgLedgerQuerySchema.safeParse({
      productId: c.req.query("productId") || undefined,
      inputId: c.req.query("inputId") || undefined,
      viewMode: c.req.query("viewMode") || undefined,
      format: c.req.query("format") || undefined,
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

    try {
      const ledger = await analyticsRepo.getEsgLedger(
        orgId,
        { productId: parsedQuery.data.productId, inputId: parsedQuery.data.inputId },
        undefined,
        parsedQuery.data.viewMode,
      );
      const validated = EsgLedgerResponseSchema.parse(ledger);

      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "ESG_LEDGER_EXPORTED",
        summary: `Exported auditor-ready ESG ledger (${parsedQuery.data.format.toUpperCase()}, ${validated.entries.length} entries, ${validated.totalTco2e} tCO2e, PCAF ${validated.weightedPcafScore ?? "N/A"})`,
        metadata: {
          format: parsedQuery.data.format,
          entryCount: validated.entries.length,
          totalTco2e: validated.totalTco2e,
          weightedPcafScore: validated.weightedPcafScore,
          factorMatrixVersion: validated.factorMatrixVersion,
        },
      });

      if (parsedQuery.data.format === "csv") {
        const csv = formatEsgLedgerCsv(validated.entries);
        return new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="kulgo-esg-ledger-${validated.factorMatrixVersion}.csv"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      return c.json(validated, 200);
    } catch (err) {
      if (err instanceof AnalyticsValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.get("/report", async (c) => {
    const auth = c.get("auth");
    const orgId = auth.organization.orgId;
    const rawProductId = c.req.query("productId");
    const rawInputId = c.req.query("inputId");
    const rawViewMode = c.req.query("viewMode");

    const parsedQuery = AnalyticsQuerySchema.safeParse({
      productId: rawProductId || undefined,
      inputId: rawInputId || undefined,
      viewMode: rawViewMode || undefined,
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

    try {
      const report = await analyticsRepo.getExecutiveReport(
        orgId,
        { productId: parsedQuery.data.productId, inputId: parsedQuery.data.inputId },
        undefined,
        parsedQuery.data.viewMode,
      );
      const validated = ExecutiveReportSchema.parse(report);

      await authRepo.recordAuditEvent({
        orgId,
        actorUserId: auth.user.userId,
        actorEmail: auth.user.email,
        action: "CSRD_REPORT_EXPORTED",
        summary: `Exported CSRD & supply chain resilience executive report (resilience ${validated.analytics.resilienceScore}/100, ${validated.analytics.overallStatus})`,
        metadata: {
          productId: parsedQuery.data.productId ?? null,
          inputId: parsedQuery.data.inputId ?? null,
          resilienceScore: validated.analytics.resilienceScore,
          overallStatus: validated.analytics.overallStatus,
          totalTco2e: validated.analytics.esg.totalTco2e,
        },
      });

      return c.json(validated, 200);
    } catch (err) {
      if (err instanceof AnalyticsValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  routes.post("/simulate", async (c) => {
    const orgId = c.get("auth").organization.orgId;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = SimulateAnalyticsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await analyticsRepo.simulate(orgId, parsed.data);
      return c.json(SimulateAnalyticsResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof AnalyticsValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  return routes;
}
