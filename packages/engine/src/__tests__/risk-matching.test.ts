import { describe, expect, it } from "vitest";
import { FacilitySchema, ProductSchema, RiskSignalSchema, SupplyLaneSchema } from "@kulgo/shared";
import { evaluateNetworkAnalytics } from "../analytics.js";
import { computeFinancialRiskSummary } from "../financial-risk.js";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const supplier = FacilitySchema.parse({
  facilityId: id(1), ownerOrgId: id(10), name: "Supplier", kind: "FACTORY",
  locationPrecision: "SITE_VERIFIED", countryCode: "CN", regionCode: "CN-SOUTH",
  lat: 22.5, lng: 114, sector: "Electronics", isOwnFacility: false,
});
const buyer = FacilitySchema.parse({
  ...supplier, facilityId: id(2), name: "Buyer", countryCode: "EE",
  regionCode: "EE-37", lat: 59.4, lng: 24.7, isOwnFacility: true,
});
const lane = SupplyLaneSchema.parse({
  laneId: id(3), ownerOrgId: id(10), fromFacilityId: supplier.facilityId,
  toFacilityId: buyer.facilityId, materialCategory: "Electronics", transportMode: "SEA",
  volumeSharePct: 100, annualSpendEur: 1_200_000, riskStatus: "GREEN",
});
const product = ProductSchema.parse({ productId: id(4), ownerOrgId: id(10), name: "Product" });
const signal = RiskSignalSchema.parse({
  signalId: "earthquake", title: "Earthquake", kind: "CLIMATE", severity: "RED",
  polygonWkt: "POLYGON ((113 22, 115 22, 115 23, 113 23, 113 22))",
  affectedCountryCodes: [], affectedSectors: [], verificationStatus: "CONFIRMED", active: true,
});
const base = { products: [product], organization: { scope1Tco2e: null, scope2Tco2e: null }, inputs: [], facilities: [supplier, buyer],
  lanes: [lane], riskSignals: [], asOfDate: new Date("2026-11-22T00:00:00Z") };
const alerts = (s = signal, lanes = [lane]) => evaluateNetworkAnalytics({ ...base, lanes, riskSignals: [s] }).alerts;
const exposure = (s: typeof signal | null, lanes = [lane]) => computeFinancialRiskSummary({
  ...base, lanes, riskSignals: s ? [s] : [], asOfDate: "2026-11-22", viewMode: "RUN_RATE",
}).baseEur!;

