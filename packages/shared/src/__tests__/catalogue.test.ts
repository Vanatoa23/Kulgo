import { describe, expect, it } from "vitest";
import {
  AlternativeMatchSchema,
  CatalogueItemSchema,
  CreateCatalogueItemInputSchema,
  IntroRequestInputSchema,
  KULGO_MATERIAL_TAXONOMY,
  matchStandardizedCategories,
  resolveStandardizedCategory,
} from "../catalogue.js";

describe("Sub-Project 5 — Catalogue & Taxonomy shared contracts", () => {
  it("defines 20 standardized manufacturing categories with HS/CN codes", () => {
    expect(KULGO_MATERIAL_TAXONOMY).toHaveLength(20);
    for (const def of KULGO_MATERIAL_TAXONOMY) {
      expect(def.hsCode).toMatch(/^\d{4}$/);
      expect(def.cnCode).toMatch(/^\d{6}$/);
      expect(def.keywords.length).toBeGreaterThan(0);
    }
  });

  it("matches exact codes, labels, HS/CN codes, and free-text material descriptions", () => {
    expect(resolveStandardizedCategory("ALUMINUM_EXTRUSIONS")).toBe(
      "ALUMINUM_EXTRUSIONS",
    );
    expect(resolveStandardizedCategory("Aluminum Extrusions")).toBe(
      "ALUMINUM_EXTRUSIONS",
    );
    expect(resolveStandardizedCategory("7604")).toBe("ALUMINUM_EXTRUSIONS");
    expect(resolveStandardizedCategory("760429")).toBe("ALUMINUM_EXTRUSIONS");
    expect(resolveStandardizedCategory("Recycled Aluminum Housings")).toBe(
      "ALUMINUM_EXTRUSIONS",
    );
    expect(resolveStandardizedCategory("PCB Assembly & SMT")).toBe(
      "PCB_ASSEMBLY",
    );
    expect(resolveStandardizedCategory("Lithium-Ion Battery Cells")).toBe(
      "LITHIUM_ION_CELLS",
    );
    expect(matchStandardizedCategories("")).toEqual([]);
  });

  it("enforces strict schemas on CatalogueItem, CreateCatalogueItemInput, AlternativeMatch, and IntroRequestInput", () => {
    const validCreate = CreateCatalogueItemInputSchema.parse({
      standardizedCategory: "ALUMINUM_EXTRUSIONS",
      productTitle: "6061-T6 Precision Extruded Profile",
      baseUnit: "TONNES",
      unitFamily: "MASS",
      productEmissionFactorTco2ePerUnit: 4.2,
      pcfVerified: true,
      specs: ["EN AW-6061", "Anodized"],
      leadTimeDays: 14,
      moq: 5,
      capacityBand: "LARGE",
      certifications: ["ISO 14001", "ASI Performance"],
    });
    expect(validCreate.standardizedCategory).toBe("ALUMINUM_EXTRUSIONS");

    expect(() =>
      CreateCatalogueItemInputSchema.parse({
        ...validCreate,
        unexpectedField: "leak",
      }),
    ).toThrow();

    expect(() =>
      IntroRequestInputSchema.parse({
        targetOrgId: "90000001-0001-4001-8001-000000000001",
        materialCategory: "Aluminum Extrusions",
        volumeBand: "100-500 tonnes/year",
        privateBuyerSupplierName: "ShouldBeRejected",
      }),
    ).toThrow();

    const parsedItem = CatalogueItemSchema.parse({
      itemId: "11111111-1111-4111-8111-111111111111",
      orgId: "22222222-2222-4222-8222-222222222222",
      standardizedCategory: "PCB_ASSEMBLY",
      productTitle: "4-Layer Industrial Control PCBA",
      baseUnit: "UNITS",
      unitFamily: "COUNT",
      createdAt: "2026-11-24T12:00:00.000Z",
      updatedAt: "2026-11-24T12:00:00.000Z",
    });
    expect(parsedItem.pcfVerified).toBe(false);

    expect(() =>
      AlternativeMatchSchema.parse({
        orgId: "90000001-0001-4001-8001-000000000001",
        name: "Nordic AluWorks AB",
        countryCode: "SE",
        riskStatus: "GREEN",
        esgBadges: ["ISO-14001"],
        certifications: ["ISO-14001"],
        capabilities: ["Aluminum Extrusions"],
        source: "KULGO_DIRECTORY",
        matchScore: 95,
        matchReason: "Standardized category match: Aluminum Extrusions",
        matchedCatalogueItems: [],
        estimatedDistanceKm: 420,
        distanceDeltaKm: -180,
        estimatedTransportCo2eDeltaT: -12.4,
        existingBuyers: ["SecretBuyer"],
      }),
    ).toThrow();
  });

  it("verifies negative category matching rules", () => {
    const checkNoMatch = (text: string, category: any) => {
      const matches = matchStandardizedCategories(text);
      const found = matches.find((m) => m.code === category);
      return !found || found.score < 60;
    };
    expect(checkNoMatch("Corrugated cardboard", "PCB_ASSEMBLY")).toBe(true);
    expect(checkNoMatch("Woodchips", "SEMICONDUCTOR_SUBSTRATES")).toBe(true);
    expect(checkNoMatch("Cellulose", "LITHIUM_ION_CELLS")).toBe(true);
  });

  it("rejects invalid unitFamily and pcfVerified inputs in CreateCatalogueItemInputSchema", () => {
    const res1 = CreateCatalogueItemInputSchema.safeParse({
      standardizedCategory: "ALUMINUM_EXTRUSIONS",
      productTitle: "Test",
      baseUnit: "TONNES",
      unitFamily: "COUNT",
    });
    expect(res1.success).toBe(false);

    const res2 = CreateCatalogueItemInputSchema.safeParse({
      standardizedCategory: "ALUMINUM_EXTRUSIONS",
      productTitle: "Test",
      baseUnit: "TONNES",
      unitFamily: "MASS",
      pcfVerified: true,
      productEmissionFactorTco2ePerUnit: null,
    });
    expect(res2.success).toBe(false);
  });
});
