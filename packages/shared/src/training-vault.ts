import { z } from "zod";
import {
  AlertAckReasonSchema,
  RiskSignalLifecycleSchema,
} from "./network.js";

export const TRAINING_VAULT_SCHEMA_VERSION = "1.0" as const;

export const TrainingVaultPlaneSchema = z.enum([
  "global_public",
  "anonymized_outcomes",
]);
export type TrainingVaultPlane = z.infer<typeof TrainingVaultPlaneSchema>;

export const TrainingVaultDatasetSchema = z.enum([
  "raw_feeds",
  "llm_extractions",
  "signal_lifecycles",
  "entity_resolution_pairs",
  "anonymized_alert_feedback",
  "anonymized_decision_outcomes",
]);
export type TrainingVaultDataset = z.infer<typeof TrainingVaultDatasetSchema>;

export const LabelProvenanceSchema = z.enum([
  "LLM_SILVER",
  "RULE_VERIFIED",
  "HUMAN_VERIFIED",
]);
export type LabelProvenance = z.infer<typeof LabelProvenanceSchema>;

export const FeedContentPolicySchema = z.enum(["FULL_TEXT", "EXCERPT_ONLY"]);
export type FeedContentPolicy = z.infer<typeof FeedContentPolicySchema>;

export const FeedLicenseTagSchema = z.enum([
  "PUBLIC_DOMAIN",
  "CC0",
  "CC_BY",
  "OPEN_GOV",
  "COPYRIGHTED_EXCERPT",
]);
export type FeedLicenseTag = z.infer<typeof FeedLicenseTagSchema>;

export const UtcDayBucketSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected UTC day bucket YYYY-MM-DD");

/**
 * Fields that MUST NEVER appear in any Training Data Vault record (Plane A or Plane B).
 * Used by privacy boundary tests and runtime sanitization audits.
 */
export const TRAINING_VAULT_FORBIDDEN_FIELDS = [
  "orgId",
  "ownerOrgId",
  "userId",
  "acknowledgedByUserId",
  "email",
  "facilityId",
  "facilityName",
  "supplierId",
  "supplierName",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "streetAddress",
  "unitPrice",
  "revenue",
  "spend",
  "margin",
  "contractValue",
  "partnerOrgId",
  "fulfilledByFacilityId",
  "note",
] as const;

/**
 * Truncates an ISO-8601 timestamp to a coarse UTC day bucket ("YYYY-MM-DD")
 * to prevent timing-correlation attacks on low-volume tenants in Plane B.
 */
export function toUtcDayBucket(isoTimestamp: string): string {
  const parsedMs = Date.parse(isoTimestamp);
  const date = Number.isNaN(parsedMs) ? new Date() : new Date(parsedMs);
  return date.toISOString().slice(0, 10);
}

// =============================================================================
// Plane A — global_public (100% Tenant-Free World & Intelligence Archive)
// =============================================================================

export const RawFeedVaultRecordSchema = z
  .object({
    schemaVersion: z.literal(TRAINING_VAULT_SCHEMA_VERSION),
    plane: z.literal("global_public"),
    sweepId: z.string().min(1),
    sourceId: z.string().min(1),
    stage: z.enum(["STAGE_1", "STAGE_2"]),
    url: z.string().min(1),
    publisherDomain: z.string().min(1),
    fetchedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    language: z.string().min(2).max(16).nullable(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentPolicy: FeedContentPolicySchema,
    licenseTag: FeedLicenseTagSchema,
    title: z.string(),
    summary: z.string().nullable(),
    fullText: z.string().nullable(),
    preFilterPassed: z.boolean(),
    preFilterReason: z.string().nullable(),
    matchedKeywords: z.array(z.string()),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.contentPolicy === "EXCERPT_ONLY" && record.fullText !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fullText"],
        message: "fullText must be null when contentPolicy is EXCERPT_ONLY",
      });
    }
    if (
      record.licenseTag === "COPYRIGHTED_EXCERPT" &&
      record.contentPolicy !== "EXCERPT_ONLY"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentPolicy"],
        message:
          "COPYRIGHTED_EXCERPT records must use contentPolicy EXCERPT_ONLY",
      });
    }
  });
export type RawFeedVaultRecord = z.infer<typeof RawFeedVaultRecordSchema>;

