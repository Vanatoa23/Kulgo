import { z } from "zod";
import { MaterialArchetypeSchema } from "./esg.js";

export const FacilityKindSchema = z.enum([
  "HQ",
  "FACTORY",
  "WAREHOUSE",
  "PORT",
  "HUB",
  "EXTRACTION",
  "CUSTOMER",
]);
export type FacilityKind = z.infer<typeof FacilityKindSchema>;

export const FacilityRelationshipRoleSchema = z.enum([
  "SUPPLIER",
  "OWN",
  "CLIENT",
]);
export type FacilityRelationshipRole = z.infer<
  typeof FacilityRelationshipRoleSchema
>;

export const LaneDirectionSchema = z.enum([
  "UPSTREAM",
  "INTERNAL",
  "DOWNSTREAM",
]);
export type LaneDirection = z.infer<typeof LaneDirectionSchema>;

export function resolveFacilityRole(facility: {
  relationshipRole?: FacilityRelationshipRole;
  isOwnFacility?: boolean;
  kind?: FacilityKind;
}): FacilityRelationshipRole {
  if (facility.relationshipRole) return facility.relationshipRole;
  if (facility.isOwnFacility) return "OWN";
  if (facility.kind === "CUSTOMER") return "CLIENT";
  return "SUPPLIER";
}

export function resolveLaneDirection(
  lane: { direction?: LaneDirection },
  fromFacility?: {
    relationshipRole?: FacilityRelationshipRole;
    isOwnFacility?: boolean;
    kind?: FacilityKind;
  },
  toFacility?: {
    relationshipRole?: FacilityRelationshipRole;
    isOwnFacility?: boolean;
    kind?: FacilityKind;
  },
): LaneDirection {
  if (lane.direction) return lane.direction;
  const fromRole = fromFacility ? resolveFacilityRole(fromFacility) : undefined;
  const toRole = toFacility ? resolveFacilityRole(toFacility) : undefined;
  if (toRole === "CLIENT") return "DOWNSTREAM";
  if (fromRole === "OWN" && toRole === "OWN") return "INTERNAL";
  return "UPSTREAM";
}

export const LocationPrecisionSchema = z.enum(["HQ_ESTIMATED", "SITE_VERIFIED"]);
export type LocationPrecision = z.infer<typeof LocationPrecisionSchema>;