describe("consistent alert and financial risk matching (#38)", () => {
  it("preserves RED sanctions when a YELLOW climate signal matches", () => {
    const result = alerts({ ...signal, severity: "YELLOW" }, [{ ...lane, riskStatus: "RED", riskReason: "Secondary sanctions exposure" }]);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "SECONDARY_SANCTION", severity: "RED" }),
      expect.objectContaining({ category: "GEOPOLITICAL", severity: "YELLOW" }),
    ]));
  });

  it("preserves a higher severity lane warning for the same risk", () => {
    expect(alerts({ ...signal, severity: "YELLOW" }, [{ ...lane, riskStatus: "RED", riskReason: signal.title }]))
      .toContainEqual(expect.objectContaining({ alertId: `lane-risk-${lane.laneId}`, severity: "RED" }));
  });

  it("deduplicates an equal severity warning for the same risk", () => {
    expect(alerts(signal, [{ ...lane, riskStatus: "RED", riskReason: signal.title }])
      .filter(a => a.category === "GEOPOLITICAL")).toHaveLength(1);
  });

  it("preserves distinct risks within the same public alert category", () => {
    expect(alerts(signal, [{ ...lane, riskStatus: "YELLOW", riskReason: "Export controls" }])
      .filter(a => a.category === "GEOPOLITICAL")).toHaveLength(2);
  });

  it("does not suppress a lane warning without evidence of the same event", () => {
    expect(alerts(signal, [{ ...lane, riskStatus: "RED", riskReason: null }]))
      .toContainEqual(expect.objectContaining({ alertId: `lane-risk-${lane.laneId}` }));
  });

  it("uses lane relevance when deduplicating a supplier's different corridors", () => {
    const suez = { ...signal, polygonWkt: "POLYGON EMPTY", affectedChokepoints: ["SUEZ_CANAL" as const] };
    const air = { ...lane, laneId: id(5), transportMode: "AIR" as const, riskStatus: "RED" as const, riskReason: signal.title };
    expect(alerts(suez, [lane, air]))
      .toContainEqual(expect.objectContaining({ alertId: `lane-risk-${air.laneId}`, severity: "RED" }));
  });

  it("deduplicates a lower severity warning when an identical event is RED", () => {
    expect(alerts(signal, [{ ...lane, riskStatus: "YELLOW", riskReason: signal.title }])
      .filter(a => a.category === "GEOPOLITICAL"))
      .toEqual([expect.objectContaining({ severity: "RED", alertId: "signal-earthquake" })]);
  });

  it.each([
    ["polygon without country metadata", signal],
    ["country", { ...signal, polygonWkt: "POLYGON EMPTY", affectedCountryCodes: ["CN"] }],
    ["region", { ...signal, polygonWkt: "POLYGON EMPTY", regionCode: "CN-SOUTH" }],
    ["sector", { ...signal, polygonWkt: "POLYGON EMPTY", affectedSectors: ["Electronics"] }],
    ["relevant chokepoint", { ...signal, polygonWkt: "POLYGON EMPTY", affectedChokepoints: ["SUEZ_CANAL"] }],
  ] as const)("matches %s for both alerts and exposure, once per signal", (_, fixture) => {
    const matched = RiskSignalSchema.parse(fixture);
    expect(alerts(matched)).toContainEqual(expect.objectContaining({ alertId: "signal-earthquake" }));
    expect(exposure(matched)).toBeGreaterThan(exposure(null));
    expect(exposure({ ...matched, affectedCountryCodes: ["CN"] })).toBe(exposure(matched));
  });

  it.each([
    ["unrelated geography", { ...signal, polygonWkt: "POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))" }],
    ["unrelated chokepoint", { ...signal, polygonWkt: "POLYGON EMPTY", affectedChokepoints: ["PANAMA_CANAL"] }],
    ["resolved", { ...signal, lifecycle: "RESOLVED" }],
    ["expired", { ...signal, expiresAt: "2026-11-21T00:00:00Z" }],
    ["inactive", { ...signal, active: false }],
  ] as const)("ignores %s for both alerts and exposure", (_, fixture) => {
    const unmatched = RiskSignalSchema.parse(fixture);
    expect(alerts(unmatched).some(a => a.alertId === "signal-earthquake")).toBe(false);
    expect(exposure(unmatched)).toBe(exposure(null));
  });

  it("does not match a maritime chokepoint on an AIR lane", () => {
    const air = [{ ...lane, transportMode: "AIR" as const }];
    const suez = { ...signal, polygonWkt: "POLYGON EMPTY", affectedChokepoints: ["SUEZ_CANAL" as const] };
    expect(alerts(suez, air).some(a => a.alertId === "signal-earthquake")).toBe(false);
    expect(exposure(suez, air)).toBe(exposure(null, air));
  });

  it("keeps future planned and ongoing disruptions active past feed staleness expiresAt until eventEndAt passes", () => {
    const ongoingPastTtl = RiskSignalSchema.parse({
      ...signal,
      expiresAt: "2026-11-21T00:00:00Z",
      eventStartAt: "2026-11-18T00:00:00Z",
      eventEndAt: "2026-11-28T00:00:00Z",
    });
    expect(alerts(ongoingPastTtl)).toContainEqual(expect.objectContaining({ alertId: "signal-earthquake" }));

    const plannedPastTtl = RiskSignalSchema.parse({
      ...signal,
      lifecycle: "PLANNED",
      expiresAt: "2026-11-21T00:00:00Z",
      eventStartAt: "2026-11-25T00:00:00Z",
      eventEndAt: null,
    });
    expect(alerts(plannedPastTtl)).toContainEqual(expect.objectContaining({ alertId: "signal-earthquake" }));

    const endedBeforeTtl = RiskSignalSchema.parse({
      ...signal,
      expiresAt: "2026-11-30T00:00:00Z",
      eventStartAt: "2026-11-18T00:00:00Z",
      eventEndAt: "2026-11-21T00:00:00Z",
    });
    expect(alerts(endedBeforeTtl).some(a => a.alertId === "signal-earthquake")).toBe(false);
  });
});
