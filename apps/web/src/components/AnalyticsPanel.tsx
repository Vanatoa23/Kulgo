import type {
  AnalyticsSummary,
  Facility,
  FinancialViewMode,
  Organization,
} from "@kulgo/shared";
import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Coins,
  Download,
  FileText,
  Globe2,
  Leaf,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { exportEsgLedgerCsv } from "../lib/api.js";
import { downloadEsgExecutiveSummaryPdf } from "../lib/esgPdfExport.js";

export interface AnalyticsPanelProps {
  analytics: AnalyticsSummary | null;
  loading: boolean;
  facilities: readonly Facility[];
  organization?: Organization;
  financialViewMode?: FinancialViewMode;
  onChangeFinancialViewMode?: (mode: FinancialViewMode) => void;
  onQuickFillInputs?: () => void;
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

function formatEurCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}€${(abs / 1_000).toFixed(1)}k`;
  }
  return `${sign}€${Math.round(abs).toLocaleString("en-US")}`;
}

export function AnalyticsPanel({
  analytics,
  loading,
  facilities,
  organization,
  financialViewMode = "PERIOD_WINDOW",
  onChangeFinancialViewMode,
  onQuickFillInputs,
  onSelectFacility,
  onOpenSimulator,
  onOpenDirectory,
}: AnalyticsPanelProps) {
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportCsvLedger = async () => {
    setExportingCsv(true);
    setExportError(null);
    try {
      const csv = await exportEsgLedgerCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kulgo-esg-ledger-${analytics?.esg.factorMatrixVersion ?? "2026.1"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export ESG CSV ledger.",
      );
    } finally {
      setExportingCsv(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!analytics || !organization) return;
    downloadEsgExecutiveSummaryPdf(organization, analytics);
  };

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
  const fin = analytics.financialRisk;

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

      {/* Financial Risk & Provisions Card (Sub-Project 2) */}
      {fin && (
        <section
          data-testid="financial-risk-card"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-amber-400" />
                Financial Risk &amp; Provisions
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span
                  data-testid="financial-confidence-badge"
                  className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border border-sky-500/35 bg-sky-500/10 text-sky-300"
                >
                  {fin.confidenceBadge}
                </span>
                {fin.networkVerified && (
                  <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border border-emerald-500/35 bg-emerald-500/10 text-emerald-300">
                    NETWORK_VERIFIED
                  </span>
                )}
                {fin.isEstimatedProxy && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-500/35 bg-amber-500/10 text-amber-300">
                    SPEND PROXY
                  </span>
                )}
              </div>
            </div>
            {onChangeFinancialViewMode && (
              <div
                className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-[10px]"
                role="group"
                aria-label="Financial horizon view"
              >
                <button
                  type="button"
                  data-testid="view-mode-run-rate"
                  onClick={() => onChangeFinancialViewMode("RUN_RATE")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                    financialViewMode === "RUN_RATE"
                      ? "bg-indigo-500 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Run-Rate
                </button>
                <button
                  type="button"
                  data-testid="view-mode-period-window"
                  onClick={() => onChangeFinancialViewMode("PERIOD_WINDOW")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                    financialViewMode === "PERIOD_WINDOW"
                      ? "bg-indigo-500 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Next 12M
                </button>
              </div>
            )}
          </div>

          {fin.baseEur !== null ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                  Expected Annual Loss
                </div>
                <div
                  data-testid="financial-base-eal"
                  className="text-lg font-bold font-mono text-white mt-0.5"
                >
                  {formatEurCompact(fin.baseEur)}
                  <span className="text-[10px] text-slate-500 font-normal ml-0.5">
                    /yr
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  Band: {formatEurCompact(fin.lowEur)} –{" "}
                  {formatEurCompact(fin.highEur)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                  Disruption VaR (p90)
                </div>
                <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
                  {formatEurCompact(fin.varP90Eur)}
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  p95: {formatEurCompact(fin.varP95Eur)} · Spend{" "}
                  {formatEurCompact(fin.totalActiveSpendEur)}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 text-[11px] text-slate-300">
              <div className="font-semibold text-slate-200">
                Level 0 — Qualitative Exposure Only
              </div>
              <p className="text-slate-400 mt-0.5">
                {fin.missingInputsPrompt ??
                  "Add lane annual spend or product revenue & gross margin to unlock € EAL and provision bands."}
              </p>
            </div>
          )}

          {/* Commercial & Lifecycle Warning Chips */}
          {(fin.renewalCliffCount > 0 ||
            fin.uncontractedMaterialCount > 0 ||
            fin.holdoverLaneCount > 0 ||
            fin.lapsedLaneCount > 0) && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {fin.renewalCliffCount > 0 && (
                <span className="px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/15 text-red-200 font-medium">
                  {fin.renewalCliffCount} Renewal Cliff (&gt;30% in 90d)
                </span>
              )}
              {fin.uncontractedMaterialCount > 0 && (
                <span className="px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200 font-medium">
                  {fin.uncontractedMaterialCount} Uncontracted / Spot Exposure
                </span>
              )}
              {fin.holdoverLaneCount > 0 && (
                <span className="px-2 py-0.5 rounded-full border border-amber-500/40 border-dashed bg-amber-500/10 text-amber-200 font-medium">
                  {fin.holdoverLaneCount} Holdover Lane
                  {fin.holdoverLaneCount === 1 ? "" : "s"}
                </span>
              )}
              {fin.lapsedLaneCount > 0 && (
                <span className="px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-200 font-medium">
                  {fin.lapsedLaneCount} Lapsed / Uncontracted
                </span>
              )}
            </div>
          )}

          {/* Top Material TTS vs TTR & Defect Buffer Rows */}
          {fin.materials.length > 0 && (
            <div className="space-y-1.5">
              {fin.materials.slice(0, 4).map((mat) => (
                <div
                  key={mat.inputId}
                  className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2 text-[11px] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200 truncate">
                      {mat.inputName}
                    </span>
                    <span className="font-mono text-slate-300 shrink-0">
                      {mat.baseEur !== null
                        ? `${formatEurCompact(mat.baseEur)}/yr`
                        : "Unpriced"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-slate-400">
                    <span>
                      Gap:{" "}
                      <strong
                        className={
                          mat.unprotectedGapDaysBase > 0
                            ? "text-amber-300"
                            : "text-emerald-300"
                        }
                      >
                        {mat.unprotectedGapDaysBase}d
                      </strong>{" "}
                      (TTR {mat.effectiveTtrDaysBase}d vs TTS{" "}
                      {mat.ttsDays ?? "7*"}d)
                    </span>
                    {mat.defectBuffer && (
                      <span>
                        Defect buffer:{" "}
                        <strong className="text-sky-300">
                          +{mat.defectBuffer.recommendedOrderBufferPct.toFixed(1)}%
                        </strong>
                      </span>
                    )}
                    {mat.uncontractedDemandPct !== null &&
                      mat.uncontractedDemandPct > 0 && (
                        <span className="text-amber-300">
                          {mat.uncontractedDemandPct.toFixed(0)}% uncontracted
                        </span>
                      )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {fin.baseEur !== null && fin.missingInputsPrompt && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1.5 text-[10px] text-sky-200">
              <span>{fin.missingInputsPrompt}</span>
              {onQuickFillInputs && (
                <button
                  type="button"
                  onClick={onQuickFillInputs}
                  className="shrink-0 font-semibold text-sky-300 hover:text-white underline cursor-pointer"
                >
                  Fill inputs
                </button>
              )}
            </div>
          )}
        </section>
      )}

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
                  {metric.coveredLanesCount !== undefined &&
                    metric.totalActiveLanesCount !== undefined && (
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>
                          Based on {metric.coveredLanesCount} of{" "}
                          {metric.totalActiveLanesCount} active lane
                          {metric.totalActiveLanesCount === 1 ? "" : "s"}
                          {metric.coveragePct !== undefined
                            ? ` (${metric.coveragePct}% coverage)`
                            : ""}
                        </span>
                        {metric.weightingBasis && (
                          <span className="font-mono text-[9px] uppercase text-slate-500">
                            {metric.weightingBasis === "SPEND_EUR"
                              ? "~Spend EUR"
                              : metric.weightingBasis === "VOLUME"
                                ? "Volume"
                                : "Share %"}
                          </span>
                        )}
                      </div>
                    )}
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

      {/* Scope 1 / 2 / 3 ESG Emissions Breakdown & PCAF Data Quality */}
      <section
        data-testid="esg-compliance-panel"
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Leaf className="h-3.5 w-3.5 text-emerald-400" />
            ESG &amp; Compliance
          </h3>
          <div className="flex items-center gap-1.5">
            {analytics.esg.factorMatrixVersion && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                v{analytics.esg.factorMatrixVersion}
              </span>
            )}
            <span className="text-xs font-semibold font-mono text-white">
              {formatTco2e(analytics.esg.totalTco2e)}
            </span>
          </div>
        </div>

        {/* Export actions: Auditor CSV Ledger + Board/Bank-Ready PDF */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={exportingCsv}
            onClick={() => void handleExportCsvLedger()}
            data-testid="export-esg-csv-btn"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60 cursor-pointer"
          >
            {exportingCsv ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            CSV Ledger
          </button>
          <button
            type="button"
            disabled={!organization}
            onClick={handleDownloadPdf}
            data-testid="export-esg-pdf-btn"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-50 cursor-pointer"
          >
            <FileText className="h-3 w-3" />
            PDF Executive Summary
          </button>
        </div>

        {exportError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
            {exportError}
          </div>
        )}

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
            title={`Scope 2 (Location): ${analytics.esg.scope2Tco2e} tCO2e`}
          />
          <div
            className="bg-indigo-400"
            style={{ width: `${upstreamPct}%` }}
            title={`Scope 3 Cat 1: ${analytics.esg.upstreamScope3Tco2e} tCO2e`}
          />
          <div
            className="bg-amber-400"
            style={{ width: `${transportPct}%` }}
            title={`Scope 3 Cat 4 Freight: ${analytics.esg.transportScope3Tco2e} tCO2e`}
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
              Scope 2 (Loc / Mkt)
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.scope2LocationTco2e ?? analytics.esg.scope2Tco2e)}
              {analytics.esg.scope2MarketTco2e !== null &&
              analytics.esg.scope2MarketTco2e !== undefined ? (
                <span className="text-[10px] text-teal-300 ml-1">
                  / {formatTco2e(analytics.esg.scope2MarketTco2e)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-indigo-400" />
              Scope 3 Cat 1
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.upstreamScope3Tco2e)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Scope 3 Cat 4 Freight
            </div>
            <div className="font-mono font-semibold text-white mt-0.5">
              {formatTco2e(analytics.esg.transportScope3Tco2e)}
            </div>
          </div>
        </div>

        {/* PCAF 1-5 Data Quality Meter & Carbon Intensity */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-slate-300">
              PCAF-Aligned Data Quality (1 = Best)
            </span>
            <span
              data-testid="pcaf-weighted-score"
              className="font-mono font-semibold text-emerald-300"
            >
              {analytics.esg.weightedPcafScore !== null &&
              analytics.esg.weightedPcafScore !== undefined
                ? `${analytics.esg.weightedPcafScore.toFixed(2)} / 5.0`
                : "N/A"}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {(analytics.esg.pcafBreakdown ?? []).map((bucket) => (
              <div
                key={bucket.score}
                title={`${bucket.label}: ${bucket.tco2e} tCO2e (${bucket.sharePct}%)`}
                className={`rounded border px-1.5 py-1 text-center text-[10px] ${
                  bucket.sharePct > 0
                    ? bucket.score <= 2
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                      : bucket.score === 3
                        ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
                        : "border-amber-500/40 bg-amber-500/15 text-amber-200"
                    : "border-slate-800 bg-slate-900/50 text-slate-500"
                }`}
              >
                <div className="font-bold">P{bucket.score}</div>
                <div className="font-mono">{Math.round(bucket.sharePct)}%</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>
              Primary Data Share:{" "}
              <strong className="text-slate-200">
                {analytics.esg.primaryDataSharePct ?? 0}%
              </strong>
            </span>
            {analytics.esg.carbonIntensityPerEurMillion !== null &&
              analytics.esg.carbonIntensityPerEurMillion !== undefined && (
                <span>
                  Intensity:{" "}
                  <strong className="text-slate-200">
                    {analytics.esg.carbonIntensityPerEurMillion} tCO2e/€M
                  </strong>
                </span>
              )}
          </div>
        </div>

        {/* EU CBAM Embedded Emissions Alert */}
        {analytics.esg.cbamSummary && analytics.esg.cbamSummary.flaggedLanesCount > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] space-y-1">
            <div className="flex items-center justify-between font-medium text-amber-200">
              <span>EU CBAM Screening</span>
              <span className="font-mono text-[10px]">
                {analytics.esg.cbamSummary.cumulativeMassTonnes} t /{" "}
                {analytics.esg.cbamSummary.deMinimisThresholdTonnes} t threshold
              </span>
            </div>
            <p className="text-[10px] text-amber-100/80">
              {analytics.esg.cbamSummary.euCbamApplicable
                ? `${analytics.esg.cbamSummary.flaggedLanesCount} non-EU CBAM lane(s) (${analytics.esg.cbamSummary.defaultFactorLanesCount} using default factors). Collect verified supplier actuals.`
                : `Below 50 t/yr cumulative EU CBAM de minimis threshold (${analytics.esg.cbamSummary.flaggedLanesCount} lane(s) monitored).`}
            </p>
          </div>
        )}

        {/* Top-5 Scope 3 Emission Hotspots */}
        {(analytics.esg.hotspots ?? []).length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-300">
              Top Scope 3 Hotspots
            </div>
            <div className="space-y-1">
              {(analytics.esg.hotspots ?? []).map((h) => (
                <div
                  key={h.entityId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-200">
                      {h.entityName} ({h.countryCode})
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                      <span className="truncate">{h.materialCategory}</span>
                      <span>·</span>
                      <span className="rounded bg-slate-800 px-1 py-0.2 font-mono text-[9px] text-slate-300">
                        {h.attributionMethod}
                      </span>
                      <span className="rounded bg-slate-800 px-1 py-0.2 font-mono text-[9px] text-emerald-300">
                        P{h.pcafScore}
                      </span>
                      {h.cbamCategory && (
                        <span className="rounded bg-amber-500/20 px-1 py-0.2 font-mono text-[9px] text-amber-300">
                          CBAM
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold text-white">
                      {formatTco2e(h.tco2e)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {h.shareOfScope3Pct}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Multi-Region Compliance Readiness Checklist */}
        {(analytics.esg.complianceChecklist ?? []).length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
                Regional Compliance Readiness
              </span>
              <div className="flex flex-wrap gap-1" data-testid="active-compliance-packs">
                {(analytics.esg.activeCompliancePacks ?? []).map((pack) => (
                  <span
                    key={pack}
                    className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-sky-200"
                  >
                    <Globe2 className="h-2.5 w-2.5" />
                    {pack}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {(analytics.esg.complianceChecklist ?? []).map((item) => (
                <div
                  key={item.ruleId}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[11px] space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200 truncate">
                      {item.title}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        item.status === "PASSED"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : item.status === "ACTION_NEEDED"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {item.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {item.framework}
                    {item.legalStatus !== "IN_FORCE" ? ` · ${item.legalStatus}` : ""}
                  </div>
                  <p className="text-[10px] text-slate-300/90">{item.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
