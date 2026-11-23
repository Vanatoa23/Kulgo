import { z } from "zod";

/**
 * Shared public entity dictionary used by both news matching (Sub-Project 1)
 * and business-registry supplier onboarding (Sub-Project 5). Contains only
 * public data; never tenant-specific information.
 */
export const PublicEntitySiteKindSchema = z.enum([
  "LEGAL_HQ",
  "PRODUCTION_SITE",
  "PORT_OR_TERMINAL",
  "OTHER",
]);
export type PublicEntitySiteKind = z.infer<typeof PublicEntitySiteKindSchema>;

export const PublicEntitySiteSchema = z
  .object({
    name: z.string().min(1),
    kind: PublicEntitySiteKindSchema,
    countryCode: z.string().length(2).nullable().default(null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
  })
  .strict();
export type PublicEntitySite = z.infer<typeof PublicEntitySiteSchema>;

export const PublicEntitySchema = z
  .object({
    entityId: z.string().min(1),
    canonicalName: z.string().min(1),
    /** Registry scheme -> code, e.g. { EE_ARIREGISTER: "10137319" }. */
    registryIds: z.record(z.string().min(1), z.string().min(1)).default({}),
    aliases: z.array(z.string().min(1)).default([]),
    /** Names that look similar but must NOT resolve to this entity. */
    negativeMatches: z.array(z.string().min(1)).default([]),
    sites: z.array(PublicEntitySiteSchema).default([]),
  })
  .strict();
export type PublicEntity = z.infer<typeof PublicEntitySchema>;

/** Case/diacritic/punctuation-insensitive form of an entity name. */
export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface EntityAliasMatch {
  entity: PublicEntity;
  matchedOn: "REGISTRY_ID" | "CANONICAL_NAME" | "ALIAS" | "SITE_NAME";
  site: PublicEntitySite | null;
}

/**
 * Resolve a free-text name (or registry id) to a public entity. Negative
 * matches are checked first so they always win over aliases.
 */
export function resolvePublicEntity(
  entities: readonly PublicEntity[],
  query: { name?: string | null; registryId?: string | null },
): EntityAliasMatch | null {
  const registryId = query.registryId?.trim();
  if (registryId) {
    for (const entity of entities) {
      if (Object.values(entity.registryIds).includes(registryId)) {
        return { entity, matchedOn: "REGISTRY_ID", site: null };
      }
    }
  }
  const name = normalizeEntityName(query.name ?? "");
  if (!name) return null;

  for (const entity of entities) {
    if (entity.negativeMatches.some((n) => normalizeEntityName(n) === name)) {
      continue;
    }
    if (normalizeEntityName(entity.canonicalName) === name) {
      return { entity, matchedOn: "CANONICAL_NAME", site: null };
    }
    if (entity.aliases.some((a) => normalizeEntityName(a) === name)) {
      return { entity, matchedOn: "ALIAS", site: null };
    }
    const site = entity.sites.find((s) => normalizeEntityName(s.name) === name);
    if (site) return { entity, matchedOn: "SITE_NAME", site };
  }
  return null;
}
