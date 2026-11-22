import { describe, expect, it } from "vitest";
import { SupplyLaneSchema, DerivedLaneCommercialSummarySchema } from "@kulgo/shared";
import { allocationPreviewPool, allocationPreviewVolume } from "../lib/allocation-preview.js";

const lane = (laneId: string, volumeUnit: "KG" | "TONNES" | "UNITS", annualVolume: number) => SupplyLaneSchema.parse({
  laneId, ownerOrgId: "11111111-1111-4111-8111-111111111111",
  fromFacilityId: "22222222-2222-4222-8222-222222222222",
  toFacilityId: "33333333-3333-4333-8333-333333333333",
  materialCategory: "Copper", transportMode: "ROAD", volumeSharePct: 50, annualVolume, volumeUnit,
});
const idA = "44444444-4444-4444-8444-444444444441";
const idB = "44444444-4444-4444-8444-444444444442";

// The preview only consumes the quantity/unit pair from a derived summary.
const summary = (activeVolume: number | null, baseUnit: string) =>
  ({ activeVolume, baseUnit }) as ReturnType<typeof DerivedLaneCommercialSummarySchema.parse>;

describe("allocation preview quantity units", () => {
  it("reads derived tonnes for a kilogram lane and renders each destination in its stored unit", () => {
    const lanes = [lane(idA, "KG", 1000), lane(idB, "TONNES", 1)];
    const pool = allocationPreviewPool(lanes, new Map([
      [idA, summary(1, "TONNES")], [idB, summary(1, "TONNES")],
    ]));
    expect(allocationPreviewVolume(pool, 75, "KG")).toBe("1500.0");
    expect(allocationPreviewVolume(pool, 25, "TONNES")).toBe("0.5");
  });
  it("uses the stored unit when falling back to legacy volume", () => {
    const pool = allocationPreviewPool([lane(idA, "KG", 1000), lane(idB, "TONNES", 1)],
      new Map([[idA, summary(null, "TONNES")]]));
    expect(allocationPreviewVolume(pool, 50, "KG")).toBe("1000.0");
  });
  it("does not guess conversions for incompatible units", () => {
    expect(allocationPreviewPool([lane(idA, "UNITS", 10)],
      new Map([[idA, summary(1, "TONNES")]]))).toBeNull();
  });
});
