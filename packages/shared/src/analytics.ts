import { z } from "zod";
import {
  CbamSummarySchema,
  ComplianceCheckItemSchema,
  CompliancePackIdSchema,
  EsgHotspotSchema,
  PcafBucketSummarySchema,
  TargetMarketSchema,
} from "./esg.js";
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

export const HhiWeightingBasisSchema = z.enum([
  "VOLUME",
  "VOLUME_BASE_UNIT",
  "SPEND_EUR",
  "MASS_KG",
  "VOLUME_SHARE_PCT",
]);
export type HhiWeightingBasis = z.infer<typeof HhiWeightingBasisSchema>;

export const HhiCoverageReasonSchema = z.enum([
  "NO_ACTIVE_LANES",
  "NO_USABLE_WEIGHTS",
  "UNIT_CONFLICT",
]);
export type HhiCoverageReason = z.infer<typeof HhiCoverageReasonSchema>;

export const HhiMetricSchema = z
  .object({
    dimension: z.enum(["SUPPLIER", "COUNTRY", "PORT", "MATERIAL"]),
    label: z.string(),
    rawHhi: z.number().min(0).max(10000),
    normalizedScore: z.number().min(0).max(100),
    concentrationLevel: z.enum(["LOW", "MODERATE", "HIGH", "SINGLE_SOURCE"]),
    isSinglePointOfFailure: z.boolean(),
    coveredLanesCount: z.number().int().nonnegative().optional(),
    totalActiveLanesCount: z.number().int().nonnegative().optional(),
    coveragePct: z.number().min(0).max(100).optional(),
    weightingBasis: HhiWeightingBasisSchema.optional(),
    unknownWeightPct: z.number().min(0).max(100).optional(),
    isEstimatedUpperBoundForGhost: z.boolean().optional(),
    coverageReason: HhiCoverageReasonSchema.nullable().optional(),
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
    // Sub-Project 3: PCAF-scored & Multi-Region ESG extensions
    factorMatrixVersion: z.string().min(1).optional(),
    scope2LocationTco2e: z.number().finite().nonnegative().optional(),
    scope2MarketTco2e: z.number().finite().nonnegative().nullable().optional(),
    weightedPcafScore: z.number().finite().min(1).max(5).nullable().optional(),
    pcafBreakdown: z.array(PcafBucketSummarySchema).optional(),
    primaryDataSharePct: z.number().finite().min(0).max(100).optional(),
    carbonIntensityPerEurMillion: z.number().finite().nonnegative().nullable().optional(),
    carbonIntensityPerTonne: z.number().finite().nonnegative().nullable().optional(),
    hotspots: z.array(EsgHotspotSchema).optional(),
    cbamSummary: CbamSummarySchema.optional(),
    activeCompliancePacks: z.array(CompliancePackIdSchema).optional(),
    complianceChecklist: z.array(ComplianceCheckItemSchema).optional(),
    improvementPrompts: z.array(z.string()).optional(),
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

// --- Sub-Project 2: Strict Financial Risk & Contract Derivation DTOs ---

export const FinancialConfidenceBadgeSchema = z.enum([
  "CONTRACTED",
  "IMPORTED",
  "HYBRID",
  "ESTIMATED",
]);
export type FinancialConfidenceBadge = z.infer<
  typeof FinancialConfidenceBadgeSchema
>;

export const FinancialViewModeSchema = z.enum(["RUN_RATE", "PERIOD_WINDOW"]);
export type FinancialViewMode = z.infer<typeof FinancialViewModeSchema>;

export const LaneCommercialStateSchema = z.enum([
  "ACTIVE",
  "HOLDOVER",
  "LAPSED_UNCONTRACTED",
  "LEVEL_0_UNPRICED",
]);
export type LaneCommercialState = z.infer<typeof LaneCommercialStateSchema>;

export const DerivedLaneCommercialSummarySchema = z
  .object({
    laneId: z.string().uuid(),
    viewMode: FinancialViewModeSchema,
    asOfDate: z.string().date(),
    windowStart: z.string().date(),
    windowEndExclusive: z.string().date(),
    laneCommercialState: LaneCommercialStateSchema,
    activeVolume: z.number().finite().nonnegative().nullable(),
    baseUnit: z.string().min(1).max(32).nullable(),
    activeSpendEur: z.number().finite().nonnegative().nullable(),
    weightedAvgUnitPrice: z.number().finite().nonnegative().nullable(),
    spendOnlyExcludedEur: z.number().finite().nonnegative(),
    cBothSpendCoveragePct: z.number().finite().min(0).max(100).nullable(),
    knownMappedSharePct: z.number().finite().min(0).max(100).nullable(),
    totalDemandSharePct: z.number().finite().min(0).max(100).nullable(),
    weightingBasis: HhiWeightingBasisSchema.nullable(),
    nextExpirationDate: z.string().date().nullable(),
    nextNoticeDeadline: z.string().date().nullable(),
    atRiskVolumePct: z.number().finite().min(0).max(100),
    assumedHoldoverVolume: z.number().finite().nonnegative(),
    hasUnitConflict: z.boolean(),
    missingFxCurrencies: z.array(z.string().length(3)),
    activeContractCount: z.number().int().nonnegative(),
    confidenceBadge: FinancialConfidenceBadgeSchema,
  })
  .strict();
export type DerivedLaneCommercialSummary = z.infer<
  typeof DerivedLaneCommercialSummarySchema
>;

export const DefectBufferRecommendationSchema = z
  .object({
    laneId: z.string().uuid().nullable(),
    inputId: z.string().uuid().nullable(),
    defectRatePct: z.number().finite().min(0).max(95),
    isBaselineEstimate: z.boolean(),
    orderFrequencyPerYear: z.number().int().positive(),
    expectedFaultyUnitsPerOrder: z.number().finite().nonnegative(),
    expectedFaultyUnitsAnnual: z.number().finite().nonnegative(),
    recommendedOrderBufferPct: z.number().finite().nonnegative(),
    recommendedBufferUnitsPerOrder: z.number().finite().nonnegative(),
    recommendedBufferUnitsAnnual: z.number().finite().nonnegative(),
    defectOverheadCostEur: z.number().finite().nonnegative().nullable(),
  })
  .strict();
export type DefectBufferRecommendation = z.infer<
  typeof DefectBufferRecommendationSchema
>;

export const MaterialFinancialRiskSchema = z
  .object({
    inputId: z.string().uuid(),
    inputName: z.string().min(1),
    baseUnit: z.string().min(1).max(32),
    totalAnnualDemand: z.number().finite().nonnegative().nullable(),
    mappedActiveVolume: z.number().finite().nonnegative().nullable(),
    uncontractedDemand: z.number().finite().nonnegative().nullable(),
    uncontractedDemandPct: z.number().finite().min(0).max(100).nullable(),
    isRenewalCliff: z.boolean(),
    atRiskVolumePct: z.number().finite().min(0).max(100),
    hasUnitConflict: z.boolean(),
    unprotectedGapDaysBase: z.number().finite().nonnegative(),
    effectiveTtrDaysBase: z.number().finite().nonnegative(),
    ttsDays: z.number().finite().nonnegative().nullable(),
    lowEur: z.number().finite().nonnegative().nullable(),
    baseEur: z.number().finite().nonnegative().nullable(),
    highEur: z.number().finite().nonnegative().nullable(),
    varP90Eur: z.number().finite().nonnegative().nullable(),
    varP95Eur: z.number().finite().nonnegative().nullable(),
    conditionalTailLossP90Eur: z.number().finite().nonnegative().nullable(),
    expeditingCostBaseEur: z.number().finite().nonnegative().nullable(),
    carryingCostAnnualEur: z.number().finite().nonnegative().nullable(),
    recommendedSafetyStockDays: z.number().finite().nonnegative().nullable(),
    defectBuffer: DefectBufferRecommendationSchema.nullable(),
    confidenceBadge: FinancialConfidenceBadgeSchema,
    networkVerified: z.boolean(),
    isEstimatedProxy: z.boolean(),
    missingReasons: z.array(z.string()),
  })
  .strict();
export type MaterialFinancialRisk = z.infer<typeof MaterialFinancialRiskSchema>;

export const ProductFinancialRiskSchema = z
  .object({
    productId: z.string().uuid(),
    productName: z.string().min(1),
    annualRevenueEur: z.number().finite().nonnegative().nullable(),
    grossMarginPct: z.number().finite().min(0).max(100).nullable(),
    lowEur: z.number().finite().nonnegative().nullable(),
    baseEur: z.number().finite().nonnegative().nullable(),
    highEur: z.number().finite().nonnegative().nullable(),
    varP90Eur: z.number().finite().nonnegative().nullable(),
    varP95Eur: z.number().finite().nonnegative().nullable(),
    conditionalTailLossP90Eur: z.number().finite().nonnegative().nullable(),
    confidenceBadge: FinancialConfidenceBadgeSchema,
    networkVerified: z.boolean(),
    isEstimatedProxy: z.boolean(),
    missingReasons: z.array(z.string()),
  })
  .strict();
export type ProductFinancialRisk = z.infer<typeof ProductFinancialRiskSchema>;

/**
 * Strictly anonymized financial risk & provisions DTO.
 * `.strict()` guarantees zero Tier-2+ partner identities, unit costs,
 * revenues, margins, opaque event group IDs, or raw hidden multipliers leak.
 */
export const FinancialRiskSummarySchema = z
  .object({
    benchmarkVersion: z.string().min(1),
    viewMode: FinancialViewModeSchema,
    asOfDate: z.string().date(),
    windowStart: z.string().date(),
    windowEndExclusive: z.string().date(),
    lowEur: z.number().finite().nonnegative().nullable(),
    baseEur: z.number().finite().nonnegative().nullable(),
    highEur: z.number().finite().nonnegative().nullable(),
    annualizedBaseEalEur: z.number().finite().nonnegative().nullable(),
    varP90Eur: z.number().finite().nonnegative().nullable(),
    varP95Eur: z.number().finite().nonnegative().nullable(),
    conditionalTailLossP90Eur: z.number().finite().nonnegative().nullable(),
    totalActiveSpendEur: z.number().finite().nonnegative(),
    uncontractedMaterialCount: z.number().int().nonnegative(),
    renewalCliffCount: z.number().int().nonnegative(),
    lapsedLaneCount: z.number().int().nonnegative(),
    holdoverLaneCount: z.number().int().nonnegative(),
    confidenceBadge: FinancialConfidenceBadgeSchema,
    networkVerified: z.boolean(),
    isEstimatedProxy: z.boolean(),
    missingInputsPrompt: z.string().nullable(),
    missingReasons: z.array(z.string()),
    laneCommercials: z.array(DerivedLaneCommercialSummarySchema),
    materials: z.array(MaterialFinancialRiskSchema),
    products: z.array(ProductFinancialRiskSchema),
  })
  .strict();
export type FinancialRiskSummary = z.infer<typeof FinancialRiskSummarySchema>;

export const FinancialSimulationDeltaSchema = z
  .object({
    baseEalDeltaEur: z.number().finite().nullable(),
    lowEalDeltaEur: z.number().finite().nullable(),
    highEalDeltaEur: z.number().finite().nullable(),
    varP90DeltaEur: z.number().finite().nullable(),
    carryingCostDeltaEur: z.number().finite().nullable(),
    incrementalWorkingCapitalEur: z.number().finite().nullable(),
    otherRecurringCostDeltaEur: z.number().finite().nullable(),
    netAnnualBenefitEur: z.number().finite().nullable(),
    workingCapitalRoiPct: z.number().finite().nullable(),
    paybackYears: z.number().finite().nullable(),
    paybackReason: z.string().nullable(),
  })
  .strict();
export type FinancialSimulationDelta = z.infer<
  typeof FinancialSimulationDeltaSchema
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
    financialRisk: FinancialRiskSummarySchema.optional(),
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
    annualSpendEur: z.number().finite().nonnegative().nullable().optional(),
    safetyStockDays: z.number().finite().nonnegative().nullable().optional(),
    carryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
    defectRatePct: z.number().finite().min(0).max(95).nullable().optional(),
    riskStatus: RiskStatusSchema.optional(),
  })
  .strict();
