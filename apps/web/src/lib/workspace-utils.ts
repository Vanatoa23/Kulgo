import type {
  Facility,
  Product,
  RiskSignal,
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

export const RISK_HEX_COLORS: Record<RiskStatus, string> = {
  GREEN: "#10b981",
  YELLOW: "#f59e0b",
  RED: "#ef4444",
};

export interface RiskSignalPolygonDatum {
  signalId: string;
  signal: RiskSignal;
  polygon: [number, number][];
  fillColor: [number, number, number, number];
  lineColor: [number, number, number, number];
}

export function parseWktPolygonRing(wkt: string): [number, number][] {
  const match = /POLYGON\s*\(\s*\(([^)]+)\)/i.exec(wkt.trim());
  if (!match?.[1]) {
    return [];
  }
  const coords: [number, number][] = [];
  for (const pair of match[1].split(",")) {
    const parts = pair.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      coords.push([lng, lat]);
    }
  }
  return coords;
}

export function buildRiskSignalPolygons(
  riskSignals: readonly RiskSignal[],
): RiskSignalPolygonDatum[] {
  const polygons: RiskSignalPolygonDatum[] = [];
  for (const signal of riskSignals) {
    if (!signal.active) continue;
    const polygon = parseWktPolygonRing(signal.polygonWkt);
    if (polygon.length < 3) continue;
    const [r, g, b] = RISK_COLORS[signal.severity];
    polygons.push({
      signalId: signal.signalId,
      signal,
      polygon,
      fillColor: [r, g, b, signal.severity === "RED" ? 48 : 38],
      lineColor: [r, g, b, 210],
    });
  }
  return polygons;
}

export interface LogicalGraphNodeModel {
  id: string;
  kind: "product" | "input" | "facility";
  entityId: string;
  position: { x: number; y: number };
  label: string;
  subtitle: string;
  badge: string;
  riskStatus: RiskStatus;
  isOwnFacility?: boolean;
  isSpof?: boolean;
  isSelected: boolean;
}

export interface LogicalGraphEdgeModel {
  id: string;
  source: string;
  target: string;
  kind: "bom" | "supply" | "delivery";
  laneId: string | null;
  riskStatus: RiskStatus | null;
  color: string;
  label: string;
  animated: boolean;
  isSelected: boolean;
}

export interface LogicalGraphModel {
  nodes: LogicalGraphNodeModel[];
  edges: LogicalGraphEdgeModel[];
}

