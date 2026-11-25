import { z } from "zod";
import {
  RiskStatusSchema,
  UnitFamilySchema,
  VolumeUnitSchema,
  type UnitFamily,
  type VolumeUnit,
} from "./network.js";

/**
 * Kulgo v1 Standardized Material/Product Taxonomy (Sub-Project 5 / Issue #29).
 *
 * Maps common manufacturing procurement categories to 4/6-digit HS/CN codes
 * and canonical unit families so buyer supplier nodes can be matched against
 * opted-in suppliers' Product Catalogues without brittle exact-string lookups.
 */

export const StandardizedCategoryCodeSchema = z.enum([
  "ALUMINUM_EXTRUSIONS",
  "RAW_STEEL",
  "STEEL_FASTENERS",
  "COPPER_WIRING",
  "PCB_ASSEMBLY",
  "SEMICONDUCTOR_SUBSTRATES",
  "POWER_ELECTRONICS",
  "INDUSTRIAL_SENSORS",
  "LITHIUM_ION_CELLS",
  "BATTERY_PACK_ASSEMBLY",
  "THERMAL_MANAGEMENT",
  "INDUSTRIAL_POLYMERS",
  "INJECTION_MOLDING",
  "PRECISION_CNC_MACHINING",
  "ELECTRIC_MOTORS",
  "HYDRAULIC_COMPONENTS",
  "COMPOSITE_MATERIALS",
  "INDUSTRIAL_COATINGS",
  "OPTICAL_COMPONENTS",
  "PACKAGING_CORRUGATED",
]);

export type StandardizedCategoryCode = z.infer<
  typeof StandardizedCategoryCodeSchema
>;

export interface TaxonomyCategoryDefinition {
  readonly code: StandardizedCategoryCode;
  readonly label: string;
  readonly hsCode: string;
  readonly cnCode: string;
  readonly defaultBaseUnit: VolumeUnit;
  readonly unitFamily: UnitFamily;
  readonly keywords: readonly string[];
}