export const TransportModeSchema = z.enum([
  "SEA",
  "AIR",
  "RAIL",
  "ROAD",
  "MULTIMODAL",
]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const VolumeUnitSchema = z.enum([
  "UNITS",
  "TONNES",
  "KG",
  "LITERS",
  "EUR_VALUE",
]);
export type VolumeUnit = z.infer<typeof VolumeUnitSchema>;

export const UnitFamilySchema = z.enum([
  "MASS",
  "COUNT",
  "VOLUME",
  "AREA",
  "CURRENCY",
]);
export type UnitFamily = z.infer<typeof UnitFamilySchema>;

export const RiskStatusSchema = z.enum(["GREEN", "YELLOW", "RED"]);
export type RiskStatus = z.infer<typeof RiskStatusSchema>;

export const ContractTypeSchema = z.enum(["FRAMEWORK", "SPOT_PO", "ESTIMATE"]);
export type ContractType = z.infer<typeof ContractTypeSchema>;

export const ContractCadenceSchema = z.enum(["PER_YEAR", "TOTAL_OVER_TERM"]);
export type ContractCadence = z.infer<typeof ContractCadenceSchema>;

export const ContractPricingModelSchema = z.enum(["FIXED", "INDEXED"]);
export type ContractPricingModel = z.infer<typeof ContractPricingModelSchema>;

export const ContractExpiryBehaviorSchema = z.enum([
  "HOLDOVER",
  "AUTO_RENEW",
  "AUTO_ARCHIVE",
]);
export type ContractExpiryBehavior = z.infer<
  typeof ContractExpiryBehaviorSchema
>;

export const ContractConfidenceSchema = z.enum([
  "CONTRACTED",
  "IMPORTED",
  "ESTIMATED",
]);
export type ContractConfidence = z.infer<typeof ContractConfidenceSchema>;

export const ContractLifecycleStateSchema = z.enum([
  "ACTIVE",
  "SCHEDULED",
  "EXPIRED_ASSUMED_HOLDOVER",
  "ARCHIVED_EXPIRED",
  "ARCHIVED_BY_FRAMEWORK",
  "ARCHIVED_MANUAL",
]);
export type ContractLifecycleState = z.infer<
  typeof ContractLifecycleStateSchema
>;

export const ContractSchema = z
  .object({
    contractId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    supplierFacilityId: z.string().uuid(),
    title: z.string().min(1).max(200),
    contractType: ContractTypeSchema,
    pricingModel: ContractPricingModelSchema.default("FIXED"),
    expiryBehavior: ContractExpiryBehaviorSchema.default("HOLDOVER"),
    confidence: ContractConfidenceSchema.default("CONTRACTED"),
    startDate: z.string().date(),
    endDate: z.string().date().nullable().default(null),
    noticePeriodDays: z.number().int().nonnegative().default(0),
    nonRenewalNoticeGiven: z.boolean().default(false),
    archiveEffectiveDate: z.string().date().nullable().default(null),
    isManuallyArchived: z.boolean().default(false),
    incoterms: z.string().max(32).nullable().default(null),
    notes: z.string().max(1000).nullable().default(null),
  })
  .strict();
export type Contract = z.infer<typeof ContractSchema>;

export const ContractLineSchema = z
  .object({
    contractLineId: z.string().uuid(),
    contractId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    laneId: z.string().uuid(),
    inputId: z.string().uuid().nullable().default(null),
    cadence: ContractCadenceSchema.default("PER_YEAR"),
    committedVolume: z.number().finite().nonnegative().nullable().default(null),
    unit: z.string().min(1).max(32).default("TONNES"),
    committedSpend: z.number().finite().nonnegative().nullable().default(null),
    unitPrice: z.number().finite().nonnegative().nullable().default(null),
    currency: z.string().length(3).default("EUR"),
    startDateOverride: z.string().date().nullable().default(null),
    endDateOverride: z.string().date().nullable().default(null),
  })
  .strict();
export type ContractLine = z.infer<typeof ContractLineSchema>;

export const ProductSchema = z
  .object({
    productId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    name: z.string().min(1).max(160),
    sku: z.string().max(64).nullable().default(null),
    description: z.string().max(1000).nullable().default(null),
    annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
    grossMarginPct: z.number().finite().min(0).max(100).nullable().optional(),
  })
  .strict();
export type Product = z.infer<typeof ProductSchema>;

export const SupplyInputSchema = z
  .object({
    inputId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    productId: z.string().uuid().nullable().default(null),
    name: z.string().min(1).max(160),
    category: z.string().min(1).max(100),
    unit: VolumeUnitSchema.default("TONNES"),
    baseUnit: VolumeUnitSchema.optional(),
    unitFamily: UnitFamilySchema.optional(),
    unitConversionFactors: z
      .record(z.string().min(1).max(32), z.number().finite().positive())
      .optional(),
    totalAnnualDemand: z.number().finite().nonnegative().nullable().optional(),
    materialCriticality: z.number().finite().min(0).max(1).nullable().optional(),
    // Sub-Project 3 ESG taxonomy & PCF fields
    cnCode: z.string().trim().max(16).nullable().optional(),
    materialArchetype: MaterialArchetypeSchema.nullable().optional(),
    unitMassKg: z.number().finite().positive().nullable().optional(),
    productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
    pcfVerified: z.boolean().optional(),
  })
  .strict();
export type SupplyInput = z.infer<typeof SupplyInputSchema>;

export const FacilitySchema = z
  .object({
    facilityId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    name: z.string().min(1).max(160),
    kind: FacilityKindSchema,
    locationPrecision: LocationPrecisionSchema.default("HQ_ESTIMATED"),
    countryCode: z.string().length(2),
    regionCode: z.string().max(64).nullable().default(null),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    isOwnFacility: z.boolean().default(false),
    relationshipRole: FacilityRelationshipRoleSchema.optional(),
    isPartnerVerified: z.boolean().default(false),
    sector: z.string().max(100).nullable().default(null),
    esgBadges: z.array(z.string()).default([]),
    estimatedScope12Tco2e: z.number().nonnegative().nullable().default(null),
    defaultCarryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
    // Sub-Project 3 ESG electricity & revenue scoping fields
    annualElectricityMwh: z.number().finite().nonnegative().nullable().optional(),
    renewableElectricityPct: z.number().finite().min(0).max(100).nullable().optional(),
    renewableInstrumentsVerified: z.boolean().optional(),
    annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
    registryCode: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();
export type Facility = z.infer<typeof FacilitySchema>;

export const SupplyLaneSchema = z
  .object({
    laneId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    fromFacilityId: z.string().uuid(),
    toFacilityId: z.string().uuid(),
    direction: LaneDirectionSchema.optional(),
    allocationSplitPct: z.number().finite().min(0).max(100).nullable().optional(),
    inputId: z.string().uuid().nullable().default(null),
    materialCategory: z.string().min(1).max(100),
    transportMode: TransportModeSchema,
    volumeSharePct: z.number().min(0).max(100),
    annualVolume: z.number().nonnegative().nullable().default(null),
    volumeUnit: VolumeUnitSchema.default("TONNES"),
    annualSpendEur: z.number().nonnegative().nullable().default(null),
    contractEndDate: z.string().date().nullable().default(null),
    contractTerms: z.string().max(500).nullable().default(null),
    leadTimeDays: z.number().int().nonnegative().nullable().default(null),
    distanceKm: z.number().nonnegative().nullable().default(null),
    estimatedLaneCo2e: z.number().nonnegative().nullable().default(null),
    riskStatus: RiskStatusSchema.default("GREEN"),
    riskReason: z.string().max(300).nullable().default(null),
    safetyStockDays: z.number().finite().nonnegative().nullable().optional(),
    defectRatePct: z.number().finite().min(0).max(95).nullable().optional(),
    carryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
    unitLandedCostEur: z.number().finite().nonnegative().nullable().optional(),
    ordinaryFreightCostPerUnitEur: z.number().finite().nonnegative().nullable().optional(),
    customAnnualDisruptionProb: z.number().finite().min(0).max(1).nullable().optional(),
    customTtrDays: z.number().finite().nonnegative().nullable().optional(),
    // Sub-Project 3 lane-level PCF & allocation overrides
    productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
    pcfVerified: z.boolean().optional(),
    economicAttributionRatio: z.number().finite().min(0).max(1).nullable().optional(),
  })
  .strict();
export type SupplyLane = z.infer<typeof SupplyLaneSchema>;

export const RiskSignalKindSchema = z.enum([
  "SANCTIONS",
  "GEOPOLITICAL",
  "MARITIME_CHOKEPOINT",
  "PORT_CONGESTION",
  "CLIMATE",
  "LABOR_INDUSTRIAL",
  "CYBER_FINANCIAL",
]);
export type RiskSignalKind = z.infer<typeof RiskSignalKindSchema>;

export const ChokepointCodeSchema = z.enum([
  "SUEZ_CANAL",
  "RED_SEA_BAB_EL_MANDEB",
  "PANAMA_CANAL",
  "MALACCA_STRAIT",
  "STRAIT_OF_HORMUZ",
  "BOSPORUS_STRAIT",
  "BALTIC_SEA",
  "DANISH_STRAITS",
  "NORTH_SEA",
  "ENGLISH_CHANNEL",
  "ALPINE_BRENNER_CORRIDOR",
  "ALPINE_GOTTHARD_CORRIDOR",
  "RHINE_VALLEY_CORRIDOR",
  "BALTIC_VIA_BALTICA_CORRIDOR",
  "EU_EASTERN_BORDER_CORRIDOR",
]);
export type ChokepointCode = z.infer<typeof ChokepointCodeSchema>;

export const RiskSignalVerificationStatusSchema = z.enum([
  "CONFIRMED",
  "CORROBORATED",
  "ALLEGED",
]);
export type RiskSignalVerificationStatus = z.infer<
  typeof RiskSignalVerificationStatusSchema
>;

export const RiskSignalLifecycleSchema = z.enum([
  "PLANNED",
  "ACTIVE",
  "RESOLVED",
]);
export type RiskSignalLifecycle = z.infer<typeof RiskSignalLifecycleSchema>;

export const RiskSignalSchema = z
  .object({
    signalId: z.string().min(1),
    kind: RiskSignalKindSchema,
    severity: RiskStatusSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().default(null),
    regionCode: z.string().max(64).nullable().default(null),
    affectedCountryCodes: z.array(z.string().length(2)).default([]),
    affectedChokepoints: z.array(ChokepointCodeSchema).default([]),
    affectedSectors: z.array(z.string().max(100)).default([]),
    polygonWkt: z.string().min(1),
    sourceUrls: z.array(z.string().url()).default([]),
    evidenceQuotes: z.array(z.string().max(400)).optional(),
    publishedAt: z.string().datetime().nullable().default(null),
    lastSeenAt: z.string().datetime().nullable().default(null),
    eventStartAt: z.string().datetime().nullable().optional(),
    eventEndAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().default(null),
    resolvedAt: z.string().datetime().nullable().default(null),
    dedupeKey: z.string().max(128).nullable().default(null),
    confidence: z.number().min(0).max(1).default(1),
    verificationStatus: RiskSignalVerificationStatusSchema.default("CONFIRMED"),
    lifecycle: RiskSignalLifecycleSchema.default("ACTIVE"),
    active: z.boolean().default(true),
  })
  .strict();
export type RiskSignal = z.infer<typeof RiskSignalSchema>;

export const AlertNotificationPreferenceSchema = z
  .object({
    orgId: z.string().uuid(),
    instantRedEmailEnabled: z.boolean().default(true),
    dailyAmberDigestEnabled: z.boolean().default(true),
    emailRecipients: z.array(z.string().email()).max(20).default([]),
    webhookUrl: z.string().url().nullable().default(null),
    webhookSecretConfigured: z.boolean().default(false),
    allowAnonymizedTraining: z.boolean().default(true),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AlertNotificationPreference = z.infer<
  typeof AlertNotificationPreferenceSchema
>;

export const AlertAckReasonSchema = z.enum([
  "HANDLED",
  "WRONG_ENTITY_OR_SITE",
  "FALSE_OR_OUTDATED_EVENT",
  "NOT_RELEVANT_TO_LANE",
]);
export type AlertAckReason = z.infer<typeof AlertAckReasonSchema>;

export const OrgAlertAckSchema = z
  .object({
    orgId: z.string().uuid(),
    signalId: z.string().min(1),
    status: z.enum(["ACKNOWLEDGED", "MUTED"]),
    acknowledgedByUserId: z.string().uuid(),
    reason: AlertAckReasonSchema.nullable().default(null),
    note: z.string().max(500).nullable().default(null),
    acknowledgedAt: z.string().datetime(),
  })
  .strict();
export type OrgAlertAck = z.infer<typeof OrgAlertAckSchema>;

export const WorkspaceNetworkResponseSchema = z
  .object({
    products: z.array(ProductSchema),
    inputs: z.array(SupplyInputSchema),
    facilities: z.array(FacilitySchema),
    lanes: z.array(SupplyLaneSchema),
    riskSignals: z.array(RiskSignalSchema).default([]),
    contracts: z.array(ContractSchema).optional(),
    contractLines: z.array(ContractLineSchema).optional(),
  })
  .strict();
export type WorkspaceNetworkResponse = z.infer<
  typeof WorkspaceNetworkResponseSchema
>;

// --- M1 CRUD & Refinement Input Schemas ---

export const CountryCodeInputSchema = z
  .string()
  .trim()
  .length(2)
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => /^[A-Z]{2}$/.test(value),
    "countryCode must be a 2-letter ISO code",
  );

export const CreateProductInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
  grossMarginPct: z.number().finite().min(0).max(100).nullable().optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = CreateProductInputSchema.partial();
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

export const CreateSupplyInputInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  unit: VolumeUnitSchema.default("TONNES"),
  baseUnit: VolumeUnitSchema.optional(),
  unitFamily: UnitFamilySchema.optional(),
  unitConversionFactors: z
    .record(z.string().min(1).max(32), z.number().finite().positive())
    .optional(),
  totalAnnualDemand: z.number().finite().nonnegative().nullable().optional(),
  materialCriticality: z.number().finite().min(0).max(1).nullable().optional(),
  cnCode: z.string().trim().max(16).nullable().optional(),
  materialArchetype: MaterialArchetypeSchema.nullable().optional(),
  unitMassKg: z.number().finite().positive().nullable().optional(),
  productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
  pcfVerified: z.boolean().optional(),
});
export type CreateSupplyInputInput = z.infer<
  typeof CreateSupplyInputInputSchema
>;

export const UpdateSupplyInputInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  unit: VolumeUnitSchema.optional(),
  baseUnit: VolumeUnitSchema.optional(),
  unitFamily: UnitFamilySchema.optional(),
  unitConversionFactors: z
    .record(z.string().min(1).max(32), z.number().finite().positive())
    .optional(),
  totalAnnualDemand: z.number().finite().nonnegative().nullable().optional(),
  materialCriticality: z.number().finite().min(0).max(1).nullable().optional(),
  cnCode: z.string().trim().max(16).nullable().optional(),
  materialArchetype: MaterialArchetypeSchema.nullable().optional(),
  unitMassKg: z.number().finite().positive().nullable().optional(),
  productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
  pcfVerified: z.boolean().optional(),
});
export type UpdateSupplyInputInput = z.infer<
  typeof UpdateSupplyInputInputSchema
