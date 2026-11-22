import type { PickingInfo } from "@deck.gl/core";
import {
  ArcLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  resolveFacilityRole,
  resolveLaneDirection,
  type AnalyticsSummary,
  type Facility,
  type RiskSignal,
  type SupplyInput,
  type SupplyLane,
} from "@kulgo/shared";
import {
  AlertTriangle,
  ArrowRight,
  Crosshair,
  ExternalLink,
  Flame,
  GitBranch,
  Layers,
  ShieldAlert,
  Sliders,
  X,
} from "lucide-react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCorridorArcs,
  buildFacilityMarkers,
  buildRiskSignalPolygons,
  computeFacilitiesBounds,
  formatEur,
  type CorridorArcDatum,
  type FacilityMarkerDatum,
  type RiskSignalPolygonDatum,
} from "../lib/workspace-utils.js";
import type { MapInteractionMode } from "./FilterBar.js";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const DARK_BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const DEFAULT_CENTER: [number, number] = [24.7536, 59.437];
const DEFAULT_ZOOM = 3.6;

type FlowFilterMode = "suppliers" | "both" | "clients";

interface ChokepointMarkerDatum {
  signal: RiskSignal;
  position: [number, number];
  label: string;
}

interface FlowPulseDatum {
  laneId: string;
  position: [number, number];
  color: [number, number, number, number];
  radius: number;
}

function computePolygonCentroid(
  polygon: readonly [number, number][],
): [number, number] | null {
  if (polygon.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of polygon) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / polygon.length, sumLat / polygon.length];
}