export const KULGO_MATERIAL_TAXONOMY: readonly TaxonomyCategoryDefinition[] = [
  {
    code: "ALUMINUM_EXTRUSIONS",
    label: "Aluminum Extrusions",
    hsCode: "7604",
    cnCode: "760429",
    defaultBaseUnit: "TONNES",
    unitFamily: "MASS",
    keywords: [
      "aluminum",
      "aluminium",
      "extrusion",
      "extrusions",
      "alloy",
      "alloys",
      "housing",
      "housings",
      "profile",
      "profiles",
    ],
  },
  {
    code: "RAW_STEEL",
    label: "Raw & Cold-Rolled Steel",
    hsCode: "7209",
    cnCode: "720916",
    defaultBaseUnit: "TONNES",
    unitFamily: "MASS",
    keywords: [
      "steel",
      "raw steel",
      "cold-rolled",
      "sheet metal",
      "coil",
      "stainless",
      "ferrous",
      "ore",
    ],
  },
  {
    code: "STEEL_FASTENERS",
    label: "Steel Fasteners & Hardware",
    hsCode: "7318",
    cnCode: "731815",
    defaultBaseUnit: "KG",
    unitFamily: "MASS",
    keywords: [
      "fastener",
      "fasteners",
      "bolt",
      "bolts",
      "screw",
      "screws",
      "nut",
      "nuts",
      "hardware",
      "rivet",
    ],
  },
  {
    code: "COPPER_WIRING",
    label: "Copper Wiring & Harnesses",
    hsCode: "8544",
    cnCode: "854442",
    defaultBaseUnit: "KG",
    unitFamily: "MASS",
    keywords: [
      "copper",
      "wiring",
      "wire",
      "cable",
      "cables",
      "harness",
      "harnesses",
      "connector",
      "connectors",
    ],
  },
  {
    code: "PCB_ASSEMBLY",
    label: "PCB Assembly & Electronics",
    hsCode: "8534",
    cnCode: "853400",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "pcb",
      "pcba",
      "circuit",
      "board",
      "electronics",
      "smt",
      "microelectronics",
      "controller",
      "electronic",
    ],
  },
  {
    code: "SEMICONDUCTOR_SUBSTRATES",
    label: "Semiconductor Substrates & Wafers",
    hsCode: "3818",
    cnCode: "381800",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "semiconductor",
      "wafer",
      "wafers",
      "silicon",
      "substrate",
      "substrates",
      "ic",
      "chip",
      "chips",
      "microcontroller",
    ],
  },
  {
    code: "POWER_ELECTRONICS",
    label: "Power Control & Electronics Modules",
    hsCode: "8504",
    cnCode: "850440",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "power",
      "inverter",
      "converter",
      "transformer",
      "psu",
      "rectifier",
      "control module",
      "igbt",
    ],
  },
  {
    code: "INDUSTRIAL_SENSORS",
    label: "Industrial Sensors & Actuators",
    hsCode: "9031",
    cnCode: "903180",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "sensor",
      "sensors",
      "actuator",
      "actuators",
      "transducer",
      "lidar",
      "telemetry",
      "measurement",
    ],
  },
  {
    code: "LITHIUM_ION_CELLS",
    label: "Lithium-Ion Battery Cells",
    hsCode: "8507",
    cnCode: "850760",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "lithium",
      "li-ion",
      "battery",
      "batteries",
      "cell",
      "cells",
      "lfp",
      "nmc",
      "cathode",
    ],
  },
  {
    code: "BATTERY_PACK_ASSEMBLY",
    label: "Battery Pack Assembly & BMS",
    hsCode: "8507",
    cnCode: "850760",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "battery pack",
      "pack assembly",
      "bms",
      "energy storage",
      "module assembly",
    ],
  },
  {
    code: "THERMAL_MANAGEMENT",
    label: "Thermal Management Systems",
    hsCode: "8419",
    cnCode: "841950",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "thermal",
      "cooling",
      "heatsink",
      "heat exchanger",
      "radiator",
      "chiller",
      "hvac",
    ],
  },
  {
    code: "INDUSTRIAL_POLYMERS",
    label: "Industrial Polymers & Resins",
    hsCode: "3901",
    cnCode: "390110",
    defaultBaseUnit: "TONNES",
    unitFamily: "MASS",
    keywords: [
      "polymer",
      "polymers",
      "resin",
      "resins",
      "plastic",
      "plastics",
      "polypropylene",
      "polyethylene",
      "abs",
      "enclosure",
      "enclosures",
    ],
  },
  {
    code: "INJECTION_MOLDING",
    label: "Precision Injection Molding",
    hsCode: "3926",
    cnCode: "392690",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "injection",
      "molding",
      "moulding",
      "molded",
      "thermoplastic",
      "tooling",
    ],
  },
  {
    code: "PRECISION_CNC_MACHINING",
    label: "Precision CNC Machining",
    hsCode: "8483",
    cnCode: "848390",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "cnc",
      "machining",
      "machined",
      "milling",
      "turning",
      "lathe",
      "precision metal",
    ],
  },
  {
    code: "ELECTRIC_MOTORS",
    label: "Electric Motors & Drives",
    hsCode: "8501",
    cnCode: "850152",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "motor",
      "motors",
      "drive",
      "drives",
      "servo",
      "stator",
      "rotor",
      "brushless",
    ],
  },
  {
    code: "HYDRAULIC_COMPONENTS",
    label: "Hydraulic & Pneumatic Components",
    hsCode: "8412",
    cnCode: "841221",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "hydraulic",
      "pneumatic",
      "valve",
      "valves",
      "pump",
      "pumps",
      "cylinder",
      "manifold",
    ],
  },
  {
    code: "COMPOSITE_MATERIALS",
    label: "Carbon & Glass Composite Materials",
    hsCode: "6815",
    cnCode: "681511",
    defaultBaseUnit: "KG",
    unitFamily: "MASS",
    keywords: [
      "composite",
      "composites",
      "carbon fiber",
      "fiberglass",
      "prepreg",
      "laminate",
      "aramid",
    ],
  },
  {
    code: "INDUSTRIAL_COATINGS",
    label: "Industrial Coatings & Adhesives",
    hsCode: "3208",
    cnCode: "320890",
    defaultBaseUnit: "LITERS",
    unitFamily: "VOLUME",
    keywords: [
      "coating",
      "coatings",
      "adhesive",
      "adhesives",
      "paint",
      "sealant",
      "epoxy",
      "primer",
      "varnish",
    ],
  },
  {
    code: "OPTICAL_COMPONENTS",
    label: "Optical Lenses & Assemblies",
    hsCode: "9001",
    cnCode: "900190",
    defaultBaseUnit: "UNITS",
    unitFamily: "COUNT",
    keywords: [
      "optical",
      "optics",
      "lens",
      "lenses",
      "prism",
      "laser",
      "photonics",
      "mirror",
    ],
  },
  {
    code: "PACKAGING_CORRUGATED",
    label: "Industrial Packaging & Corrugated",
    hsCode: "4819",
    cnCode: "481910",
    defaultBaseUnit: "TONNES",
    unitFamily: "MASS",
    keywords: [
      "packaging",
      "corrugated",
      "cardboard",
      "carton",
      "pallet",
      "crate",
      "box",
      "boxes",
    ],
  },
] as const;