export function buildLogicalGraphModel(params: {
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  activeProductId: string | null;
  activeInputId: string | null;
  selectedFacilityId: string | null;
  selectedLaneId: string | null;
}): LogicalGraphModel {
  const {
    products,
    inputs,
    facilities,
    lanes,
    activeProductId,
    activeInputId,
    selectedFacilityId,
    selectedLaneId,
  } = params;

  const nodes: LogicalGraphNodeModel[] = [];
  const edges: LogicalGraphEdgeModel[] = [];

  const visibleProducts = activeProductId
    ? products.filter((p) => p.productId === activeProductId)
    : products;

  const visibleInputs = activeInputId
    ? inputs.filter((i) => i.inputId === activeInputId)
    : inputs;

  const visibleInputIds = new Set(visibleInputs.map((i) => i.inputId));
  const visibleFacilityIds = new Set(facilities.map((f) => f.facilityId));

  // Worst risk status per input & facility for status indicators
  const riskRank: Record<RiskStatus, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
  const worstRisk = (a: RiskStatus, b: RiskStatus): RiskStatus =>
    riskRank[b] > riskRank[a] ? b : a;

  const inputRiskMap = new Map<string, RiskStatus>();
  const inputSupplierCountMap = new Map<string, Set<string>>();
  const facilityRiskMap = new Map<string, RiskStatus>();

  for (const lane of lanes) {
    if (lane.inputId) {
      inputRiskMap.set(
        lane.inputId,
        worstRisk(inputRiskMap.get(lane.inputId) ?? "GREEN", lane.riskStatus),
      );
      const set = inputSupplierCountMap.get(lane.inputId) ?? new Set<string>();
      set.add(lane.fromFacilityId);
      inputSupplierCountMap.set(lane.inputId, set);
    }
    facilityRiskMap.set(
      lane.fromFacilityId,
      worstRisk(
        facilityRiskMap.get(lane.fromFacilityId) ?? "GREEN",
        lane.riskStatus,
      ),
    );
    facilityRiskMap.set(
      lane.toFacilityId,
      worstRisk(
        facilityRiskMap.get(lane.toFacilityId) ?? "GREEN",
        lane.riskStatus,
      ),
    );
  }

  // Column 1: Products (x = 40)
  const productGapY = 140;
  visibleProducts.forEach((product, idx) => {
    const linkedInputs = visibleInputs.filter(
      (i) => i.productId === product.productId,
    );
    let prodRisk: RiskStatus = "GREEN";
    for (const inp of linkedInputs) {
      prodRisk = worstRisk(prodRisk, inputRiskMap.get(inp.inputId) ?? "GREEN");
    }
    nodes.push({
      id: `product:${product.productId}`,
      kind: "product",
      entityId: product.productId,
      position: { x: 40, y: 80 + idx * productGapY },
      label: product.name,
      subtitle: product.sku ?? `${linkedInputs.length} materials`,
      badge: "PRODUCT",
      riskStatus: prodRisk,
      isSelected: activeProductId === product.productId,
    });
  });

  // Column 2: SupplyInputs / Materials A-F (x = 360)
  const inputGapY = 112;
  visibleInputs.forEach((input, idx) => {
    const suppliers = inputSupplierCountMap.get(input.inputId);
    const isSpof = suppliers !== undefined && suppliers.size === 1;
    nodes.push({
      id: `input:${input.inputId}`,
      kind: "input",
      entityId: input.inputId,
      position: { x: 360, y: 40 + idx * inputGapY },
      label: input.name,
      subtitle: input.category,
      badge: isSpof ? "SPOF" : input.unit,
      riskStatus: inputRiskMap.get(input.inputId) ?? "GREEN",
      isSpof,
      isSelected: activeInputId === input.inputId,
    });

    if (
      input.productId &&
      visibleProducts.some((p) => p.productId === input.productId)
    ) {
      edges.push({
        id: `bom:${input.productId}->${input.inputId}`,
        source: `product:${input.productId}`,
        target: `input:${input.inputId}`,
        kind: "bom",
        laneId: null,
        riskStatus: null,
        color: "#475569",
        label: "",
        animated: false,
        isSelected: false,
      });
    }
  });

  // Column 3: Supplier Facilities (x = 710), Column 4: Own Facilities (x = 1070)
  const supplierFacilities = facilities.filter((f) => !f.isOwnFacility);
  const ownFacilities = facilities.filter((f) => f.isOwnFacility);

  const facilityGapY = 122;
  supplierFacilities.forEach((facility, idx) => {
    nodes.push({
      id: `facility:${facility.facilityId}`,
      kind: "facility",
      entityId: facility.facilityId,
      position: { x: 710, y: 40 + idx * facilityGapY },
      label: facility.name,
      subtitle: `${facility.countryCode} · ${facility.sector ?? facility.kind}`,
      badge:
        facility.locationPrecision === "SITE_VERIFIED"
          ? "SITE_VERIFIED"
          : "HQ_ESTIMATED",
      riskStatus: facilityRiskMap.get(facility.facilityId) ?? "GREEN",
      isOwnFacility: false,
      isSelected: selectedFacilityId === facility.facilityId,
    });
  });

  ownFacilities.forEach((facility, idx) => {
    nodes.push({
      id: `facility:${facility.facilityId}`,
      kind: "facility",
      entityId: facility.facilityId,
      position: { x: 1070, y: 120 + idx * 140 },
      label: facility.name,
      subtitle: `${facility.countryCode} · Own ${facility.kind}`,
      badge: "OWN HQ",
      riskStatus: facilityRiskMap.get(facility.facilityId) ?? "GREEN",
      isOwnFacility: true,
      isSelected: selectedFacilityId === facility.facilityId,
    });
  });

  // SupplyLane edges (Green / Yellow / Red)
  for (const lane of lanes) {
    if (
      !visibleFacilityIds.has(lane.fromFacilityId) ||
      !visibleFacilityIds.has(lane.toFacilityId)
    ) {
      continue;
    }

    const color = RISK_HEX_COLORS[lane.riskStatus];
    const isSelected = selectedLaneId === lane.laneId;
    const label = `${lane.volumeSharePct}% · ${lane.transportMode}`;

    if (lane.inputId && visibleInputIds.has(lane.inputId)) {
      edges.push({
        id: `lane-in:${lane.laneId}`,
        source: `input:${lane.inputId}`,
        target: `facility:${lane.fromFacilityId}`,
        kind: "supply",
        laneId: lane.laneId,
        riskStatus: lane.riskStatus,
        color,
        label,
        animated: lane.riskStatus === "RED" || isSelected,
        isSelected,
      });
    }

    edges.push({
      id: `lane-del:${lane.laneId}`,
      source: `facility:${lane.fromFacilityId}`,
      target: `facility:${lane.toFacilityId}`,
      kind: "delivery",
      laneId: lane.laneId,
      riskStatus: lane.riskStatus,
      color,
      label: lane.inputId ? `${lane.transportMode}` : label,
      animated: lane.riskStatus === "RED" || isSelected,
      isSelected,
    });
  }

  return { nodes, edges };
}
