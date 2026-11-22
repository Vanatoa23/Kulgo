/**
 * ATTRIBUTION-ONLY / PUBLIC DOMAIN OPEN ESG FACTOR MATRIX (FACTOR_MATRIX_VERSION = "2026.1")
 *
 * Zero ShareAlike / Zero Non-Commercial Dependencies:
 * - Physical Materials: ADEME Base Carbone (Etalab Open Licence v2.0),
 *   UK DESNZ 2026 Conversion Factors (Open Government Licence v3.0),
 *   EU JRC CBAM Default Emission Intensities (JRC134682 / IR (EU) 2025/2621, EU CC-BY 4.0).
 * - North American Spend Supplement: US EPA Supply Chain GHG Factors v1.3 / USEEIO (CC0 1.0).
 * - Freight (Scope 3 Cat 4): UK DESNZ 2026 (OGL v3.0) & ADEME Base Carbone (Etalab v2.0),
 *   implementing ISO 14083 / GLEC v3.2 calculation methodology independently.
 * - Electricity Grid (Scope 2): EEA (CC-BY 4.0), UK DESNZ 2026 (OGL v3.0),
 *   US EPA eGRID (CC0), Ember Yearly Electricity Data 2026 (CC-BY 4.0), and AIB Residual Mix.
 */

import type {
  CbamCoveredCategory,
  EudrCommodity,
  FactorProvenanceStatus,
  MaterialArchetype,
  TransportMode,
} from "@kulgo/shared";

export interface PhysicalMaterialFactorEntry {
  readonly factorIdPrefix: string;
  readonly sourceCitation: string;
  readonly licenseId: string;
  readonly provenanceStatus: FactorProvenanceStatus;
  readonly cbamCategory: CbamCoveredCategory | null;
  readonly eudrCommodity: EudrCommodity | null;
  /** Fraction of cradle-to-gate emissions driven by grid electricity [0, 0.75] for renewable scaling. */
  readonly electricityShareOfTotal: number;
  /** Country/region overrides in tCO2e / tonne (numerically equal to kgCO2e / kg). */
  readonly tco2ePerTonneByGeo: Readonly<{
    EU_AVG: number;
    DE: number;
    CN: number;
    IN: number;
    NORDIC_LOW_CARBON: number;
  }>;
}

export const OPEN_PHYSICAL_FACTORS: Readonly<
  Record<MaterialArchetype, PhysicalMaterialFactorEntry>
