import type { HhiMetric } from "@kulgo/shared";

export interface ShareEntry {
  key: string;
  weight: number;
}

/**
 * Computes the Herfindahl-Hirschman Index (HHI) for a set of positive weights.
 * Raw HHI ranges from 0 to 10,000 (10,000 = 100% single source).
 */
export function computeHhi(
  dimension: HhiMetric["dimension"],
  label: string,
  entries: ShareEntry[],
): HhiMetric {
  const aggregated = new Map<string, number>();
  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    aggregated.set(entry.key, (aggregated.get(entry.key) ?? 0) + entry.weight);
  }

  const total = Array.from(aggregated.values()).reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return {
      dimension,
      label,
      rawHhi: 0,
      normalizedScore: 0,
      concentrationLevel: "LOW",
      isSinglePointOfFailure: false,
    };
  }

  let rawHhi = 0;
  for (const weight of aggregated.values()) {
    const sharePct = (weight / total) * 100;
    rawHhi += sharePct * sharePct;
  }

  rawHhi = Math.round(rawHhi);
  const normalizedScore = Math.min(100, Math.round(rawHhi / 100));
  const isSinglePointOfFailure = aggregated.size === 1;

  let concentrationLevel: HhiMetric["concentrationLevel"] = "LOW";
  if (isSinglePointOfFailure || rawHhi >= 9900) {
    concentrationLevel = "SINGLE_SOURCE";
  } else if (rawHhi >= 2500) {
    concentrationLevel = "HIGH";
  } else if (rawHhi >= 1500) {
    concentrationLevel = "MODERATE";
  }

  return {
    dimension,
    label,
    rawHhi,
    normalizedScore,
    concentrationLevel,
    isSinglePointOfFailure,
  };
}
