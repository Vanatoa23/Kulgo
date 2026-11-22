import type { DerivedLaneCommercialSummary, SupplyLane } from "@kulgo/shared";

const massFactor = (unit: string) => unit === "TONNES" ? 1000 : unit === "KG" ? 1 : null;

export function allocationPreviewPool(
  lanes: readonly SupplyLane[],
  derived: ReadonlyMap<string, DerivedLaneCommercialSummary>,
): { total: number; mass: boolean } | null {
  const quantities = lanes.map((lane) => {
    const summary = derived.get(lane.laneId);
    // A derived value and its baseUnit are a pair; only fall back to the lane
    // unit when falling back to the lane quantity as well.
    return summary?.activeVolume != null
      ? { value: summary.activeVolume, unit: summary.baseUnit ?? lane.volumeUnit }
      : { value: lane.annualVolume ?? 0, unit: lane.volumeUnit };
  });
  const mass = quantities.every((q) => massFactor(q.unit) !== null) &&
    lanes.every((lane) => massFactor(lane.volumeUnit) !== null);
  const sameUnit = new Set([...quantities.map((q) => q.unit), ...lanes.map((l) => l.volumeUnit)]).size === 1;
  if (!mass && !sameUnit) return null;
  return { total: quantities.reduce((sum, q) => sum + q.value * (mass ? massFactor(q.unit)! : 1), 0), mass };
}

export function allocationPreviewVolume(
  pool: ReturnType<typeof allocationPreviewPool>, percentage: number, displayUnit: string,
): string | null {
  if (!pool || pool.total <= 0) return null;
  const factor = pool.mass ? massFactor(displayUnit)! : 1;
  return (pool.total * percentage / 100 / factor).toFixed(1);
}
