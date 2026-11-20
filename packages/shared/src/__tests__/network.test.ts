import { describe, expect, it } from "vitest";
import {
  CreateFacilityInputSchema,
  CreateProductInputSchema,
  CreateSupplyInputInputSchema,
  CreateSupplyLaneInputSchema,
  UpdateFacilityInputSchema,
  UpdateProductInputSchema,
  UpdateSupplyInputInputSchema,
  UpdateSupplyLaneInputSchema,
} from "../index.js";

describe("M1 CRUD & refinement input schemas", () => {
  it("validates CreateProductInputSchema and partial UpdateProductInputSchema", () => {
    const created = CreateProductInputSchema.parse({
      name: "  Product X  ",
      sku: "PX-001",
    });
    expect(created).toEqual({ name: "Product X", sku: "PX-001" });

    const updated = UpdateProductInputSchema.parse({ description: "Updated" });
    expect(updated).toEqual({ description: "Updated" });
    expect(updated.name).toBeUndefined();

    expect(CreateProductInputSchema.safeParse({ name: "   " }).success).toBe(
      false,
    );
  });

  it("applies CreateSupplyInputInputSchema defaults without overwriting on Update", () => {
    const created = CreateSupplyInputInputSchema.parse({
      name: "Material A",
      category: "Electronics",
    });
    expect(created.unit).toBe("TONNES");

    const updated = UpdateSupplyInputInputSchema.parse({ name: "Material A+" });
    expect(updated).toEqual({ name: "Material A+" });
    expect(updated.unit).toBeUndefined();
  });

  it("normalizes countryCode to uppercase, validates bounds, and preserves partial updates on Facility", () => {
    const created = CreateFacilityInputSchema.parse({
      name: "Tallinn HQ",
      countryCode: "ee",
      lat: 59.437,
      lng: 24.7536,
    });
    expect(created.countryCode).toBe("EE");
    expect(created.kind).toBe("FACTORY");
    expect(created.locationPrecision).toBe("HQ_ESTIMATED");
    expect(created.isOwnFacility).toBe(false);

    // Partial update for HQ-to-site refinement must NOT overwrite unspecified defaults
    const refined = UpdateFacilityInputSchema.parse({
      locationPrecision: "SITE_VERIFIED",
      lat: 59.438,
      lng: 24.754,
    });
    expect(refined).toEqual({
      locationPrecision: "SITE_VERIFIED",
      lat: 59.438,
      lng: 24.754,
    });
    expect(refined.kind).toBeUndefined();
    expect(refined.isOwnFacility).toBeUndefined();

    // Invalid country codes & coordinates rejected
    expect(
      CreateFacilityInputSchema.safeParse({
        name: "Bad Country",
        countryCode: "12",
        lat: 59,
        lng: 24,
      }).success,
    ).toBe(false);
    expect(
      CreateFacilityInputSchema.safeParse({
        name: "Bad Lat",
        countryCode: "EE",
        lat: 91,
        lng: 24,
      }).success,
    ).toBe(false);
    expect(
      CreateFacilityInputSchema.safeParse({
        name: "Bad Lng",
        countryCode: "EE",
        lat: 59,
        lng: -181,
      }).success,
    ).toBe(false);
  });

  it("validates SupplyLane volumeSharePct, contractEndDate, defaults, and partial updates", () => {
    const fromFacilityId = "11111111-1111-4111-8111-111111111111";
    const toFacilityId = "22222222-2222-4222-8222-222222222222";

    const created = CreateSupplyLaneInputSchema.parse({
      fromFacilityId,
      toFacilityId,
      materialCategory: "Electronics",
      contractEndDate: "2027-06-30",
    });
    expect(created.transportMode).toBe("ROAD");
    expect(created.volumeSharePct).toBe(100);
    expect(created.volumeUnit).toBe("TONNES");
    expect(created.riskStatus).toBe("GREEN");
    expect(created.contractEndDate).toBe("2027-06-30");

    const updated = UpdateSupplyLaneInputSchema.parse({
      riskStatus: "RED",
      riskReason: "Latvian sanctions risk",
    });
    expect(updated).toEqual({
      riskStatus: "RED",
      riskReason: "Latvian sanctions risk",
    });
    expect(updated.transportMode).toBeUndefined();
    expect(updated.volumeSharePct).toBeUndefined();

    // Invalid volumeSharePct & contractEndDate rejected
    expect(
      CreateSupplyLaneInputSchema.safeParse({
        fromFacilityId,
        toFacilityId,
        materialCategory: "Metals",
        volumeSharePct: 105,
      }).success,
    ).toBe(false);
    expect(
      CreateSupplyLaneInputSchema.safeParse({
        fromFacilityId,
        toFacilityId,
        materialCategory: "Metals",
        contractEndDate: "30-06-2027",
      }).success,
    ).toBe(false);
  });
});
