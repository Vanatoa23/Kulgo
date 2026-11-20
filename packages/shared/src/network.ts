import { z } from "zod";

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

export const RiskStatusSchema = z.enum(["GREEN", "YELLOW", "RED"]);
export type RiskStatus = z.infer<typeof RiskStatusSchema>;

export const ProductSchema = z.object({
  productId: z.string().uuid(),
  ownerOrgId: z.string().uuid(),
  name: z.string().min(1).max(160),
  sku: z.string().max(64).nullable().default(null),
  description: z.string().max(1000).nullable().default(null),
});
export type Product = z.infer<typeof ProductSchema>;

export const SupplyInputSchema = z.object({
  inputId: z.string().uuid(),
  ownerOrgId: z.string().uuid(),
  productId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(160),
  category: z.string().min(1).max(100),
  unit: VolumeUnitSchema.default("TONNES"),
});
export type SupplyInput = z.infer<typeof SupplyInputSchema>;

export const FacilitySchema = z.object({
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
  isPartnerVerified: z.boolean().default(false),
  sector: z.string().max(100).nullable().default(null),
  esgBadges: z.array(z.string()).default([]),
  estimatedScope12Tco2e: z.number().nonnegative().nullable().default(null),
});
export type Facility = z.infer<typeof FacilitySchema>;

export const SupplyLaneSchema = z.object({
  laneId: z.string().uuid(),
  ownerOrgId: z.string().uuid(),
  fromFacilityId: z.string().uuid(),
  toFacilityId: z.string().uuid(),
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
});
export type SupplyLane = z.infer<typeof SupplyLaneSchema>;

export const RiskSignalKindSchema = z.enum([
  "SANCTIONS",
  "GEOPOLITICAL",
  "MARITIME_CHOKEPOINT",
  "PORT_CONGESTION",
  "CLIMATE",
]);
export type RiskSignalKind = z.infer<typeof RiskSignalKindSchema>;

export const RiskSignalSchema = z
  .object({
    signalId: z.string().min(1),
    kind: RiskSignalKindSchema,
    severity: RiskStatusSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().default(null),
    regionCode: z.string().max(64).nullable().default(null),
    affectedCountryCodes: z.array(z.string().length(2)).default([]),
    polygonWkt: z.string().min(1),
    active: z.boolean().default(true),
  })
  .strict();
export type RiskSignal = z.infer<typeof RiskSignalSchema>;

export const WorkspaceNetworkResponseSchema = z.object({
  products: z.array(ProductSchema),
  inputs: z.array(SupplyInputSchema),
  facilities: z.array(FacilitySchema),
  lanes: z.array(SupplyLaneSchema),
  riskSignals: z.array(RiskSignalSchema).default([]),
});
export type WorkspaceNetworkResponse = z.infer<
  typeof WorkspaceNetworkResponseSchema
>;

// --- M1 CRUD & Refinement Input Schemas ---

const CountryCodeInputSchema = z
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
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = CreateProductInputSchema.partial();
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

export const CreateSupplyInputInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  unit: VolumeUnitSchema.default("TONNES"),
});
export type CreateSupplyInputInput = z.infer<
  typeof CreateSupplyInputInputSchema
>;

export const UpdateSupplyInputInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  unit: VolumeUnitSchema.optional(),
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
  sector: z.string().trim().max(100).nullable().optional(),
  esgBadges: z.array(z.string().trim().min(1).max(64)).optional(),
  estimatedScope12Tco2e: z.number().finite().nonnegative().nullable().optional(),
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
  sector: z.string().trim().max(100).nullable().optional(),
  esgBadges: z.array(z.string().trim().min(1).max(64)).optional(),
  estimatedScope12Tco2e: z.number().finite().nonnegative().nullable().optional(),
});
export type UpdateFacilityInput = z.infer<typeof UpdateFacilityInputSchema>;

export const CreateSupplyLaneInputSchema = z.object({
  fromFacilityId: z.string().uuid(),
  toFacilityId: z.string().uuid(),
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
});
export type CreateSupplyLaneInput = z.infer<typeof CreateSupplyLaneInputSchema>;

export const UpdateSupplyLaneInputSchema = z.object({
  fromFacilityId: z.string().uuid().optional(),
  toFacilityId: z.string().uuid().optional(),
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
});
export type UpdateSupplyLaneInput = z.infer<typeof UpdateSupplyLaneInputSchema>;

// --- M4 Bulk Import & Export Schemas ---

export const BulkImportFacilityRowSchema = CreateFacilityInputSchema.extend({
  refKey: z.string().trim().min(1).max(100).optional(),
});
export type BulkImportFacilityRow = z.infer<typeof BulkImportFacilityRowSchema>;

export const BulkImportLaneRowSchema = z.object({
  fromFacilityId: z.string().uuid().optional(),
  toFacilityId: z.string().uuid().optional(),
  fromFacilityRef: z.string().trim().min(1).max(160).optional(),
  toFacilityRef: z.string().trim().min(1).max(160).optional(),
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
});
export type BulkImportLaneRow = z.infer<typeof BulkImportLaneRowSchema>;

export const BulkImportJsonRequestSchema = z.object({
  facilities: z.array(z.unknown()).max(500).optional(),
  lanes: z.array(z.unknown()).max(1000).optional(),
  csv: z.string().min(1).max(2_000_000).optional(),
});
export type BulkImportJsonRequest = z.infer<typeof BulkImportJsonRequestSchema>;

export const BulkImportErrorSchema = z
  .object({
    row: z.number().int().nonnegative(),
    entity: z.enum(["FACILITY", "LANE", "ROW"]),
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


