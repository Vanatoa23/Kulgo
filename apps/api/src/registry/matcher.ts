import {
  COMPANY_REGISTRY_MAX_CANDIDATES,
  normalizeEntityName,
  type CompanyRegistryCandidate,
  type CompanyRegistrySearchOutcome,
} from "@kulgo/shared";

import type { RegistryCompanyEntry, RegistrySnapshotIndex } from "./snapshot.js";

export interface RegistrySearchQuery {
  name: string;
  countryCode?: string | null;
  registryId?: string | null;
}

export interface RegistrySearchResult {
  outcome: CompanyRegistrySearchOutcome;
  candidates: CompanyRegistryCandidate[];
}

const SUPPORTED_COUNTRY = "EE";
const MIN_FUZZY_QUERY_LENGTH = 3;

function toCandidate(entry: RegistryCompanyEntry): CompanyRegistryCandidate {
  return {
    legalName: entry.legalName,
    registryId: entry.registryId,
    countryCode: SUPPORTED_COUNTRY,
    source: "EE_ARIREGISTER",
    status: entry.status,
  };
}

function normalizeRegistryId(value: string): string {
  return value.replace(/\s+/g, "");
}

function sortCandidates(entries: RegistryCompanyEntry[]): RegistryCompanyEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.legalName.localeCompare(b.legalName) || a.registryId.localeCompare(b.registryId),
  );
}

function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((token) => token.length > 0));
}

function isPlausibleMatch(queryNormalized: string, candidateNormalized: string): boolean {
  if (queryNormalized.length < MIN_FUZZY_QUERY_LENGTH || candidateNormalized.length < MIN_FUZZY_QUERY_LENGTH) return false;
  if (candidateNormalized.includes(queryNormalized)) return true;
  if (queryNormalized.includes(candidateNormalized)) return true;
  const queryTokens = tokenSet(queryNormalized);
  const candidateTokens = tokenSet(candidateNormalized);
  if (queryTokens.size === 0 || candidateTokens.size === 0) return false;
  // Every query token appears in the candidate name (e.g. "nordic alloys"
  // -> "nordic alloys ou"), or every candidate token appears in the query.
  const queryInCandidate = [...queryTokens].every((t) => candidateTokens.has(t));
  const candidateInQuery = [...candidateTokens].every((t) => queryTokens.has(t));
  return queryInCandidate || candidateInQuery;
}

/**
 * Conservative registry matching against a local Estonia snapshot.
 *
 * - Only Estonia ("EE") is supported; any other country is UNSUPPORTED_COUNTRY.
 * - A registry ID never verifies anything by itself. An ID that conflicts
 *   with the name (it belongs to a different company) blocks any conclusive
 *   result so another company is never silently attached.
 * - CONCLUSIVE_MATCH requires a genuinely exact, unique name plus matching
 *   country, or a consistent registry ID. An exact Estonia-only hit without
 *   country or ID is offered as a single CANDIDATE for user choice.
 * - A supplied registry ID that is missing from the snapshot downgrades an
 *   otherwise conclusive name+country hit to CANDIDATES: the name/country
 *   record is a different record than the supplied ID, so it is offered as a
 *   choice and never attached.
 * - Multiple plausible matches always go to user choice (CANDIDATES).
 * - Fuzzy fallback never produces a conclusive match.
 */
export function matchRegistry(
  index: RegistrySnapshotIndex,
  query: RegistrySearchQuery,
): RegistrySearchResult {
  const countryCode = query.countryCode?.trim().toUpperCase() || null;
  if (countryCode && countryCode !== SUPPORTED_COUNTRY) {
    return { outcome: "UNSUPPORTED_COUNTRY", candidates: [] };
  }

  const normalized = normalizeEntityName(query.name);
  if (!normalized) {
    return { outcome: "NO_MATCH", candidates: [] };
  }

  const exact = index.byNormalizedName.get(normalized) ?? [];
  const idEntry = query.registryId
    ? index.byRegistryId.get(normalizeRegistryId(query.registryId.trim()))
    : undefined;

  const idMissingFromSnapshot =
    Boolean(query.registryId?.trim()) && idEntry === undefined;

  const idConflictsWithName =
    idEntry !== undefined && normalizeEntityName(idEntry.legalName) !== normalized;
  const idConsistentWithName =
    idEntry !== undefined && normalizeEntityName(idEntry.legalName) === normalized;

  // A consistent ID disambiguates even between several same-named entries.
  if (idConsistentWithName && idEntry) {
    return { outcome: "CONCLUSIVE_MATCH", candidates: [toCandidate(idEntry)] };
  }

  const onlyExact = exact.length === 1 ? exact[0] : undefined;
  if (onlyExact && !idConflictsWithName && countryCode === SUPPORTED_COUNTRY) {
    // A supplied ID missing from the snapshot cannot verify this name/country
    // hit (it is a different record), so offer it as a choice, not conclusive.
    if (idMissingFromSnapshot) {
      return { outcome: "CANDIDATES", candidates: [toCandidate(onlyExact)] };
    }
    return { outcome: "CONCLUSIVE_MATCH", candidates: [toCandidate(onlyExact)] };
  }

  let pool: RegistryCompanyEntry[];
  if (exact.length > 0) {
    pool = exact;
  } else {
    pool = [];
    for (const [candidateNormalized, entries] of index.byNormalizedName) {
      if (isPlausibleMatch(normalized, candidateNormalized)) {
        pool.push(...entries);
      }
    }
  }

  if (pool.length === 0) {
    return { outcome: "NO_MATCH", candidates: [] };
  }
  const bounded = sortCandidates(pool).slice(0, COMPANY_REGISTRY_MAX_CANDIDATES);
  return { outcome: "CANDIDATES", candidates: bounded.map(toCandidate) };
}