>;

export const CreateFacilityInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: FacilityKindSchema.default("FACTORY"),
  locationPrecision: LocationPrecisionSchema.default("HQ_ESTIMATED"),
  countryCode: CountryCodeInputSchema,
  regionCode: z.string().trim().max(32).nullable().optional(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  isOwnFacility: z.boolean().default(false),
  relationshipRole: FacilityRelationshipRoleSchema.optional(),
  sector: z.string().trim().max(100).nullable().optional(),
  esgBadges: z.array(z.string().trim().min(1).max(64)).optional(),
  estimatedScope12Tco2e: z.number().finite().nonnegative().nullable().optional(),
  defaultCarryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
  annualElectricityMwh: z.number().finite().nonnegative().nullable().optional(),
  renewableElectricityPct: z.number().finite().min(0).max(100).nullable().optional(),
  renewableInstrumentsVerified: z.boolean().optional(),
  annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
  registryCode: z.string().trim().min(1).max(64).nullable().optional(),
});
export type CreateFacilityInput = z.infer<typeof CreateFacilityInputSchema>;

export const UpdateFacilityInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  kind: FacilityKindSchema.optional(),
  locationPrecision: LocationPrecisionSchema.optional(),
  countryCode: CountryCodeInputSchema.optional(),
  regionCode: z.string().trim().max(32).nullable().optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  isOwnFacility: z.boolean().optional(),
  relationshipRole: FacilityRelationshipRoleSchema.optional(),
  sector: z.string().trim().max(100).nullable().optional(),
  esgBadges: z.array(z.string().trim().min(1).max(64)).optional(),
  estimatedScope12Tco2e: z.number().finite().nonnegative().nullable().optional(),
  defaultCarryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
  annualElectricityMwh: z.number().finite().nonnegative().nullable().optional(),
  renewableElectricityPct: z.number().finite().min(0).max(100).nullable().optional(),
  renewableInstrumentsVerified: z.boolean().optional(),
  annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
  registryCode: z.string().trim().min(1).max(64).nullable().optional(),
});
export type UpdateFacilityInput = z.infer<typeof UpdateFacilityInputSchema>;

