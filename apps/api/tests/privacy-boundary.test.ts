import {
  AnalyticsSummarySchema,
  AnonymizedRiskAlertSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";

/**
 * Mandatory Privacy Boundary Test Suite (M0 foundation; expanded with live
 * two-org ArcadeDB traversal leak tests in M2).
 *
 * Guarantees that the Analytics DTO contract structurally rejects any leaked
 * hidden Tier-2+ supplier identities, names, emails, or exact coordinates.
 */
describe("Privacy Boundary Contract (Tier-2+ Anonymization)", () => {
  it("accepts a clean anonymized alert referencing only Org A's Tier-1 facility", () => {
    const validAlert = {
      alertId: "alert-sanction-01",
      severity: "RED",
      category: "SECONDARY_SANCTION",
      title: "Hidden upstream sanctions exposure",
      summary:
        "A verified Tier-1 partner has an upstream dependency linked to a sanctioned jurisdiction. Consider switching suppliers.",
      affectedTier1FacilityIds: ["11111111-1111-4111-8111-111111111111"],
      affectedRegionCode: "EASTERN_EUROPE",
      confidence: "NETWORK_VERIFIED",
      recommendedAction: "Review verified alternative suppliers in Kulgo Directory.",
    };

    expect(() => AnonymizedRiskAlertSchema.parse(validAlert)).not.toThrow();
  });

  it("rejects any alert payload attempting to leak hidden Tier-2+ identity or coordinates", () => {
    const leakyAlert = {
      alertId: "alert-leak-01",
      severity: "RED",
      category: "SECONDARY_SANCTION",
      title: "Upstream risk",
      summary: "Upstream exposure detected",
      affectedTier1FacilityIds: ["11111111-1111-4111-8111-111111111111"],
      affectedRegionCode: "EASTERN_EUROPE",
      confidence: "NETWORK_VERIFIED",
      recommendedAction: "Switch supplier",
      // Forbidden leaked fields:
      tier2SupplierName: "Secret Upstream LLC",
      tier2FacilityLat: 55.7558,
      tier2FacilityLng: 37.6173,
    };

    expect(() => AnonymizedRiskAlertSchema.parse(leakyAlert)).toThrow();
  });

  it("rejects any AnalyticsSummary containing raw hidden upstream graph nodes", () => {
    const leakySummary = {
      resilienceScore: 62,
      overallStatus: "RED",
      verifiedCoveragePct: 50,
      confidence: "ESTIMATED",
      hhiMetrics: [],
      alerts: [],
      esg: {
        scope1Tco2e: 100,
        scope2Tco2e: 50,
        upstreamScope3Tco2e: 400,
        transportScope3Tco2e: 30,
        totalTco2e: 580,
        confidence: "ESTIMATED",
        verifiedCoveragePct: 50,
      },
      computedAt: new Date().toISOString(),
      // Forbidden leaked raw graph:
      hiddenUpstreamNodes: [{ name: "Secret Tier-2 Factory" }],
    };

    expect(() => AnalyticsSummarySchema.parse(leakySummary)).toThrow();
  });
});
