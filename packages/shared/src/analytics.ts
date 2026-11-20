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
