import type {
  BulkImportSummary,
  ExecutiveReport,
  Organization,
} from "@kulgo/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import {
  bulkImportWorkspace,
  exportWorkspaceCsv,
  exportWorkspaceJson,
  getExecutiveReport,
} from "../lib/api.js";

export interface ImportExportModalProps {
  open: boolean;
  organization: Organization;
  activeProductId: string | null;
  activeInputId: string | null;
  onClose: () => void;
  onImported: () => void;
}

type ModalTab = "import" | "export";

const SAMPLE_CSV = [
  "recordType,refKey,name,kind,countryCode,lat,lng,isOwnFacility,sector,esgBadges,estimatedScope12Tco2e,fromFacility,toFacility,materialCategory,transportMode,volumeSharePct,annualVolume,volumeUnit,annualSpendEur,riskStatus",
  "FACILITY,hq-ee,Tallinn Main Assembly,HQ,EE,59.4370,24.7536,true,Electronics,ISO 14001|RE100,180,,,,,,,,,",
  "FACILITY,sup-fi,Helsinki Precision Metals,FACTORY,FI,60.1699,24.9384,false,Metals,EcoVadis Gold,140,,,,,,,,,",
  "LANE,,,,,,,,,,,sup-fi,hq-ee,Aluminum Housings,SEA,100,450,TONNES,620000,GREEN",
].join("\n");

function triggerBrowserDownload(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface ParsedPreview {
  format: "csv" | "json" | "invalid";
  summary: string;
  previewLines: string[];
  error?: string;
}

function buildInputPreview(rawText: string): ParsedPreview | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const facilities = Array.isArray(parsed.facilities)
        ? parsed.facilities
        : [];
      const lanes = Array.isArray(parsed.lanes) ? parsed.lanes : [];
      const previewLines: string[] = [];
      for (const fac of facilities.slice(0, 4)) {
        const rec = fac as Record<string, unknown>;
        previewLines.push(
          `FACILITY: ${String(rec.name ?? "(unnamed)")} (${String(rec.countryCode ?? "??")})`,
        );
      }
      for (const lane of lanes.slice(0, 4)) {
        const rec = lane as Record<string, unknown>;
        previewLines.push(
          `LANE: ${String(rec.fromFacilityRef ?? rec.fromFacilityId ?? "?")} → ${String(rec.toFacilityRef ?? rec.toFacilityId ?? "?")} [${String(rec.materialCategory ?? "?")}]`,
        );
      }
      return {
        format: "json",
        summary: `JSON detected: ${facilities.length} facilit${facilities.length === 1 ? "y" : "ies"}, ${lanes.length} lane${lanes.length === 1 ? "" : "s"}`,
        previewLines,
      };
    } catch {
      return {
        format: "invalid",
        summary: "Invalid JSON syntax",
        previewLines: [],
        error: "Could not parse JSON payload. Check syntax and try again.",
      };
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const dataRowCount = Math.max(0, lines.length - 1);
  return {
    format: "csv",
    summary: `CSV detected: ${dataRowCount} data row${dataRowCount === 1 ? "" : "s"}`,
    previewLines: lines.slice(0, 6),
  };
}

