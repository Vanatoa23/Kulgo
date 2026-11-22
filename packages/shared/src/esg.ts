import { z } from "zod";

export const FACTOR_MATRIX_VERSION = "2026.1" as const;

export const TargetMarketSchema = z.enum(["EU", "UK", "US", "APAC", "AFRICA"]);
export type TargetMarket = z.infer<typeof TargetMarketSchema>;

export const CompliancePackIdSchema = z.enum([
  "GLOBAL_GHG_ISSB",
  "EU",
  "UK",
  "US",
  "APAC",
  "AFRICA",
]);
export type CompliancePackId = z.infer<typeof CompliancePackIdSchema>;

export const ComplianceLegalStatusSchema = z.enum([
  "IN_FORCE",
  "FUTURE",
  "LITIGATED",
]);
export type ComplianceLegalStatus = z.infer<typeof ComplianceLegalStatusSchema>;

export const ComplianceCheckStatusSchema = z.enum([
  "PASSED",
  "ACTION_NEEDED",
  "NOT_APPLICABLE",
]);
export type ComplianceCheckStatus = z.infer<typeof ComplianceCheckStatusSchema>;

export const PcafScoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type PcafScore = z.infer<typeof PcafScoreSchema>;

export const Scope3AttributionMethodSchema = z.enum([
  "PCF_VOLUME",
  "ECONOMIC_INTENSITY",
  "ALLOCATION_RATIO",
  "PHYSICAL_FACTOR",
  "SPEND_EEIO",
  "SECTOR_BASELINE",
]);
export type Scope3AttributionMethod = z.infer<
  typeof Scope3AttributionMethodSchema
>;

export const EsgLedgerAttributionMethodSchema = z.enum([
  "PCF_VOLUME",
  "ECONOMIC_INTENSITY",
  "ALLOCATION_RATIO",
  "PHYSICAL_FACTOR",
  "SPEND_EEIO",
  "SECTOR_BASELINE",
  "DIRECT_REPORTED",
  "GRID_LOCATION_BASED",
  "GRID_MARKET_BASED",
  "FREIGHT_WTW",
]);
export type EsgLedgerAttributionMethod = z.infer<
  typeof EsgLedgerAttributionMethodSchema
>;

export const MaterialArchetypeSchema = z.enum([
  "STEEL_PRIMARY_FLAT_BAR",
  "STEEL_RECYCLED_EAF",
  "ALUMINUM_PRIMARY_INGOT_SHEET",
  "ALUMINUM_RECYCLED_SECONDARY",
  "COPPER_BRASS_SEMI",
  "FABRICATED_CNC_METAL_PARTS",
  "PCB_SEMICONDUCTOR_ELECTRONICS",
  "ELECTRICAL_DRIVES_MOTORS_BATTERIES",
  "CHEMICALS_SOLVENTS_INORGANIC",
  "PLASTICS_POLYMERS_RESINS",
  "PACKAGING_CARDBOARD_PAPER",
  "PACKAGING_WOOD_PALLETS",
]);
export type MaterialArchetype = z.infer<typeof MaterialArchetypeSchema>;

export const CbamCoveredCategorySchema = z.enum([
  "IRON_STEEL",
  "ALUMINUM",
  "CEMENT",
  "FERTILIZERS",
  "HYDROGEN",
  "ELECTRICITY",
]);
export type CbamCoveredCategory = z.infer<typeof CbamCoveredCategorySchema>;

export const EudrCommoditySchema = z.enum([
  "WOOD_TIMBER",
  "RUBBER",
  "CATTLE_LEATHER",
  "COCOA",
  "COFFEE",
  "OIL_PALM",
  "SOYA",
]);
export type EudrCommodity = z.infer<typeof EudrCommoditySchema>;

export const TaxonomyMatchConfidenceSchema = z.enum([
  "EXACT_CODE",
  "ARCHETYPE",
  "KEYWORD_INFERRED",
  "SECTOR_FALLBACK",
  "PRIMARY_PARTNER",
]);
export type TaxonomyMatchConfidence = z.infer<
  typeof TaxonomyMatchConfidenceSchema
>;

export const FactorProvenanceStatusSchema = z.enum([
  "OFFICIAL_PUBLISHED",
  "CALIBRATED_BASELINE_V1",
  "PARTNER_PRIMARY",
  "ORG_REPORTED",
]);
export type FactorProvenanceStatus = z.infer<
  typeof FactorProvenanceStatusSchema
>;

export const PcafBucketSummarySchema = z
  .object({
    score: PcafScoreSchema,
    label: z.string().min(1),
    tco2e: z.number().finite().nonnegative(),
    sharePct: z.number().finite().min(0).max(100),
    lineCount: z.number().int().nonnegative(),
  })
  .strict();
export type PcafBucketSummary = z.infer<typeof PcafBucketSummarySchema>;