> = {
  STEEL_PRIMARY_FLAT_BAR: {
    factorIdPrefix: "jrc_cbam_steel_primary",
    sourceCitation:
      "EU JRC CBAM Default Values (JRC134682 / IR (EU) 2025/2621, CC-BY 4.0) & UK DESNZ 2026 Material Use (OGL v3.0)",
    licenseId: "CC-BY-4.0 / OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: "IRON_STEEL",
    eudrCommodity: null,
    electricityShareOfTotal: 0.15,
    tco2ePerTonneByGeo: {
      EU_AVG: 2.21,
      DE: 1.95,
      CN: 2.73,
      IN: 3.15,
      NORDIC_LOW_CARBON: 0.62,
    },
  },
  STEEL_RECYCLED_EAF: {
    factorIdPrefix: "ademe_desnz_steel_eaf",
    sourceCitation:
      "ADEME Base Carbone (Etalab 2.0) & UK DESNZ 2026 Closed-Loop Steel (OGL v3.0)",
    licenseId: "Etalab-2.0 / OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: "IRON_STEEL",
    eudrCommodity: null,
    electricityShareOfTotal: 0.45,
    tco2ePerTonneByGeo: {
      EU_AVG: 0.47,
      DE: 0.55,
      CN: 0.98,
      IN: 1.15,
      NORDIC_LOW_CARBON: 0.31,
    },
  },
  ALUMINUM_PRIMARY_INGOT_SHEET: {
    factorIdPrefix: "jrc_cbam_aluminum_primary",
    sourceCitation:
      "EU JRC CBAM Default Values (JRC134682 / IR (EU) 2025/2621, CC-BY 4.0) & ADEME Base Carbone (Etalab 2.0)",
    licenseId: "CC-BY-4.0 / Etalab-2.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: "ALUMINUM",
    eudrCommodity: null,
    electricityShareOfTotal: 0.65,
    tco2ePerTonneByGeo: {
      EU_AVG: 6.75,
      DE: 6.83,
      CN: 14.8,
      IN: 16.4,
      NORDIC_LOW_CARBON: 1.85,
    },
  },
  ALUMINUM_RECYCLED_SECONDARY: {
    factorIdPrefix: "ademe_desnz_aluminum_recycled",
    sourceCitation:
      "ADEME Base Carbone (Etalab 2.0) & UK DESNZ 2026 Closed-Loop Aluminium (OGL v3.0)",
    licenseId: "Etalab-2.0 / OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: "ALUMINUM",
    eudrCommodity: null,
    electricityShareOfTotal: 0.35,
    tco2ePerTonneByGeo: {
      EU_AVG: 0.52,
      DE: 0.58,
      CN: 0.85,
      IN: 0.92,
      NORDIC_LOW_CARBON: 0.38,
    },
  },
  COPPER_BRASS_SEMI: {
    factorIdPrefix: "ademe_desnz_copper_semi",
    sourceCitation:
      "ADEME Base Carbone (Etalab 2.0) & UK DESNZ 2026 Primary Copper (OGL v3.0)",
    licenseId: "Etalab-2.0 / OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.3,
    tco2ePerTonneByGeo: {
      EU_AVG: 3.81,
      DE: 2.85,
      CN: 4.95,
      IN: 5.2,
      NORDIC_LOW_CARBON: 1.9,
    },
  },
  FABRICATED_CNC_METAL_PARTS: {
    factorIdPrefix: "ademe_fabricated_metal",
    sourceCitation:
      "ADEME Base Carbone Steel + Machining Composite (Etalab Open Licence v2.0)",
    licenseId: "Etalab-2.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.25,
    tco2ePerTonneByGeo: {
      EU_AVG: 2.65,
      DE: 2.4,
      CN: 3.35,
      IN: 3.7,
      NORDIC_LOW_CARBON: 1.15,
    },
  },
  PCB_SEMICONDUCTOR_ELECTRONICS: {
    factorIdPrefix: "ademe_pcb_electronics",
    sourceCitation:
      "ADEME Base Carbone Electronic Board & IC Manufacturing (Etalab Open Licence v2.0)",
    licenseId: "Etalab-2.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.4,
    tco2ePerTonneByGeo: {
      EU_AVG: 24.5,
      DE: 19.8,
      CN: 28.4,
      IN: 30.2,
      NORDIC_LOW_CARBON: 16.4,
    },
  },
  ELECTRICAL_DRIVES_MOTORS_BATTERIES: {
    factorIdPrefix: "ademe_desnz_electrical_eq",
    sourceCitation:
      "ADEME Base Carbone (Etalab 2.0) & UK DESNZ 2026 Electrical Equipment (OGL v3.0)",
    licenseId: "Etalab-2.0 / OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.3,
    tco2ePerTonneByGeo: {
      EU_AVG: 4.85,
      DE: 4.2,
      CN: 6.4,
      IN: 6.9,
      NORDIC_LOW_CARBON: 3.25,
    },
  },
  CHEMICALS_SOLVENTS_INORGANIC: {
    factorIdPrefix: "ademe_basic_chemicals",
    sourceCitation:
      "ADEME Base Carbone Basic Industrial Chemicals (Etalab Open Licence v2.0)",
    licenseId: "Etalab-2.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.25,
    tco2ePerTonneByGeo: {
      EU_AVG: 1.85,
      DE: 1.72,
      CN: 2.68,
      IN: 2.85,
      NORDIC_LOW_CARBON: 1.2,
    },
  },
  PLASTICS_POLYMERS_RESINS: {
    factorIdPrefix: "desnz2026_plastics_avg",
    sourceCitation:
      "UK DESNZ 2026 Conversion Factors — Average Plastics (OGL v3.0)",
    licenseId: "OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.25,
    tco2ePerTonneByGeo: {
      EU_AVG: 2.42,
      DE: 2.3,
      CN: 3.15,
      IN: 3.35,
      NORDIC_LOW_CARBON: 1.95,
    },
  },
  PACKAGING_CARDBOARD_PAPER: {
    factorIdPrefix: "desnz2026_board_paper",
    sourceCitation:
      "UK DESNZ 2026 Conversion Factors — Board & Paper Closed-Loop (OGL v3.0)",
    licenseId: "OGL-3.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: null,
    electricityShareOfTotal: 0.2,
    tco2ePerTonneByGeo: {
      EU_AVG: 0.82,
      DE: 0.78,
      CN: 1.25,
      IN: 1.38,
      NORDIC_LOW_CARBON: 0.64,
    },
  },
  PACKAGING_WOOD_PALLETS: {
    factorIdPrefix: "desnz_ademe_wood_pallets",
    sourceCitation:
      "UK DESNZ 2026 (OGL v3.0) & ADEME Base Carbone Fossil Timber Manufacturing (Etalab 2.0)",
    licenseId: "OGL-3.0 / Etalab-2.0",
    provenanceStatus: "OFFICIAL_PUBLISHED",
    cbamCategory: null,
    eudrCommodity: "WOOD_TIMBER",
    electricityShareOfTotal: 0.15,
    tco2ePerTonneByGeo: {
      EU_AVG: 0.31,
      DE: 0.31,
      CN: 0.48,
      IN: 0.52,
      NORDIC_LOW_CARBON: 0.24,
    },
  },
};