export const KULGO_TAXONOMY_BY_CODE: ReadonlyMap<
  StandardizedCategoryCode,
  TaxonomyCategoryDefinition
> = new Map(KULGO_MATERIAL_TAXONOMY.map((item) => [item.code, item]));

export function inferUnitFamilyFromVolumeUnit(unit: VolumeUnit): UnitFamily {
  switch (unit) {
    case "TONNES":
    case "KG":
      return "MASS";
    case "UNITS":
      return "COUNT";
    case "LITERS":
      return "VOLUME";
    case "EUR_VALUE":
      return "CURRENCY";
  }
}

export function tokenizeMaterialText(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/**
 * Resolves a free-text material category, capability, or taxonomy code/label
 * to one or more matching standardized taxonomy categories, ordered by score.
 */
export function matchStandardizedCategories(
  rawText: string,
): Array<{ code: StandardizedCategoryCode; score: number }> {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return [];

  const upperCode = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  const exactCode = KULGO_TAXONOMY_BY_CODE.get(
    upperCode as StandardizedCategoryCode,
  );
  if (exactCode) {
    return [{ code: exactCode.code, score: 100 }];
  }

  const normalized = trimmed.toLowerCase();
  const tokens = new Set(tokenizeMaterialText(normalized));
  const matches: Array<{ code: StandardizedCategoryCode; score: number }> = [];

  for (const def of KULGO_MATERIAL_TAXONOMY) {
    if (def.label.toLowerCase() === normalized) {
      matches.push({ code: def.code, score: 100 });
      continue;
    }

    let score = 0;
    if (normalized === def.hsCode || normalized === def.cnCode) {
      score = 95;
    } else {
      for (const kw of def.keywords) {
        if (kw.includes(" ")) {
          if (normalized.includes(kw)) {
            score = Math.max(score, 85);
          }
        } else if (tokens.has(kw)) {
          score = Math.max(score, 75);
        } else if (kw.length >= 5 && Array.from(tokens).some((t) => t.startsWith(kw) && t.length <= kw.length + 4)) {
          score = Math.max(score, 62);
        }
      }
      // Bonus for multiple keyword hits
      let hitCount = 0;
      for (const kw of def.keywords) {
        if (
          (kw.includes(" ") && normalized.includes(kw)) ||
          tokens.has(kw)
        ) {
          hitCount += 1;
        }
      }
      if (hitCount >= 2 && score > 0) {
        score = Math.min(95, score + 10);
      }
    }

    if (score > 0) {
      matches.push({ code: def.code, score });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return matches;
}

export function resolveStandardizedCategory(
  rawText: string,
): StandardizedCategoryCode | null {
  const matches = matchStandardizedCategories(rawText);
  return matches[0]?.code ?? null;
}

export const CatalogueCapacityBandSchema = z.enum([
  "SMALL",
  "MEDIUM",
  "LARGE",
  "ENTERPRISE",
]);
export type CatalogueCapacityBand = z.infer<typeof CatalogueCapacityBandSchema>;

export const CatalogueItemSchema = z
  .object({
    itemId: z.string().uuid(),
    orgId: z.string().uuid(),
    standardizedCategory: StandardizedCategoryCodeSchema,
    productTitle: z.string().trim().min(1).max(160),
    sku: z.string().trim().min(1).max(64).nullable().default(null),
    baseUnit: VolumeUnitSchema.default("TONNES"),
    unitFamily: UnitFamilySchema.default("MASS"),
    productEmissionFactorTco2ePerUnit: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .default(null),
    pcfVerified: z.boolean().default(false),
    specs: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    leadTimeDays: z.number().int().min(0).max(365).nullable().default(null),
    moq: z.number().finite().nonnegative().nullable().default(null),
    capacityBand: CatalogueCapacityBandSchema.nullable().default(null),
    certifications: z
      .array(z.string().trim().min(1).max(64))
      .max(20)
      .default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type CatalogueItem = z.infer<typeof CatalogueItemSchema>;

export const CreateCatalogueItemInputSchema = z
  .object({
    standardizedCategory: StandardizedCategoryCodeSchema,
    productTitle: z.string().trim().min(1).max(160),
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    baseUnit: VolumeUnitSchema.optional(),
    unitFamily: UnitFamilySchema.optional(),
    productEmissionFactorTco2ePerUnit: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .optional(),
    pcfVerified: z.boolean().optional(),
    specs: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
    moq: z.number().finite().nonnegative().nullable().optional(),
    capacityBand: CatalogueCapacityBandSchema.nullable().optional(),
    certifications: z
      .array(z.string().trim().min(1).max(64))
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.baseUnit && val.unitFamily && val.unitFamily !== inferUnitFamilyFromVolumeUnit(val.baseUnit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitFamily"],
        message: "Incompatible baseUnit and unitFamily",
      });
    }
    if (val.pcfVerified === true && (val.productEmissionFactorTco2ePerUnit === undefined || val.productEmissionFactorTco2ePerUnit === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pcfVerified"],
        message: "pcfVerified requires productEmissionFactorTco2ePerUnit",
      });
    }
  });
export type CreateCatalogueItemInput = z.infer<
  typeof CreateCatalogueItemInputSchema
>;

export const UpdateCatalogueItemInputSchema = z
  .object({
    standardizedCategory: StandardizedCategoryCodeSchema.optional(),
    productTitle: z.string().trim().min(1).max(160).optional(),
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    baseUnit: VolumeUnitSchema.optional(),
    unitFamily: UnitFamilySchema.optional(),
    productEmissionFactorTco2ePerUnit: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .optional(),
    pcfVerified: z.boolean().optional(),
    specs: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
    moq: z.number().finite().nonnegative().nullable().optional(),
    capacityBand: CatalogueCapacityBandSchema.nullable().optional(),
    certifications: z
      .array(z.string().trim().min(1).max(64))
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.baseUnit && val.unitFamily && val.unitFamily !== inferUnitFamilyFromVolumeUnit(val.baseUnit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitFamily"],
        message: "Incompatible baseUnit and unitFamily",
      });
    }
    if (val.pcfVerified === true && val.productEmissionFactorTco2ePerUnit === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pcfVerified"],
        message: "pcfVerified cannot be true when productEmissionFactorTco2ePerUnit is null",
      });
    }
  });