export const LlmExtractionVaultRecordSchema = z
  .object({
    schemaVersion: z.literal(TRAINING_VAULT_SCHEMA_VERSION),
    plane: z.literal("global_public"),
    labelProvenance: z.literal("LLM_SILVER"),
    sweepId: z.string().min(1),
    articleContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    promptTemplateVersion: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    promptText: z.string(),
    rawOutput: z.string(),
    parsedCandidate: z.record(z.unknown()).nullable(),
    evidenceQuotes: z.array(z.string()),
    validationPassed: z.boolean(),
    validationErrors: z.array(z.string()),
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().nonnegative(),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type LlmExtractionVaultRecord = z.infer<
  typeof LlmExtractionVaultRecordSchema
>;

export const SignalLifecycleVaultRecordSchema = z
  .object({
    schemaVersion: z.literal(TRAINING_VAULT_SCHEMA_VERSION),
    plane: z.literal("global_public"),
    labelProvenance: LabelProvenanceSchema,
    sweepId: z.string().min(1),
    signalId: z.string().min(1),
    eventCategory: z.string().min(1),
    severity: z.string().min(1),
    countryCodes: z.array(z.string().length(2)),
    lifecycleStatus: RiskSignalLifecycleSchema,
    previousStatus: RiskSignalLifecycleSchema.nullable(),
    mergedArticleHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
    independentSourceCount: z.number().int().nonnegative(),
    firstSeenAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
    observedDurationHours: z.number().nonnegative().nullable(),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type SignalLifecycleVaultRecord = z.infer<
  typeof SignalLifecycleVaultRecordSchema
>;

export const EntityResolutionPairVaultRecordSchema = z
  .object({
    schemaVersion: z.literal(TRAINING_VAULT_SCHEMA_VERSION),
    plane: z.literal("global_public"),
    labelProvenance: z.enum(["RULE_VERIFIED", "HUMAN_VERIFIED"]),
    inputNormalized: z.string().trim().min(1).max(200),
    inputLanguage: z.string().min(2).max(16).nullable(),
    registrySource: z.string().trim().min(1).max(64),
    registryId: z.string().trim().min(1).max(128),
    canonicalName: z.string().trim().min(1).max(200),
    countryCode: z.string().length(2).nullable(),
    resolutionMethod: z.enum([
      "EXACT_ID",
      "ALIAS_DICTIONARY",
      "FUZZY_MATCH",
      "USER_CONFIRMED",
    ]),
    confidence: z.number().min(0).max(1),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type EntityResolutionPairVaultRecord = z.infer<
  typeof EntityResolutionPairVaultRecordSchema
>;

// =============================================================================
// Plane B — anonymized_outcomes (De-Identified Operational Feedback & Gym Outcomes)
// =============================================================================

export const AnonymizedAlertFeedbackVaultRecordSchema = z
  .object({
    schemaVersion: z.literal(TRAINING_VAULT_SCHEMA_VERSION),
    plane: z.literal("anonymized_outcomes"),
    labelProvenance: z.literal("HUMAN_VERIFIED"),
    signalId: z.string().min(1),
    reasonCode: AlertAckReasonSchema,
    eventCategory: z.string().min(1).nullable(),
    severity: z.string().min(1).nullable(),
    countryCode: z.string().length(2).nullable(),
    timestampBucket: UtcDayBucketSchema,
  })
  .strict();
export type AnonymizedAlertFeedbackVaultRecord = z.infer<
  typeof AnonymizedAlertFeedbackVaultRecordSchema
>;

export const AnonymizedDecisionOutcomeVaultRecordSchema = z
  .object({
    schemaVersion: z.literal(TRAINING_VAULT_SCHEMA_VERSION),
    plane: z.literal("anonymized_outcomes"),
    labelProvenance: z.enum(["HUMAN_VERIFIED", "RULE_VERIFIED"]),
    signalId: z.string().min(1),
    eventCategory: z.string().min(1),
    transportMode: z.string().min(1).nullable(),
    regionBucket: z.string().min(1).nullable(),
    predictedTtrBandDays: z.string().min(1).nullable(),
    observedTtrBandDays: z.string().min(1).nullable(),
    actionType: z.string().min(1).nullable(),
    timestampBucket: UtcDayBucketSchema,
  })
  .strict();
export type AnonymizedDecisionOutcomeVaultRecord = z.infer<
  typeof AnonymizedDecisionOutcomeVaultRecordSchema
>;

export const TRAINING_VAULT_DATASET_PLANE: Record<
  TrainingVaultDataset,
  TrainingVaultPlane
> = {
  raw_feeds: "global_public",
  llm_extractions: "global_public",
  signal_lifecycles: "global_public",
  entity_resolution_pairs: "global_public",
  anonymized_alert_feedback: "anonymized_outcomes",
  anonymized_decision_outcomes: "anonymized_outcomes",
};

export const TRAINING_VAULT_DATASET_SCHEMAS = {
  raw_feeds: RawFeedVaultRecordSchema,
  llm_extractions: LlmExtractionVaultRecordSchema,
  signal_lifecycles: SignalLifecycleVaultRecordSchema,
  entity_resolution_pairs: EntityResolutionPairVaultRecordSchema,
  anonymized_alert_feedback: AnonymizedAlertFeedbackVaultRecordSchema,
  anonymized_decision_outcomes: AnonymizedDecisionOutcomeVaultRecordSchema,
} as const;

export interface TrainingVaultRecordMap {
  raw_feeds: RawFeedVaultRecord;
  llm_extractions: LlmExtractionVaultRecord;
  signal_lifecycles: SignalLifecycleVaultRecord;
  entity_resolution_pairs: EntityResolutionPairVaultRecord;
  anonymized_alert_feedback: AnonymizedAlertFeedbackVaultRecord;
  anonymized_decision_outcomes: AnonymizedDecisionOutcomeVaultRecord;
}