export const EsgHotspotSchema = z
  .object({
    entityId: z.string().uuid(),
    entityType: z.enum(["TIER1_SUPPLIER_LANE", "TIER1_SUPPLIER_FACILITY"]),
    entityName: z.string().min(1),
    materialCategory: z.string().min(1),
    countryCode: z.string().length(2),
    tco2e: z.number().finite().nonnegative(),
    shareOfScope3Pct: z.number().finite().min(0).max(100),
    pcafScore: PcafScoreSchema,
    attributionMethod: Scope3AttributionMethodSchema,
    cbamCategory: CbamCoveredCategorySchema.nullable(),
  })
  .strict();
export type EsgHotspot = z.infer<typeof EsgHotspotSchema>;

export const CbamFlaggedLaneSchema = z
  .object({
    laneId: z.string().uuid(),
    supplierName: z.string().min(1),
    originCountryCode: z.string().length(2),
    materialCategory: z.string().min(1),
    cnCode: z.string().nullable(),
    cbamCategory: CbamCoveredCategorySchema,
    annualTonnes: z.number().finite().nonnegative().nullable(),
    embeddedTco2e: z.number().finite().nonnegative(),
    usingDefaultFactor: z.boolean(),
    pcafScore: PcafScoreSchema,
  })
  .strict();
export type CbamFlaggedLane = z.infer<typeof CbamFlaggedLaneSchema>;

export const CbamSummarySchema = z
  .object({
    euCbamApplicable: z.boolean(),
    cumulativeMassTonnes: z.number().finite().nonnegative(),
    deMinimisThresholdTonnes: z.number().finite().positive(),
    exceedsDeMinimisThreshold: z.boolean(),
    hasNoThresholdCategory: z.boolean(),
    flaggedLanesCount: z.number().int().nonnegative(),
    defaultFactorLanesCount: z.number().int().nonnegative(),
    totalEmbeddedTco2e: z.number().finite().nonnegative(),
    flaggedLanes: z.array(CbamFlaggedLaneSchema),
  })
  .strict();
export type CbamSummary = z.infer<typeof CbamSummarySchema>;

export const ComplianceCheckItemSchema = z
  .object({
    ruleId: z.string().min(1),
    packId: CompliancePackIdSchema,
    framework: z.string().min(1),
    legalStatus: ComplianceLegalStatusSchema,
    title: z.string().min(1),
    status: ComplianceCheckStatusSchema,
    summary: z.string().min(1),
    remediationPrompt: z.string().nullable(),
    affectedEntityIds: z.array(z.string().uuid()),
  })
  .strict();
export type ComplianceCheckItem = z.infer<typeof ComplianceCheckItemSchema>;

/**
 * Strictly anonymized auditor-ready Scope 1 / 2 / 3 ESG ledger line item.
 * `.strict()` guarantees zero Tier-2+ partner identities, partner revenues,
 * internal margins, or upstream coordinates can ever pass serialization.
 */
export const EsgLedgerEntrySchema = z
  .object({
    entryId: z.string().min(1),
    scope: z.enum([
      "SCOPE_1",
      "SCOPE_2_LOCATION",
      "SCOPE_2_MARKET",
      "SCOPE_3_CAT_1",
      "SCOPE_3_CAT_4",
    ]),
    entityType: z.enum([
      "OWN_ORGANIZATION",
      "OWN_FACILITY",
      "TIER1_SUPPLIER_LANE",
      "TIER1_SUPPLIER_FACILITY",
    ]),
    entityId: z.string().uuid(),
    entityName: z.string().min(1),
    countryCode: z.string().length(2),
    sector: z.string().nullable(),
    materialCategory: z.string().nullable(),
    materialArchetype: MaterialArchetypeSchema.nullable(),
    cnCode: z.string().nullable(),
    cbamCategory: CbamCoveredCategorySchema.nullable(),
    matchConfidence: TaxonomyMatchConfidenceSchema,
    activityValue: z.number().finite().nonnegative().nullable(),
    activityUnit: z.string().min(1),
    attributionMethod: EsgLedgerAttributionMethodSchema,
    factorId: z.string().min(1),
    factorVersion: z.string().min(1),
    factorValue: z.number().finite().nonnegative(),
    factorUnit: z.string().min(1),
    sourceCitation: z.string().min(1),
    licenseId: z.string().min(1),
    provenanceStatus: FactorProvenanceStatusSchema,
    pcafScore: PcafScoreSchema,
    tco2e: z.number().finite().nonnegative(),
    formulaTrace: z.string().min(1),
    networkVerified: z.boolean(),
  })
  .strict();
export type EsgLedgerEntry = z.infer<typeof EsgLedgerEntrySchema>;

export const EsgLedgerResponseSchema = z
  .object({
    ledgerVersion: z.literal("1.0"),
    factorMatrixVersion: z.string().min(1),
    generatedAt: z.string().datetime(),
    organizationId: z.string().uuid(),
    organizationName: z.string().min(1),
    activeCompliancePacks: z.array(CompliancePackIdSchema),
    weightedPcafScore: z.number().finite().min(1).max(5).nullable(),
    totalTco2e: z.number().finite().nonnegative(),
    entries: z.array(EsgLedgerEntrySchema),
  })
  .strict();
export type EsgLedgerResponse = z.infer<typeof EsgLedgerResponseSchema>;
