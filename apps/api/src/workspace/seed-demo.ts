import type { WorkspaceNetworkResponse } from "@kulgo/shared";
import { assertOrgId, type WorkspaceRepository } from "./repository.js";

const DEMO_PRODUCT_SKU = "KUL-PX-01";

/**
 * Idempotently seeds the Estonia "Product X" demo supply network for the
 * authenticated organization:
 * - Product X (Tallinn precision industrial electronics assembly)
 * - 6 SupplyInputs (Material A through Material F)
 * - 6 Facilities: Tallinn HQ (EE, own, SITE_VERIFIED) + EE/LV/FI/DE/CN suppliers
 *   with a mix of SITE_VERIFIED and HQ_ESTIMATED precision
 * - 7 SupplyLanes with volume splits, EUR spend, contract end dates,
 *   Green lanes (EE/FI/DE), Yellow China corridor risk, and Red Latvian sanctions risk.
 */
export async function seedEstoniaProductXDemo(
  repo: WorkspaceRepository,
  orgId: string,
): Promise<WorkspaceNetworkResponse> {
  const safeOrgId = assertOrgId(orgId);

  const existingProducts = await repo.listProducts(safeOrgId);
  const alreadySeeded = existingProducts.some(
    (p) => p.sku === DEMO_PRODUCT_SKU || p.name === "Product X",
  );
  if (alreadySeeded) {
    return repo.getNetwork(safeOrgId);
  }

  const productX = await repo.createProduct(safeOrgId, {
    name: "Product X",
    sku: DEMO_PRODUCT_SKU,
    description:
      "Precision industrial electronics assembly manufactured in Tallinn, Estonia.",
  });

  const [
    materialA,
    materialB,
    materialC,
    materialD,
    materialE,
    materialF,
  ] = await Promise.all([
    repo.createInput(safeOrgId, {
      productId: productX.productId,
      name: "Material A",
      category: "Precision Machined Enclosures",
      unit: "TONNES",
    }),
    repo.createInput(safeOrgId, {
      productId: productX.productId,
      name: "Material B",
      category: "Specialty Polymer Insulation",
      unit: "TONNES",
    }),
    repo.createInput(safeOrgId, {
      productId: productX.productId,
      name: "Material C",
      category: "Power Semiconductor Modules",
      unit: "TONNES",
    }),
    repo.createInput(safeOrgId, {
      productId: productX.productId,
      name: "Material D",
      category: "Optical Sensor Arrays",
      unit: "TONNES",
    }),
    repo.createInput(safeOrgId, {
      productId: productX.productId,
      name: "Material E",
      category: "Industrial Control PCBs",
      unit: "TONNES",
    }),
    repo.createInput(safeOrgId, {
      productId: productX.productId,
      name: "Material F",
      category: "Rare-Earth Magnet Subassemblies",
      unit: "TONNES",
    }),
  ]);

  const [
    tallinnHq,
    tartuSupplier,
    rigaSupplier,
    tampereSupplier,
    hamburgSupplier,
    shenzhenSupplier,
  ] = await Promise.all([
    repo.createFacility(safeOrgId, {
      name: "Tallinn HQ & Assembly Plant",
      kind: "HQ",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      regionCode: "EE-37",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
      sector: "Electronics",
      esgBadges: ["ISO 14001", "EU CSRD Ready"],
      estimatedScope12Tco2e: 310,
    }),
    repo.createFacility(safeOrgId, {
      name: "Tartu Precision Metalworks",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      regionCode: "EE-79",
      lat: 58.378,
      lng: 26.729,
      isOwnFacility: false,
      sector: "Metals",
      esgBadges: ["ISO 14001"],
      estimatedScope12Tco2e: 420,
    }),
    repo.createFacility(safeOrgId, {
      name: "Riga Baltic Polymers",
      kind: "HQ",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "LV",
      regionCode: "LV-RIX",
      lat: 56.9496,
      lng: 24.1052,
      isOwnFacility: false,
      sector: "Chemicals",
      esgBadges: [],
      estimatedScope12Tco2e: 680,
    }),
    repo.createFacility(safeOrgId, {
      name: "Tampere Nordic Photonics",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "FI",
      regionCode: "FI-11",
      lat: 61.4978,
      lng: 23.761,
      isOwnFacility: false,
      sector: "Electronics",
      esgBadges: ["ISO 14001", "RE100"],
      estimatedScope12Tco2e: 240,
    }),
    repo.createFacility(safeOrgId, {
      name: "Hamburg Mechatronics GmbH",
      kind: "HQ",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "DE",
      regionCode: "DE-HH",
      lat: 53.5511,
      lng: 9.9937,
      isOwnFacility: false,
      sector: "Electronics",
      esgBadges: ["ISO 14001", "EcoVadis Silver"],
      estimatedScope12Tco2e: 510,
    }),
    repo.createFacility(safeOrgId, {
      name: "Shenzhen Pacific Magnetics",
      kind: "HQ",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "CN",
      regionCode: "CN-GD",
      lat: 22.5431,
      lng: 114.0579,
      isOwnFacility: false,
      sector: "Electronics",
      esgBadges: [],
      estimatedScope12Tco2e: 1120,
    }),
  ]);

  await Promise.all([
    repo.createLane(safeOrgId, {
      fromFacilityId: tartuSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialA.inputId,
      materialCategory: materialA.category,
      transportMode: "ROAD",
      volumeSharePct: 100,
      annualVolume: 180,
      volumeUnit: "TONNES",
      annualSpendEur: 420000,
      contractEndDate: "2027-06-30",
      contractTerms: "Net 30, DDP Tallinn",
      leadTimeDays: 3,
      riskStatus: "GREEN",
      riskReason: null,
    }),
    repo.createLane(safeOrgId, {
      fromFacilityId: rigaSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialB.inputId,
      materialCategory: materialB.category,
      transportMode: "ROAD",
      volumeSharePct: 100,
      annualVolume: 95,
      volumeUnit: "TONNES",
      annualSpendEur: 310000,
      contractEndDate: "2026-09-30",
      contractTerms: "Net 30, FCA Riga",
      leadTimeDays: 5,
      riskStatus: "RED",
      riskReason:
        "Latvian supplier flagged for secondary sanctions exposure linked to upstream petrochemical feedstock.",
    }),
    repo.createLane(safeOrgId, {
      fromFacilityId: tampereSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialC.inputId,
      materialCategory: materialC.category,
      transportMode: "SEA",
      volumeSharePct: 60,
      annualVolume: 60,
      volumeUnit: "TONNES",
      annualSpendEur: 540000,
      contractEndDate: "2027-12-31",
      contractTerms: "Net 45, CIF Tallinn",
      leadTimeDays: 6,
      riskStatus: "GREEN",
      riskReason: null,
    }),
    repo.createLane(safeOrgId, {
      fromFacilityId: hamburgSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialC.inputId,
      materialCategory: materialC.category,
      transportMode: "MULTIMODAL",
      volumeSharePct: 40,
      annualVolume: 40,
      volumeUnit: "TONNES",
      annualSpendEur: 390000,
      contractEndDate: "2027-03-31",
      contractTerms: "Net 45, DAP Tallinn",
      leadTimeDays: 9,
      riskStatus: "GREEN",
      riskReason: null,
    }),
    repo.createLane(safeOrgId, {
      fromFacilityId: tampereSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialD.inputId,
      materialCategory: materialD.category,
      transportMode: "SEA",
      volumeSharePct: 100,
      annualVolume: 45,
      volumeUnit: "TONNES",
      annualSpendEur: 480000,
      contractEndDate: "2027-11-30",
      contractTerms: "Net 45, CIF Tallinn",
      leadTimeDays: 7,
      riskStatus: "GREEN",
      riskReason: null,
    }),
    repo.createLane(safeOrgId, {
      fromFacilityId: hamburgSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialE.inputId,
      materialCategory: materialE.category,
      transportMode: "RAIL",
      volumeSharePct: 100,
      annualVolume: 75,
      volumeUnit: "TONNES",
      annualSpendEur: 620000,
      contractEndDate: "2027-08-31",
      contractTerms: "Net 30, DAP Tallinn",
      leadTimeDays: 10,
      riskStatus: "GREEN",
      riskReason: null,
    }),
    repo.createLane(safeOrgId, {
      fromFacilityId: shenzhenSupplier.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: materialF.inputId,
      materialCategory: materialF.category,
      transportMode: "SEA",
      volumeSharePct: 100,
      annualVolume: 120,
      volumeUnit: "TONNES",
      annualSpendEur: 890000,
      contractEndDate: "2026-12-15",
      contractTerms: "Net 60, FOB Shenzhen",
      leadTimeDays: 38,
      riskStatus: "YELLOW",
      riskReason:
        "China maritime corridor geopolitical tension and Red Sea transit congestion risk.",
    }),
  ]);

  return repo.getNetwork(safeOrgId);
}