export type SimulatedLaneChange = z.infer<typeof SimulatedLaneChangeSchema>;

export const SimulateAnalyticsRequestSchema = z
  .object({
    productId: z.string().uuid().optional(),
    inputId: z.string().uuid().optional(),
    viewMode: FinancialViewModeSchema.optional(),
    laneChanges: z.array(SimulatedLaneChangeSchema).min(1).max(100),
    oneTimeQualificationEur: z.number().finite().nonnegative().optional(),
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
    financialDeltas: FinancialSimulationDeltaSchema.optional(),
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
    scope2MarketTco2e: z.number().nonnegative().nullable().optional(),
    targetMarkets: z.array(TargetMarketSchema).optional(),
    enabledCompliancePacks: z.array(CompliancePackIdSchema).optional(),
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
    weightedPcafScore: z.number().finite().min(1).max(5).nullable().optional(),
    primaryDataSharePct: z.number().finite().min(0).max(100).optional(),
    activeCompliancePacks: z.array(CompliancePackIdSchema).optional(),
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
    financialExposure: FinancialRiskSummarySchema.optional(),
    complianceChecklist: z.array(ComplianceCheckItemSchema).optional(),
  })
  .strict();
export type ExecutiveReport = z.infer<typeof ExecutiveReportSchema>;

