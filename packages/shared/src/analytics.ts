import { z } from "zod";
import {
  RiskSignalSchema,
  RiskStatusSchema,
  TransportModeSchema,
} from "./network.js";

export const ConfidenceLevelSchema = z.enum([
  "NETWORK_VERIFIED",
  "ESTIMATED",
  "UNKNOWN",
]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const HhiMetricSchema = z
  .object({
    dimension: z.enum(["SUPPLIER", "COUNTRY", "PORT", "MATERIAL"]),
    label: z.string(),
    rawHhi: z.number().min(0).max(10000),
    normalizedScore: z.number().min(0).max(100),
    concentrationLevel: z.enum(["LOW", "MODERATE", "HIGH", "SINGLE_SOURCE"]),
    isSinglePointOfFailure: z.boolean(),
  })
  .strict();
export type HhiMetric = z.infer<typeof HhiMetricSchema>;

/**
 * Strictly anonymized risk alert DTO.
 * `.strict()` guarantees that NO hidden Tier-2+ vertex IDs, company names,
 * emails, or exact facility coordinates can ever pass serialization.
 */
export const AnonymizedRiskAlertSchema = z
  .object({
    alertId: z.string(),
    severity: RiskStatusSchema,
    category: z.enum([
      "GEOPOLITICAL",
      "SECONDARY_SANCTION",
      "SHARED_UPSTREAM_CHOKEPOINT",
      "SINGLE_SOURCE",
      "CONTRACT_EXPIRY",
    ]),
    title: z.string(),
    summary: z.string(),
    affectedTier1FacilityIds: z.array(z.string().uuid()),
    affectedRegionCode: z.string().nullable(),
    confidence: ConfidenceLevelSchema,
    recommendedAction: z.string(),
  })
  .strict();
export type AnonymizedRiskAlert = z.infer<typeof AnonymizedRiskAlertSchema>;

export const EsgSummarySchema = z
  .object({
    scope1Tco2e: z.number().nonnegative(),
    scope2Tco2e: z.number().nonnegative(),
    upstreamScope3Tco2e: z.number().nonnegative(),
    transportScope3Tco2e: z.number().nonnegative(),
    totalTco2e: z.number().nonnegative(),
    confidence: ConfidenceLevelSchema,
    verifiedCoveragePct: z.number().min(0).max(100),
  })
  .strict();
export type EsgSummary = z.infer<typeof EsgSummarySchema>;

export const AlternativeCandidateSchema = z
  .object({
    orgId: z.string().uuid(),
    name: z.string(),
    countryCode: z.string().length(2),
    capabilities: z.array(z.string()),
    esgBadges: z.array(z.string()),
    riskStatus: RiskStatusSchema,
    source: z.enum(["KULGO_DIRECTORY", "SEEDED_DIRECTORY"]),
  })
  .strict();
export type AlternativeCandidate = z.infer<typeof AlternativeCandidateSchema>;

export const DirectoryAlternativesResponseSchema = z
  .object({
    candidates: z.array(AlternativeCandidateSchema),
  })
  .strict();
export type DirectoryAlternativesResponse = z.infer<
  typeof DirectoryAlternativesResponseSchema
>;

export const AnalyticsSummarySchema = z
  .object({
    resilienceScore: z.number().min(0).max(100),
    overallStatus: RiskStatusSchema,
    verifiedCoveragePct: z.number().min(0).max(100),
    confidence: ConfidenceLevelSchema,
    hhiMetrics: z.array(HhiMetricSchema),
    alerts: z.array(AnonymizedRiskAlertSchema),
    esg: EsgSummarySchema,
    riskSignals: z.array(RiskSignalSchema).default([]),
    computedAt: z.string().datetime(),
  })
  .strict();
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

export const SimulatedLaneChangeSchema = z
  .object({
    laneId: z.string().uuid(),
    volumeSharePct: z.number().finite().min(0).max(100).optional(),
    transportMode: TransportModeSchema.optional(),
    annualVolume: z.number().finite().nonnegative().nullable().optional(),
    riskStatus: RiskStatusSchema.optional(),
  })
  .strict();
export type SimulatedLaneChange = z.infer<typeof SimulatedLaneChangeSchema>;

export const SimulateAnalyticsRequestSchema = z
  .object({
    productId: z.string().uuid().optional(),
    inputId: z.string().uuid().optional(),
    laneChanges: z.array(SimulatedLaneChangeSchema).min(1).max(100),
  })
  .strict();
export type SimulateAnalyticsRequest = z.infer<
  typeof SimulateAnalyticsRequestSchema
>;

export const AnalyticsDeltaSchema = z
  .object({
    resilienceScoreDelta: z.number(),
    maxHhiDelta: z.number(),
    avgHhiDelta: z.number(),
    alertCountDelta: z.number().int(),
    redAlertCountDelta: z.number().int(),
    spofCountDelta: z.number().int(),
    transportScope3Tco2eDelta: z.number(),
    totalTco2eDelta: z.number(),
  })
  .strict();
export type AnalyticsDelta = z.infer<typeof AnalyticsDeltaSchema>;

export const SimulateAnalyticsResponseSchema = z
  .object({
    baseline: AnalyticsSummarySchema,
    simulated: AnalyticsSummarySchema,
    deltas: AnalyticsDeltaSchema,
    appliedChangesCount: z.number().int().nonnegative(),
  })
  .strict();
export type SimulateAnalyticsResponse = z.infer<
  typeof SimulateAnalyticsResponseSchema
>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("kulgo-api"),
  version: z.string(),
  database: z.object({
    engine: z.literal("arcadedb"),
    connected: z.boolean(),
    latencyMs: z.number().nonnegative().nullable(),
  }),
  timestamp: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// --- M4 CSRD / Executive Risk & ESG Report DTO ---

export const ExecutiveReportOrganizationSchema = z
  .object({
    orgId: z.string().uuid(),
    name: z.string().min(1).max(160),
    countryCode: z.string().length(2),
    sector: z.string().min(1).max(100),
    esgBadges: z.array(z.string()),
    scope1Tco2e: z.number().nonnegative().nullable(),
    scope2Tco2e: z.number().nonnegative().nullable(),
    openToNewBuyers: z.boolean(),
    capabilities: z.array(z.string()),
  })
  .strict();
export type ExecutiveReportOrganization = z.infer<
  typeof ExecutiveReportOrganizationSchema
>;

export const VerifiedPartnerCoverageSchema = z
  .object({
    totalTier1Suppliers: z.number().int().nonnegative(),
    verifiedTier1Suppliers: z.number().int().nonnegative(),
    unverifiedTier1Suppliers: z.number().int().nonnegative(),
    verifiedCoveragePct: z.number().min(0).max(100),
    siteVerifiedFacilities: z.number().int().nonnegative(),
    hqEstimatedFacilities: z.number().int().nonnegative(),
  })
  .strict();
export type VerifiedPartnerCoverage = z.infer<
  typeof VerifiedPartnerCoverageSchema
>;

export const RecommendedActionSchema = z
  .object({
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    category: z.string().min(1),
    title: z.string().min(1),
    action: z.string().min(1),
    affectedTier1FacilityIds: z.array(z.string().uuid()),
    confidence: ConfidenceLevelSchema,
  })
  .strict();
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

export const CsrdDisclosuresSchema = z
  .object({
    scope1Status: z.enum(["REPORTED", "MISSING"]),
    scope2Status: z.enum(["REPORTED", "MISSING"]),
    scope3Methodology: z.enum([
      "PRIMARY_VERIFIED",
      "HYBRID_VERIFIED_AND_ESTIMATED",
      "SPEND_AND_FACTOR_ESTIMATED",
    ]),
    totalReportedTco2e: z.number().nonnegative(),
    privacyAttestation: z.string().min(1),
  })
  .strict();
export type CsrdDisclosures = z.infer<typeof CsrdDisclosuresSchema>;

/**
 * Strictly anonymized CSRD / Executive Risk & ESG Report DTO.
 * Every nested schema uses `.strict()` so no Tier-2+ identities, emails,
 * or exact coordinates can ever be serialized.
 */
export const ExecutiveReportSchema = z
  .object({
    reportVersion: z.literal("1.0"),
    generatedAt: z.string().datetime(),
    organization: ExecutiveReportOrganizationSchema,
    analytics: AnalyticsSummarySchema,
    verifiedPartnerCoverage: VerifiedPartnerCoverageSchema,
    topRecommendedActions: z.array(RecommendedActionSchema),
    csrdDisclosures: CsrdDisclosuresSchema,
  })
  .strict();
export type ExecutiveReport = z.infer<typeof ExecutiveReportSchema>;