/**
 * US EPA Supply Chain GHG Emission Factors v1.3 (USEEIO, CC0 1.0 Public Domain)
 * normalized to kgCO2e / EUR_2026 for North American (US/CA/MX) suppliers.
 */
export const USEEIO_V13_NA_SPEND_FACTORS: Readonly<
  Record<MaterialArchetype, { factorId: string; kgCo2ePerEur2026: number; naicsCode: string }>
> = {
  STEEL_PRIMARY_FLAT_BAR: { factorId: "useeio_v13_naics331110_2026", kgCo2ePerEur2026: 1.09, naicsCode: "331110" },
  STEEL_RECYCLED_EAF: { factorId: "useeio_v13_naics331110_eaf_2026", kgCo2ePerEur2026: 0.52, naicsCode: "331110" },
  ALUMINUM_PRIMARY_INGOT_SHEET: { factorId: "useeio_v13_naics331313_2026", kgCo2ePerEur2026: 1.29, naicsCode: "331313" },
  ALUMINUM_RECYCLED_SECONDARY: { factorId: "useeio_v13_naics331314_2026", kgCo2ePerEur2026: 0.42, naicsCode: "331314" },
  COPPER_BRASS_SEMI: { factorId: "useeio_v13_naics331420_2026", kgCo2ePerEur2026: 0.68, naicsCode: "331420" },
  FABRICATED_CNC_METAL_PARTS: { factorId: "useeio_v13_naics332710_2026", kgCo2ePerEur2026: 0.54, naicsCode: "332710" },
  PCB_SEMICONDUCTOR_ELECTRONICS: { factorId: "useeio_v13_naics334412_2026", kgCo2ePerEur2026: 0.28, naicsCode: "334412" },
  ELECTRICAL_DRIVES_MOTORS_BATTERIES: { factorId: "useeio_v13_naics335312_2026", kgCo2ePerEur2026: 0.38, naicsCode: "335312" },
  CHEMICALS_SOLVENTS_INORGANIC: { factorId: "useeio_v13_naics325180_2026", kgCo2ePerEur2026: 0.98, naicsCode: "325180" },
  PLASTICS_POLYMERS_RESINS: { factorId: "useeio_v13_naics325211_2026", kgCo2ePerEur2026: 0.72, naicsCode: "325211" },
  PACKAGING_CARDBOARD_PAPER: { factorId: "useeio_v13_naics322211_2026", kgCo2ePerEur2026: 0.49, naicsCode: "322211" },
  PACKAGING_WOOD_PALLETS: { factorId: "useeio_v13_naics321920_2026", kgCo2ePerEur2026: 0.34, naicsCode: "321920" },
};

export const USEEIO_V13_SOURCE_CITATION =
  "US EPA Supply Chain GHG Emission Factors v1.3 by NAICS-6 (USEEIO, CC0 1.0) converted to 2026 EUR via 2022 ECB FX & US BLS PPI" as const;
export const USEEIO_V13_LICENSE_ID = "CC0-1.0" as const;

