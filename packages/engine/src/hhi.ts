import type {
  HhiCoverageReason,
  HhiMetric,
  HhiWeightingBasis,
} from "@kulgo/shared";

export interface ShareEntry {
  key: string;
  weight: number;
}

export interface HhiCoverageOptions {
  coveredLanesCount?: number;
  totalActiveLanesCount?: number;
  weightingBasis?: HhiWeightingBasis;
  unknownWeightPct?: number;
  isEstimatedUpperBoundForGhost?: boolean;
  coverageReason?: HhiCoverageReason | null;
}

function buildCoverageFields(
  options?: HhiCoverageOptions,
): Pick<
  HhiMetric,
  | "coveredLanesCount"
  | "totalActiveLanesCount"
  | "coveragePct"
  | "weightingBasis"
  | "unknownWeightPct"
  | "isEstimatedUpperBoundForGhost"
  | "coverageReason"
> {
  if (!options) return {};
  const result: Pick<
    HhiMetric,
    | "coveredLanesCount"
    | "totalActiveLanesCount"
    | "coveragePct"
    | "weightingBasis"
    | "unknownWeightPct"
    | "isEstimatedUpperBoundForGhost"
    | "coverageReason"
  > = {};

  if (
    options.coveredLanesCount !== undefined &&
    Number.isFinite(options.coveredLanesCount) &&
    options.coveredLanesCount >= 0
  ) {
    result.coveredLanesCount = Math.round(options.coveredLanesCount);
  }
  if (
    options.totalActiveLanesCount !== undefined &&
    Number.isFinite(options.totalActiveLanesCount) &&
    options.totalActiveLanesCount >= 0
  ) {
    result.totalActiveLanesCount = Math.round(options.totalActiveLanesCount);
  }
  if (
    result.coveredLanesCount !== undefined &&
    result.totalActiveLanesCount !== undefined
  ) {
    result.coveragePct =
      result.totalActiveLanesCount > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Math.round(
                (result.coveredLanesCount / result.totalActiveLanesCount) * 100,
              ),
            ),
          )
        : 0;
  }
  if (options.weightingBasis) {
    result.weightingBasis = options.weightingBasis;
  }
  if (
    options.unknownWeightPct !== undefined &&
    Number.isFinite(options.unknownWeightPct)
  ) {
    result.unknownWeightPct = Math.min(
      100,
      Math.max(0, Math.round(options.unknownWeightPct * 100) / 100),
    );
  }
  if (options.isEstimatedUpperBoundForGhost !== undefined) {
    result.isEstimatedUpperBoundForGhost =
      options.isEstimatedUpperBoundForGhost;
  }
  if (options.coverageReason !== undefined) {
    result.coverageReason = options.coverageReason;
  }
  return result;
}

/**
 * Computes the Herfindahl-Hirschman Index (HHI) for a set of positive weights.
 * Raw HHI ranges from 0 to 10,000 (10,000 = 100% single source).
 * Supports partial-coverage metadata ("Based on X of Y active lanes").
 */
export function computeHhi(
  dimension: HhiMetric["dimension"],
  label: string,
  entries: ShareEntry[],
  coverageOptions?: HhiCoverageOptions,
): HhiMetric {
  const coverageFields = buildCoverageFields(coverageOptions);
  const aggregated = new Map<string, number>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) continue;
    aggregated.set(entry.key, (aggregated.get(entry.key) ?? 0) + entry.weight);
  }

  const total = Array.from(aggregated.values()).reduce((sum, v) => sum + v, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return {
      dimension,
      label,
      rawHhi: 0,
      normalizedScore: 0,
      concentrationLevel: "LOW",
      isSinglePointOfFailure: false,
      ...coverageFields,
    };
  }

  let rawHhi = 0;
  for (const weight of aggregated.values()) {
    const sharePct = (weight / total) * 100;
    rawHhi += sharePct * sharePct;
  }

  rawHhi = Math.min(10000, Math.max(0, Math.round(rawHhi)));
  const normalizedScore = Math.min(100, Math.max(0, Math.round(rawHhi / 100)));
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
    ...coverageFields,
  };
}

