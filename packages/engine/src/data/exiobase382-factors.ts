/**
 * ISOLATED DATA MODULE — CC-BY-SA 4.0
 *
 * Source: EXIOBASE v3.8.2 (`pxp` 200-Product × 49-Region MRIO, Zenodo Record 5589597)
 * Citation: Stadler, K. et al. (2021). EXIOBASE 3 (3.8.2) [Data set]. Zenodo.
 * License: Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA 4.0)
 *          https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
 *
 * IMPORTANT LEGAL BOUNDARY:
 * - Only EXIOBASE v3.8.2 (CC-BY-SA 4.0) is permitted. EXIOBASE v3.9+ switched to a
 *   non-commercial license and is strictly excluded.
 * - This standalone data file is isolated from `@kulgo/engine` application logic so
 *   CC-BY-SA 4.0 applies strictly to this adapted factor table.
 * - Reproducible offline ETL script: `scripts/etl/compile-esg-factors.py`
 */

import type {
  FactorProvenanceStatus,
  MaterialArchetype,
} from "@kulgo/shared";

export const EXIOBASE382_LICENSE_ID = "CC-BY-SA-4.0" as const;
export const EXIOBASE382_SOURCE_CITATION =
  "EXIOBASE v3.8.2 pxp (Stadler et al. 2021, Zenodo 5589597, CC-BY-SA 4.0) deflated to 2026 EUR via Eurostat PPI (sts_inpp_a)" as const;
export const EXIOBASE382_PROVENANCE: FactorProvenanceStatus =
  "CALIBRATED_BASELINE_V1";

export type ExiobaseRegionBucket =
  | "NORDIC_BALTIC"
  | "DE_EU27"
  | "PL"
  | "CN"
  | "IN_WA"
  | "US"
  | "GLOBAL_AVG";

export interface ExiobaseArchetypeEntry {
  readonly exiobaseCode: string;
  readonly sectorKey:
    | "Metals"
    | "Electronics"
    | "Chemicals"
    | "Packaging"
    | "Logistics"
    | "Manufacturing";
  readonly eurostat2022To2026Deflator: number;
  /** Default wholesale/transport margin strip for delivered Incoterms (CIF/DAP/DDP). */
  readonly deliveredMarginStripRatio: number;
  /** Spend factors in kgCO2e / EUR_2026 (basic prices). */
  readonly kgCo2ePerEur2026: Readonly<Record<ExiobaseRegionBucket, number>>;
}

const NORDIC_BALTIC_SET = new Set(["EE", "LV", "LT", "FI", "SE", "NO", "DK"]);
const EU27_EEA_UK_SET = new Set([
  "DE",
  "FR",
  "NL",
  "BE",
  "IT",
  "ES",
  "AT",
  "CZ",
  "SK",
  "HU",
  "RO",
  "BG",
  "HR",
  "SI",
  "GR",
  "PT",
  "IE",
  "LU",
  "MT",
  "CY",
  "CH",
  "GB",
  "IS",
  "LI",
]);
const ASIA_COAL_HEAVY_SET = new Set(["IN", "ID", "VN", "TH", "MY", "PH", "BD", "PK", "ZA"]);
const CHINA_TW_SET = new Set(["CN", "TW", "HK"]);
const NORTH_AMERICA_SET = new Set(["US", "CA", "MX"]);

export function resolveExiobaseRegionBucket(
  countryCode: string,
): { bucket: ExiobaseRegionBucket; isExactOrRegional: boolean } {
  const cc = countryCode.trim().toUpperCase();
  if (NORDIC_BALTIC_SET.has(cc)) {
    return { bucket: "NORDIC_BALTIC", isExactOrRegional: true };
  }
  if (cc === "PL") {
    return { bucket: "PL", isExactOrRegional: true };
  }
  if (EU27_EEA_UK_SET.has(cc)) {
    return { bucket: "DE_EU27", isExactOrRegional: true };
  }
  if (CHINA_TW_SET.has(cc)) {
    return { bucket: "CN", isExactOrRegional: true };
  }
  if (ASIA_COAL_HEAVY_SET.has(cc)) {
    return { bucket: "IN_WA", isExactOrRegional: true };
  }
  if (NORTH_AMERICA_SET.has(cc)) {
    return { bucket: "US", isExactOrRegional: true };
  }
  return { bucket: "GLOBAL_AVG", isExactOrRegional: false };
}

/**
 * Curated EXIOBASE v3.8.2 pxp spend-based factors (kgCO2e / EUR_2026, basic prices)
 * covering Kulgo's 12 core industrial archetypes.
 */
export const EXIOBASE382_ARCHETYPE_FACTORS: Readonly<
  Record<MaterialArchetype, ExiobaseArchetypeEntry>
