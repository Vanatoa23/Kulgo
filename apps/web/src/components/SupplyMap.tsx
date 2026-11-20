import type { PickingInfo } from "@deck.gl/core";
import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Facility, SupplyInput, SupplyLane } from "@kulgo/shared";
import { AlertTriangle, Crosshair, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCorridorArcs,
  buildFacilityMarkers,
  computeFacilitiesBounds,
  formatEur,
  type CorridorArcDatum,
  type FacilityMarkerDatum,
} from "../lib/workspace-utils.js";
import type { MapInteractionMode } from "./FilterBar.js";

const DARK_BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const DEFAULT_CENTER: [number, number] = [24.7536, 59.437]; // Tallinn, Estonia
const DEFAULT_ZOOM = 3.6;

export interface SupplyMapProps {
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  inputs: readonly SupplyInput[];
  selectedFacilityId: string | null;
  selectedLaneId: string | null;
  mapMode: MapInteractionMode;
  refiningFacilityName: string | null;
  fitTrigger: number;
  onSelectFacility: (facilityId: string) => void;
  onSelectLane: (laneId: string) => void;
  onMapPickCoordinates: (coords: { lat: number; lng: number }) => void;
  onCancelMapMode: () => void;
}

type HoverState =
  | { kind: "lane"; x: number; y: number; datum: CorridorArcDatum }
  | { kind: "facility"; x: number; y: number; datum: FacilityMarkerDatum }
  | null;