export type UpdateCatalogueItemInput = z.infer<
  typeof UpdateCatalogueItemInputSchema
>;

export const ListCatalogueItemsResponseSchema = z
  .object({
    items: z.array(CatalogueItemSchema),
  })
  .strict();
export type ListCatalogueItemsResponse = z.infer<
  typeof ListCatalogueItemsResponseSchema
>;

export const CatalogueItemResponseSchema = z
  .object({
    item: CatalogueItemSchema,
  })
  .strict();
export type CatalogueItemResponse = z.infer<typeof CatalogueItemResponseSchema>;

export const BulkCatalogueImportErrorSchema = z
  .object({
    row: z.number().int().positive(),
    field: z.string().optional(),
    message: z.string().min(1),
  })
  .strict();
export type BulkCatalogueImportError = z.infer<
  typeof BulkCatalogueImportErrorSchema
>;

export const BulkCatalogueImportResultSchema = z
  .object({
    createdCount: z.number().int().nonnegative(),
    items: z.array(CatalogueItemSchema),
    errors: z.array(BulkCatalogueImportErrorSchema),
  })
  .strict();
export type BulkCatalogueImportResult = z.infer<
  typeof BulkCatalogueImportResultSchema
>;

export const TaxonomyResponseSchema = z
  .object({
    categories: z.array(
      z
        .object({
          code: StandardizedCategoryCodeSchema,
          label: z.string(),
          hsCode: z.string(),
          cnCode: z.string(),
          defaultBaseUnit: VolumeUnitSchema,
          unitFamily: UnitFamilySchema,
          keywords: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type TaxonomyResponse = z.infer<typeof TaxonomyResponseSchema>;

/**
 * Public-only snippet of a matched supplier catalogue item exposed in
 * "See alternatives (x)". Never exposes private org revenue, buyers, or emails.
 */
export const AlternativeCatalogueSnippetSchema = z
  .object({
    itemId: z.string().uuid(),
    standardizedCategory: StandardizedCategoryCodeSchema,
    categoryLabel: z.string(),
    productTitle: z.string(),
    baseUnit: VolumeUnitSchema,
    unitFamily: UnitFamilySchema,
    productEmissionFactorTco2ePerUnit: z.number().nonnegative().nullable(),
    pcfVerified: z.boolean(),
    specs: z.array(z.string()),
    leadTimeDays: z.number().int().nonnegative().nullable(),
    moq: z.number().nonnegative().nullable(),
    capacityBand: CatalogueCapacityBandSchema.nullable(),
    certifications: z.array(z.string()),
  })
  .strict();
export type AlternativeCatalogueSnippet = z.infer<
  typeof AlternativeCatalogueSnippetSchema
>;

/**
 * Ranked alternative supplier returned by
 * `GET /api/v1/directory/alternatives/for-facility/:facilityId`.
 */
export const AlternativeMatchSchema = z
  .object({
    orgId: z.string().uuid(),
    name: z.string().min(1).max(160),
    countryCode: z.string().length(2),
    riskStatus: RiskStatusSchema,
    esgBadges: z.array(z.string()),
    certifications: z.array(z.string()),
    capabilities: z.array(z.string()),
    source: z.enum(["KULGO_DIRECTORY", "SEEDED_DIRECTORY"]),
    matchScore: z.number().min(0).max(100),
    matchReason: z.string().min(1).max(240),
    matchedCatalogueItems: z.array(AlternativeCatalogueSnippetSchema),
    estimatedDistanceKm: z.number().nonnegative().nullable(),
    distanceDeltaKm: z.number().nullable(),
    estimatedTransportCo2eDeltaT: z.number().nullable(),
  })
  .strict();
export type AlternativeMatch = z.infer<typeof AlternativeMatchSchema>;

export const FacilityAlternativesResponseSchema = z
  .object({
    facilityId: z.string().uuid(),
    materialCategories: z.array(z.string()),
    standardizedCategories: z.array(StandardizedCategoryCodeSchema),
    count: z.number().int().nonnegative(),
    alternatives: z.array(AlternativeMatchSchema),
  })
  .strict();
export type FacilityAlternativesResponse = z.infer<
  typeof FacilityAlternativesResponseSchema
>;

export const IntroRequestInputSchema = z
  .object({
    targetOrgId: z.string().uuid(),
    materialCategory: z.string().trim().min(1).max(120),
    volumeBand: z.string().trim().min(1).max(80),
    unit: VolumeUnitSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type IntroRequestInput = z.infer<typeof IntroRequestInputSchema>;

export const IntroRequestResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    targetOrgId: z.string().uuid(),
    targetOrgName: z.string().min(1).max(160),
    status: z.enum(["SENT", "RECORDED", "SUPPRESSED"]),
    sentAt: z.string().datetime(),
  })
  .strict();
export type IntroRequestResponse = z.infer<typeof IntroRequestResponseSchema>;

export const EmailSuppressionSchema = z
  .object({
    emailHash: z.string().min(16).max(128),
    reason: z.enum(["UNSUBSCRIBE", "BOUNCE", "COMPLAINT"]),
    createdAt: z.string().datetime(),
  })
  .strict();
export type EmailSuppression = z.infer<typeof EmailSuppressionSchema>;
