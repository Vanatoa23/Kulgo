import type { Facility, SupplyLane, WorkspaceNetworkResponse } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { scopePartnerNetworkForReconciliation } from "../src/analytics/partner-resolver.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function makeFacility(
  id: string,
  name: string,
  isOwnFacility: boolean,
  countryCode = "FI",
): Facility {
  return {
    facilityId: id,
    ownerOrgId: ORG_ID,
    name,
    kind: isOwnFacility ? "FACTORY" : "WAREHOUSE",
    locationPrecision: "SITE_VERIFIED",
    countryCode,
    regionCode: null,
    lat: 60.1699,
    lng: 24.9384,
    isOwnFacility,
    isPartnerVerified: false,
    sector: "Manufacturing",
    esgBadges: [],
    estimatedScope12Tco2e: 50,
  };
}

function makeLane(
  laneId: string,
  fromFacilityId: string,
  toFacilityId: string,
  volumeSharePct = 100,
): SupplyLane {
  return {
    laneId,
    ownerOrgId: ORG_ID,
    fromFacilityId,
    toFacilityId,
    inputId: null,
    materialCategory: "Precision Components",
    transportMode: "ROAD",
    volumeSharePct,
    annualVolume: null,
    volumeUnit: "TONNES",
    annualSpendEur: null,
    productEmissionFactorTco2ePerUnit: null,
    economicAttributionRatio: null,
    distanceKm: 100,
    estimatedLaneCo2e: 5,
    leadTimeDays: 3,
    contractEndDate: null,
    contractTerms: null,
    riskStatus: "GREEN",
    riskReason: null,
  };
}

function makeNetwork(
  facilities: Facility[],
  lanes: SupplyLane[],
): WorkspaceNetworkResponse {
  return {
    products: [],
    inputs: [],
    facilities,
    lanes,
    riskSignals: [],
    contracts: [],
    contractLines: [],
  };
}

