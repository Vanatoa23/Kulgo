import { createHash } from "node:crypto";
import type { ChokepointCode, RiskSignal, RiskSignalKind } from "@kulgo/shared";

const EVENT_MERGE_WINDOW_MS = 7 * 86_400_000;
const SYNDICATION_TITLE_THRESHOLD = 0.8;
const SYNDICATION_QUOTE_THRESHOLD = 0.78;
const SYNDICATION_DESCRIPTION_THRESHOLD = 0.85;
const TOPIC_TITLE_SIMILARITY_THRESHOLD = 0.35;

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "me.uk",
  "net.uk",
  "com.au",
  "net.au",
  "org.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "go.jp",
  "co.kr",
  "or.kr",
  "com.cn",
  "net.cn",
  "org.cn",
  "com.hk",
  "com.tw",
  "com.sg",
  "com.my",
  "com.br",
  "com.mx",
  "com.ar",
  "com.tr",
  "co.za",
  "co.in",
  "com.pl",
  "net.pl",
  "org.pl",
  "com.ua",
  "co.il",
  "com.sa",
  "com.eg",
  "eu.com",
  "uk.com",
  "us.com",
]);

const NARROW_CHOKEPOINTS = new Set<ChokepointCode>([
  "SUEZ_CANAL",
  "RED_SEA_BAB_EL_MANDEB",
  "PANAMA_CANAL",
  "MALACCA_STRAIT",
  "STRAIT_OF_HORMUZ",
  "BOSPORUS_STRAIT",
  "DANISH_STRAITS",
  "ENGLISH_CHANNEL",
  "ALPINE_BRENNER_CORRIDOR",
  "ALPINE_GOTTHARD_CORRIDOR",
]);

const GENERIC_EVENT_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "over",
  "into",
  "amid",
  "after",
  "near",
  "across",
  "due",
  "that",
  "this",
  "are",
  "was",
  "were",
  "has",
  "have",
  "will",
  "not",
  "all",
  "new",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "strike",
  "strikes",
  "walkout",
  "walkouts",
  "blockade",
  "blockades",
  "flood",
  "floods",
  "flooding",
  "storm",
  "storms",
  "sanction",
  "sanctions",
  "embargo",
  "tariff",
  "tariffs",
  "outage",
  "outages",
  "shutdown",
  "shutdowns",
  "ransomware",
  "cyberattack",
  "bankruptcy",
  "insolvency",
  "disruption",
  "disruptions",
  "disrupts",
  "disrupted",
  "alert",
  "warning",
  "delay",
  "delays",
  "port",
  "ports",
  "terminal",
  "terminals",
  "plant",
  "plants",
  "factory",
  "factories",
  "facility",
  "facilities",
  "worker",
  "workers",
  "staff",
  "union",
  "unions",
  "labor",
  "labour",
  "company",
  "freight",
  "cargo",
  "shipping",
  "vessel",
  "vessels",
  "supply",
  "chain",
  "logistics",
  "operation",
  "operations",
  "halted",
  "halt",
  "suspended",
  "suspend",
  "announce",
  "announces",
  "announced",
  "begin",
  "begins",
  "began",
  "started",
  "start",
  "continues",
  "continued",
  "enters",
  "report",
  "reports",
  "reported",
  "wage",
  "wages",
  "talks",
  "dispute",
  "planned",
  "active",
  "severe",
  "major",
  "two",
  "three",
  "four",
  "second",
  "third",
]);

/**
 * Returns ISO year-week string (e.g. "2026-W47") for a timestamp so
 * reports of the same disruption within the same week share a dedupe window.
 */
export function toIsoYearWeek(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "unknown-week";
  }
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Extracts distinctive entity/location tokens from a title or text, filtering
 * out stop words and generic disruption-category nouns so unrelated events in
 * the same country/category do not collide.
 */
