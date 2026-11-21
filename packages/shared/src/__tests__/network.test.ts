import { describe, expect, it } from "vitest";
import {
  AcceptInviteInputSchema,
  AuthMeResponseSchema,
  CreateFacilityInputSchema,
  CreateProductInputSchema,
  CreateSupplyInputInputSchema,
  CreateSupplyLaneInputSchema,
  FacilitySchema,
  InvitationSchema,
  OrganizationSchema,
  ProductSchema,
  SupplyInputSchema,
  SupplyLaneSchema,
  UpdateFacilityInputSchema,
  UpdateProductInputSchema,
  UpdateSupplyInputInputSchema,
  UpdateSupplyLaneInputSchema,
  UserSchema,
  WorkspaceNetworkResponseSchema,
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

describe("Strict entity/response schemas & invite input defaults", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const productId = "33333333-3333-4333-8333-333333333333";
  const inputId = "44444444-4444-4444-8444-444444444444";
  const facilityId1 = "55555555-5555-4555-8555-555555555555";
  const facilityId2 = "66666666-6666-4666-8666-666666666666";
  const laneId = "77777777-7777-4777-8777-777777777777";
  const inviteId = "88888888-8888-4888-8888-888888888888";
  const timestamp = "2026-11-21T09:00:00.000Z";

  const validProduct = {
    productId,
    ownerOrgId: orgId,
    name: "Turbine Assembly",
  };
  const validSupplyInput = {
    inputId,
    ownerOrgId: orgId,
    name: "Precision Bearings",
    category: "Mechanical",
  };
  const validFacility = {
    facilityId: facilityId1,
    ownerOrgId: orgId,
    name: "Tallinn Plant",
    kind: "FACTORY" as const,
    countryCode: "EE",
    lat: 59.437,
    lng: 24.7536,
  };
  const validLane = {
    laneId,
    ownerOrgId: orgId,
    fromFacilityId: facilityId1,
    toFacilityId: facilityId2,
    materialCategory: "Mechanical",
    transportMode: "ROAD" as const,
    volumeSharePct: 100,
  };
  const validOrganization = {
    orgId,
    name: "Baltic Mfg",
    slug: "baltic-mfg",
    countryCode: "EE",
    sector: "Manufacturing",
    createdAt: timestamp,
  };
  const validUser = {
    userId,
    orgId,
    email: "owner@example.com",
    role: "OWNER" as const,
    createdAt: timestamp,
  };
  const validInvitation = {
    inviteId,
    fromOrgId: orgId,
    targetFacilityId: facilityId1,
    inviteeEmail: "supplier@example.com",
    status: "PENDING" as const,
    expiresAt: timestamp,
    createdAt: timestamp,
  };

  it("rejects extra/sensitive fields via .strict() on network schemas", () => {
    expect(() =>
      ProductSchema.parse({ ...validProduct, secretNote: "internal" }),
    ).toThrow();

    expect(() =>
      SupplyInputSchema.parse({ ...validSupplyInput, costPriceEur: 42 }),
    ).toThrow();

    expect(() =>
      FacilitySchema.parse({ ...validFacility, partnerOrgId: orgId }),
    ).toThrow();

    expect(() =>
      SupplyLaneSchema.parse({ ...validLane, hiddenTier2OrgId: orgId }),
    ).toThrow();

    expect(() =>
      WorkspaceNetworkResponseSchema.parse({
        products: [validProduct],
        inputs: [validSupplyInput],
        facilities: [validFacility],
        lanes: [validLane],
        internalMeta: true,
      }),
    ).toThrow();
  });

  it("rejects extra/sensitive fields via .strict() on auth and invite schemas", () => {
    expect(() =>
      OrganizationSchema.parse({ ...validOrganization, internalNotes: "x" }),
    ).toThrow();

    expect(() =>
      UserSchema.parse({ ...validUser, passwordHash: "scrypt:abc" }),
    ).toThrow();

    expect(() =>
      AuthMeResponseSchema.parse({
        user: validUser,
        organization: validOrganization,
        sessionToken: "raw-token",
      }),
    ).toThrow();

    expect(() =>
      InvitationSchema.parse({ ...validInvitation, tokenHash: "sha256-hex" }),
    ).toThrow();
  });

  it("parses empty AcceptInviteInputSchema without defaulting openToNewBuyers or capabilities", () => {
    const parsed = AcceptInviteInputSchema.parse({});
    expect(parsed.openToNewBuyers).toBeUndefined();
    expect(parsed.capabilities).toBeUndefined();
    expect(parsed.refinedSite).toBeUndefined();
  });
});

