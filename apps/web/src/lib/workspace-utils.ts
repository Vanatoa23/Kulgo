import type {
  Facility,
  RiskStatus,
  SupplyInput,
  SupplyLane,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";

export type RgbColor = readonly [number, number, number];
export type RgbaColor = readonly [number, number, number, number];

export const RISK_COLORS: Record<RiskStatus, RgbColor> = {
  GREEN: [16, 185, 129],
  YELLOW: [245, 158, 11],
  RED: [239, 68, 68],
};

export interface WorkspaceFilterState {
  productId: string | null;
  inputId: string | null;
}

export interface WorkspaceSummaryStats {
  totalSpendEur: number;
  greenLaneCount: number;
  yellowLaneCount: number;
  redLaneCount: number;
  unverifiedHqCount: number;
  verifiedSiteCount: number;
  totalLanes: number;
  totalFacilities: number;
}

export interface FilteredWorkspaceResult {
  inputs: SupplyInput[];
  lanes: SupplyLane[];
  facilities: Facility[];
  stats: WorkspaceSummaryStats;
}

export interface CorridorArcDatum {
  laneId: string;
  lane: SupplyLane;
  fromFacility: Facility;
  toFacility: Facility;
  inputName: string | null;
  sourcePosition: [number, number];
  targetPosition: [number, number];
  color: [number, number, number];
  sourceColor: [number, number, number, number];
  targetColor: [number, number, number, number];
  width: number;
}

export interface FacilityMarkerDatum {
  facilityId: string;
  facility: Facility;
  position: [number, number];
  fillColor: [number, number, number, number];
  lineColor: [number, number, number, number];
  radiusPixels: number;
  label: string;
}

export interface NetworkBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function filterWorkspaceNetwork(
  network: WorkspaceNetworkResponse,
  filters: WorkspaceFilterState,
): FilteredWorkspaceResult {
  const { productId, inputId } = filters;

  const visibleInputs = productId
    ? network.inputs.filter((item) => item.productId === productId)
    : network.inputs;

  const allowedInputIds = productId
    ? new Set(visibleInputs.map((item) => item.inputId))
    : null;

  const filteredLanes = network.lanes.filter((lane) => {
    if (allowedInputIds !== null) {
      if (!lane.inputId || !allowedInputIds.has(lane.inputId)) {
        return false;
      }
    }
    if (inputId !== null && lane.inputId !== inputId) {
      return false;
    }
    return true;
  });

  const isFiltering = productId !== null || inputId !== null;
  let filteredFacilities: Facility[];

  if (!isFiltering) {
    filteredFacilities = network.facilities;
  } else {
    const connectedFacilityIds = new Set<string>();
    for (const lane of filteredLanes) {
      connectedFacilityIds.add(lane.fromFacilityId);
      connectedFacilityIds.add(lane.toFacilityId);
    }
    filteredFacilities = network.facilities.filter(
      (facility) =>
        facility.isOwnFacility || connectedFacilityIds.has(facility.facilityId),
    );
  }

  let totalSpendEur = 0;
  let greenLaneCount = 0;
  let yellowLaneCount = 0;
  let redLaneCount = 0;

  for (const lane of filteredLanes) {
    totalSpendEur += lane.annualSpendEur ?? 0;
    if (lane.riskStatus === "GREEN") {
      greenLaneCount += 1;
    } else if (lane.riskStatus === "YELLOW") {
      yellowLaneCount += 1;
    } else {
      redLaneCount += 1;
    }
  }

  let unverifiedHqCount = 0;
  let verifiedSiteCount = 0;
  for (const facility of filteredFacilities) {
    if (facility.locationPrecision === "SITE_VERIFIED") {
      verifiedSiteCount += 1;
    } else {
      unverifiedHqCount += 1;
    }
  }

  return {
    inputs: visibleInputs,
    lanes: filteredLanes,
    facilities: filteredFacilities,
    stats: {
      totalSpendEur,
      greenLaneCount,
      yellowLaneCount,
      redLaneCount,
      unverifiedHqCount,
      verifiedSiteCount,
      totalLanes: filteredLanes.length,
      totalFacilities: filteredFacilities.length,
    },
  };
}

export function computeCorridorWidth(
  volumeSharePct: number,
  annualSpendEur: number | null | undefined,
): number {
  const clampedShare = Math.max(0, Math.min(100, volumeSharePct));
  const shareComponent = 2 + (clampedShare / 100) * 4.5;
  const spendBoost =
    annualSpendEur && annualSpendEur > 0
      ? Math.min(2.5, Math.log10(annualSpendEur / 10000 + 1) * 0.9)
      : 0;
  return Number((shareComponent + spendBoost).toFixed(2));
}

export function buildCorridorArcs(
  lanes: readonly SupplyLane[],
  facilitiesById: ReadonlyMap<string, Facility>,
  inputsById?: ReadonlyMap<string, SupplyInput>,
): CorridorArcDatum[] {
  const arcs: CorridorArcDatum[] = [];

  for (const lane of lanes) {
    const fromFacility = facilitiesById.get(lane.fromFacilityId);
    const toFacility = facilitiesById.get(lane.toFacilityId);
    if (!fromFacility || !toFacility) {
      continue;
    }

    const baseRgb = RISK_COLORS[lane.riskStatus];
    const [r, g, b] = baseRgb;
    const linkedInput = lane.inputId ? inputsById?.get(lane.inputId) : undefined;

    arcs.push({
      laneId: lane.laneId,
      lane,
      fromFacility,
      toFacility,
      inputName: linkedInput?.name ?? null,
      sourcePosition: [fromFacility.lng, fromFacility.lat],
      targetPosition: [toFacility.lng, toFacility.lat],
      color: [r, g, b],
      sourceColor: [r, g, b, 215],
      targetColor: [r, g, b, 255],
      width: computeCorridorWidth(lane.volumeSharePct, lane.annualSpendEur),
    });
  }

  return arcs;
}

export function buildFacilityMarkers(
  facilities: readonly Facility[],
  selectedFacilityId?: string | null,
): FacilityMarkerDatum[] {
  return facilities.map((facility) => {
    const isSelected = facility.facilityId === selectedFacilityId;
    let fillColor: [number, number, number, number];
    let lineColor: [number, number, number, number];
    let radiusPixels: number;

    if (facility.isOwnFacility) {
      fillColor = [16, 185, 129, 240]; // Emerald own HQ
      lineColor = [236, 253, 245, 255];
      radiusPixels = isSelected ? 12 : 10;
    } else if (facility.locationPrecision === "SITE_VERIFIED") {
      fillColor = [6, 182, 212, 230]; // Cyan verified site
      lineColor = [207, 250, 254, 255];
      radiusPixels = isSelected ? 10 : 8;
    } else {
      fillColor = [245, 158, 11, 185]; // Amber HQ estimated
      lineColor = [254, 243, 199, 255];
      radiusPixels = isSelected ? 9 : 7;
    }

    return {
      facilityId: facility.facilityId,
      facility,
      position: [facility.lng, facility.lat],
      fillColor,
      lineColor,
      radiusPixels,
      label: facility.name,
    };
  });
}

export function computeFacilitiesBounds(
  facilities: readonly Facility[],
): NetworkBounds | null {
  const first = facilities[0];
  if (!first) {
    return null;
  }

  let minLng = first.lng;
  let maxLng = first.lng;
  let minLat = first.lat;
  let maxLat = first.lat;

  for (let i = 1; i < facilities.length; i += 1) {
    const item = facilities[i];
    if (!item) continue;
    if (item.lng < minLng) minLng = item.lng;
    if (item.lng > maxLng) maxLng = item.lng;
    if (item.lat < minLat) minLat = item.lat;
    if (item.lat > maxLat) maxLat = item.lat;
  }

  if (maxLng - minLng < 0.25) {
    minLng = Math.max(-180, minLng - 0.5);
    maxLng = Math.min(180, maxLng + 0.5);
  }
  if (maxLat - minLat < 0.25) {
    minLat = Math.max(-85, minLat - 0.5);
    maxLat = Math.min(85, maxLat + 0.5);
  }

  return { minLng, minLat, maxLng, maxLat };
}

export function formatEur(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  if (amount >= 1_000_000) {
    return `€${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `€${Math.round(amount / 1_000)}k`;
  }
  return `€${Math.round(amount).toLocaleString("en-US")}`;
}