export function extractEventTokens(text: string): Set<string> {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = new Set<string>();
  if (!normalized) return tokens;

  for (const token of normalized.split(" ")) {
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (GENERIC_EVENT_TOKENS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/**
 * Builds a deterministic normalized event discriminator from an event title so
 * unrelated Stage 2 events in the same country/week get distinct dedupe keys.
 */
export function buildEventDiscriminator(title: string): string {
  const tokens = Array.from(extractEventTokens(title)).sort().slice(0, 6);
  if (tokens.length > 0) {
    return tokens.join("_");
  }
  return title
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Deterministic canonical deduplication key:
 * sha256(kind + ":" + canonicalLocationOrChokepoint + [":" + discriminator] + ":" + isoYearWeek)
 */
export function computeCanonicalDedupeKey(
  kind: RiskSignalKind,
  canonicalLocation: string,
  isoDate: string,
  eventDiscriminator?: string,
): string {
  const normalizedLocation = canonicalLocation
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const normalizedDiscriminator = eventDiscriminator
    ?.trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const bucket = toIsoYearWeek(isoDate);
  const rawKey = normalizedDiscriminator
    ? `${kind}:${normalizedLocation}:${normalizedDiscriminator}:${bucket}`
    : `${kind}:${normalizedLocation}:${bucket}`;
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 32);
}

function isIpHostname(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

/**
 * Extracts the normalized registrable domain (eTLD+1) from a URL for
 * independent-source counting, collapsing subdomains such as `uk.reuters.com`
 * and `www.reuters.com` to `reuters.com` and preserving multi-part public
 * suffixes such as `bbc.co.uk`.
 */
export function extractSourceDomain(url: string): string | null {
  try {
    const rawHost = new URL(url)
      .hostname.toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
    if (!rawHost) return null;
    if (isIpHostname(rawHost)) return rawHost;

    const parts = rawHost.split(".").filter(Boolean);
    if (parts.length <= 2) {
      return parts.join(".") || null;
    }

    const lastTwo = parts.slice(-2).join(".");
    if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join(".");
    }

    return lastTwo;
  } catch {
    return null;
  }
}

function tokensShareDistinctiveEntity(
  tokensA: ReadonlySet<string>,
  tokensB: ReadonlySet<string>,
): boolean {
  for (const a of tokensA) {
    if (tokensB.has(a)) return true;
    if (a.length >= 5) {
      for (const b of tokensB) {
        if (b.length >= 5 && (a.startsWith(b) || b.startsWith(a))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Determines whether two signals describe the same underlying disruption topic
 * rather than two unrelated events that happen to share a country and category.
 */
export function areEventsTopicallyCompatible(
  existing: RiskSignal,
  incoming: RiskSignal,
): boolean {
  if (
    trigramJaccardSimilarity(existing.title, incoming.title) >=
    TOPIC_TITLE_SIMILARITY_THRESHOLD
  ) {
    return true;
  }

  const existingTokens = extractEventTokens(existing.title);
  const incomingTokens = extractEventTokens(incoming.title);
  if (tokensShareDistinctiveEntity(existingTokens, incomingTokens)) {
    return true;
  }

  // Narrow maritime/overland chokepoint disruptions (e.g. Suez Canal transit drops)
  // are inherently scoped to a single physical corridor.
  if (
    existing.kind === "MARITIME_CHOKEPOINT" &&
    existing.affectedChokepoints.some(
      (cp) =>
        NARROW_CHOKEPOINTS.has(cp) &&
        incoming.affectedChokepoints.includes(cp),
    )
  ) {
    return true;
  }

  return false;
}

function hasGeographicOverlap(existing: RiskSignal, incoming: RiskSignal): boolean {
  if (
    existing.affectedChokepoints.some((cp) =>
      incoming.affectedChokepoints.includes(cp),
    )
  ) {
    return true;
  }

  const existingCountries = new Set(
    existing.affectedCountryCodes.map((c) => c.toUpperCase()),
  );
  if (
    incoming.affectedCountryCodes.some((c) =>
      existingCountries.has(c.toUpperCase()),
    )
  ) {
    return true;
  }

  if (
    existing.regionCode &&
    incoming.regionCode &&
    existing.regionCode.toUpperCase() === incoming.regionCode.toUpperCase()
  ) {
    return true;
  }

  return false;
}

function isWithinEventMergeWindow(
  existing: RiskSignal,
  incoming: RiskSignal,
): boolean {
  const existingAnchor = existing.lastSeenAt ?? existing.publishedAt;
  const incomingAnchor = incoming.publishedAt ?? incoming.lastSeenAt;
  if (!existingAnchor || !incomingAnchor) return true;

  const existingMs = Date.parse(existingAnchor);
  const incomingMs = Date.parse(incomingAnchor);
  if (Number.isNaN(existingMs) || Number.isNaN(incomingMs)) return true;

  if (Math.abs(incomingMs - existingMs) <= EVENT_MERGE_WINDOW_MS) {
    return true;
  }

  // Allow updates to a still-ongoing disruption with an explicit future eventEndAt
  if (existing.eventEndAt) {
    const endMs = Date.parse(existing.eventEndAt);
    if (!Number.isNaN(endMs) && incomingMs <= endMs) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether an incoming signal represents the same real-world event as
 * an existing signal:
 * - Prevents unrelated same-country/same-week events with distinct titles/entities from merging
 * - Bridges ISO-week boundaries (e.g. Sunday -> Monday) using a rolling time window
 */
export function areSignalsSameEvent(
  existing: RiskSignal,
  incoming: RiskSignal,
): boolean {
  if (existing.signalId === incoming.signalId) {
    return true;
  }
  if (existing.kind !== incoming.kind) {
    return false;
  }

  const sameDedupeKey = Boolean(
    existing.dedupeKey &&
      incoming.dedupeKey &&
      existing.dedupeKey === incoming.dedupeKey,
  );

  // Deterministic confirmed feeds (Stage 1) with an identical structured dedupeKey always merge
  if (
    sameDedupeKey &&
    existing.verificationStatus === "CONFIRMED" &&
    incoming.verificationStatus === "CONFIRMED"
  ) {
    return true;
  }

  if (!isWithinEventMergeWindow(existing, incoming)) {
    return false;
  }

  if (!sameDedupeKey && !hasGeographicOverlap(existing, incoming)) {
    return false;
  }

  return areEventsTopicallyCompatible(existing, incoming);
}

/**
 * Finds the best matching existing signal for an incoming signal among active
 * candidates, preferring exact signalId match, then highest title similarity.
 */
export function findMatchingSignal(
  candidates: readonly RiskSignal[],
  incoming: RiskSignal,
): RiskSignal | null {
  const exactById = candidates.find((c) => c.signalId === incoming.signalId);
  if (exactById) return exactById;

  let best: RiskSignal | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (!candidate.active || candidate.lifecycle === "RESOLVED") continue;
    if (!areSignalsSameEvent(candidate, incoming)) continue;

    const sameDedupeBonus =
      candidate.dedupeKey &&
      incoming.dedupeKey &&
      candidate.dedupeKey === incoming.dedupeKey
        ? 0.25
        : 0;
    const score =
      trigramJaccardSimilarity(candidate.title, incoming.title) + sameDedupeBonus;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/**
 * Detects whether an incoming signal is likely a syndicated wire repost of an
 * existing signal by comparing headline and verbatim evidence quote similarity.
 */
export function isLikelySyndicatedCopy(
  existing: RiskSignal,
  incoming: RiskSignal,
): boolean {
  const existingQuotes = existing.evidenceQuotes ?? [];
  const incomingQuotes = incoming.evidenceQuotes ?? [];

  if (existingQuotes.length > 0 && incomingQuotes.length > 0) {
    for (const exQuote of existingQuotes) {
      for (const inQuote of incomingQuotes) {
        if (
          trigramJaccardSimilarity(exQuote, inQuote) >=
          SYNDICATION_QUOTE_THRESHOLD
        ) {
          return true;
        }
      }
    }
  }

  if (
    trigramJaccardSimilarity(existing.title, incoming.title) >=
    SYNDICATION_TITLE_THRESHOLD
  ) {
    return true;
  }

  if (
    existingQuotes.length === 0 &&
    incomingQuotes.length === 0 &&
    existing.description &&
    incoming.description &&
    existing.description.trim().length >= 30 &&
    incoming.description.trim().length >= 30 &&
    trigramJaccardSimilarity(existing.description, incoming.description) >=
      SYNDICATION_DESCRIPTION_THRESHOLD
  ) {
    return true;
  }

  return false;
}

function mergeIsoTimestamps(
  a: string | null | undefined,
  b: string | null | undefined,
  mode: "earliest" | "latest",
): string | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs)) return b;
  if (Number.isNaN(bMs)) return a;
  if (mode === "earliest") {
    return aMs <= bMs ? a : b;
  }
  return aMs >= bMs ? a : b;
}

/**
 * Merges an incoming RiskSignal into an existing canonical RiskSignal:
 * - Unions sourceUrls, evidenceQuotes, affectedCountryCodes, affectedChokepoints, affectedSectors
 * - Updates lastSeenAt, eventStartAt, eventEndAt, and extends expiresAt
 * - Promotes verificationStatus from ALLEGED -> CORROBORATED only when a second
 *   independent registrable domain provides non-syndicated reporting
 *   (CONFIRMED always stays CONFIRMED)
 */
export function mergeRiskSignals(
  existing: RiskSignal,
  incoming: RiskSignal,
): RiskSignal {
  const mergedUrls = Array.from(
    new Set([...existing.sourceUrls, ...incoming.sourceUrls]),
  );
  const existingDomains = new Set(
    existing.sourceUrls
      .map(extractSourceDomain)
      .filter((d): d is string => d !== null),
  );
  const incomingDomains = new Set(
    incoming.sourceUrls
      .map(extractSourceDomain)
      .filter((d): d is string => d !== null),
  );
  const hasNewIndependentDomain = Array.from(incomingDomains).some(
    (domain) => !existingDomains.has(domain),
  );
  const syndicated = isLikelySyndicatedCopy(existing, incoming);

  let verificationStatus = existing.verificationStatus;
  if (
    existing.verificationStatus === "CONFIRMED" ||
    incoming.verificationStatus === "CONFIRMED"
  ) {
    verificationStatus = "CONFIRMED";
  } else if (
    existing.verificationStatus === "CORROBORATED" ||
    incoming.verificationStatus === "CORROBORATED" ||
    (hasNewIndependentDomain && !syndicated)
  ) {
    verificationStatus = "CORROBORATED";
  }

  const severityRank: Record<RiskSignal["severity"], number> = {
    GREEN: 0,
    YELLOW: 1,
    RED: 2,
  };
  const severity =
    severityRank[incoming.severity] > severityRank[existing.severity]
      ? incoming.severity
      : existing.severity;

  const lastSeenAt =
    mergeIsoTimestamps(existing.lastSeenAt, incoming.lastSeenAt, "latest") ??
    new Date().toISOString();

  const expiresAt = mergeIsoTimestamps(
    existing.expiresAt,
    incoming.expiresAt,
    "latest",
  );
  const eventStartAt = mergeIsoTimestamps(
    existing.eventStartAt,
    incoming.eventStartAt,
    "earliest",
  );
  const eventEndAt = mergeIsoTimestamps(
    existing.eventEndAt,
    incoming.eventEndAt,
    "latest",
  );

  const mergedQuotes = Array.from(
    new Set([
      ...(existing.evidenceQuotes ?? []),
      ...(incoming.evidenceQuotes ?? []),
    ]),
  );

  const polygonWkt =
    existing.polygonWkt.trim().toUpperCase() === "POLYGON EMPTY" &&
    incoming.polygonWkt.trim().toUpperCase() !== "POLYGON EMPTY"
      ? incoming.polygonWkt
      : existing.polygonWkt;

  return {
    ...existing,
    severity,
    description: incoming.description ?? existing.description,
    affectedCountryCodes: Array.from(
      new Set([
        ...existing.affectedCountryCodes,
        ...incoming.affectedCountryCodes,
      ]),
    ),
    affectedChokepoints: Array.from(
      new Set([
        ...existing.affectedChokepoints,
        ...incoming.affectedChokepoints,
      ]),
    ),
    affectedSectors: Array.from(
      new Set([...existing.affectedSectors, ...incoming.affectedSectors]),
    ),
    polygonWkt,
    sourceUrls: mergedUrls,
    ...(mergedQuotes.length > 0 ? { evidenceQuotes: mergedQuotes } : {}),
    lastSeenAt,
    ...(eventStartAt !== null || existing.eventStartAt !== undefined
      ? { eventStartAt }
      : {}),
    ...(eventEndAt !== null || existing.eventEndAt !== undefined
      ? { eventEndAt }
      : {}),
    expiresAt,
    confidence: Math.max(existing.confidence, incoming.confidence),
    verificationStatus,
    lifecycle:
      incoming.lifecycle === "RESOLVED"
        ? "RESOLVED"
        : existing.lifecycle === "PLANNED" && incoming.lifecycle === "ACTIVE"
          ? "ACTIVE"
          : existing.lifecycle,
    active:
      incoming.lifecycle === "RESOLVED"
        ? false
        : existing.active || incoming.active,
    resolvedAt:
      incoming.lifecycle === "RESOLVED"
        ? (incoming.resolvedAt ?? new Date().toISOString())
        : existing.resolvedAt,
  };
}

function buildTrigrams(text: string): Set<string> {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const trigrams = new Set<string>();
  if (normalized.length < 3) {
    if (normalized) trigrams.add(normalized);
    return trigrams;
  }
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Computes Jaccard similarity over character trigrams (0..1) for zero-token
 * near-duplicate news title pre-filtering and syndication detection.
 */
export function trigramJaccardSimilarity(a: string, b: string): number {
  const setA = buildTrigrams(a);
  const setB = buildTrigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