export interface FreightFactorEntry {
  readonly factorId: string;
  readonly ttwKgPerTkm: number;
  readonly wttKgPerTkm: number;
  readonly wtwKgPerTkm: number;
  readonly haversineCircuityMultiplier: number;
  readonly haversineAdditiveKm: number;
  readonly hubPenaltyKgPerTonne: number;
  readonly sourceCitation: string;
  readonly licenseId: string;
}

/**
 * Freight factors sourced from UK DESNZ 2026 (OGL v3.0) & ADEME Base Carbone (Etalab 2.0),
 * implementing ISO 14083 / GLEC v3.2 TTW+WTT & circuity rules independently.
 */
export const OPEN_FREIGHT_FACTORS: Readonly<Record<TransportMode, FreightFactorEntry>> = {
  SEA: {
    factorId: "desnz2026_freight_sea_container",
    ttwKgPerTkm: 0.0128,
    wttKgPerTkm: 0.0032,
    wtwKgPerTkm: 0.016,
    haversineCircuityMultiplier: 1.15,
    haversineAdditiveKm: 0,
    hubPenaltyKgPerTonne: 2.4,
    sourceCitation: "UK DESNZ 2026 Freight Conversion Factors — Sea Container Avg (OGL v3.0)",
    licenseId: "OGL-3.0",
  },
  RAIL: {
    factorId: "desnz2026_ademe_freight_rail",
    ttwKgPerTkm: 0.0205,
    wttKgPerTkm: 0.0075,
    wtwKgPerTkm: 0.028,
    haversineCircuityMultiplier: 1.25,
    haversineAdditiveKm: 0,
    hubPenaltyKgPerTonne: 1.8,
    sourceCitation: "UK DESNZ 2026 (OGL v3.0) & ADEME Base Carbone Rail Freight (Etalab 2.0)",
    licenseId: "OGL-3.0 / Etalab-2.0",
  },
  ROAD: {
    factorId: "desnz2026_freight_road_hgv",
    ttwKgPerTkm: 0.0772,
    wttKgPerTkm: 0.0188,
    wtwKgPerTkm: 0.096,
    haversineCircuityMultiplier: 1.2,
    haversineAdditiveKm: 0,
    hubPenaltyKgPerTonne: 0.7,
    sourceCitation: "UK DESNZ 2026 Freight Conversion Factors — HGV All Types Avg Laden (OGL v3.0)",
    licenseId: "OGL-3.0",
  },
  AIR: {
    factorId: "desnz2026_freight_air_intl",
    ttwKgPerTkm: 0.495,
    wttKgPerTkm: 0.107,
    wtwKgPerTkm: 0.602,
    haversineCircuityMultiplier: 1.0,
    haversineAdditiveKm: 95,
    hubPenaltyKgPerTonne: 4.2,
    sourceCitation: "UK DESNZ 2026 Freight Conversion Factors — Long-Haul Air Cargo (OGL v3.0)",
    licenseId: "OGL-3.0",
  },
  MULTIMODAL: {
    factorId: "desnz2026_ademe_freight_multimodal",
    ttwKgPerTkm: 0.0515,
    wttKgPerTkm: 0.0135,
    wtwKgPerTkm: 0.065,
    haversineCircuityMultiplier: 1.2,
    haversineAdditiveKm: 0,
    hubPenaltyKgPerTonne: 3.1,
    sourceCitation: "UK DESNZ 2026 (OGL v3.0) & ADEME Multimodal Corridor Composite (Etalab 2.0)",
    licenseId: "OGL-3.0 / Etalab-2.0",
  },
};

export interface GridIntensityEntry {
  readonly locationTco2ePerMwh: number;
  readonly marketResidualTco2ePerMwh: number;
  readonly baselineRenewablePct: number;
  readonly accountingBasis: "OPERATIONAL_GENERATION" | "LIFECYCLE_SCREENING";
  readonly sourceCitation: string;
  readonly licenseId: string;
}