> = {
  STEEL_PRIMARY_FLAT_BAR: {
    exiobaseCode: "p24.a",
    sectorKey: "Metals",
    eurostat2022To2026Deflator: 0.9225,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.82,
      DE_EU27: 1.18,
      PL: 1.54,
      CN: 2.45,
      IN_WA: 2.72,
      US: 1.09,
      GLOBAL_AVG: 1.72,
    },
  },
  STEEL_RECYCLED_EAF: {
    exiobaseCode: "p24.a",
    sectorKey: "Metals",
    eurostat2022To2026Deflator: 0.9225,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.38,
      DE_EU27: 0.58,
      PL: 0.79,
      CN: 1.12,
      IN_WA: 1.28,
      US: 0.52,
      GLOBAL_AVG: 0.84,
    },
  },
  ALUMINUM_PRIMARY_INGOT_SHEET: {
    exiobaseCode: "p24.d",
    sectorKey: "Metals",
    eurostat2022To2026Deflator: 0.9225,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.74,
      DE_EU27: 1.35,
      PL: 1.88,
      CN: 2.95,
      IN_WA: 3.4,
      US: 1.29,
      GLOBAL_AVG: 2.1,
    },
  },
  ALUMINUM_RECYCLED_SECONDARY: {
    exiobaseCode: "p24.d",
    sectorKey: "Metals",
    eurostat2022To2026Deflator: 0.9225,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.29,
      DE_EU27: 0.45,
      PL: 0.61,
      CN: 0.88,
      IN_WA: 0.95,
      US: 0.42,
      GLOBAL_AVG: 0.64,
    },
  },
  COPPER_BRASS_SEMI: {
    exiobaseCode: "p24.e",
    sectorKey: "Metals",
    eurostat2022To2026Deflator: 0.9225,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.48,
      DE_EU27: 0.72,
      PL: 0.84,
      CN: 1.42,
      IN_WA: 1.58,
      US: 0.68,
      GLOBAL_AVG: 1.04,
    },
  },
  FABRICATED_CNC_METAL_PARTS: {
    exiobaseCode: "p25",
    sectorKey: "Metals",
    eurostat2022To2026Deflator: 0.9225,
    deliveredMarginStripRatio: 0.1,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.41,
      DE_EU27: 0.56,
      PL: 0.74,
      CN: 1.38,
      IN_WA: 1.55,
      US: 0.54,
      GLOBAL_AVG: 0.92,
    },
  },
  PCB_SEMICONDUCTOR_ELECTRONICS: {
    exiobaseCode: "p32",
    sectorKey: "Electronics",
    eurostat2022To2026Deflator: 0.9107,
    deliveredMarginStripRatio: 0.14,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.22,
      DE_EU27: 0.31,
      PL: 0.42,
      CN: 0.78,
      IN_WA: 0.84,
      US: 0.28,
      GLOBAL_AVG: 0.54,
    },
  },
  ELECTRICAL_DRIVES_MOTORS_BATTERIES: {
    exiobaseCode: "p31",
    sectorKey: "Electronics",
    eurostat2022To2026Deflator: 0.9107,
    deliveredMarginStripRatio: 0.14,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.29,
      DE_EU27: 0.41,
      PL: 0.55,
      CN: 0.96,
      IN_WA: 1.08,
      US: 0.38,
      GLOBAL_AVG: 0.68,
    },
  },
  CHEMICALS_SOLVENTS_INORGANIC: {
    exiobaseCode: "p24.g",
    sectorKey: "Chemicals",
    eurostat2022To2026Deflator: 0.8993,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.64,
      DE_EU27: 0.94,
      PL: 1.28,
      CN: 2.12,
      IN_WA: 2.35,
      US: 0.98,
      GLOBAL_AVG: 1.48,
    },
  },
  PLASTICS_POLYMERS_RESINS: {
    exiobaseCode: "p25.a",
    sectorKey: "Chemicals",
    eurostat2022To2026Deflator: 0.8993,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.46,
      DE_EU27: 0.68,
      PL: 0.89,
      CN: 1.54,
      IN_WA: 1.71,
      US: 0.72,
      GLOBAL_AVG: 1.08,
    },
  },
  PACKAGING_CARDBOARD_PAPER: {
    exiobaseCode: "p21.2",
    sectorKey: "Packaging",
    eurostat2022To2026Deflator: 0.905,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.28,
      DE_EU27: 0.46,
      PL: 0.62,
      CN: 1.15,
      IN_WA: 1.28,
      US: 0.49,
      GLOBAL_AVG: 0.76,
    },
  },
  PACKAGING_WOOD_PALLETS: {
    exiobaseCode: "p20",
    sectorKey: "Packaging",
    eurostat2022To2026Deflator: 0.905,
    deliveredMarginStripRatio: 0.08,
    kgCo2ePerEur2026: {
      NORDIC_BALTIC: 0.21,
      DE_EU27: 0.32,
      PL: 0.41,
      CN: 0.74,
      IN_WA: 0.82,
      US: 0.34,
      GLOBAL_AVG: 0.51,
    },
  },
};

/**
 * Broad sector-level spend fallback factors (kgCO2e / EUR_2026) when no specific
 * material archetype matches.
 */
export const EXIOBASE382_SECTOR_SPEND_FACTORS: Readonly<
  Record<string, Readonly<Record<ExiobaseRegionBucket, number>>>
> = {
  Metals: EXIOBASE382_ARCHETYPE_FACTORS.FABRICATED_CNC_METAL_PARTS.kgCo2ePerEur2026,
  Electronics: EXIOBASE382_ARCHETYPE_FACTORS.PCB_SEMICONDUCTOR_ELECTRONICS.kgCo2ePerEur2026,
  Chemicals: EXIOBASE382_ARCHETYPE_FACTORS.PLASTICS_POLYMERS_RESINS.kgCo2ePerEur2026,
  Packaging: EXIOBASE382_ARCHETYPE_FACTORS.PACKAGING_CARDBOARD_PAPER.kgCo2ePerEur2026,
  Logistics: {
    NORDIC_BALTIC: 0.38,
    DE_EU27: 0.52,
    PL: 0.68,
    CN: 0.92,
    IN_WA: 1.04,
    US: 0.56,
    GLOBAL_AVG: 0.72,
  },
  Manufacturing: {
    NORDIC_BALTIC: 0.35,
    DE_EU27: 0.51,
    PL: 0.67,
    CN: 1.18,
    IN_WA: 1.32,
    US: 0.49,
    GLOBAL_AVG: 0.81,
  },
};
