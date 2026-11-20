import type { AnalyticsSummary, Facility } from "@kulgo/shared";
import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Leaf,
  Loader2,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";

export interface AnalyticsPanelProps {
  analytics: AnalyticsSummary | null;
  loading: boolean;
  facilities: readonly Facility[];
  onSelectFacility: (facilityId: string) => void;
  onOpenSimulator: () => void;
  onOpenDirectory: (capability?: string) => void;
}

function formatTco2e(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}k tCO2e`;
  }
  return `${value.toFixed(1)} tCO2e`;
}

export function AnalyticsPanel({
  analytics,
  loading,
  facilities,
  onSelectFacility,
  onOpenSimulator,
  onOpenDirectory,
}: AnalyticsPanelProps) {
  if (loading && !analytics) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-xs text-slate-400 gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        <span>Computing HHI, risk &amp; ESG analytics...</span>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
        Load the Estonia Product X demo or add supply lanes to view live HHI
        concentration, SPOF alerts, and Scope 1/2/3 ESG analytics.
      </div>
    );
  }

  const facilitiesById = new Map(facilities.map((f) => [f.facilityId, f]));

  const statusColors =
    analytics.overallStatus === "RED"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : analytics.overallStatus === "YELLOW"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  const totalEsg = Math.max(0.01, analytics.esg.totalTco2e);
  const scope1Pct = Math.round((analytics.esg.scope1Tco2e / totalEsg) * 100);
  const scope2Pct = Math.round((analytics.esg.scope2Tco2e / totalEsg) * 100);
  const upstreamPct = Math.round(
    (analytics.esg.upstreamScope3Tco2e / totalEsg) * 100,
  );
  const transportPct = Math.max(
    0,
    100 - scope1Pct - scope2Pct - upstreamPct,
  );

  return (
    <div className="space-y-4">
      {/* Resilience Header Card */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
              Network Resilience
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Confidence: {analytics.confidence} ·{" "}
              {analytics.verifiedCoveragePct}% verified
            </p>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusColors}`}
          >
            {analytics.overallStatus}
          </span>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="text-3xl font-bold tracking-tight text-white">
              {analytics.resilienceScore}
            </span>
            <span className="text-xs text-slate-500 ml-1">/ 100</span>
          </div>
          <button
            type="button"
            onClick={onOpenSimulator}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-xs px-3 py-1.5 transition-colors cursor-pointer shadow-sm shadow-indigo-500/20"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>What-If Simulator</span>
          </button>
        </div>

        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              analytics.overallStatus === "RED"
                ? "bg-red-500"
                : analytics.overallStatus === "YELLOW"
                  ? "bg-amber-400"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${analytics.resilienceScore}%` }}
          />
        </div>
      </section>

      {/* HHI Concentration Metrics */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            HHI Concentration
          </h3>
          <span className="text-[10px] font-mono text-slate-500">
            0 – 10,000 scale
          </span>
        </div>

        {analytics.hhiMetrics.length === 0 ? (
          <p className="text-xs text-slate-500">No active supply lanes.</p>
        ) : (
          <div className="space-y-2">
            {analytics.hhiMetrics.map((metric) => {
              const barColor =
                metric.concentrationLevel === "SINGLE_SOURCE"
                  ? "bg-red-500"
                  : metric.concentrationLevel === "HIGH"
                    ? "bg-amber-400"
                    : metric.concentrationLevel === "MODERATE"
                      ? "bg-sky-400"
                      : "bg-emerald-500";

              return (
                <div
                  key={`${metric.dimension}-${metric.label}`}
                  className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-200 truncate">
                      {metric.label}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {metric.isSinglePointOfFailure && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/35">
                          SPOF
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-white font-semibold">
                        {metric.rawHhi.toLocaleString("en-US")}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${metric.normalizedScore}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SPOF, Contract Expiry & Corridor Risk Alerts */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            Risk &amp; Expiry Alerts
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenDirectory()}
              className="inline-flex items-center gap-1 rounded-md border border-teal-500/35 bg-teal-500/10 hover:bg-teal-500/20 px-2 py-0.5 text-[10px] font-medium text-teal-200 transition-colors cursor-pointer"
            >
              <Building2 className="h-3 w-3" />
              <span>Alternatives</span>
            </button>
            <span className="text-[11px] font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded-full">
              {analytics.alerts.length}
            </span>
          </div>
        </div>

        {analytics.alerts.length === 0 ? (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>No active SPOF, contract-expiry, or corridor alerts.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {analytics.alerts.map((alert) => {
              const isRed = alert.severity === "RED";
              const primaryFacilityId = alert.affectedTier1FacilityIds[0];
              const primaryFacility = primaryFacilityId
                ? facilitiesById.get(primaryFacilityId)
                : undefined;

              return (
                <div
                  key={alert.alertId}
                  className={`rounded-lg border p-2.5 space-y-1.5 text-xs ${
                    isRed
                      ? "border-red-500/35 bg-red-500/10"
                      : "border-amber-500/35 bg-amber-500/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      {isRed ? (
                        <AlertOctagon className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      )}
                      <span>{alert.title}</span>
                    </span>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-950/70 text-slate-300 shrink-0">
                      {alert.category.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-snug">
                    {alert.summary}
                  </p>
                  <p className="text-[10px] text-slate-400 leading-snug">
                    {alert.recommendedAction}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-0.5">
                    {primaryFacilityId && (
                      <button
                        type="button"
                        onClick={() => onSelectFacility(primaryFacilityId)}
                        className="text-[10px] font-medium text-emerald-300 hover:text-emerald-200 underline underline-offset-2 cursor-pointer"
                      >
                        Inspect {primaryFacility?.name ?? "Tier-1 facility"} →
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onOpenDirectory(primaryFacility?.sector ?? undefined)
                      }
                      className="text-[10px] font-medium text-teal-300 hover:text-teal-200 underline underline-offset-2 cursor-pointer"
                    >
                      Find Alternative Suppliers →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Scope 1 / 2 / 3 ESG Emissions Breakdown */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Leaf className="h-3.5 w-3.5 text-emerald-400" />
            Scope 1 / 2 / 3 CO2e
          </h3>
          <span className="text-xs font-semibold font-mono text-white">
            {formatTco2e(analytics.esg.totalTco2e)}
          </span>
        </div>

        {/* Stacked proportional bar */}
        <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden flex">
          <div
            className="bg-emerald-400"
            style={{ width: `${scope1Pct}%` }}
            title={`Scope 1: ${analytics.esg.scope1Tco2e} tCO2e`}
          />
          <div
            className="bg-teal-400"
            style={{ width: `${scope2Pct}%` }}
            title={`Scope 2: ${analytics.esg.scope2Tco2e} tCO2e`}
          />
          <div
            className="bg-indigo-400"
            style={{ width: `${upstreamPct}%` }}
            title={`Upstream Scope 3: ${analytics.esg.upstreamScope3Tco2e} tCO2e`}
          />
          <div
            className="bg-amber-400"
            style={{ width: `${transportPct}%` }}
            title={`Transport Scope 3: ${analytics.esg.transportScope3Tco2e} tCO2e`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Scope 1 (Own)
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.scope1Tco2e)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-teal-400" />
              Scope 2 (Energy)
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.scope2Tco2e)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-indigo-400" />
              Scope 3 Upstream
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.upstreamScope3Tco2e)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Scope 3 Transport
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.transportScope3Tco2e)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
