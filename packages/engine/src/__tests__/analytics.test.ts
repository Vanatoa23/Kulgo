import type {
  Facility,
  RiskSignal,
  SupplyInput,
  SupplyLane,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import {
  evaluateNetworkAnalytics,
  simulateNetworkAnalytics,
} from "../analytics.js";
import { isPointInWktPolygon, parseWktPolygon } from "../geo.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROD_ID = "22222222-2222-4222-8222-222222222221";
const INPUT_POLYMER_ID = "33333333-3333-4333-8333-333333333331";
const INPUT_CHIPS_ID = "33333333-3333-4333-8333-333333333332";
const FAC_HQ_ID = "44444444-4444-4444-8444-444444444441";
const FAC_RIGA_ID = "44444444-4444-4444-8444-444444444442";
const FAC_TAMPERE_ID = "44444444-4444-4444-8444-444444444443";
const FAC_HAMBURG_ID = "44444444-4444-4444-8444-444444444444";
const LANE_RIGA_ID = "55555555-5555-4555-8555-555555555551";
const LANE_TAMPERE_ID = "55555555-5555-4555-8555-555555555552";
const LANE_HAMBURG_ID = "55555555-5555-4555-8555-555555555553";

const LATVIA_SIGNAL: RiskSignal = {
  signalId: "sig-latvia-sanctions-01",
  kind: "SANCTIONS",
  severity: "RED",
  title: "Baltic / Latvia Secondary Sanctions Corridor",
  description: "Sanctions risk on upstream petrochemical feedstock.",
  regionCode: "LV-BALTIC",
  affectedCountryCodes: ["LV"],
  polygonWkt:
    "POLYGON ((20.9 55.6, 28.3 55.6, 28.3 58.1, 20.9 58.1, 20.9 55.6))",
  active: true,
};

const FACILITIES: Facility[] = [
  {
    facilityId: FAC_HQ_ID,
    ownerOrgId: ORG_ID,
    name: "Tallinn HQ",
    kind: "HQ",
    locationPrecision: "SITE_VERIFIED",
    countryCode: "EE",
    regionCode: "EE-37",
    lat: 59.437,
    lng: 24.7536,
    isOwnFacility: true,
    isPartnerVerified: false,
    sector: "Electronics",
    esgBadges: ["ISO 14001"],
    estimatedScope12Tco2e: 300,
  },
  {
    facilityId: FAC_RIGA_ID,
    ownerOrgId: ORG_ID,
    name: "Riga Polymers",
    kind: "FACTORY",
    locationPrecision: "HQ_ESTIMATED",
    countryCode: "LV",
    regionCode: "LV-RIX",
    lat: 56.9496,
    lng: 24.1052,
    isOwnFacility: false,
    isPartnerVerified: false,
    sector: "Chemicals",
    esgBadges: [],
    estimatedScope12Tco2e: 600,
  },
  {
    facilityId: FAC_TAMPERE_ID,
    ownerOrgId: ORG_ID,
    name: "Tampere Photonics",
    kind: "FACTORY",
    locationPrecision: "SITE_VERIFIED",
    countryCode: "FI",
    regionCode: "FI-11",
    lat: 61.4978,
    lng: 23.761,
    isOwnFacility: false,
    isPartnerVerified: true,
    sector: "Electronics",
    esgBadges: ["RE100"],
    estimatedScope12Tco2e: 250,
  },
  {
    facilityId: FAC_HAMBURG_ID,
    ownerOrgId: ORG_ID,
    name: "Hamburg Mechatronics",
    kind: "FACTORY",
    locationPrecision: "SITE_VERIFIED",
    countryCode: "DE",
    regionCode: "DE-HH",
    lat: 53.5511,
    lng: 9.9937,
    isOwnFacility: false,
    isPartnerVerified: false,
    sector: "Electronics",
    esgBadges: [],
    estimatedScope12Tco2e: 400,
  },
];

const INPUTS: SupplyInput[] = [
  {
    inputId: INPUT_POLYMER_ID,
    ownerOrgId: ORG_ID,
    productId: PROD_ID,
    name: "Material B",
    category: "Polymers",
    unit: "TONNES",
  },
  {
    inputId: INPUT_CHIPS_ID,
    ownerOrgId: ORG_ID,
    productId: PROD_ID,
    name: "Material C",
    category: "Semiconductors",
    unit: "TONNES",
  },
];

const LANES: SupplyLane[] = [
  {
    laneId: LANE_RIGA_ID,
    ownerOrgId: ORG_ID,
    fromFacilityId: FAC_RIGA_ID,
    toFacilityId: FAC_HQ_ID,
    inputId: INPUT_POLYMER_ID,
    materialCategory: "Polymers",
    transportMode: "ROAD",
    volumeSharePct: 100,
    annualVolume: 100,
    volumeUnit: "TONNES",
    annualSpendEur: 300000,
    contractEndDate: "2026-12-15",
    contractTerms: "Net 30",
    leadTimeDays: 5,
    distanceKm: 300,
    estimatedLaneCo2e: null,
    riskStatus: "RED",
    riskReason: "Latvian sanctions exposure",
  },
  {
    laneId: LANE_TAMPERE_ID,
    ownerOrgId: ORG_ID,
    fromFacilityId: FAC_TAMPERE_ID,
    toFacilityId: FAC_HQ_ID,
    inputId: INPUT_CHIPS_ID,
    materialCategory: "Semiconductors",
    transportMode: "AIR",
    volumeSharePct: 60,
    annualVolume: 60,
    volumeUnit: "TONNES",
    annualSpendEur: 500000,
    contractEndDate: "2028-06-30",
    contractTerms: "CIF Tallinn",
    leadTimeDays: 3,
    distanceKm: 250,
    estimatedLaneCo2e: null,
    riskStatus: "GREEN",
    riskReason: null,
  },
  {
    laneId: LANE_HAMBURG_ID,
    ownerOrgId: ORG_ID,
    fromFacilityId: FAC_HAMBURG_ID,
    toFacilityId: FAC_HQ_ID,
    inputId: INPUT_CHIPS_ID,
    materialCategory: "Semiconductors",
    transportMode: "ROAD",
    volumeSharePct: 40,
    annualVolume: 40,
    volumeUnit: "TONNES",
    annualSpendEur: 350000,
    contractEndDate: "2028-06-30",
    contractTerms: "DAP Tallinn",
    leadTimeDays: 7,
    distanceKm: 1100,
    estimatedLaneCo2e: null,
    riskStatus: "GREEN",
    riskReason: null,
  },
];

describe("geo WKT polygon helpers", () => {
  it("parses WKT polygon and detects Riga inside Latvia sanctions polygon", () => {
    const ring = parseWktPolygon(LATVIA_SIGNAL.polygonWkt);
    expect(ring.length).toBe(5);
    expect(
      isPointInWktPolygon(56.9496, 24.1052, LATVIA_SIGNAL.polygonWkt),
    ).toBe(true);
    expect(
      isPointInWktPolygon(61.4978, 23.761, LATVIA_SIGNAL.polygonWkt),
    ).toBe(false);
  });
});

describe("evaluateNetworkAnalytics & simulateNetworkAnalytics", () => {
  const asOfDate = new Date("2026-11-20T00:00:00Z");

  it("computes HHI, SPOF, contract expiry, RiskSignal alerts, and Scope 1/2/3 ESG", () => {
    const summary = evaluateNetworkAnalytics({
      organization: { scope1Tco2e: null, scope2Tco2e: null },
      inputs: INPUTS,
      facilities: FACILITIES,
      lanes: LANES,
      riskSignals: [LATVIA_SIGNAL],
      asOfDate,
    });

    expect(summary.overallStatus).toBe("RED");
    expect(summary.resilienceScore).toBeLessThan(70);

    // Material B is 100% single source (SPOF); Material C is 60/40 split (HHI = 5200)
    const matBHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL" && m.label.includes("Material B"),
    );
    const matCHhi = summary.hhiMetrics.find(
      (m) => m.dimension === "MATERIAL" && m.label.includes("Material C"),
    );
    expect(matBHhi?.rawHhi).toBe(10000);
    expect(matBHhi?.isSinglePointOfFailure).toBe(true);
    expect(matCHhi?.rawHhi).toBe(5200);
    expect(matCHhi?.isSinglePointOfFailure).toBe(false);

    // Alerts include SINGLE_SOURCE, CONTRACT_EXPIRY (25d), and SECONDARY_SANCTION (Latvia polygon)
    const categories = new Set(summary.alerts.map((a) => a.category));
    expect(categories.has("SINGLE_SOURCE")).toBe(true);
    expect(categories.has("CONTRACT_EXPIRY")).toBe(true);
    expect(categories.has("SECONDARY_SANCTION")).toBe(true);

    // Own Scope 1+2 derived from Tallinn HQ (300 -> 120 + 180)
    expect(summary.esg.scope1Tco2e).toBe(120);
    expect(summary.esg.scope2Tco2e).toBe(180);
    expect(summary.esg.upstreamScope3Tco2e).toBe(600 + 250 + 400);
    expect(summary.esg.transportScope3Tco2e).toBeGreaterThan(0);
    expect(summary.esg.verifiedCoveragePct).toBe(33);
    expect(summary.riskSignals).toHaveLength(1);
  });

  it("runs stateless what-if simulations returning accurate CO2e, HHI, and risk deltas", () => {
    const sim = simulateNetworkAnalytics(
      {
        organization: { scope1Tco2e: 120, scope2Tco2e: 180 },
        inputs: INPUTS,
        facilities: FACILITIES,
        lanes: LANES,
        riskSignals: [LATVIA_SIGNAL],
        asOfDate,
      },
      [
        // De-risk RED Latvia lane by setting volume share to 0%
        { laneId: LANE_RIGA_ID, volumeSharePct: 0 },
        // Switch Tampere from AIR to SEA and rebalance 50/50 with Hamburg
        { laneId: LANE_TAMPERE_ID, volumeSharePct: 50, transportMode: "SEA" },
        { laneId: LANE_HAMBURG_ID, volumeSharePct: 50, transportMode: "RAIL" },
      ],
    );

    expect(sim.appliedChangesCount).toBe(3);
    expect(sim.simulated.resilienceScore).toBeGreaterThan(
      sim.baseline.resilienceScore,
    );
    expect(sim.deltas.resilienceScoreDelta).toBeGreaterThan(0);
    expect(sim.deltas.redAlertCountDelta).toBeLessThan(0);
    expect(sim.deltas.spofCountDelta).toBe(-1);
    expect(sim.deltas.transportScope3Tco2eDelta).toBeLessThan(0);
    expect(sim.deltas.totalTco2eDelta).toBeLessThan(0);
    expect(sim.simulated.overallStatus).toBe("GREEN");
  });
});