export function SupplyMap({
  facilities,
  lanes,
  inputs,
  selectedFacilityId,
  selectedLaneId,
  mapMode,
  refiningFacilityName,
  fitTrigger,
  onSelectFacility,
  onSelectLane,
  onMapPickCoordinates,
  onCancelMapMode,
}: SupplyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [hover, setHover] = useState<HoverState>(null);
  const [tileError, setTileError] = useState<string | null>(null);

  // Keep latest callbacks & mode in refs so imperative MapLibre/Deck handlers never go stale
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

  const facilitiesById = useMemo(() => {
    const map = new Map<string, Facility>();
    for (const facility of facilities) {
      map.set(facility.facilityId, facility);
    }
    return map;
  }, [facilities]);

  const inputsById = useMemo(() => {
    const map = new Map<string, SupplyInput>();
    for (const input of inputs) {
      map.set(input.inputId, input);
    }
    return map;
  }, [inputs]);

  const arcs = useMemo(
    () => buildCorridorArcs(lanes, facilitiesById, inputsById),
    [lanes, facilitiesById, inputsById],
  );

  const markers = useMemo(
    () => buildFacilityMarkers(facilities, selectedFacilityId),
    [facilities, selectedFacilityId],
  );

  // Imperative MapLibre + Deck.gl MapboxOverlay lifecycle (React 19 StrictMode safe)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let isDisposed = false;
    setTileError(null);

    const map = new maplibregl.Map({
      container,
      style: DARK_BASEMAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 24,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });

    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on("error", () => {
      if (!isDisposed) {
        setTileError(
          "Basemap tiles unavailable — interactive supply layers remain active.",
        );
      }
    });

    map.on("click", (event: maplibregl.MapMouseEvent) => {
      if (isDisposed) return;
      const mode = mapModeRef.current;
      if (mode === "pick-new-facility" || mode === "refine-site") {
        callbacksRef.current.onMapPickCoordinates({
          lat: Number(event.lngLat.lat.toFixed(5)),
          lng: Number(event.lngLat.lng.toFixed(5)),
        });
      }
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      isDisposed = true;
      mapRef.current = null;
      overlayRef.current = null;
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl);
      } catch {
        // Ignore if map already tore down controls
      }
      try {
        overlay.finalize();
      } catch {
        // Ignore duplicate teardown in StrictMode
      }
      map.remove();
    };
  }, []);

  // Update Deck.gl layers whenever data or selection changes
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    const isPickingCoords =
      mapMode === "pick-new-facility" || mapMode === "refine-site";

    const arcLayer = new ArcLayer<CorridorArcDatum>({
      id: "kulgo-supply-corridors",
      data: arcs,
      greatCircle: true,
      pickable: !isPickingCoords,
      autoHighlight: !isPickingCoords,
      highlightColor: [255, 255, 255, 110],
      widthUnits: "pixels",
      widthMinPixels: 2,
      widthMaxPixels: 11,
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getSourceColor: (d) =>
        d.laneId === selectedLaneId
          ? [255, 255, 255, 255]
          : d.sourceColor,
      getTargetColor: (d) =>
        d.laneId === selectedLaneId
          ? [255, 255, 255, 255]
          : d.targetColor,
      getWidth: (d) => (d.laneId === selectedLaneId ? d.width + 2.5 : d.width),
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
          callbacksRef.current.onSelectLane(info.object.laneId);
        }
      },
      updateTriggers: {
        getSourceColor: [selectedLaneId],
        getTargetColor: [selectedLaneId],
        getWidth: [selectedLaneId],
      },
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
      getRadius: (d) => d.radiusPixels,
      getFillColor: (d) => d.fillColor,
      getLineColor: (d) => d.lineColor,
      getLineWidth: (d) =>
        d.facilityId === selectedFacilityId
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
          callbacksRef.current.onSelectFacility(info.object.facilityId);
        }
      },
      updateTriggers: {
        getRadius: [selectedFacilityId],
        getLineWidth: [selectedFacilityId],
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
      getColor: [226, 232, 240, 230],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      background: true,
      getBackgroundColor: [2, 6, 23, 185],
      backgroundPadding: [4, 2],
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontWeight: 600,
    });

    overlay.setProps({
      layers: [arcLayer, facilityLayer, labelLayer],
    });
  }, [arcs, markers, selectedFacilityId, selectedLaneId, mapMode]);

  // Fit bounds when requested (initial data load, demo seed, or "Fit Network")
  useEffect(() => {
    if (fitTrigger === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const bounds = computeFacilitiesBounds(facilities);
    if (!bounds) return;

    map.fitBounds(
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
      ],
      {
        padding: { top: 64, bottom: 72, left: 64, right: 64 },
        maxZoom: 8.5,
        duration: 850,
      },
    );
  }, [fitTrigger, facilities]);

  const isPickingMode =
    mapMode === "pick-new-facility" || mapMode === "refine-site";

  return (
    <div
      className={`relative flex-1 min-h-0 bg-slate-950 overflow-hidden ${
        isPickingMode ? "cursor-crosshair" : ""
      }`}
    >
      <div ref={containerRef} className="w-full h-full" />

      {/* Coordinate-pick mode banner */}
      {isPickingMode && (
        <div
          className={`absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-xl backdrop-blur-md ${
            mapMode === "refine-site"
              ? "border-amber-500/50 bg-amber-950/90 text-amber-100"
              : "border-emerald-500/50 bg-emerald-950/90 text-emerald-100"
          }`}
        >
          <Crosshair className="h-4 w-4 shrink-0" />
          <span>
            {mapMode === "refine-site"
              ? `Click exact site on map to refine "${refiningFacilityName ?? "Facility"}" to SITE_VERIFIED`
              : "Click anywhere on the map to pre-fill coordinates for a new facility"}
          </span>
          <button
            type="button"
            onClick={onCancelMapMode}
            className="rounded-md p-1 hover:bg-white/10 transition-colors cursor-pointer"
            title="Cancel map click mode"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Graceful basemap offline notice */}
      {tileError && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-slate-900/90 px-3 py-2 text-xs text-amber-200 backdrop-blur">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span>{tileError}</span>
        </div>
      )}

      {/* Hover Tooltip */}
      {hover && !isPickingMode && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded-xl border border-slate-700/90 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-md"
          style={{
            left: Math.min(hover.x + 14, Math.max(12, window.innerWidth - 360)),
            top: Math.max(12, hover.y - 12),
          }}
        >
          {hover.kind === "lane" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  {hover.datum.inputName ?? hover.datum.lane.materialCategory}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    hover.datum.lane.riskStatus === "RED"
                      ? "bg-red-500/20 text-red-300 border border-red-500/40"
                      : hover.datum.lane.riskStatus === "YELLOW"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  }`}
                >
                  {hover.datum.lane.riskStatus}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {hover.datum.fromFacility.name} ({hover.datum.fromFacility.countryCode}) →{" "}
                {hover.datum.toFacility.name} ({hover.datum.toFacility.countryCode})
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 border-t border-slate-800 text-[11px]">
                <span className="text-slate-400">
                  Volume Share:{" "}
                  <strong className="text-slate-100">
                    {hover.datum.lane.volumeSharePct}%
                  </strong>
                </span>
                <span className="text-slate-400">
                  Spend:{" "}
                  <strong className="text-slate-100">
                    {formatEur(hover.datum.lane.annualSpendEur)}
                  </strong>
                </span>
                <span className="text-slate-400">
                  Mode:{" "}
                  <strong className="text-slate-100">
                    {hover.datum.lane.transportMode}
                  </strong>
                </span>
                <span className="text-slate-400">
                  Contract:{" "}
                  <strong className="text-slate-100">
                    {hover.datum.lane.contractEndDate ?? "—"}
                  </strong>
                </span>
              </div>
              {hover.datum.lane.riskReason && (
                <p className="pt-1 border-t border-slate-800 text-[11px] text-amber-200 leading-snug">
                  {hover.datum.lane.riskReason}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  {hover.datum.facility.name}
                </span>
                <span className="font-mono text-[10px] text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded">
                  {hover.datum.facility.countryCode}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-400">{hover.datum.facility.kind}</span>
                <span className="text-slate-600">·</span>
                <span
                  className={
                    hover.datum.facility.isOwnFacility
                      ? "text-emerald-300 font-medium"
                      : hover.datum.facility.locationPrecision === "SITE_VERIFIED"
                        ? "text-cyan-300 font-medium"
                        : "text-amber-300 font-medium"
                  }
                >
                  {hover.datum.facility.isOwnFacility
                    ? "Own Facility"
                    : hover.datum.facility.locationPrecision === "SITE_VERIFIED"
                      ? "Site Verified"
                      : "HQ Estimated"}
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-500">
                {hover.datum.facility.lat.toFixed(4)},{" "}
                {hover.datum.facility.lng.toFixed(4)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Map Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-slate-800/90 bg-slate-950/85 backdrop-blur-md px-3.5 py-2.5 text-[11px] text-slate-300 space-y-1.5 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-emerald-500" />
            Green
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-amber-500" />
            Yellow Risk
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-red-500" />
            Red Risk
          </span>
        </div>
        <div className="flex items-center gap-3 pt-1 border-t border-slate-800/80">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-1 ring-emerald-200" />
            Own HQ
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-500 ring-1 ring-cyan-200" />
            Site Verified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 ring-1 ring-amber-200" />
            HQ Estimated
          </span>
        </div>
      </div>
    </div>
  );
}
