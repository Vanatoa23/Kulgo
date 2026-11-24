import { z } from "zod";

import { normalizeEntityName } from "./entity-alias.js";
import { CountryCodeInputSchema } from "./network.js";

/**
 * Server-side company registry search (GitHub issue #29, Sub-Project 5).
 *
 * Kulgo resolves a client-entered company name against a locally stored
 * snapshot of a public business registry — starting with the Estonian
 * e-Business Register (Äriregister) open data. The snapshot is public open
 * data only; tenant-entered supplier/customer names are never sent to any
 * external service, and registry responses expose only safe public fields
 * (legal name, registry ID, country, official source, status).
 *
 * Registry matching is a distinct fact from relationship confirmation:
 * no client-supplied registry ID verifies anything by itself.
 */

export const COMPANY_REGISTRY_SOURCE_EE = "EE_ARIREGISTER" as const;

export const COMPANY_REGISTRY_MAX_CANDIDATES = 10;

/** Public attribution metadata for the Estonian e-Business Register open data (CC BY 4.0). */
export const CompanyRegistrySourceSchema = z
  .object({
    id: z.literal(COMPANY_REGISTRY_SOURCE_EE),
    name: z.literal("Estonian e-Business Register (Äriregister) open data"),
    datasetUrl: z
      .string()
      .url()
      .default("https://avaandmed.ariregister.rik.ee/en/downloading-open-data"),
    licence: z.literal("CC BY 4.0"),
    licenceUrl: z
      .string()
      .url()
      .default("https://creativecommons.org/licenses/by/4.0/"),
  })
  .strict();

export type CompanyRegistrySource = z.infer<typeof CompanyRegistrySourceSchema>;

export const EE_COMPANY_REGISTRY_SOURCE: CompanyRegistrySource =
  CompanyRegistrySourceSchema.parse({
    id: COMPANY_REGISTRY_SOURCE_EE,
    name: "Estonian e-Business Register (Äriregister) open data",
    datasetUrl: "https://avaandmed.ariregister.rik.ee/en/downloading-open-data",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  });

/** Registry status reduced to a safe public signal: "R" (registered) is ACTIVE, anything else is INACTIVE. */
export const CompanyRegistryStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export type CompanyRegistryStatus = z.infer<typeof CompanyRegistryStatusSchema>;

/** A bounded, safe registry candidate. Never includes personal/contact fields. */
export const CompanyRegistryCandidateSchema = z
  .object({
    legalName: z.string().min(1).max(160),
    registryId: z.string().min(1).max(64),
    countryCode: z.string().length(2),
    source: z.literal(COMPANY_REGISTRY_SOURCE_EE),
    status: CompanyRegistryStatusSchema,
  })
  .strict();

export type CompanyRegistryCandidate = z.infer<typeof CompanyRegistryCandidateSchema>;

/**
 * Search outcome:
 * - CONCLUSIVE_MATCH: a genuinely exact, unique name with matching country (when no registry ID was
 *   supplied) or a consistent registry ID.
 * - CANDIDATES: multiple plausible matches go to user choice, as does an exact Estonia-only hit
 *   without country/ID or with a supplied registry ID that is missing from the snapshot.
 * - NO_MATCH: nothing plausible in the snapshot.
 * - UNSUPPORTED_COUNTRY: only Estonia (EE) is supported in this slice.
 * - SNAPSHOT_UNAVAILABLE: no usable local snapshot (missing or corrupt); ordinary workspace operations are unaffected.
 */
export const CompanyRegistrySearchOutcomeSchema = z.enum([
  "CONCLUSIVE_MATCH",
  "CANDIDATES",
  "NO_MATCH",
  "UNSUPPORTED_COUNTRY",
  "SNAPSHOT_UNAVAILABLE",
]);

export type CompanyRegistrySearchOutcome = z.infer<typeof CompanyRegistrySearchOutcomeSchema>;

export const CompanyRegistrySearchInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine(
        (value) => normalizeEntityName(value).length > 0,
        "name must contain at least one letter or digit",
      ),
    countryCode: CountryCodeInputSchema.nullable().optional(),
    registryId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

export type CompanyRegistrySearchInput = z.infer<typeof CompanyRegistrySearchInputSchema>;

export const CompanyRegistrySearchResponseSchema = z
  .object({
    outcome: CompanyRegistrySearchOutcomeSchema,
    candidates: z
      .array(CompanyRegistryCandidateSchema)
      .max(COMPANY_REGISTRY_MAX_CANDIDATES),
    source: CompanyRegistrySourceSchema,
  })
  .strict();

export type CompanyRegistrySearchResponse = z.infer<typeof CompanyRegistrySearchResponseSchema>;
