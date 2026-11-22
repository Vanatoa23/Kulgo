import type { DerivedLaneCommercialSummary, SupplyLane } from "@kulgo/shared";

const massFactor = (unit: string) => unit === "TONNES" ? 1000 : unit === "KG" ? 1 : null;

export function allocationPreviewPool(
  lanes: readonly SupplyLane[],
  derived: ReadonlyMap<string, DerivedLaneCommercialSummary>,
  percentages: Readonly<Record<string, number>> = Object.fromEntries(
    lanes.map((lane) => [lane.laneId, lane.allocationSplitPct ?? lane.volumeSharePct]),
  ),
) {
  const eligible = lanes.filter((lane) => derived.get(lane.laneId)?.laneCommercialState !== "LAPSED_UNCONTRACTED");
  const eligibleIds = new Set(eligible.map((lane) => lane.laneId));
  const eligiblePercentage = eligible.reduce((sum, lane) => sum + (percentages[lane.laneId] ?? 0), 0);
  const quantities = eligible.map((lane) => {
    const summary = derived.get(lane.laneId);
    // Analytics is authoritative even when its active quantity is unknown/null.
    // Legacy fallback is only appropriate when no derived summary is available.
    return summary
      ? { value: summary.activeVolume ?? 0, unit: summary.baseUnit ?? lane.volumeUnit }
      : { value: lane.annualVolume ?? 0, unit: lane.volumeUnit };
  });
  const mass = quantities.every((q) => massFactor(q.unit) !== null) &&
    eligible.every((lane) => massFactor(lane.volumeUnit) !== null);
  const sameUnit = new Set([...quantities.map((q) => q.unit), ...eligible.map((l) => l.volumeUnit)]).size <= 1;
  const canConvert = (mass || sameUnit) && !eligible.some((lane) => derived.get(lane.laneId)?.hasUnitConflict);
  const validSplit = Math.abs(lanes.reduce((sum, lane) => sum + (percentages[lane.laneId] ?? 0), 0) - 100) <= 0.5;
  return {
    total: canConvert ? quantities.reduce((sum, q) => sum + q.value * (mass ? massFactor(q.unit)! : 1), 0) : null,
    mass, eligibleIds, eligiblePercentage, validSplit,
  };
}

export function allocationPreviewVolume(
  pool: ReturnType<typeof allocationPreviewPool>, percentage: number, displayUnit: string, laneId: string,
): string | null {
  if (!pool.validSplit) return null;
  if (!pool.eligibleIds.has(laneId)) return "0.0";
  // The engine retains its source quantities if no eligible destination has a
  // positive allocation; those sources cannot be reconstructed from allocated output.
  if (pool.total === null || pool.total <= 0 || pool.eligiblePercentage <= 0) return null;
  const factor = pool.mass ? massFactor(displayUnit)! : 1;
  return (pool.total * percentage / pool.eligiblePercentage / factor).toFixed(1);
}