export const COUNTRY_GRID_FACTORS: Readonly<Record<string, GridIntensityEntry>> = {
  EE: { locationTco2ePerMwh: 0.312, marketResidualTco2ePerMwh: 0.518, baselineRenewablePct: 51.4, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  LV: { locationTco2ePerMwh: 0.145, marketResidualTco2ePerMwh: 0.412, baselineRenewablePct: 72.8, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  LT: { locationTco2ePerMwh: 0.158, marketResidualTco2ePerMwh: 0.445, baselineRenewablePct: 76.2, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  FI: { locationTco2ePerMwh: 0.042, marketResidualTco2ePerMwh: 0.315, baselineRenewablePct: 56.5, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  SE: { locationTco2ePerMwh: 0.018, marketResidualTco2ePerMwh: 0.072, baselineRenewablePct: 69.8, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  NO: { locationTco2ePerMwh: 0.016, marketResidualTco2ePerMwh: 0.468, baselineRenewablePct: 98.4, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  DK: { locationTco2ePerMwh: 0.105, marketResidualTco2ePerMwh: 0.452, baselineRenewablePct: 86.4, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  DE: { locationTco2ePerMwh: 0.338, marketResidualTco2ePerMwh: 0.562, baselineRenewablePct: 59.2, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  PL: { locationTco2ePerMwh: 0.595, marketResidualTco2ePerMwh: 0.748, baselineRenewablePct: 29.6, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  FR: { locationTco2ePerMwh: 0.044, marketResidualTco2ePerMwh: 0.088, baselineRenewablePct: 28.4, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  NL: { locationTco2ePerMwh: 0.248, marketResidualTco2ePerMwh: 0.468, baselineRenewablePct: 54.1, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  IT: { locationTco2ePerMwh: 0.285, marketResidualTco2ePerMwh: 0.485, baselineRenewablePct: 48.2, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  ES: { locationTco2ePerMwh: 0.132, marketResidualTco2ePerMwh: 0.295, baselineRenewablePct: 58.9, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 (CC-BY 4.0) & AIB 2025 Residual Mix", licenseId: "CC-BY-4.0" },
  GB: { locationTco2ePerMwh: 0.131, marketResidualTco2ePerMwh: 0.31, baselineRenewablePct: 51.8, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "UK DESNZ 2026 Electricity Generation (OGL v3.0)", licenseId: "OGL-3.0" },
  US: { locationTco2ePerMwh: 0.354, marketResidualTco2ePerMwh: 0.382, baselineRenewablePct: 24.2, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "US EPA eGRID National Output Rate (CC0 1.0)", licenseId: "CC0-1.0" },
  CN: { locationTco2ePerMwh: 0.536, marketResidualTco2ePerMwh: 0.555, baselineRenewablePct: 35.8, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  TW: { locationTco2ePerMwh: 0.528, marketResidualTco2ePerMwh: 0.542, baselineRenewablePct: 11.6, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  KR: { locationTco2ePerMwh: 0.415, marketResidualTco2ePerMwh: 0.432, baselineRenewablePct: 10.8, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  JP: { locationTco2ePerMwh: 0.448, marketResidualTco2ePerMwh: 0.462, baselineRenewablePct: 24.5, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  IN: { locationTco2ePerMwh: 0.708, marketResidualTco2ePerMwh: 0.725, baselineRenewablePct: 22.4, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  VN: { locationTco2ePerMwh: 0.482, marketResidualTco2ePerMwh: 0.498, baselineRenewablePct: 41.2, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  TR: { locationTco2ePerMwh: 0.412, marketResidualTco2ePerMwh: 0.44, baselineRenewablePct: 43.5, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  ZA: { locationTco2ePerMwh: 0.795, marketResidualTco2ePerMwh: 0.815, baselineRenewablePct: 13.2, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 (CC-BY 4.0, Lifecycle Screening)", licenseId: "CC-BY-4.0" },
  EU27: { locationTco2ePerMwh: 0.215, marketResidualTco2ePerMwh: 0.435, baselineRenewablePct: 49.5, accountingBasis: "OPERATIONAL_GENERATION", sourceCitation: "EEA / Ember 2026 EU-27 Average (CC-BY 4.0) & AIB 2025 Avg", licenseId: "CC-BY-4.0" },
  ROW: { locationTco2ePerMwh: 0.432, marketResidualTco2ePerMwh: 0.465, baselineRenewablePct: 32.5, accountingBasis: "LIFECYCLE_SCREENING", sourceCitation: "Ember Yearly Electricity Data 2026 Global Average (CC-BY 4.0)", licenseId: "CC-BY-4.0" },
};

export function resolveCountryGridFactor(countryCode: string): GridIntensityEntry {
  const cc = countryCode.trim().toUpperCase();
  return COUNTRY_GRID_FACTORS[cc] ?? COUNTRY_GRID_FACTORS.ROW!;
}
