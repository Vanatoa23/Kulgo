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

export const WorkspaceNetworkResponseSchema = z.object({
  products: z.array(ProductSchema),
  inputs: z.array(SupplyInputSchema),
  facilities: z.array(FacilitySchema),
  lanes: z.array(SupplyLaneSchema),
});
export type WorkspaceNetworkResponse = z.infer<
  typeof WorkspaceNetworkResponseSchema
>;
