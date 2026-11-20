import {
  TransportModeSchema,
  type Facility,
  type SimulateAnalyticsResponse,
  type SimulatedLaneChange,
  type SupplyInput,
  type SupplyLane,
  type TransportMode,
} from "@kulgo/shared";
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { simulateAnalytics } from "../lib/api.js";

export interface WhatIfSimulatorDrawerProps {
  open: boolean;
  lanes: readonly SupplyLane[];
  facilities: readonly Facility[];
  inputs: readonly SupplyInput[];
  activeProductId: string | null;
  activeInputId: string | null;
  onClose: () => void;
}

interface DraftLaneOverride {
  volumeSharePct: number;
  transportMode: TransportMode;
}

const TRANSPORT_MODES = TransportModeSchema.options;

function formatDelta(
  value: number,
  unit = "",
  positiveIsGood = false,
): { text: string; className: string } {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return { text: `0${unit}`, className: "text-slate-400" };
  }
  const sign = rounded > 0 ? "+" : "";
  const isGood = positiveIsGood ? rounded > 0 : rounded < 0;
  return {
    text: `${sign}${rounded}${unit}`,
    className: isGood ? "text-emerald-400" : "text-red-400",
  };
}

export function WhatIfSimulatorDrawer({
  open,
  lanes,
  facilities,
  inputs,
  activeProductId,
  activeInputId,
  onClose,
}: WhatIfSimulatorDrawerProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftLaneOverride>>({});
  const [result, setResult] = useState<SimulateAnalyticsResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facilitiesById = useMemo(
    () => new Map(facilities.map((f) => [f.facilityId, f])),
    [facilities],
  );
  const inputsById = useMemo(
    () => new Map(inputs.map((i) => [i.inputId, i])),
    [inputs],
  );

  // Reset drafts whenever visible lane set changes
  useEffect(() => {
    setDrafts({});
    setResult(null);
    setError(null);
  }, [lanes, activeProductId, activeInputId]);

  const laneChanges = useMemo<SimulatedLaneChange[]>(() => {
    const changes: SimulatedLaneChange[] = [];
    for (const lane of lanes) {
      const draft = drafts[lane.laneId];
      if (!draft) continue;
      const shareChanged = draft.volumeSharePct !== lane.volumeSharePct;
      const modeChanged = draft.transportMode !== lane.transportMode;
      if (!shareChanged && !modeChanged) continue;
      changes.push({
        laneId: lane.laneId,
        ...(shareChanged ? { volumeSharePct: draft.volumeSharePct } : {}),
        ...(modeChanged ? { transportMode: draft.transportMode } : {}),
      });
    }
    return changes;
  }, [drafts, lanes]);

  // Run stateless simulation whenever laneChanges updates (debounced 220ms)
  useEffect(() => {
    if (!open) return;
    if (laneChanges.length === 0) {
      setResult(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRunning(true);
      setError(null);
      simulateAnalytics({
        ...(activeProductId ? { productId: activeProductId } : {}),
        ...(activeInputId ? { inputId: activeInputId } : {}),
        laneChanges,
      })
        .then((res) => {
          if (!cancelled) {
            setResult(res);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Failed to run what-if simulation.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setRunning(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, laneChanges, activeProductId, activeInputId]);

  if (!open) return null;

  const updateDraft = (
    lane: SupplyLane,
    patch: Partial<DraftLaneOverride>,
  ) => {
    setDrafts((prev) => {
      const current = prev[lane.laneId] ?? {
        volumeSharePct: lane.volumeSharePct,
        transportMode: lane.transportMode,
      };
      return {
        ...prev,
        [lane.laneId]: { ...current, ...patch },
      };
    });
  };

  const applyDeriskRedPreset = () => {
    const next: Record<string, DraftLaneOverride> = {};
    for (const lane of lanes) {
      if (lane.riskStatus === "RED") {
        next[lane.laneId] = {
          volumeSharePct: 0,
          transportMode: lane.transportMode,
        };
      }
    }
    setDrafts(next);
  };

  const applyLowCarbonModePreset = () => {
    const next: Record<string, DraftLaneOverride> = {};
    for (const lane of lanes) {
      if (lane.transportMode === "AIR" || lane.transportMode === "ROAD") {
        next[lane.laneId] = {
          volumeSharePct: lane.volumeSharePct,
          transportMode: lane.transportMode === "AIR" ? "SEA" : "RAIL",
        };
      }
    }
    setDrafts(next);
  };

  const resilienceDelta = result
    ? formatDelta(result.deltas.resilienceScoreDelta, " pts", true)
    : null;
  const hhiDelta = result
    ? formatDelta(result.deltas.avgHhiDelta, "", false)
    : null;
  const alertsDelta = result
    ? formatDelta(result.deltas.alertCountDelta, "", false)
    : null;
  const co2Delta = result
    ? formatDelta(result.deltas.transportScope3Tco2eDelta, " tCO2e", false)
    : null;

  return (
    <div
      role="dialog"
      aria-label="What-If Supply Chain Simulator"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[460px] border-l border-slate-800 bg-slate-950/98 shadow-2xl backdrop-blur-xl flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/15 border border-indigo-500/35 flex items-center justify-center text-indigo-300 shrink-0">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">
              What-If Simulator
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              Stateless scenario preview · workspace data unchanged
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close What-If Simulator"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick Presets */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 bg-slate-900/50 flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={applyDeriskRedPreset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-500/10 hover:bg-red-500/20 text-red-200 text-xs font-medium px-2.5 py-1 transition-colors cursor-pointer"
        >
          <Sparkles className="h-3 w-3" />
          De-risk RED Lanes
        </button>
        <button
          type="button"
          onClick={applyLowCarbonModePreset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-xs font-medium px-2.5 py-1 transition-colors cursor-pointer"
        >
          <Sparkles className="h-3 w-3" />
          Shift Road/Air → Rail/Sea
        </button>
        <button
          type="button"
          onClick={() => {
            setDrafts({});
            setResult(null);
            setError(null);
          }}
          disabled={laneChanges.length === 0}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 text-xs px-2.5 py-1 transition-colors cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      {/* Live Delta Preview Strip */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/30 shrink-0">
        {error && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {running ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
            <span>Simulating HHI, risk &amp; CO2e deltas...</span>
          </div>
        ) : result ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/90 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Resilience Score
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
                <span className="text-slate-400">
                  {result.baseline.resilienceScore}
                </span>
                <ArrowRight className="h-3 w-3 text-slate-600" />
                <span className="text-white font-semibold">
                  {result.simulated.resilienceScore}
                </span>
                {resilienceDelta && (
                  <span className={`ml-auto font-semibold ${resilienceDelta.className}`}>
                    {resilienceDelta.text}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/90 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Avg Material HHI
              </div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono">
                <span className="text-white font-semibold">
                  {hhiDelta?.text}
                </span>
                <span className="text-[10px] text-slate-500">
                  SPOF Δ {result.deltas.spofCountDelta >= 0 ? `+${result.deltas.spofCountDelta}` : result.deltas.spofCountDelta}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/90 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Active Alerts
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
                <span className="text-slate-400">
                  {result.baseline.alerts.length}
                </span>
                <ArrowRight className="h-3 w-3 text-slate-600" />
                <span className="text-white font-semibold">
                  {result.simulated.alerts.length}
                </span>
                {alertsDelta && (
                  <span className={`ml-auto font-semibold ${alertsDelta.className}`}>
                    {alertsDelta.text}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/90 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                Transport Scope 3
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs font-mono">
                <span className="text-white font-semibold">
                  {result.simulated.esg.transportScope3Tco2e.toFixed(1)}t
                </span>
                {co2Delta && (
                  <span className={`ml-auto font-semibold ${co2Delta.className}`}>
                    {co2Delta.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-2">
            Adjust any lane volume split or transport mode below to preview live
            HHI, risk alert, and CO2e deltas.
          </p>
        )}
      </div>

      {/* Lane Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {lanes.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">
            No visible supply lanes to simulate.
          </p>
        ) : (
          lanes.map((lane) => {
            const draft = drafts[lane.laneId] ?? {
              volumeSharePct: lane.volumeSharePct,
              transportMode: lane.transportMode,
            };
            const isModified =
              draft.volumeSharePct !== lane.volumeSharePct ||
              draft.transportMode !== lane.transportMode;
            const from = facilitiesById.get(lane.fromFacilityId);
            const input = lane.inputId
              ? inputsById.get(lane.inputId)
              : undefined;

            return (
              <div
                key={lane.laneId}
                className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                  isModified
                    ? "border-indigo-500/50 bg-indigo-950/20"
                    : "border-slate-800 bg-slate-900/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">
                      {input?.name ?? lane.materialCategory}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {from?.name ?? "Supplier"} ({from?.countryCode ?? "—"})
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                      lane.riskStatus === "RED"
                        ? "bg-red-500/20 text-red-300"
                        : lane.riskStatus === "YELLOW"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {lane.riskStatus}
                  </span>
                </div>

                {/* Volume Share Slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Volume Share</span>
                    <span className="font-mono text-white">
                      {draft.volumeSharePct}%
                      {draft.volumeSharePct !== lane.volumeSharePct && (
                        <span className="text-slate-500 ml-1">
                          (was {lane.volumeSharePct}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={draft.volumeSharePct}
                    onChange={(e) =>
                      updateDraft(lane, {
                        volumeSharePct: Number(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-400 cursor-pointer"
                  />
                </div>

                {/* Transport Mode Selector */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-400">
                    Transport Mode
                  </span>
                  <select
                    value={draft.transportMode}
                    onChange={(e) =>
                      updateDraft(lane, {
                        transportMode: e.target.value as TransportMode,
                      })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100"
                  >
                    {TRANSPORT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
