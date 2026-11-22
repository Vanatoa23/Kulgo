import type { AnalyticsSummary, Organization } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { buildEsgExecutiveSummaryPdfBytes } from "../lib/esgPdfExport.js";

describe("buildEsgExecutiveSummaryPdfBytes", () => {
  it("generates a valid PDF 1.4 binary containing organization, PCAF score, hotspots, and compliance checklist", () => {
    const org: Organization = {
      orgId: "11111111-1111-4111-8111-111111111111",
      name: "Tallinn Precision Drives OU",
      slug: "tallinn-precision-drives",
      countryCode: "EE",
      sector: "Manufacturing",
      esgBadges: ["ISO 14001"],
      scope1Tco2e: 80,
      scope2Tco2e: 312,
      scope2MarketTco2e: 362.6,
      annualRevenueEur: 8_000_000,
      targetMarkets: ["EU", "UK"],
      enabledCompliancePacks: [],
      openToNewBuyers: false,
      capabilities: [],
      createdAt: "2026-11-22T00:00:00.000Z",
    };

    const analytics: AnalyticsSummary = {
      resilienceScore: 82,
      overallStatus: "GREEN",
      verifiedCoveragePct: 50,
      confidence: "ESTIMATED",
      hhiMetrics: [],
      alerts: [],
      riskSignals: [],
      computedAt: "2026-11-22T00:00:00.000Z",
      esg: {
        scope1Tco2e: 80,
        scope2Tco2e: 312,
        scope2LocationTco2e: 312,
        scope2MarketTco2e: 362.6,
        upstreamScope3Tco2e: 1594,
        transportScope3Tco2e: 118.08,
        totalTco2e: 2104.08,
        confidence: "ESTIMATED",
        verifiedCoveragePct: 50,
        factorMatrixVersion: "2026.1",
        weightedPcafScore: 2.06,
        primaryDataSharePct: 65.7,
        carbonIntensityPerEurMillion: 263.01,
        hotspots: [
          {
            entityId: "55555555-5555-4555-8555-555555555501",
            entityType: "TIER1_SUPPLIER_LANE",
            entityName: "Baoshan Metals Co.",
            materialCategory: "Electrical Steel",
            countryCode: "CN",
            tco2e: 546,
            shareOfScope3Pct: 31.9,
            pcafScore: 3,
            attributionMethod: "PHYSICAL_FACTOR",
            cbamCategory: "IRON_STEEL",
          },
        ],
        activeCompliancePacks: ["GLOBAL_GHG_ISSB", "EU", "UK"],
        complianceChecklist: [
          {
            ruleId: "ISSB_S2_SCOPE12_REPORTED",
            packId: "GLOBAL_GHG_ISSB",
            framework: "GHG Protocol / ISSB IFRS S2",
            legalStatus: "IN_FORCE",
            title: "Scope 1 & Scope 2 Inventory Reported",
            status: "PASSED",
            summary: "Scope 1 and Scope 2 are populated.",
            remediationPrompt: null,
            affectedEntityIds: [],
          },
        ],
      },
    };

    const bytes = buildEsgExecutiveSummaryPdfBytes(org, analytics, "2026-11-22T00:00:00.000Z");
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("%%EOF");
    expect(text).toContain("Tallinn Precision Drives OU");
    expect(text).toContain("Weighted PCAF-Aligned Score: 2.06");
    expect(text).toContain("Baoshan Metals Co.");
    expect(text).toContain("ISSB");
  });
});
