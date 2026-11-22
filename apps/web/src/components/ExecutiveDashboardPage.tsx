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
  CheckCircle2,
  ChevronDown,
  Coins,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Flame,
  Leaf,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { exportEsgLedgerCsv, getExecutiveReport } from "../lib/api.js";
import { downloadEsgExecutiveSummaryPdf } from "../lib/esgPdfExport.js";

export type DashboardTab = "overview" | "financial" | "esg" | "compliance";

export interface ExecutiveDashboardPageProps {
  analytics: AnalyticsSummary | null;
  loading: boolean;
  organization: Organization;
  facilities: readonly Facility[];
  activeProductId: string | null;
  activeInputId: string | null;
  financialViewMode: FinancialViewMode;
  activeRedDisruptions: number;
  activeAmberDisruptions: number;
  onSelectFacility: (facilityId: string) => void;
  onOpenSimulator: () => void;
  onOpenDirectory: (capability?: string) => void;
  onOpenImportExport: () => void;
  onOpenSettings: () => void;
}

function formatEurCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(1)}k`;
  return `${sign}€${Math.round(abs).toLocaleString("en-US")}`;
}

function formatTco2e(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k tCO2e`;
  return `${value.toFixed(1)} tCO2e`;
}

export function ExecutiveDashboardPage({
  analytics,
  loading,
  organization,
  facilities,
  activeProductId,
  activeInputId,
  financialViewMode,
  activeRedDisruptions,
  activeAmberDisruptions,
  onSelectFacility,
  onOpenSimulator,
  onOpenDirectory,
  onOpenImportExport,
  onOpenSettings,
}: ExecutiveDashboardPageProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const facilitiesById = new Map(facilities.map((f) => [f.facilityId, f]));
  const reportFilters = {
    productId: activeProductId ?? undefined,
    inputId: activeInputId ?? undefined,
    viewMode: financialViewMode,
  };

  const handleDownloadPdf = () => {
    setExportMenuOpen(false);
    if (!analytics) return;
    setExportError(null);
    downloadEsgExecutiveSummaryPdf(organization, analytics);
    setExportNotice("Board / Bank-Ready PDF Executive Summary downloaded.");
  };

  const handleDownloadCsv = async () => {
    setExportMenuOpen(false);
    setExportBusy("csv");
    setExportError(null);
    setExportNotice(null);
    try {
      const csv = await exportEsgLedgerCsv(reportFilters);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kulgo-esg-ledger-${analytics?.esg.factorMatrixVersion ?? "2026.1"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportNotice("Auditor CSV Ledger downloaded.");
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export CSV ledger.",
      );
    } finally {
      setExportBusy(null);
    }
  };

  const handleDownloadJsonReport = async () => {
    setExportMenuOpen(false);
    setExportBusy("json");
    setExportError(null);
    setExportNotice(null);
    try {
      const report = await getExecutiveReport(reportFilters);
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kulgo-executive-report-${organization.slug}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportNotice("Structured JSON Executive Report downloaded.");
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export JSON report.",
      );
    } finally {
      setExportBusy(null);
    }
  };

  if (loading && !analytics) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-xs text-slate-400 gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        <span>Computing Resilience, Financial Risk &amp; ESG Dashboard...</span>
      </div>
    );
  }

  const fin = analytics?.financialRisk;
  const esg = analytics?.esg;
  const totalDisruptions = activeRedDisruptions + activeAmberDisruptions;

  // Overall HHI coverage indicator
  const overallHhi =
    analytics?.hhiMetrics.find((m) => m.dimension === "SUPPLIER") ??
    analytics?.hhiMetrics[0];
  const coverageText =
    overallHhi?.coveredLanesCount != null && overallHhi?.totalActiveLanesCount != null
      ? `Based on ${overallHhi.coveredLanesCount} of ${overallHhi.totalActiveLanesCount} active lanes`
      : analytics
        ? `${analytics.hhiMetrics.length} concentration scopes`
        : "No active lanes";

  const statusBadgeClass =
    analytics?.overallStatus === "RED"
      ? "bg-red-500/15 text-red-300 border-red-500/40"
      : analytics?.overallStatus === "YELLOW"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
        : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";

  const tabs: ReadonlyArray<{ id: DashboardTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "financial", label: "Financial Risk" },
    { id: "esg", label: "ESG & Emissions" },
    { id: "compliance", label: "Compliance" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header + Export Reports Dropdown */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              Executive Dashboard
            </h1>
            <p className="text-xs text-slate-400">
              Board-ready financial exposure, PCAF-scored carbon footprint, and regional compliance readiness ({financialViewMode === "RUN_RATE" ? "Current Run-Rate" : "Selected Period Window T"}).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSimulator}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 cursor-pointer"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
              What-If Simulator
            </button>

            {/* Prominent Export Reports Dropdown */}
            <div className="relative">
              <button
                type="button"
                data-testid="export-reports-btn"
                onClick={() => setExportMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-lg cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{exportBusy ? "Exporting..." : "Export Reports"}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {exportMenuOpen && (
                <div
                  role="menu"
                  data-testid="export-reports-menu"
                  className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-700 bg-slate-950/98 backdrop-blur-md p-1.5 shadow-2xl z-30 text-xs"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!analytics}
                    onClick={handleDownloadPdf}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-900 disabled:opacity-40 cursor-pointer"
                  >
                    <FileText className="h-4 w-4 text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-semibold">Board / Bank-Ready PDF</div>
                      <div className="text-[10px] text-slate-400">
                        Executive ESG &amp; Resilience Summary
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleDownloadCsv()}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-900 cursor-pointer"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="font-semibold">Auditor CSV Ledger</div>
                      <div className="text-[10px] text-slate-400">
                        Factor citations, attribution &amp; PCAF scores
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleDownloadJsonReport()}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-900 cursor-pointer"
                  >
                    <FileJson className="h-4 w-4 text-violet-400 shrink-0" />
                    <div>
                      <div className="font-semibold">Structured JSON Report</div>
                      <div className="text-[10px] text-slate-400">
                        CSRD Executive Report payload
                      </div>
                    </div>
                  </button>
                  <div className="my-1 border-t border-slate-800" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onOpenImportExport();
                    }}
                    className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-900 cursor-pointer"
                  >
                    <Upload className="h-4 w-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold">Bulk Import / Export Workspace</div>
                      <div className="text-[10px] text-slate-400">
                        CSV/JSON backup &amp; CSRD preview
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {exportNotice && (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{exportNotice}</span>
          </div>
        )}
        {exportError && (
          <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-xs text-red-200">
            {exportError}
          </div>
        )}

        {/* Top KPI Strip (4 Cards) */}
        <div
          data-testid="dashboard-kpi-strip"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {/* 1. Resilience Score */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Resilience Score
              </span>
              {analytics && (
                <span
                  className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${statusBadgeClass}`}
                >
                  {analytics.overallStatus === "YELLOW"
                    ? "AMBER"
                    : analytics.overallStatus}
                </span>
              )}
            </div>
            <div className="text-2xl font-black font-mono text-white">
              {analytics ? `${analytics.resilienceScore}` : "—"}
              <span className="text-xs font-normal text-slate-500"> / 100</span>
            </div>
            <div className="text-[11px] text-slate-400">{coverageText}</div>
          </div>

          {/* 2. Expected Annual Loss (EAL) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium flex items-center gap-1.5">
                <Coins className="h-4 w-4 text-amber-400" />
                Expected Annual Loss
              </span>
              {fin?.confidenceBadge && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  {fin.confidenceBadge}
                </span>
              )}
            </div>
            <div className="text-xl font-black font-mono text-white">
              {fin
                ? `${formatEurCompact(fin.lowEur)} – ${formatEurCompact(fin.highEur)}`
                : "—"}
            </div>
            <div className="text-[11px] text-slate-400">
              Base EAL: {fin ? formatEurCompact(fin.baseEur) : "—"} (
              {financialViewMode === "RUN_RATE" ? "Run-Rate" : "Window T"})
            </div>
          </div>

          {/* 3. Total Carbon Footprint + PCAF */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium flex items-center gap-1.5">
                <Leaf className="h-4 w-4 text-emerald-400" />
                Total Carbon Footprint
              </span>
              {esg?.weightedPcafScore != null && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  PCAF {esg.weightedPcafScore.toFixed(1)}
                </span>
              )}
            </div>
            <div className="text-2xl font-black font-mono text-white">
              {esg ? formatTco2e(esg.totalTco2e) : "—"}
            </div>
            <div className="text-[11px] text-slate-400">
              Scope 1+2+3 (GHG Protocol Cat 1 &amp; 4)
            </div>
          </div>

          {/* 4. Active Disruptions */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-red-400" />
                Active Disruptions
              </span>
              <span className="text-[10px] font-mono text-slate-400">Live</span>
            </div>
            <div className="text-2xl font-black font-mono text-white">
              {totalDisruptions}
            </div>
            <div className="text-[11px] flex items-center gap-2">
              <span className="text-red-300 font-mono">
                {activeRedDisruptions} RED
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-amber-300 font-mono">
                {activeAmberDisruptions} AMBER
              </span>
            </div>
          </div>
        </div>

        {/* Clean Sub-Tabs */}
        <div
          role="tablist"
          aria-label="Dashboard sections"
          className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-3"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              data-testid={`dashboard-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                activeTab === tab.id
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!analytics ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-xs text-slate-400">
            Load the Estonia Product X demo or add supply routes in the Network
            Hub to populate Executive Dashboard insights.
          </div>
        ) : (
          <>
            {/* SUB-TAB 1: Overview */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top Risk Alerts */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                      <AlertOctagon className="h-4 w-4 text-red-400" />
                      Top Supply Chain Risks ({analytics.alerts.length})
                    </h2>
                  </div>
                  {analytics.alerts.length === 0 ? (
                    <p className="text-xs text-emerald-300">
                      No active concentration, contract, or corridor risk alerts.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {analytics.alerts.slice(0, 6).map((alert) => (
                        <div
                          key={alert.alertId}
                          className="rounded-xl border border-slate-800 bg-slate-950/75 p-3 space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-white">
                              {alert.title}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                alert.severity === "RED"
                                  ? "bg-red-500/20 text-red-300"
                                  : "bg-amber-500/20 text-amber-300"
                              }`}
                            >
                              {alert.severity === "YELLOW" ? "AMBER" : alert.severity}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {alert.summary}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            {alert.affectedTier1FacilityIds[0] && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectFacility(
                                    alert.affectedTier1FacilityIds[0]!,
                                  )
                                }
                                className="text-[11px] text-emerald-300 hover:underline cursor-pointer"
                              >
                                Inspect Supplier
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenDirectory()}
                              className="text-[11px] text-sky-300 hover:underline cursor-pointer"
                            >
                              Find Alternatives
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* HHI Concentration with Explicit Coverage % */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                    <BarChart3 className="h-4 w-4 text-sky-400" />
                    Supplier Concentration (HHI)
                  </h2>
                  <div className="space-y-2">
                    {analytics.hhiMetrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-xl border border-slate-800 bg-slate-950/75 p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">
                            {metric.label}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2">
                            <span>{metric.dimension}</span>
                            {metric.coveragePct != null && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                Coverage {Math.round(metric.coveragePct)}%
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold text-white">
                            HHI {metric.rawHhi.toLocaleString("en-US")}
                          </div>
                          <div
                            className={`text-[10px] font-semibold ${
                              metric.concentrationLevel === "HIGH" ||
                              metric.concentrationLevel === "SINGLE_SOURCE"
                                ? "text-red-300"
                                : metric.concentrationLevel === "MODERATE"
                                  ? "text-amber-300"
                                  : "text-emerald-300"
                            }`}
                          >
                            {metric.concentrationLevel.replace(/_/g, " ")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* SUB-TAB 2: Financial Risk */}
            {activeTab === "financial" && (
              <div className="space-y-4">
                {!fin ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-xs text-slate-400">
                    Financial risk modeling requires active upstream lanes with spend or revenue context.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-1">
                        <div className="text-slate-400">Expected Annual Loss (Low / Base / High)</div>
                        <div className="text-lg font-mono font-bold text-white">
                          {formatEurCompact(fin.lowEur)} /{" "}
                          <span className="text-amber-300">
                            {formatEurCompact(fin.baseEur)}
                          </span>{" "}
                          / {formatEurCompact(fin.highEur)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-1">
                        <div className="text-slate-400">Worst-Case Tail VaR (95%)</div>
                        <div className="text-lg font-mono font-bold text-red-300">
                          {formatEurCompact(fin.varP95Eur)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-1">
                        <div className="text-slate-400">Active Spend &amp; Renewal Cliffs</div>
                        <div className="text-lg font-mono font-bold text-emerald-300">
                          {formatEurCompact(fin.totalActiveSpendEur)}
                          <span className="text-xs font-normal text-slate-400 ml-2">
                            ({fin.renewalCliffCount} cliff{fin.renewalCliffCount === 1 ? "" : "s"})
                          </span>
                        </div>
                      </div>
                    </div>

                    {fin.materials.length > 0 && (
                      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-2.5">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                          Material Exposure, Outage Gaps &amp; Defect Buffers
                        </h3>
                        <div className="divide-y divide-slate-800">
                          {fin.materials.map((mat) => (
                            <div
                              key={mat.inputId}
                              className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <div>
                                <div className="font-semibold text-white">
                                  {mat.inputName}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  Unprotected gap: {mat.unprotectedGapDaysBase.toFixed(1)}d ·
                                  Effective TTR: {mat.effectiveTtrDaysBase.toFixed(1)}d
                                  {mat.defectBuffer && (
                                    <> · Defect buffer: +{mat.defectBuffer.recommendedOrderBufferPct.toFixed(1)}%</>
                                  )}
                                </div>
                              </div>
                              <div className="text-right font-mono">
                                <div className="text-amber-300 font-bold">
                                  EAL {formatEurCompact(mat.baseEur)}
                                </div>
                                {mat.isRenewalCliff && (
                                  <div className="text-[10px] text-red-300">
                                    Renewal cliff ({Math.round(mat.atRiskVolumePct)}% at risk)
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}

            {/* SUB-TAB 3: ESG & Emissions */}
            {activeTab === "esg" && esg && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-slate-400">Scope 1 (Direct)</div>
                    <div className="text-lg font-mono font-bold text-white mt-1">
                      {formatTco2e(esg.scope1Tco2e)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-slate-400">Scope 2 (Location)</div>
                    <div className="text-lg font-mono font-bold text-white mt-1">
                      {formatTco2e(esg.scope2Tco2e)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-slate-400">Scope 3 Cat 1 (Purchased)</div>
                    <div className="text-lg font-mono font-bold text-emerald-300 mt-1">
                      {formatTco2e(esg.upstreamScope3Tco2e)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="text-slate-400">Scope 3 Cat 4 (Freight)</div>
                    <div className="text-lg font-mono font-bold text-sky-300 mt-1">
                      {formatTco2e(esg.transportScope3Tco2e)}
                    </div>
                  </div>
                </div>

                {/* Emission Hotspots */}
                {esg.hotspots && esg.hotspots.length > 0 && (
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                      <Flame className="h-4 w-4 text-amber-400" />
                      Top Emitting Lanes &amp; Hotspots
                    </h3>
                    <div className="divide-y divide-slate-800 text-xs">
                      {esg.hotspots.slice(0, 6).map((hs) => {
                        const sup = facilitiesById.get(hs.entityId);
                        return (
                          <div
                            key={`${hs.entityId}-${hs.materialCategory}`}
                            className="py-2.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-white truncate">
                                {hs.entityName} — {hs.materialCategory}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {sup ? `${sup.countryCode} · ` : `${hs.countryCode} · `}
                                {hs.attributionMethod} · PCAF {hs.pcafScore}
                              </div>
                            </div>
                            <div className="font-mono font-bold text-emerald-300 shrink-0">
                              {formatTco2e(hs.tco2e)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* CBAM Flagged Lanes */}
                {esg.cbamSummary && esg.cbamSummary.flaggedLanes.length > 0 && (
                  <section className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2 text-xs">
                    <div className="font-semibold text-amber-200 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" />
                      EU CBAM Flagged Import Corridors (
                      {esg.cbamSummary.flaggedLanes.length})
                    </div>
                    <div className="space-y-1 text-[11px] text-amber-100/90">
                      {esg.cbamSummary.flaggedLanes.map((lane) => (
                        <div key={lane.laneId}>
                          • {lane.materialCategory} ({lane.originCountryCode}) —{" "}
                          {lane.cbamCategory} ({lane.embeddedTco2e.toFixed(1)} tCO2e)
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* SUB-TAB 4: Compliance */}
            {activeTab === "compliance" && (
              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Regional Compliance Readiness Checklist
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Driven by HQ ({organization.countryCode}) and active Target
                      Sales Markets (
                      {(organization.targetMarkets ?? []).join(", ") || "Default"}
                      ).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs text-slate-200 cursor-pointer"
                  >
                    Configure Markets &amp; Packs
                  </button>
                </div>

                {!esg?.complianceChecklist ||
                esg.complianceChecklist.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No regional compliance checks evaluated yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {esg.complianceChecklist.map((item) => (
                      <div
                        key={item.ruleId}
                        className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                              {item.packId}
                            </span>
                            <span className="font-semibold text-white">
                              {item.framework}: {item.title}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {item.summary}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                            item.status === "PASSED"
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/35"
                              : item.status === "ACTION_NEEDED"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/35"
                                : "bg-slate-800 text-slate-400 border-slate-700"
                          }`}
                        >
                          {item.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
