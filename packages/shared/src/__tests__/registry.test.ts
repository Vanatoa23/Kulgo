import { describe, expect, it } from "vitest";

import {
  COMPANY_REGISTRY_MAX_CANDIDATES,
  CompanyRegistrySearchInputSchema,
  CompanyRegistrySearchResponseSchema,
  EE_COMPANY_REGISTRY_SOURCE,
} from "../registry.js";

describe("Company registry search contracts", () => {
  it("accepts and normalizes a valid search input", () => {
    const parsed = CompanyRegistrySearchInputSchema.parse({
      name: "  Nordic Alloys OÜ ",
      countryCode: "ee",
      registryId: " 10137319 ",
    });
    expect(parsed.name).toBe("Nordic Alloys OÜ");
    expect(parsed.countryCode).toBe("EE");
    expect(parsed.registryId).toBe("10137319");
  });

  it("allows name-only input with nullable optional fields", () => {
    expect(CompanyRegistrySearchInputSchema.parse({ name: "AS Foo" })).toEqual({
      name: "AS Foo",
      countryCode: undefined,
      registryId: undefined,
    });
    expect(
      CompanyRegistrySearchInputSchema.parse({ name: "AS Foo", countryCode: null, registryId: null }),
    ).toEqual({ name: "AS Foo", countryCode: null, registryId: null });
  });

  it("is strict and rejects extra or invalid fields", () => {
    expect(() =>
      CompanyRegistrySearchInputSchema.parse({ name: "AS Foo", ownerOrgId: "x" }),
    ).toThrow();
    expect(() => CompanyRegistrySearchInputSchema.parse({ name: "" })).toThrow();
    expect(() => CompanyRegistrySearchInputSchema.parse({ name: "!!!" })).toThrow();
    expect(() =>
      CompanyRegistrySearchInputSchema.parse({ name: "AS Foo", countryCode: "FIN" }),
    ).toThrow();
    expect(() =>
      CompanyRegistrySearchInputSchema.parse({ name: "AS Foo", registryId: "" }),
    ).toThrow();
    expect(() => CompanyRegistrySearchInputSchema.parse({})).toThrow();
  });

  it("bounds candidates and is a strict response contract with source attribution", () => {
    const candidate = {
      legalName: "Nordic Alloys OÜ",
      registryId: "10137319",
      countryCode: "EE",
      source: "EE_ARIREGISTER",
      status: "ACTIVE",
    };
    const response = CompanyRegistrySearchResponseSchema.parse({
      outcome: "CANDIDATES",
      candidates: [candidate],
      source: EE_COMPANY_REGISTRY_SOURCE,
    });
    expect(response.outcome).toBe("CANDIDATES");
    expect(response.source.licence).toBe("CC BY 4.0");

    expect(() =>
      CompanyRegistrySearchResponseSchema.parse({
        outcome: "NO_MATCH",
        candidates: [],
        source: EE_COMPANY_REGISTRY_SOURCE,
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      CompanyRegistrySearchResponseSchema.parse({
        outcome: "CANDIDATES",
        candidates: [{ ...candidate, contactEmail: "a@b.c" }],
        source: EE_COMPANY_REGISTRY_SOURCE,
      }),
    ).toThrow();
    expect(() =>
      CompanyRegistrySearchResponseSchema.parse({
        outcome: "CANDIDATES",
        candidates: Array.from({ length: COMPANY_REGISTRY_MAX_CANDIDATES + 1 }, () => candidate),
        source: EE_COMPANY_REGISTRY_SOURCE,
      }),
    ).toThrow();
  });
});