function lerpPosition(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export interface SupplyMapProps {
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  inputs: readonly SupplyInput[];
  riskSignals?: readonly RiskSignal[];
  analytics?: AnalyticsSummary | null;
  selectedFacilityId: string | null;
  selectedLaneId: string | null;
  mapMode: MapInteractionMode;
  refiningFacilityName: string | null;
  fitTrigger: number;
  onSelectFacility: (facilityId: string) => void;
  onSelectLane: (laneId: string) => void;
  onMapPickCoordinates: (coords: { lat: number; lng: number }) => void;
  onCancelMapMode: () => void;
  onAcknowledgeSignal?: (
    signalId: string,
    status: "ACKNOWLEDGED" | "MUTED",
  ) => Promise<void>;
  onToggleLogicalGraph?: () => void;
  onOpenSimulator?: () => void;
  onInspectLaneInHub?: (lane: SupplyLane) => void;
}

type HoverState =
  | { kind: "lane"; x: number; y: number; datum: CorridorArcDatum }
  | { kind: "facility"; x: number; y: number; datum: FacilityMarkerDatum }
  | { kind: "signal"; x: number; y: number; datum: RiskSignalPolygonDatum }
  | null;

export function SupplyMap({
  facilities,
  lanes,
  inputs,
  riskSignals = [],
  analytics = null,
  selectedFacilityId,
  selectedLaneId,
  mapMode,
  refiningFacilityName,
  fitTrigger,
  onSelectFacility,
  onSelectLane,
  onMapPickCoordinates,
  onCancelMapMode,
  onAcknowledgeSignal,
  onToggleLogicalGraph,
  onOpenSimulator,
  onInspectLaneInHub,
}: SupplyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [hover, setHover] = useState<HoverState>(null);
  const [inspectedSignal, setInspectedSignal] = useState<RiskSignal | null>(
    null,
  );
  const [tileError, setTileError] = useState<string | null>(null);

  // Strategy-game HUD state
  const [flowFilter, setFlowFilter] = useState<FlowFilterMode>("both");
  const [showRiskPolygons, setShowRiskPolygons] = useState(true);
  const [showChokepoints, setShowChokepoints] = useState(true);
  const [showEmissions, setShowEmissions] = useState(false);
  const [localSelectedLaneId, setLocalSelectedLaneId] = useState<string | null>(
    selectedLaneId,
  );
  const [localFocusFacilityId, setLocalFocusFacilityId] = useState<
    string | null
  >(selectedFacilityId);
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    setLocalSelectedLaneId(selectedLaneId);
  }, [selectedLaneId]);

  useEffect(() => {
    setLocalFocusFacilityId(selectedFacilityId);
  }, [selectedFacilityId]);

  // Subtle animated directional flow pulses (~16fps)
  useEffect(() => {
    let rafId = 0;
    let lastTs = 0;
    const step = (ts: number) => {
      if (ts - lastTs >= 60) {
        lastTs = ts;
        setPulsePhase((p) => (p + 0.022) % 1);
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const mapModeRef = useRef<MapInteractionMode>(mapMode);
  mapModeRef.current = mapMode;

  const callbacksRef = useRef({
    onSelectFacility,
    onSelectLane,
    onMapPickCoordinates,
  });
  callbacksRef.current = {
    onSelectFacility,
    onSelectLane,
    onMapPickCoordinates,
  };

  const facilitiesById = useMemo(
    () => new Map(facilities.map((f) => [f.facilityId, f])),
    [facilities],
  );
  const inputsById = useMemo(
    () => new Map(inputs.map((i) => [i.inputId, i])),
    [inputs],
  );
  const derivedByLaneId = useMemo(
    () =>
      new Map(
        (analytics?.financialRisk?.laneCommercials ?? []).map((c) => [
          c.laneId,
          c,
        ]),
      ),
    [analytics],
  );

  // Apply [Suppliers | Both | Clients] flow toggle
  const visibleLanes = useMemo(() => {
    return lanes.filter((lane) => {
      const dir = resolveLaneDirection(
        lane,
        facilitiesById.get(lane.fromFacilityId),
        facilitiesById.get(lane.toFacilityId),
      );
      if (flowFilter === "suppliers") return dir !== "DOWNSTREAM";
      if (flowFilter === "clients") return dir === "DOWNSTREAM";
      return true;
    });
  }, [lanes, facilitiesById, flowFilter]);

  const visibleFacilities = useMemo(() => {
    if (flowFilter === "both") return facilities;
    return facilities.filter((f) => {
      const role = resolveFacilityRole(f);
      if (flowFilter === "suppliers") return role === "SUPPLIER" || role === "OWN";
      return role === "CLIENT" || role === "OWN";
    });
  }, [facilities, flowFilter]);

  const arcs = useMemo(
    () => buildCorridorArcs(visibleLanes, facilitiesById, inputsById),
    [visibleLanes, facilitiesById, inputsById],
  );

  const markers = useMemo(
    () => buildFacilityMarkers(visibleFacilities, localFocusFacilityId),
    [visibleFacilities, localFocusFacilityId],
  );

  const riskPolygons = useMemo(
    () => buildRiskSignalPolygons(riskSignals),
    [riskSignals],
  );

  // Focus / Isolation mode: hovered facility takes precedence, else locked focus facility
  const activeFocusId =
    hover?.kind === "facility" ? hover.datum.facilityId : localFocusFacilityId;

  const focusedConnectedFacilityIds = useMemo(() => {
    if (!activeFocusId) return null;
    const set = new Set<string>([activeFocusId]);
    for (const arc of arcs) {
      if (
        arc.lane.fromFacilityId === activeFocusId ||
        arc.lane.toFacilityId === activeFocusId
      ) {
        set.add(arc.lane.fromFacilityId);
        set.add(arc.lane.toFacilityId);
      }
    }
    return set;
  }, [activeFocusId, arcs]);

  // Animated directional pulse dots along visible arcs
  const pulseDots = useMemo<FlowPulseDatum[]>(() => {
    const dots: FlowPulseDatum[] = [];
    for (const arc of arcs) {
      const isDimmed =
        activeFocusId !== null &&
        arc.lane.fromFacilityId !== activeFocusId &&
        arc.lane.toFacilityId !== activeFocusId;
      if (isDimmed) continue;
      for (const offset of [0, 0.5]) {
        const t = (pulsePhase + offset) % 1;
        dots.push({
          laneId: arc.laneId,
          position: lerpPosition(arc.sourcePosition, arc.targetPosition, t),
          color: [arc.color[0], arc.color[1], arc.color[2], 235],
          radius: Math.max(3, Math.min(6, arc.width * 0.75)),
        });
      }
    }
    return dots;
  }, [arcs, pulsePhase, activeFocusId]);

  // Imperative MapLibre + Deck.gl MapboxOverlay lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: DARK_BASEMAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 24,
      bearing: 0,
      attributionControl: { compact: true },
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on("click", (event) => {
      if (mapModeRef.current !== "inspect") {
        callbacksRef.current.onMapPickCoordinates({
          lat: Number(event.lngLat.lat.toFixed(5)),
          lng: Number(event.lngLat.lng.toFixed(5)),
        });
      }
    });

    map.on("error", () => {
      setTileError(
        "Map basemap tiles could not be loaded (offline or blocked). Corridor overlays remain interactive.",
      );
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl);
      } catch {
        // Ignore teardown race
      }
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Update Deck.gl layers
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const isPickingCoords = mapMode !== "inspect";
    const maxCo2 = Math.max(
      1,
      ...arcs.map((a) => a.lane.estimatedLaneCo2e ?? 0),
    );

    const arcLayer = new ArcLayer<CorridorArcDatum>({
      id: "kulgo-corridors",
      data: arcs,
      pickable: !isPickingCoords,
      autoHighlight: !isPickingCoords,
      highlightColor: [255, 255, 255, 110],
      widthUnits: "pixels",
      widthMinPixels: 2,
      widthMaxPixels: 12,
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getSourceColor: (d) => {
        if (d.laneId === localSelectedLaneId) return [255, 255, 255, 255];
        const dimmed =
          activeFocusId !== null &&
          d.lane.fromFacilityId !== activeFocusId &&
          d.lane.toFacilityId !== activeFocusId;
        if (showEmissions) {
          const ratio = Math.min(1, (d.lane.estimatedLaneCo2e ?? 0) / maxCo2);
          const r = Math.round(56 + ratio * 195);
          const g = Math.round(189 - ratio * 120);
          const b = Math.round(248 - ratio * 200);
          return [r, g, b, dimmed ? 32 : 210];
        }
        const derived = derivedByLaneId.get(d.laneId);
        if ((derived?.atRiskVolumePct ?? 0) > 30 && d.lane.riskStatus === "GREEN") {
          return [245, 158, 11, dimmed ? 32 : 220];
        }
        return [
          d.sourceColor[0],
          d.sourceColor[1],
          d.sourceColor[2],
          dimmed ? 32 : d.sourceColor[3],
        ];
      },
      getTargetColor: (d) => {
        if (d.laneId === localSelectedLaneId) return [255, 255, 255, 255];
        const dimmed =
          activeFocusId !== null &&
          d.lane.fromFacilityId !== activeFocusId &&
          d.lane.toFacilityId !== activeFocusId;
        if (showEmissions) {
          const ratio = Math.min(1, (d.lane.estimatedLaneCo2e ?? 0) / maxCo2);
          const r = Math.round(56 + ratio * 195);
          const g = Math.round(189 - ratio * 120);
          const b = Math.round(248 - ratio * 200);
          return [r, g, b, dimmed ? 32 : 240];
        }
        return [
          d.targetColor[0],
          d.targetColor[1],
          d.targetColor[2],
          dimmed ? 32 : d.targetColor[3],
        ];
      },
      getWidth: (d) => {
        const derived = derivedByLaneId.get(d.laneId);
        const derivedShare = derived?.knownMappedSharePct ?? d.lane.volumeSharePct;
        const baseWidth = Math.max(2, Math.min(10, 2 + (derivedShare / 100) * 6.5));
        return d.laneId === localSelectedLaneId ? baseWidth + 2.5 : baseWidth;
      },
      onHover: (info: PickingInfo<CorridorArcDatum>) => {
        if (info.object) {
          setHover({
            kind: "lane",
            x: info.x,
            y: info.y,
            datum: info.object,
          });
        } else {
          setHover((prev) => (prev?.kind === "lane" ? null : prev));
        }
      },
      onClick: (info: PickingInfo<CorridorArcDatum>) => {
        if (info.object && mapModeRef.current === "inspect") {
          setLocalSelectedLaneId(info.object.laneId);
          setInspectedSignal(null);
          callbacksRef.current.onSelectLane(info.object.laneId);
        }
      },
      updateTriggers: {
        getSourceColor: [localSelectedLaneId, activeFocusId, showEmissions, derivedByLaneId],
        getTargetColor: [localSelectedLaneId, activeFocusId, showEmissions],
        getWidth: [localSelectedLaneId, derivedByLaneId],
      },
    });

    const pulseLayer = new ScatterplotLayer<FlowPulseDatum>({
      id: "kulgo-flow-pulses",
      data: pulseDots,
      pickable: false,
      stroked: false,
      filled: true,
      radiusUnits: "pixels",
      getPosition: (d) => d.position,
      getRadius: (d) => d.radius,
      getFillColor: (d) => d.color,
    });

    const facilityLayer = new ScatterplotLayer<FacilityMarkerDatum>({
      id: "kulgo-facilities",
      data: markers,
      pickable: !isPickingCoords,
      autoHighlight: !isPickingCoords,
      stroked: true,
      filled: true,
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      getPosition: (d) => d.position,
      getRadius: (d) =>
        d.facilityId === activeFocusId ? d.radiusPixels + 2.5 : d.radiusPixels,
      getFillColor: (d) => {
        const dimmed =
          focusedConnectedFacilityIds !== null &&
          !focusedConnectedFacilityIds.has(d.facilityId);
        return [
          d.fillColor[0],
          d.fillColor[1],
          d.fillColor[2],
          dimmed ? 65 : d.fillColor[3],
        ];
      },
      getLineColor: (d) => {
        const dimmed =
          focusedConnectedFacilityIds !== null &&
          !focusedConnectedFacilityIds.has(d.facilityId);
        return [
          d.lineColor[0],
          d.lineColor[1],
          d.lineColor[2],
          dimmed ? 65 : d.lineColor[3],
        ];
      },
      getLineWidth: (d) =>
        d.facilityId === activeFocusId
          ? 3
          : d.facility.locationPrecision === "HQ_ESTIMATED"
            ? 2
            : 1.5,
      onHover: (info: PickingInfo<FacilityMarkerDatum>) => {
        if (info.object) {
          setHover({
            kind: "facility",
            x: info.x,
            y: info.y,
            datum: info.object,
          });
        } else {
          setHover((prev) => (prev?.kind === "facility" ? null : prev));
        }
      },
      onClick: (info: PickingInfo<FacilityMarkerDatum>) => {
        if (info.object && mapModeRef.current === "inspect") {
          setLocalFocusFacilityId((prev) =>
            prev === info.object!.facilityId ? null : info.object!.facilityId,
          );
          callbacksRef.current.onSelectFacility(info.object.facilityId);
        }
      },
      updateTriggers: {
        getRadius: [activeFocusId],
        getFillColor: [activeFocusId],
        getLineColor: [activeFocusId],
        getLineWidth: [activeFocusId],
      },
    });

    const labelLayer = new TextLayer<FacilityMarkerDatum>({
      id: "kulgo-facility-labels",
      data: markers,
      pickable: false,
      getPosition: (d) => d.position,
      getText: (d) => d.label,
      getSize: 11,
      sizeUnits: "pixels",
      getPixelOffset: [0, -16],
      getColor: (d) => {
        const dimmed =
          focusedConnectedFacilityIds !== null &&
          !focusedConnectedFacilityIds.has(d.facilityId);
        return [226, 232, 240, dimmed ? 75 : 235];
      },
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      background: true,
      getBackgroundColor: [2, 6, 23, 185],
      backgroundPadding: [4, 2],
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontWeight: 600,
      updateTriggers: {
        getColor: [activeFocusId],
      },
    });

    const chokepointMarkers: ChokepointMarkerDatum[] = [];
    if (showChokepoints) {
      for (const poly of riskPolygons) {
        if (poly.signal.affectedChokepoints.length === 0) continue;
        const centroid = computePolygonCentroid(poly.polygon);
        if (!centroid) continue;
        chokepointMarkers.push({
          signal: poly.signal,
          position: centroid,
          label: poly.signal.affectedChokepoints[0]!.replace(/_/g, " "),
        });
      }
    }

    const layers: unknown[] = [];

    if (showRiskPolygons) {
      layers.push(
        new PolygonLayer<RiskSignalPolygonDatum>({
          id: "kulgo-risk-signal-polygons",
          data: riskPolygons,
          pickable: !isPickingCoords,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 1.5,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => d.fillColor,
          getLineColor: (d) => d.lineColor,
          onHover: (info: PickingInfo<RiskSignalPolygonDatum>) => {
            if (info.object) {
              setHover({
                kind: "signal",
                x: info.x,
                y: info.y,
                datum: info.object,
              });
            } else {
              setHover((prev) => (prev?.kind === "signal" ? null : prev));
            }
          },
          onClick: (info: PickingInfo<RiskSignalPolygonDatum>) => {
            if (info.object && mapModeRef.current === "inspect") {
              setInspectedSignal(info.object.signal);
              setLocalSelectedLaneId(null);
            }
          },
        }),
      );
    }

    if (showChokepoints && chokepointMarkers.length > 0) {
      layers.push(
        new ScatterplotLayer<ChokepointMarkerDatum>({
          id: "kulgo-chokepoint-markers",
          data: chokepointMarkers,
          pickable: !isPickingCoords,
          stroked: true,
          filled: true,
          radiusUnits: "pixels",
          getRadius: 11,
          lineWidthMinPixels: 2,
          getPosition: (d) => d.position,
          getFillColor: (d) =>
            d.signal.severity === "RED"
              ? [239, 68, 68, 120]
              : [245, 158, 11, 120],
          getLineColor: (d) =>
            d.signal.severity === "RED"
              ? [254, 202, 202, 240]
              : [253, 230, 138, 240],
          onClick: (info: PickingInfo<ChokepointMarkerDatum>) => {
            if (info.object && mapModeRef.current === "inspect") {
              setInspectedSignal(info.object.signal);
              setLocalSelectedLaneId(null);
            }
          },
        }),
      );
    }

    layers.push(arcLayer, pulseLayer, facilityLayer, labelLayer);
    overlay.setProps({ layers: layers as never });
  }, [
    arcs,
    markers,
    pulseDots,
    riskPolygons,
    localSelectedLaneId,
    activeFocusId,
    focusedConnectedFacilityIds,
    mapMode,
    showRiskPolygons,
    showChokepoints,
    showEmissions,
    derivedByLaneId,
  ]);

  // Fit bounds when requested
  useEffect(() => {
    const map = mapRef.current;
    if (!map || visibleFacilities.length === 0) return;

    const bounds = computeFacilitiesBounds(visibleFacilities);
    if (!bounds) return;

    if (
      Math.abs(bounds.maxLng - bounds.minLng) < 0.01 &&
      Math.abs(bounds.maxLat - bounds.minLat) < 0.01
    ) {
      map.flyTo({
        center: [bounds.minLng, bounds.minLat],
        zoom: 6.5,
        duration: 700,
      });
      return;
    }

    map.fitBounds(
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
      ],
      {
        padding: { top: 80, bottom: 90, left: 60, right: 80 },
        maxZoom: 7.5,
        duration: 700,
      },
    );
  }, [fitTrigger, visibleFacilities.length]);

  const inspectedLane = useMemo(
    () => visibleLanes.find((l) => l.laneId === localSelectedLaneId) ?? null,
    [visibleLanes, localSelectedLaneId],
  );
  const inspectedLaneDerived = inspectedLane
    ? derivedByLaneId.get(inspectedLane.laneId)
    : undefined;
  const focusedFacility = localFocusFacilityId
    ? facilitiesById.get(localFocusFacilityId) ?? null
    : null;

  return (
    <div className="relative flex-1 h-full w-full overflow-hidden bg-slate-950">
      <div
        ref={containerRef}
        className={`h-full w-full ${mapMode !== "inspect" ? "cursor-crosshair" : ""}`}
      />

      {/* Top-Center Floating Strategy-Game Flow Toggle: [ Suppliers | Both | Clients ] */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        <div
          role="group"
          aria-label="Supply flow direction filter"
          data-testid="map-flow-toggle"
          className="inline-flex items-center rounded-xl border border-slate-700/90 bg-slate-950/90 backdrop-blur-md p-1 shadow-2xl text-xs"
        >
          {(
            [
              { id: "suppliers", label: "Suppliers" },
              { id: "both", label: "Both" },
              { id: "clients", label: "Clients" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              data-testid={`map-flow-${opt.id}`}
              onClick={() => setFlowFilter(opt.id)}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                flowFilter === opt.id
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                  : "text-slate-400 hover:text-slate-100 border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Focused Supply Hub Pill */}
        {focusedFacility && (
          <div
            data-testid="map-focus-pill"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-slate-950/90 backdrop-blur-md px-3 py-1.5 text-xs text-emerald-200 shadow-xl"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="truncate max-w-[160px]">
              Hub: {focusedFacility.name}
            </span>
            <button
              type="button"
              aria-label="Clear hub focus"
              onClick={() => setLocalFocusFacilityId(null)}
              className="p-0.5 rounded hover:bg-slate-800 text-slate-300 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Coordinate-Pick Mode Banner */}
      {mapMode !== "inspect" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-slate-950/90 backdrop-blur-md px-4 py-2 text-xs text-emerald-200 shadow-xl">
          <Crosshair className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            {mapMode === "refine-site"
              ? `Click on the map to set exact site coordinates for ${refiningFacilityName ?? "this facility"}`
              : "Click anywhere on the map to place your new facility"}
          </span>
          <button
            type="button"
            onClick={onCancelMapMode}
            className="rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1 text-slate-200 transition cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Offline Basemap Notice */}
      {tileError && (
        <div className="absolute top-16 left-4 z-10 max-w-sm rounded-lg border border-amber-500/30 bg-slate-950/85 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>{tileError}</span>
        </div>
      )}

      {/* Click-on-Line Tactical HUD Card */}
      {inspectedLane && (
        <div
          data-testid="map-line-hud-card"
          className="absolute top-4 right-14 z-20 w-84 max-w-[calc(100%-2rem)] rounded-2xl border border-slate-700/90 bg-slate-950/95 backdrop-blur-md p-4 text-xs text-slate-200 shadow-2xl space-y-3"
        >
          {(() => {
            const fromFac = facilitiesById.get(inspectedLane.fromFacilityId);
            const toFac = facilitiesById.get(inspectedLane.toFacilityId);
            const linkedInput = inspectedLane.inputId
              ? inputsById.get(inspectedLane.inputId)
              : undefined;
            const dir = resolveLaneDirection(inspectedLane, fromFac, toFac);
            const hasDerived = inspectedLaneDerived !== undefined;
            const isLapsed =
              inspectedLaneDerived?.laneCommercialState === "LAPSED_UNCONTRACTED";
            const activeVol = hasDerived
              ? inspectedLaneDerived.activeVolume
              : inspectedLane.annualVolume;
            const unitLabel = hasDerived
              ? (inspectedLaneDerived.baseUnit ?? inspectedLane.volumeUnit)
              : inspectedLane.volumeUnit;
            const activeSpend = hasDerived
              ? inspectedLaneDerived.activeSpendEur
              : inspectedLane.annualSpendEur;
            const avgPrice = inspectedLaneDerived?.weightedAvgUnitPrice ?? null;
            const isSpendShareProxy =
              inspectedLaneDerived?.weightingBasis === "SPEND_EUR";
            const displayShare = hasDerived
              ? inspectedLaneDerived.knownMappedSharePct
              : inspectedLane.volumeSharePct;
            const isRenewalCliff = (inspectedLaneDerived?.atRiskVolumePct ?? 0) > 30;

            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          inspectedLane.riskStatus === "RED"
                            ? "bg-red-500/20 text-red-300 border border-red-500/40"
                            : inspectedLane.riskStatus === "YELLOW"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        }`}
                      >
                        {inspectedLane.riskStatus}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                        {dir}
                      </span>
                      {isLapsed && (
                        <span className="px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-[10px] font-mono font-bold text-red-300">
                          LAPSED
                        </span>
                      )}
                      {inspectedLane.allocationSplitPct != null && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-[10px] font-mono text-emerald-300">
                          {inspectedLane.allocationSplitPct}% split
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-white flex items-center gap-1.5 text-xs">
                      <span className="truncate">{fromFac?.name ?? "Origin"}</span>
                      <ArrowRight className="h-3 w-3 text-slate-500 shrink-0" />
                      <span className="truncate">{toFac?.name ?? "Destination"}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {linkedInput?.name ?? inspectedLane.materialCategory}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Close line HUD card"
                    onClick={() => setLocalSelectedLaneId(null)}
                    className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Derived Commercial KPIs */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] text-slate-500">Active Volume</div>
                    <div className="font-mono font-semibold text-white mt-0.5">
                      {activeVol !== null
                        ? `${activeVol.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unitLabel}`
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] text-slate-500">Active Spend</div>
                    <div className="font-mono font-semibold text-white mt-0.5">
                      {activeSpend !== null ? formatEur(activeSpend) : "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] text-slate-500">
                      {isSpendShareProxy ? "~Spend Share %" : "Volume Share %"}
                    </div>
                    <div className="font-mono font-semibold text-emerald-300 mt-0.5">
                      {displayShare === null
                        ? "—"
                        : isSpendShareProxy
                          ? `~${displayShare}%`
                          : `${displayShare}%`}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] text-slate-500">Weighted Unit €</div>
                    <div className="font-mono font-semibold text-white mt-0.5">
                      {avgPrice !== null ? `€${avgPrice.toFixed(2)}` : "—"}
                    </div>
                  </div>
                </div>

                {/* Renewal Cliff Warning */}
                {isRenewalCliff && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Renewal cliff: &gt;30% volume expiring within 90 days.</span>
                  </div>
                )}

                {/* Physical & ESG Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                  <span>Mode: <strong className="text-slate-200">{inspectedLane.transportMode}</strong></span>
                  <span>Lead: <strong className="text-slate-200">{inspectedLane.leadTimeDays ?? "—"}d</strong></span>
                  <span>
                    CO2e:{" "}
                    <strong className="text-slate-200">
                      {inspectedLane.estimatedLaneCo2e != null
                        ? `${inspectedLane.estimatedLaneCo2e.toFixed(1)}t`
                        : "—"}
                    </strong>
                  </span>
                </div>

                {inspectedLane.riskReason && (
                  <p className="text-[11px] text-amber-200/90 bg-slate-900/90 border border-slate-800 rounded-lg p-2 leading-relaxed">
                    {inspectedLane.riskReason}
                  </p>
                )}

                {onInspectLaneInHub && (
                  <button
                    type="button"
                    onClick={() => onInspectLaneInHub(inspectedLane)}
                    className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 py-1.5 text-xs font-semibold text-emerald-200 transition cursor-pointer"
                  >
                    Open Route &amp; Contracts in Hub
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Hover Tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-30 max-w-xs rounded-xl border border-slate-700/90 bg-slate-950/95 backdrop-blur-md px-3 py-2 text-xs text-slate-200 shadow-2xl"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 300),
            top: Math.max(hover.y - 12, 12),
          }}
        >
          {hover.kind === "lane" ? (
            <div className="space-y-1">
              <div className="font-semibold text-white">
                {hover.datum.fromFacility.name} → {hover.datum.toFacility.name}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <span>{hover.datum.inputName ?? hover.datum.lane.materialCategory}</span>
                <span>·</span>
                <span>{hover.datum.lane.transportMode}</span>
                <span>·</span>
                <span>{hover.datum.lane.volumeSharePct}%</span>
              </div>
            </div>
          ) : hover.kind === "signal" ? (
            <div className="space-y-1">
              <div className="font-semibold text-white">
                {hover.datum.signal.title}
              </div>
              <div className="text-[11px] text-slate-400">
                {hover.datum.signal.severity} · {hover.datum.signal.kind.replace(/_/g, " ")}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-semibold text-white">
                {hover.datum.facility.name}
              </div>
              <div className="text-[11px] text-slate-400">
                {hover.datum.facility.countryCode} ·{" "}
                {resolveFacilityRole(hover.datum.facility)} · Click to isolate hub
              </div>
            </div>
          )}
        </div>
      )}

      {/* Click-to-Inspect Risk Signal Card */}
      {inspectedSignal && (
        <div
          data-testid="map-signal-inspector"
          className="absolute top-4 right-14 z-20 w-80 max-w-[calc(100%-2rem)] rounded-xl border border-slate-700 bg-slate-950/95 backdrop-blur-md p-3.5 text-xs text-slate-200 shadow-2xl space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                    inspectedSignal.severity === "RED"
                      ? "bg-red-500/20 text-red-300 border border-red-500/40"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  }`}
                >
                  {inspectedSignal.severity} · {inspectedSignal.kind.replace(/_/g, " ")}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                  {inspectedSignal.verificationStatus}
                </span>
              </div>
              <h4 className="font-semibold text-white leading-snug">
                {inspectedSignal.title}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setInspectedSignal(null)}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {inspectedSignal.description && (
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {inspectedSignal.description}
            </p>
          )}

          {inspectedSignal.sourceUrls.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800">
              {inspectedSignal.sourceUrls.slice(0, 3).map((url, idx) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 underline"
                >
                  Source {idx + 1}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}

          {onAcknowledgeSignal && (
            <div className="flex items-center gap-2 pt-1.5 border-t border-slate-800">
              <button
                type="button"
                onClick={() =>
                  void onAcknowledgeSignal(
                    inspectedSignal.signalId,
                    "ACKNOWLEDGED",
                  )
                }
                className="flex-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 transition cursor-pointer"
              >
                Acknowledge
              </button>
              <button
                type="button"
                onClick={() =>
                  void onAcknowledgeSignal(inspectedSignal.signalId, "MUTED")
                }
                className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition cursor-pointer"
              >
                Mute
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom-Left Floating Strategy-Game Layer Toggles & Quick Route Picker */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 max-w-[calc(100%-2rem)]">
        {/* Layer Controls */}
        <div
          data-testid="map-layer-toggles"
          className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800/90 bg-slate-950/90 backdrop-blur-md p-1.5 shadow-2xl text-[11px]"
        >
          <button
            type="button"
            onClick={() => setShowRiskPolygons((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition cursor-pointer ${
              showRiskPolygons
                ? "bg-amber-500/15 text-amber-300 border border-amber-500/40"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Risk Polygons
          </button>
          <button
            type="button"
            onClick={() => setShowChokepoints((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition cursor-pointer ${
              showChokepoints
                ? "bg-red-500/15 text-red-300 border border-red-500/40"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Chokepoints
          </button>
          <button
            type="button"
            onClick={() => setShowEmissions((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition cursor-pointer ${
              showEmissions
                ? "bg-sky-500/15 text-sky-300 border border-sky-500/40"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            Emissions
          </button>
          {onToggleLogicalGraph && (
            <button
              type="button"
              onClick={onToggleLogicalGraph}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800 transition cursor-pointer"
            >
              <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
              Logical Graph
            </button>
          )}
          {onOpenSimulator && (
            <button
              type="button"
              onClick={onOpenSimulator}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 transition cursor-pointer"
            >
              <Sliders className="h-3.5 w-3.5" />
              What-If Simulator
            </button>
          )}
        </div>

        {/* Compact Route Inspector Selector (accessible keyboard/E2E way to inspect any visible arc) */}
        {visibleLanes.length > 0 && (
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800/90 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 text-[11px] text-slate-300 shadow-lg w-fit">
            <span className="text-slate-500">
              {visibleLanes.length} route{visibleLanes.length === 1 ? "" : "s"}:
            </span>
            <select
              aria-label="Inspect route on map"
              value={localSelectedLaneId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                setLocalSelectedLaneId(id);
                if (id) onSelectLane(id);
              }}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer max-w-[260px]"
            >
              <option value="" className="bg-slate-950">
                Select route to inspect...
              </option>
              {visibleLanes.map((l) => {
                const f = facilitiesById.get(l.fromFacilityId);
                const t = facilitiesById.get(l.toFacilityId);
                return (
                  <option key={l.laneId} value={l.laneId} className="bg-slate-950">
                    {f?.name ?? "Origin"} → {t?.name ?? "Dest"} ({l.transportMode})
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
