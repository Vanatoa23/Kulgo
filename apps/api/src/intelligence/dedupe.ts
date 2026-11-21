import { createHash } from "node:crypto";
import type { RiskSignal, RiskSignalKind } from "@kulgo/shared";

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
 * Deterministic canonical deduplication key:
 * sha256(kind + ":" + canonicalLocationOrChokepoint + ":" + isoYearWeek)
 */
export function computeCanonicalDedupeKey(
  kind: RiskSignalKind,
  canonicalLocation: string,
  isoDate: string,
): string {
  const normalizedLocation = canonicalLocation
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const bucket = toIsoYearWeek(isoDate);
  return createHash("sha256")
    .update(`${kind}:${normalizedLocation}:${bucket}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Extracts normalized apex hostname from a URL for independent-source counting.
 */
export function extractSourceDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Merges an incoming RiskSignal into an existing canonical RiskSignal:
 * - Unions sourceUrls, affectedCountryCodes, affectedChokepoints, affectedSectors
 * - Updates lastSeenAt and extends expiresAt
 * - Promotes verificationStatus from ALLEGED -> CORROBORATED if >= 2 independent domains
 *   report the same event (CONFIRMED always stays CONFIRMED)
 */
export function mergeRiskSignals(
  existing: RiskSignal,
  incoming: RiskSignal,
): RiskSignal {
  const mergedUrls = Array.from(
    new Set([...existing.sourceUrls, ...incoming.sourceUrls]),
  );
  const uniqueDomains = new Set(
    mergedUrls.map(extractSourceDomain).filter((d): d is string => d !== null),
  );

  let verificationStatus = existing.verificationStatus;
  if (
    existing.verificationStatus === "CONFIRMED" ||
    incoming.verificationStatus === "CONFIRMED"
  ) {
    verificationStatus = "CONFIRMED";
  } else if (
    existing.verificationStatus === "CORROBORATED" ||
    incoming.verificationStatus === "CORROBORATED" ||
    uniqueDomains.size >= 2
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
    incoming.lastSeenAt && existing.lastSeenAt
      ? incoming.lastSeenAt > existing.lastSeenAt
        ? incoming.lastSeenAt
        : existing.lastSeenAt
      : (incoming.lastSeenAt ?? existing.lastSeenAt ?? new Date().toISOString());

  const expiresAt =
    incoming.expiresAt && existing.expiresAt
      ? incoming.expiresAt > existing.expiresAt
        ? incoming.expiresAt
        : existing.expiresAt
      : (incoming.expiresAt ?? existing.expiresAt);

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
    sourceUrls: mergedUrls,
    lastSeenAt,
    expiresAt,
    confidence: Math.max(existing.confidence, incoming.confidence),
    verificationStatus,
    lifecycle:
      incoming.lifecycle === "RESOLVED"
        ? "RESOLVED"
        : existing.lifecycle === "PLANNED" && incoming.lifecycle === "ACTIVE"
          ? "ACTIVE"
          : existing.lifecycle,
    active: incoming.lifecycle === "RESOLVED" ? false : existing.active || incoming.active,
    resolvedAt:
      incoming.lifecycle === "RESOLVED"
        ? (incoming.resolvedAt ?? new Date().toISOString())
        : existing.resolvedAt,
  };
}

function buildTrigrams(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
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
 * near-duplicate news title pre-filtering before invoking Stage 2 LLMs.
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