export const CreateSupplyLaneInputSchema = z.object({
  fromFacilityId: z.string().uuid(),
  toFacilityId: z.string().uuid(),
  direction: LaneDirectionSchema.optional(),
  allocationSplitPct: z.number().finite().min(0).max(100).nullable().optional(),
  inputId: z.string().uuid().nullable().optional(),
  materialCategory: z.string().trim().min(1).max(80),
  transportMode: TransportModeSchema.default("ROAD"),
  volumeSharePct: z.number().finite().min(0).max(100).default(100),
  annualVolume: z.number().finite().nonnegative().nullable().optional(),
  volumeUnit: VolumeUnitSchema.default("TONNES"),
  annualSpendEur: z.number().finite().nonnegative().nullable().optional(),
  contractEndDate: z.string().date().nullable().optional(),
  contractTerms: z.string().trim().max(240).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  distanceKm: z.number().finite().nonnegative().nullable().optional(),
  estimatedLaneCo2e: z.number().finite().nonnegative().nullable().optional(),
  riskStatus: RiskStatusSchema.default("GREEN"),
  riskReason: z.string().trim().max(300).nullable().optional(),
  safetyStockDays: z.number().finite().nonnegative().nullable().optional(),
  defectRatePct: z.number().finite().min(0).max(95).nullable().optional(),
  carryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
  unitLandedCostEur: z.number().finite().nonnegative().nullable().optional(),
  ordinaryFreightCostPerUnitEur: z.number().finite().nonnegative().nullable().optional(),
  customAnnualDisruptionProb: z.number().finite().min(0).max(1).nullable().optional(),
  customTtrDays: z.number().finite().nonnegative().nullable().optional(),
  productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
  pcfVerified: z.boolean().optional(),
  economicAttributionRatio: z.number().finite().min(0).max(1).nullable().optional(),
});
export type CreateSupplyLaneInput = z.infer<typeof CreateSupplyLaneInputSchema>;

