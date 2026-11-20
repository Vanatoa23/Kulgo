import type { AlternativeCandidate } from "@kulgo/shared";
import {
  Building2,
  CheckCircle2,
  Leaf,
  Loader2,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { listDirectoryAlternatives } from "../lib/api.js";

export interface AlternativeDirectoryModalProps {
  open: boolean;
  initialCapability?: string;
  onClose: () => void;
}

const COUNTRY_OPTIONS = [
  { code: "", label: "All Countries" },
  { code: "EE", label: "Estonia (EE)" },
  { code: "FI", label: "Finland (FI)" },
  { code: "SE", label: "Sweden (SE)" },
  { code: "DE", label: "Germany (DE)" },
  { code: "PL", label: "Poland (PL)" },
  { code: "LT", label: "Lithuania (LT)" },
  { code: "NO", label: "Norway (NO)" },
  { code: "RO", label: "Romania (RO)" },
];

export function AlternativeDirectoryModal({
  open,
  initialCapability = "",
  onClose,
}: AlternativeDirectoryModalProps) {
  const [countryCode, setCountryCode] = useState("");
  const [capability, setCapability] = useState(initialCapability);
  const [excludeRed, setExcludeRed] = useState(true);

  const [candidates, setCandidates] = useState<AlternativeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCapability(initialCapability);
    }
  }, [open, initialCapability]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    listDirectoryAlternatives({
      countryCode: countryCode || undefined,
      capability: capability.trim() || undefined,
      excludeRed,
    })
      .then((results) => {
        if (!cancelled) {
          setCandidates(results);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load alternative suppliers.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, countryCode, capability, excludeRed]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-3xl max-h-[86vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="directory-modal-title"
                className="text-sm font-semibold text-white"
              >
                Alternative Suppliers Directory
              </h2>
              <p className="text-[11px] text-slate-400">
                Verified EU/Nordic alternatives &amp; opt-in Kulgo suppliers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close alternative suppliers directory"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="shrink-0 px-5 py-3 border-b border-slate-800/80 bg-slate-900/40 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              placeholder="Filter by capability (e.g. Aluminum, Electronics, Copper)..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            aria-label="Filter by country"
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {COUNTRY_OPTIONS.map((opt) => (
              <option key={opt.code || "ALL"} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludeRed}
              onChange={(e) => setExcludeRed(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-emerald-500"
            />
            <span>Exclude RED Risk</span>
          </label>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 text-[11px] text-slate-400 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              Directory profiles expose only self-declared capabilities &amp; ESG
              badges — never private buyer networks.
            </span>
            <span className="font-mono text-slate-300 shrink-0">
              {candidates.length} match{candidates.length === 1 ? "" : "es"}
            </span>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
              <span>Searching verified suppliers...</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No alternative suppliers match your current filter criteria.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {candidates.map((candidate) => {
                const riskClass =
                  candidate.riskStatus === "RED"
                    ? "bg-red-500/15 text-red-300 border-red-500/40"
                    : candidate.riskStatus === "YELLOW"
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";

                const isKulgoOptIn = candidate.source === "KULGO_DIRECTORY";

                return (
                  <article
                    key={candidate.orgId}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2.5 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-white truncate">
                          {candidate.name}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                            {candidate.countryCode}
                          </span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                              isKulgoOptIn
                                ? "bg-teal-500/15 text-teal-200 border-teal-500/35"
                                : "bg-slate-800/80 text-slate-300 border-slate-700"
                            }`}
                          >
                            {isKulgoOptIn && (
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            )}
                            {isKulgoOptIn ? "Kulgo Opt-In" : "EU/Nordic Verified"}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${riskClass}`}
                      >
                        {candidate.riskStatus}
                      </span>
                    </div>

                    {candidate.capabilities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {candidate.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-slate-300"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    )}

                    {candidate.esgBadges.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-800/70">
                        <Leaf className="h-3 w-3 text-emerald-400 shrink-0" />
                        {candidate.esgBadges.map((badge) => (
                          <span
                            key={badge}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25"
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
