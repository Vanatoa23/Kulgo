import { describe, expect, it } from "vitest";
import { RiskSignalSchema } from "@kulgo/shared";
import {
  CHOKEPOINT_REGISTRY,
  inferLaneChokepoints,
  matchFacilityRiskSignals,
  matchLaneRiskSignals,
  matchPartnerRegionRiskSignals,
} from "../chokepoints.js";
import { parseWktPolygon } from "../geo.js";

const makeSignal = (overrides: Record<string, unknown> = {}) =>
  RiskSignalSchema.parse({
    signalId: "sig-1",
    kind: "MARITIME_CHOKEPOINT",
    severity: "RED",
    title: "Red Sea transit disruption",
    polygonWkt: CHOKEPOINT_REGISTRY.RED_SEA_BAB_EL_MANDEB.polygonWkt,
    affectedChokepoints: ["RED_SEA_BAB_EL_MANDEB", "SUEZ_CANAL"],
    affectedCountryCodes: [],
    active: true,
    ...overrides,
  });

describe("CHOKEPOINT_REGISTRY", () => {
  it("defines valid WKT polygons for all 15 canonical chokepoints", () => {
    const entries = Object.values(CHOKEPOINT_REGISTRY);
    expect(entries).toHaveLength(15);
    for (const cp of entries) {
      const ring = parseWktPolygon(cp.polygonWkt);
      expect(ring.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("inferLaneChokepoints", () => {
  it("tags Asia -> EU SEA lanes with Malacca, Red Sea, Suez, and Baltic/Danish Straits for EE", () => {
    const cps = inferLaneChokepoints("CN", "EE", "SEA");
    expect(cps).toContain("MALACCA_STRAIT");
    expect(cps).toContain("RED_SEA_BAB_EL_MANDEB");
    expect(cps).toContain("SUEZ_CANAL");
    expect(cps).toContain("BALTIC_SEA");
    expect(cps).toContain("DANISH_STRAITS");
  });

  it("tags intra-Baltic SEA lanes with BALTIC_SEA only", () => {
    const cps = inferLaneChokepoints("EE", "FI", "SEA");
    expect(cps).toEqual(["BALTIC_SEA"]);
  });

  it("tags Baltic -> Poland ROAD lanes with BALTIC_VIA_BALTICA_CORRIDOR", () => {
    const cps = inferLaneChokepoints("EE", "PL", "ROAD");
    expect(cps).toContain("BALTIC_VIA_BALTICA_CORRIDOR");
    expect(cps).not.toContain("BALTIC_SEA");
  });

  it("tags Italy -> Germany RAIL lanes with Alpine corridors", () => {
    const cps = inferLaneChokepoints("IT", "DE", "RAIL");
    expect(cps).toContain("ALPINE_BRENNER_CORRIDOR");
    expect(cps).toContain("ALPINE_GOTTHARD_CORRIDOR");
  });
});

describe("3-layer RiskSignal matching", () => {
  it("Layer 1: matches facilities by WKT polygon and countryCode, ignoring resolved/expired signals", () => {
    const facilities = [
      {
        facilityId: "fac-tallinn",
        lat: 59.437,
        lng: 24.7536,
        countryCode: "EE",
        regionCode: "EE-37",
      },
    ];

    const floodSignal = makeSignal({
      signalId: "sig-flood",
      kind: "CLIMATE",
      severity: "YELLOW",
      title: "Harju County Storm",
      polygonWkt: "POLYGON ((24.0 59.0, 25.5 59.0, 25.5 59.8, 24.0 59.8, 24.0 59.0))",
      affectedChokepoints: [],
      affectedCountryCodes: [],
    });

    const resolvedSignal = makeSignal({
      signalId: "sig-resolved",
      lifecycle: "RESOLVED",
      affectedCountryCodes: ["EE"],
    });

    const matches = matchFacilityRiskSignals(
      facilities,
      [floodSignal, resolvedSignal],
      "2026-11-21T12:00:00Z",
    );

    expect(matches).toEqual([
      {
        facilityId: "fac-tallinn",
        signalId: "sig-flood",
        matchType: "POLYGON",
        severity: "YELLOW",
      },
    ]);
  });

  it("Layer 2: matches SEA lanes via canonical chokepoints", () => {
    const facilitiesById = new Map([
      ["fac-cn", { countryCode: "CN" }],
      ["fac-nl", { countryCode: "NL" }],
    ]);
    const lanes = [
      {
        laneId: "lane-1",
        fromFacilityId: "fac-cn",
        toFacilityId: "fac-nl",
        transportMode: "SEA" as const,
      },
    ];

    const matches = matchLaneRiskSignals(lanes, facilitiesById, [makeSignal()]);
    expect(matches).toEqual([
      {
        laneId: "lane-1",
        signalId: "sig-1",
        matchedChokepoints: ["RED_SEA_BAB_EL_MANDEB", "SUEZ_CANAL"],
        severity: "RED",
      },
    ]);
  });

  it("Layer 3: returns strictly anonymized Tier-2+ partner alerts with zero partner identity", () => {
    const sanctionsSignal = makeSignal({
      signalId: "sig-sanctions",
      kind: "SANCTIONS",
      severity: "RED",
      title: "EU Export Control Update",
      affectedCountryCodes: ["DE"],
      affectedChokepoints: [],
    });

    const alerts = matchPartnerRegionRiskSignals(
      [{ countryCode: "DE", regionCode: "DE-BY" }],
      [sanctionsSignal],
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      signalId: "sig-sanctions",
      kind: "SANCTIONS",
      severity: "RED",
      title: "EU Export Control Update",
      countryCode: "DE",
      regionCode: null,
      matchedChokepoints: [],
    });
  });
});