describe("scopePartnerNetworkForReconciliation", () => {
  it("traverses supplier -> own transit facility -> fulfilling plant transitively and excludes unrelated branches", () => {
    const supplier = makeFacility("fac-sup-1", "Tier-2 Supplier", false, "RU");
    const transit = makeFacility("fac-transit", "Own Transit Hub", true, "FI");
    const plant = makeFacility("fac-plant", "Fulfilling Plant", true, "FI");
    const unrelatedSupplier = makeFacility("fac-sup-2", "Unrelated Supplier", false, "CN");
    const unrelatedPlant = makeFacility("fac-plant-2", "Unrelated Plant", true, "FI");

    const laneSupToTransit = makeLane("lane-1", supplier.facilityId, transit.facilityId);
    const laneTransitToPlant = makeLane("lane-2", transit.facilityId, plant.facilityId);
    const laneTransitToUnrelated = makeLane("lane-3", transit.facilityId, unrelatedPlant.facilityId);
    const laneUnrelated = makeLane("lane-4", unrelatedSupplier.facilityId, unrelatedPlant.facilityId);

    const network = makeNetwork(
      [supplier, transit, plant, unrelatedSupplier, unrelatedPlant],
      [laneSupToTransit, laneTransitToPlant, laneTransitToUnrelated, laneUnrelated],
    );

    const scoped = scopePartnerNetworkForReconciliation(network, plant.facilityId);

    expect(scoped.facilities.map((f) => f.facilityId)).toEqual([
      supplier.facilityId,
      transit.facilityId,
      plant.facilityId,
    ]);
    expect(scoped.lanes.map((l) => l.laneId)).toEqual([
      laneSupToTransit.laneId,
      laneTransitToPlant.laneId,
    ]);
  });

  it("ignores inactive inbound legs (volumeSharePct <= 0) during upstream traversal", () => {
    const supplier = makeFacility("fac-sup-inactive", "Inactive Branch Supplier", false, "RU");
    const transit = makeFacility("fac-transit-inactive", "Inactive Transit Hub", true, "FI");
    const plant = makeFacility("fac-plant", "Fulfilling Plant", true, "FI");

    const laneSupToTransit = makeLane("lane-1", supplier.facilityId, transit.facilityId, 100);
    const laneInactiveTransitToPlant = makeLane("lane-2", transit.facilityId, plant.facilityId, 0);

    const network = makeNetwork(
      [supplier, transit, plant],
      [laneSupToTransit, laneInactiveTransitToPlant],
    );

    const scoped = scopePartnerNetworkForReconciliation(network, plant.facilityId);

    expect(scoped.facilities.map((f) => f.facilityId)).toEqual([plant.facilityId]);
    expect(scoped.lanes).toEqual([]);
  });

  it("handles diamond topologies without duplicate facilities or lanes", () => {
    const deepSupplier = makeFacility("fac-deep", "Deep Supplier", false, "DE");
    const midSupplier = makeFacility("fac-mid", "Mid Supplier", false, "PL");
    const transitA = makeFacility("fac-transit-a", "Transit Hub A", true, "FI");
    const transitB = makeFacility("fac-transit-b", "Transit Hub B", true, "FI");
    const plant = makeFacility("fac-plant", "Fulfilling Plant", true, "FI");

    const lanes = [
      makeLane("lane-deep-mid", deepSupplier.facilityId, midSupplier.facilityId),
      makeLane("lane-mid-a", midSupplier.facilityId, transitA.facilityId, 50),
      makeLane("lane-mid-b", midSupplier.facilityId, transitB.facilityId, 50),
      makeLane("lane-a-plant", transitA.facilityId, plant.facilityId, 50),
      makeLane("lane-b-plant", transitB.facilityId, plant.facilityId, 50),
    ];

    const network = makeNetwork(
      [deepSupplier, midSupplier, transitA, transitB, plant],
      lanes,
    );

    const scoped = scopePartnerNetworkForReconciliation(network, plant.facilityId);

    expect(scoped.facilities.map((f) => f.facilityId)).toEqual([
      deepSupplier.facilityId,
      midSupplier.facilityId,
      transitA.facilityId,
      transitB.facilityId,
      plant.facilityId,
    ]);
    expect(scoped.lanes.map((l) => l.laneId)).toEqual(lanes.map((l) => l.laneId));
    expect(new Set(scoped.facilities.map((f) => f.facilityId)).size).toBe(5);
    expect(new Set(scoped.lanes.map((l) => l.laneId)).size).toBe(5);
  });

  it("handles cycles (both upstream and including the fulfilling plant) without infinite recursion or duplicates", () => {
    const supplier = makeFacility("fac-sup", "Cyclic Upstream Supplier", false, "RU");
    const transitA = makeFacility("fac-transit-a", "Transit A", true, "FI");
    const transitB = makeFacility("fac-transit-b", "Transit B", true, "FI");
    const plant = makeFacility("fac-plant", "Fulfilling Plant", true, "FI");
    const unrelated = makeFacility("fac-unrelated", "Unrelated Plant", true, "FI");

    const lanes = [
      makeLane("lane-sup-a", supplier.facilityId, transitA.facilityId),
      makeLane("lane-a-b", transitA.facilityId, transitB.facilityId),
      makeLane("lane-b-a", transitB.facilityId, transitA.facilityId),
      makeLane("lane-a-plant", transitA.facilityId, plant.facilityId),
      makeLane("lane-plant-b", plant.facilityId, transitB.facilityId),
    ];

    const network = makeNetwork(
      [supplier, transitA, transitB, plant, unrelated],
      lanes,
    );

    const scoped = scopePartnerNetworkForReconciliation(network, plant.facilityId);

    expect(scoped.facilities.map((f) => f.facilityId)).toEqual([
      supplier.facilityId,
      transitA.facilityId,
      transitB.facilityId,
      plant.facilityId,
    ]);
    expect(scoped.lanes.map((l) => l.laneId)).toEqual(lanes.map((l) => l.laneId));
  });

  it("preserves conservative org-wide fallback when fulfilledByFacilityId is absent, unknown, or non-own", () => {
    const supplier = makeFacility("fac-sup", "External Supplier", false, "CN");
    const plant = makeFacility("fac-plant", "Own Plant", true, "FI");
    const network = makeNetwork(
      [supplier, plant],
      [makeLane("lane-1", supplier.facilityId, plant.facilityId)],
    );

    expect(scopePartnerNetworkForReconciliation(network, null)).toBe(network);
    expect(scopePartnerNetworkForReconciliation(network, undefined)).toBe(network);
    expect(scopePartnerNetworkForReconciliation(network, "fac-missing")).toBe(network);
    expect(scopePartnerNetworkForReconciliation(network, supplier.facilityId)).toBe(network);
  });
});