export const UpdateSupplyLaneInputSchema = z.object({
  fromFacilityId: z.string().uuid().optional(),
  toFacilityId: z.string().uuid().optional(),
  direction: LaneDirectionSchema.optional(),
  allocationSplitPct: z.number().finite().min(0).max(100).nullable().optional(),
  inputId: z.string().uuid().nullable().optional(),
  materialCategory: z.string().trim().min(1).max(80).optional(),
  transportMode: TransportModeSchema.optional(),
  volumeSharePct: z.number().finite().min(0).max(100).optional(),
  annualVolume: z.number().finite().nonnegative().nullable().optional(),
  volumeUnit: VolumeUnitSchema.optional(),
  annualSpendEur: z.number().finite().nonnegative().nullable().optional(),
  contractEndDate: z.string().date().nullable().optional(),
  contractTerms: z.string().trim().max(240).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  distanceKm: z.number().finite().nonnegative().nullable().optional(),
  estimatedLaneCo2e: z.number().finite().nonnegative().nullable().optional(),
  riskStatus: RiskStatusSchema.optional(),
  riskReason: z.string().trim().max(300).nullable().optional(),
  safetyStockDays: z.number().finite().nonnegative().nullable().optional(),
  defectRatePct: z.number().finite().min(0).max(95).nullable().optional(),
  carryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
  unitLandedCostEur: z.number().finite().nonnegative().nullable().optional(),
  ordinaryFreightCostPerUnitEur: z.number().finite().nonnegative().nullable().optional(),
  customAnnualDisruptionProb: z.number().finite().min(0).max(1).nullable().optional(),
  customTtrDays: z.number().finite().nonnegative().nullable().optional(),
  productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
  pcfVerified: z.boolean().optional(),
  economicAttributionRatio: z.number().finite().min(0).max(1).nullable().optional(),
});
export type UpdateSupplyLaneInput = z.infer<typeof UpdateSupplyLaneInputSchema>;