export function ImportExportModal({
  open,
  organization,
  activeProductId,
  activeInputId,
  onClose,
  onImported,
}: ImportExportModalProps) {
  const [tab, setTab] = useState<ModalTab>("import");
  const [rawInput, setRawInput] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportSummary | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);

  const [exportingKind, setExportingKind] = useState<
    "json" | "csv" | "csrd" | null
  >(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [csrdPreview, setCsrdPreview] = useState<ExecutiveReport | null>(null);

  const preview = useMemo(() => buildInputPreview(rawInput), [rawInput]);

  if (!open) {
    return null;
  }

  const safeSlug = organization.slug.replace(/[^a-zA-Z0-9_-]/g, "");

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setRawInput(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file);
  };

  const handleRunImport = async () => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setImportError("Upload a CSV/JSON file or paste data to import.");
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      let result: BulkImportSummary;
      if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed) as {
          facilities?: unknown[];
          lanes?: unknown[];
          csv?: string;
        };
        result = await bulkImportWorkspace(parsed);
      } else {
        result = await bulkImportWorkspace({ csv: trimmed });
      }
      setImportResult(result);
      if (result.createdFacilities > 0 || result.createdLanes > 0) {
        onImported();
      }
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Bulk import failed.",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadJson = async () => {
    setExportingKind("json");
    setExportError(null);
    try {
      const data = await exportWorkspaceJson();
      triggerBrowserDownload(
        `kulgo-network-${safeSlug}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export JSON network.",
      );
    } finally {
      setExportingKind(null);
    }
  };

  const handleDownloadCsv = async () => {
    setExportingKind("csv");
    setExportError(null);
    try {
      const csv = await exportWorkspaceCsv();
      triggerBrowserDownload(
        `kulgo-network-${safeSlug}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export CSV network.",
      );
    } finally {
      setExportingKind(null);
    }
  };

  const handleDownloadCsrdReport = async () => {
    setExportingKind("csrd");
    setExportError(null);
    try {
      const report = await getExecutiveReport({
        productId: activeProductId ?? undefined,
        inputId: activeInputId ?? undefined,
      });
      setCsrdPreview(report);
      triggerBrowserDownload(
        `kulgo-csrd-report-${safeSlug}.json`,
        JSON.stringify(report, null, 2),
        "application/json",
      );
    } catch (err) {
      setExportError(
        err instanceof Error
          ? err.message
          : "Failed to generate CSRD Executive Report.",
      );
    } finally {
      setExportingKind(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-sky-500/15 border border-sky-500/35 flex items-center justify-center text-sky-400">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="import-export-modal-title"
                className="text-sm font-semibold text-white"
              >
                Import, Export &amp; CSRD Report
              </h2>
              <p className="text-[11px] text-slate-400">
                Bulk CSV/JSON ingestion, network export, and anonymized CSRD
                executive report
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close import and export modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 px-5 pt-3 border-b border-slate-800 flex items-center gap-2 bg-slate-900/30">
          <button
            type="button"
            onClick={() => setTab("import")}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              tab === "import"
                ? "border-emerald-400 text-emerald-200"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Bulk Import (CSV / JSON)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("export")}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              tab === "export"
                ? "border-emerald-400 text-emerald-200"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export &amp; CSRD Report</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "import" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 cursor-pointer">
                  <Upload className="h-3.5 w-3.5 text-sky-400" />
                  <span>{fileName ? `File: ${fileName}` : "Choose .csv or .json file"}</span>
                  <input
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setFileName("sample-network.csv");
                    setRawInput(SAMPLE_CSV);
                    setImportResult(null);
                    setImportError(null);
                  }}
                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  Load Sample CSV
                </button>
              </div>

              <textarea
                value={rawInput}
                onChange={(e) => {
                  setRawInput(e.target.value);
                  setImportResult(null);
                  setImportError(null);
                }}
                rows={7}
                placeholder="Paste CSV (with recordType=FACILITY / LANE) or JSON ({ facilities: [...], lanes: [...] })..."
                className="w-full rounded-xl border border-slate-800 bg-slate-900 p-3 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />

              {/* Live Client-Side Preview */}
              {preview && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      Preview
                    </span>
                    <span
                      className={`font-mono text-[11px] px-2 py-0.5 rounded ${
                        preview.format === "invalid"
                          ? "bg-red-500/15 text-red-300"
                          : "bg-sky-500/15 text-sky-300"
                      }`}
                    >
                      {preview.summary}
                    </span>
                  </div>
                  {preview.error ? (
                    <p className="text-xs text-red-300">{preview.error}</p>
                  ) : (
                    <pre className="overflow-x-auto text-[10px] font-mono text-slate-400 leading-relaxed">
                      {preview.previewLines.join("\n")}
                    </pre>
                  )}
                </div>
              )}

              {importError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  {importError}
                </div>
              )}

              {importResult && (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>
                      Imported {importResult.createdFacilities} facilit
                      {importResult.createdFacilities === 1 ? "y" : "ies"} and{" "}
                      {importResult.createdLanes} lane
                      {importResult.createdLanes === 1 ? "" : "s"}
                    </span>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-950/40 p-2.5 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>
                          {importResult.errors.length} row issue
                          {importResult.errors.length === 1 ? "" : "s"} skipped:
                        </span>
                      </div>
                      <ul className="space-y-0.5 text-[11px] text-amber-200/90 font-mono max-h-28 overflow-y-auto">
                        {importResult.errors.map((err, idx) => (
                          <li key={`${err.row}-${idx}`}>
                            Row {err.row} ({err.entity}
                            {err.field ? `.${err.field}` : ""}): {err.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleRunImport}
                  disabled={
                    importing ||
                    !rawInput.trim() ||
                    preview?.format === "invalid"
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-slate-950 cursor-pointer"
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  <span>Import into Workspace</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 text-[11px] text-slate-400 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>
                  Exports include only your organization&apos;s own entered
                  network and strictly anonymized CSRD aggregates — never any
                  hidden Tier-2+ partner identities or coordinates.
                </span>
              </div>

              {exportError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  {exportError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Export JSON */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="h-8 w-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                      <FileJson className="h-4 w-4" />
                    </div>
                    <h3 className="text-xs font-semibold text-white">
                      Network Export (JSON)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Complete structured snapshot of your products, materials,
                      facilities, and supply lanes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    disabled={exportingKind !== null}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-60 px-3 py-2 text-xs font-medium text-sky-200 cursor-pointer"
                  >
                    {exportingKind === "json" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>Download JSON</span>
                  </button>
                </div>

                {/* Export CSV */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="h-8 w-8 rounded-lg bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400">
                      <FileSpreadsheet className="h-4 w-4" />
                    </div>
                    <h3 className="text-xs font-semibold text-white">
                      Network Export (CSV)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Spreadsheet-ready CSV of your facilities and lanes
                      (round-trip compatible with Bulk Import).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    disabled={exportingKind !== null}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal-500/40 bg-teal-500/15 hover:bg-teal-500/25 disabled:opacity-60 px-3 py-2 text-xs font-medium text-teal-200 cursor-pointer"
                  >
                    {exportingKind === "csv" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>Download CSV</span>
                  </button>
                </div>

                {/* CSRD Executive Report */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <FileText className="h-4 w-4" />
                    </div>
                    <h3 className="text-xs font-semibold text-white">
                      CSRD Risk &amp; ESG Report
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Executive report combining Scope 1/2/3 disclosures,
                      verified coverage, and prioritized actions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadCsrdReport}
                    disabled={exportingKind !== null}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 px-3 py-2 text-xs font-semibold text-slate-950 cursor-pointer"
                  >
                    {exportingKind === "csrd" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>Download CSRD Report</span>
                  </button>
                </div>
              </div>

              {csrdPreview && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">
                      CSRD Executive Summary Preview
                    </span>
                    <span className="font-mono text-[11px] text-emerald-300">
                      Resilience {csrdPreview.analytics.resilienceScore}/100 ·{" "}
                      {csrdPreview.csrdDisclosures.totalReportedTco2e} tCO2e
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded-lg bg-slate-950 border border-slate-800 p-2">
                      <span className="block text-slate-500">Scope 1/2</span>
                      <span className="font-mono text-slate-200">
                        {csrdPreview.csrdDisclosures.scope1Status} /{" "}
                        {csrdPreview.csrdDisclosures.scope2Status}
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-950 border border-slate-800 p-2">
                      <span className="block text-slate-500">
                        Verified Partners
                      </span>
                      <span className="font-mono text-slate-200">
                        {csrdPreview.verifiedPartnerCoverage.verifiedTier1Suppliers}
                        /
                        {csrdPreview.verifiedPartnerCoverage.totalTier1Suppliers}{" "}
                        ({csrdPreview.verifiedPartnerCoverage.verifiedCoveragePct}
                        %)
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-950 border border-slate-800 p-2">
                      <span className="block text-slate-500">
                        Scope 3 Total
                      </span>
                      <span className="font-mono text-slate-200">
                        {(
                          csrdPreview.analytics.esg.upstreamScope3Tco2e +
                          csrdPreview.analytics.esg.transportScope3Tco2e
                        ).toFixed(1)}{" "}
                        tCO2e
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-950 border border-slate-800 p-2">
                      <span className="block text-slate-500">Top Actions</span>
                      <span className="font-mono text-slate-200">
                        {csrdPreview.topRecommendedActions.length} prioritized
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