export const CreateContractInputSchema = z.object({
  supplierFacilityId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  contractType: ContractTypeSchema.default("FRAMEWORK"),
  pricingModel: ContractPricingModelSchema.default("FIXED"),
  expiryBehavior: ContractExpiryBehaviorSchema.optional(),
  confidence: ContractConfidenceSchema.default("CONTRACTED"),
  startDate: z.string().date(),
  endDate: z.string().date().nullable().optional(),
  noticePeriodDays: z.number().int().nonnegative().default(0),
  nonRenewalNoticeGiven: z.boolean().default(false),
  incoterms: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CreateContractInput = z.infer<typeof CreateContractInputSchema>;

export const UpdateContractInputSchema = CreateContractInputSchema.partial().extend({
  archiveEffectiveDate: z.string().date().nullable().optional(),
  isManuallyArchived: z.boolean().optional(),
});
export type UpdateContractInput = z.infer<typeof UpdateContractInputSchema>;

export const CreateContractLineInputBaseSchema = z.object({
  contractId: z.string().uuid(),
  laneId: z.string().uuid(),
  inputId: z.string().uuid().nullable().optional(),
  cadence: ContractCadenceSchema.default("PER_YEAR"),
  committedVolume: z.number().finite().nonnegative().nullable().optional(),
  unit: z.string().trim().min(1).max(32).default("TONNES"),
  committedSpend: z.number().finite().nonnegative().nullable().optional(),
  unitPrice: z.number().finite().nonnegative().nullable().optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .default("EUR"),
  startDateOverride: z.string().date().nullable().optional(),
  endDateOverride: z.string().date().nullable().optional(),
});

export const CreateContractLineInputSchema =
  CreateContractLineInputBaseSchema.refine(
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
export type CreateContractLineInput = z.infer<
  typeof CreateContractLineInputSchema
>;

export const UpdateContractLineInputSchema =
  CreateContractLineInputBaseSchema.omit({ contractId: true }).partial();
export type UpdateContractLineInput = z.infer<
  typeof UpdateContractLineInputSchema
>;

// --- M4 Bulk Import & Export Schemas ---

export const BulkImportFacilityRowSchema = CreateFacilityInputSchema.extend({
  refKey: z.string().trim().min(1).max(100).optional(),
  facilityId: z.string().uuid().optional(),
});
export type BulkImportFacilityRow = z.infer<typeof BulkImportFacilityRowSchema>;

export const BulkImportLaneRowSchema = z.object({
  laneId: z.string().uuid().optional(),
  fromFacilityId: z.string().uuid().optional(),
  toFacilityId: z.string().uuid().optional(),
  fromFacilityRef: z.string().trim().min(1).max(160).optional(),
  toFacilityRef: z.string().trim().min(1).max(160).optional(),
  direction: LaneDirectionSchema.optional(),
  allocationSplitPct: z.number().finite().min(0).max(100).nullable().optional(),
  inputId: z.string().uuid().nullable().optional(),
  materialCategory: z.string().trim().min(1).max(80),
  transportMode: TransportModeSchema.default("ROAD"),
  volumeSharePct: z.number().finite().min(0).max(100).default(100),
  annualVolume: z.number().finite().nonnegative().nullable().optional(),
  volumeUnit: VolumeUnitSchema.default("TONNES"),
  annualSpendEur: z.number().finite().nonnegative().nullable().optional(),
  contractEndDate: z.string().date().nullable().optional(),
  contractTerms: z.string().trim().max(240).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  distanceKm: z.number().finite().nonnegative().nullable().optional(),
  estimatedLaneCo2e: z.number().finite().nonnegative().nullable().optional(),
  riskStatus: RiskStatusSchema.default("GREEN"),
  riskReason: z.string().trim().max(300).nullable().optional(),
  safetyStockDays: z.number().finite().nonnegative().nullable().optional(),
  defectRatePct: z.number().finite().min(0).max(95).nullable().optional(),
  carryingCostPct: z.number().finite().min(0).max(100).nullable().optional(),
  unitLandedCostEur: z.number().finite().nonnegative().nullable().optional(),
  ordinaryFreightCostPerUnitEur: z.number().finite().nonnegative().nullable().optional(),
  customAnnualDisruptionProb: z.number().finite().min(0).max(1).nullable().optional(),
  customTtrDays: z.number().finite().nonnegative().nullable().optional(),
  productEmissionFactorTco2ePerUnit: z.number().finite().nonnegative().nullable().optional(),
  pcfVerified: z.boolean().optional(),
  economicAttributionRatio: z.number().finite().min(0).max(1).nullable().optional(),
});
export type BulkImportLaneRow = z.infer<typeof BulkImportLaneRowSchema>;

export const BulkImportJsonRequestSchema = z.object({
  products: z.array(z.unknown()).max(500).optional(),
  inputs: z.array(z.unknown()).max(1000).optional(),
  exportVersion: z.literal("1.0").optional(),
  facilities: z.array(z.unknown()).max(500).optional(),
  lanes: z.array(z.unknown()).max(1000).optional(),
  csv: z.string().min(1).max(2_000_000).optional(),
  xlsxBase64: z.string().min(1).max(3_000_000).optional(),
});
export type BulkImportJsonRequest = z.infer<typeof BulkImportJsonRequestSchema>;

export const BulkImportErrorSchema = z
  .object({
    row: z.number().int().nonnegative(),
    entity: z.enum(["PRODUCT", "INPUT", "FACILITY", "LANE", "ROW"]),
    field: z.string().optional(),
    message: z.string().min(1),
  })
  .strict();
export type BulkImportError = z.infer<typeof BulkImportErrorSchema>;

export const BulkImportSummarySchema = z
  .object({
    createdFacilities: z.number().int().nonnegative(),
    createdLanes: z.number().int().nonnegative(),
    errors: z.array(BulkImportErrorSchema),
  })
  .strict();
export type BulkImportSummary = z.infer<typeof BulkImportSummarySchema>;

export const WorkspaceExportJsonSchema = z
  .object({
    exportVersion: z.literal("1.0"),
    exportedAt: z.string().datetime(),
    organization: z
      .object({
        orgId: z.string().uuid(),
        name: z.string().min(1).max(160),
        countryCode: z.string().length(2),
        sector: z.string().min(1).max(100),
      })
      .strict(),
    products: z.array(ProductSchema),
    inputs: z.array(SupplyInputSchema),
    facilities: z.array(FacilitySchema),
    lanes: z.array(SupplyLaneSchema),
  })
  .strict();
export type WorkspaceExportJson = z.infer<typeof WorkspaceExportJsonSchema>;


