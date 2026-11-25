import type {
  AlternativeCandidate,
  AlternativeMatch,
  FacilityAlternativesResponse,
} from "@kulgo/shared";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Leaf,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  getFacilityAlternatives,
  listDirectoryAlternatives,
  requestSupplierIntro,
} from "../lib/api.js";

export interface AlternativeDirectoryModalProps {
  open: boolean;
  initialCapability?: string;
  facilityId?: string | null;
  facilityName?: string | null;
  onTestInWhatIf?: (params: {
    facilityId: string;
    alternativeName: string;
    switchPct: number;
  }) => void;
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
  facilityId = null,
  facilityName = null,
  onTestInWhatIf,
  onClose,
}: AlternativeDirectoryModalProps) {
  const isFacilityMode = Boolean(facilityId);

  // General directory filter state
  const [countryCode, setCountryCode] = useState("");
  const [capability, setCapability] = useState(initialCapability);
  const [excludeRed, setExcludeRed] = useState(true);
  const [candidates, setCandidates] = useState<AlternativeCandidate[]>([]);

  // Facility-targeted ranked alternatives state
  const [facilityAlts, setFacilityAlts] =
    useState<FacilityAlternativesResponse | null>(null);
  const [switchPctByOrg, setSwitchPctByOrg] = useState<Record<string, number>>(
    {},
  );

  // Request Intro inline form state
  const [introOrgId, setIntroOrgId] = useState<string | null>(null);
  const [introMaterial, setIntroMaterial] = useState("");
  const [introVolumeBand, setIntroVolumeBand] = useState("100-500 tonnes/year");
  const [introNote, setIntroNote] = useState("");
  const [introBusy, setIntroBusy] = useState(false);
  const [introError, setIntroError] = useState<string | null>(null);
  const [introSentMap, setIntroSentMap] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCapability(initialCapability);
      setIntroOrgId(null);
      setIntroError(null);
    }
  }, [open, initialCapability, facilityId]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    if (facilityId) {
      getFacilityAlternatives(facilityId)
        .then((res) => {
          if (!cancelled) {
            setFacilityAlts(res);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Failed to load ranked alternative suppliers.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setFacilityAlts(null);
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
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, facilityId, countryCode, capability, excludeRed]);

  if (!open) {
    return null;
  }

  const handleOpenIntro = (alt: {
    orgId: string;
    capabilities: readonly string[];
  }) => {
    setIntroOrgId(alt.orgId);
    setIntroError(null);
    const defaultMaterial =
      facilityAlts?.materialCategories[0] ??
      alt.capabilities[0] ??
      initialCapability ??
      "Industrial Materials";
    setIntroMaterial(defaultMaterial);
    setIntroVolumeBand("100-500 tonnes/year");
    setIntroNote("");
  };

  const handleSendIntro = async (e: FormEvent, targetOrgId: string) => {
    e.preventDefault();
    setIntroBusy(true);
    setIntroError(null);
    try {
      const res = await requestSupplierIntro({
        targetOrgId,
        materialCategory: introMaterial.trim() || "General Materials",
        volumeBand: introVolumeBand.trim() || "Flexible",
        ...(introNote.trim() ? { note: introNote.trim() } : {}),
      });
      setIntroSentMap((prev) => ({
        ...prev,
        [targetOrgId]: `Intro ${res.status.toLowerCase()} to ${res.targetOrgName}`,
      }));
      setIntroOrgId(null);
    } catch (err) {
      setIntroError(
        err instanceof Error
          ? err.message
          : "Failed to send introduction request.",
      );
    } finally {
      setIntroBusy(false);
    }
  };

  const renderRiskBadge = (riskStatus: string) => {
    const riskClass =
      riskStatus === "RED"
        ? "bg-red-500/15 text-red-300 border-red-500/40"
        : riskStatus === "YELLOW"
          ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
          : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    return (
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${riskClass}`}
      >
        {riskStatus}
      </span>
    );
  };

  const renderFacilityAlternativeCard = (alt: AlternativeMatch) => {
    const isKulgoOptIn = alt.source === "KULGO_DIRECTORY";
    const switchPct = switchPctByOrg[alt.orgId] ?? 50;
    const introNotice = introSentMap[alt.orgId];

    return (
      <article
        key={alt.orgId}
        data-testid={`alternative-card-${alt.orgId}`}
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 hover:border-slate-700 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              {alt.name}
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                {alt.countryCode}
              </span>
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                  isKulgoOptIn
                    ? "bg-teal-500/15 text-teal-200 border-teal-500/35"
                    : "bg-slate-800/80 text-slate-300 border-slate-700"
                }`}
              >
                {isKulgoOptIn && <CheckCircle2 className="h-2.5 w-2.5" />}
                {isKulgoOptIn ? "Kulgo Opt-In" : "EU/Nordic Verified"}
              </span>
              <span className="text-[10px] text-slate-400">
                Match {alt.matchScore}% · {alt.matchReason}
              </span>
            </div>
          </div>
          {renderRiskBadge(alt.riskStatus)}
        </div>

        {/* Distance & Transport CO2e Delta */}
        {(alt.estimatedDistanceKm !== null ||
          alt.estimatedTransportCo2eDeltaT !== null) && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px]">
            <div>
              <span className="text-slate-500 block text-[10px]">
                Est. Distance
              </span>
              <span className="font-mono text-slate-200">
                {alt.estimatedDistanceKm !== null
                  ? `${alt.estimatedDistanceKm.toLocaleString()} km`
                  : "—"}
                {alt.distanceDeltaKm !== null && (
                  <span
                    className={`ml-1.5 ${
                      alt.distanceDeltaKm <= 0
                        ? "text-emerald-400"
                        : "text-amber-300"
                    }`}
                  >
                    ({alt.distanceDeltaKm > 0 ? "+" : ""}
                    {alt.distanceDeltaKm.toLocaleString()} km)
                  </span>
                )}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">
                Transport CO₂e Delta
              </span>
              <span
                className={`font-mono ${
                  (alt.estimatedTransportCo2eDeltaT ?? 0) <= 0
                    ? "text-emerald-400"
                    : "text-amber-300"
                }`}
              >
                {alt.estimatedTransportCo2eDeltaT !== null
                  ? `${alt.estimatedTransportCo2eDeltaT > 0 ? "+" : ""}${alt.estimatedTransportCo2eDeltaT} tCO₂e/yr`
                  : "—"}
              </span>
            </div>
          </div>
        )}

        {/* Matched Catalogue Items */}
        {alt.matchedCatalogueItems.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Matched Product Catalogue
            </div>
            {alt.matchedCatalogueItems.slice(0, 2).map((item) => (
              <div
                key={item.itemId}
                className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2 text-[11px] space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-100">
                    {item.productTitle}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {item.baseUnit}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                  {item.leadTimeDays !== null && (
                    <span>Lead time: {item.leadTimeDays}d</span>
                  )}
                  {item.moq !== null && <span>MOQ: {item.moq}</span>}
                  {item.capacityBand && (
                    <span>Capacity: {item.capacityBand}</span>
                  )}
                  {item.productEmissionFactorTco2ePerUnit !== null && (
                    <span className="text-emerald-300">
                      PCF: {item.productEmissionFactorTco2ePerUnit} tCO₂e/
                      {item.baseUnit}
                      {item.pcfVerified ? " ✓" : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ESG & Quality Certifications */}
        {alt.certifications.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {alt.certifications.map((cert) => (
              <span
                key={cert}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
              >
                <Leaf className="h-2.5 w-2.5" />
                {cert}
              </span>
            ))}
          </div>
        )}

        {/* Actions: 1-Click Test in What-If Simulator + 1-Click Request Intro / Quote */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          {facilityId && onTestInWhatIf && (
            <div className="inline-flex items-center gap-1.5">
              <select
                aria-label={`Switch percentage for ${alt.name}`}
                value={switchPct}
                onChange={(e) =>
                  setSwitchPctByOrg((prev) => ({
                    ...prev,
                    [alt.orgId]: Number(e.target.value),
                  }))
                }
                className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
              >
                <option value={30}>30%</option>
                <option value={50}>50%</option>
                <option value={75}>75%</option>
                <option value={100}>100%</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  onTestInWhatIf({
                    facilityId,
                    alternativeName: alt.name,
                    switchPct,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1 text-[11px] font-medium text-indigo-200 cursor-pointer"
              >
                <SlidersHorizontal className="h-3 w-3" />
                Test in What-If Simulator
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOpenIntro(alt)}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 text-[11px] font-medium text-emerald-200 cursor-pointer"
          >
            <Mail className="h-3 w-3" />
            Request Intro / Quote
          </button>
        </div>

        {introNotice && (
          <div
            role="status"
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200 flex items-center gap-1.5"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{introNotice}</span>
          </div>
        )}

        {introOrgId === alt.orgId && (
          <form
            onSubmit={(e) => void handleSendIntro(e, alt.orgId)}
            className="rounded-lg border border-slate-700 bg-slate-950 p-3 space-y-2"
          >
            <div className="text-[11px] font-semibold text-slate-200">
              Send Opt-In Introduction Request to {alt.name}
            </div>
            <p className="text-[10px] text-slate-400">
              Only your organization name, requested material, and volume band
              are shared — never your private supply graph or existing
              suppliers.
            </p>
            {introError && (
              <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                {introError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400 space-y-1">
                <span>Material / Category</span>
                <input
                  type="text"
                  required
                  value={introMaterial}
                  onChange={(e) => setIntroMaterial(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                />
              </label>
              <label className="text-[10px] text-slate-400 space-y-1">
                <span>Volume Band</span>
                <input
                  type="text"
                  required
                  value={introVolumeBand}
                  onChange={(e) => setIntroVolumeBand(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                />
              </label>
            </div>
            <label className="block text-[10px] text-slate-400 space-y-1">
              <span>Optional Note</span>
              <input
                type="text"
                value={introNote}
                onChange={(e) => setIntroNote(e.target.value)}
                placeholder="e.g. Dual-sourcing qualification for Q3..."
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIntroOrgId(null)}
                className="rounded px-2.5 py-1 text-[11px] text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={introBusy}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1 text-[11px] font-medium text-white cursor-pointer"
              >
                {introBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowRight className="h-3 w-3" />
                )}
                Send Intro Request
              </button>
            </div>
          </form>
        )}
      </article>
    );
  };

  const matchCount = isFacilityMode
    ? (facilityAlts?.count ?? 0)
    : candidates.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
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
                {isFacilityMode
                  ? `Alternative Suppliers for ${facilityName ?? "Selected Supplier"}`
                  : "Alternative Suppliers Directory"}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isFacilityMode
                  ? `Ranked opt-in matches for ${facilityAlts?.materialCategories.join(", ") || "connected materials"}`
                  : "Verified EU/Nordic alternatives & opt-in Kulgo suppliers"}
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

        {/* General Directory Filters (only in browse mode) */}
        {!isFacilityMode && (
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
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 text-[11px] text-slate-400 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              Directory &amp; Product Catalogue listings expose only
              self-declared public capabilities &amp; ESG badges — never private
              buyer networks.
            </span>
            <span className="font-mono text-slate-300 shrink-0">
              {matchCount} match{matchCount === 1 ? "" : "es"}
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
          ) : isFacilityMode ? (
            (facilityAlts?.alternatives.length ?? 0) === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No opted-in alternative suppliers matched this supplier&apos;s
                material categories yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {facilityAlts!.alternatives.map(renderFacilityAlternativeCard)}
              </div>
            )
          ) : candidates.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No alternative suppliers match your current filter criteria.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {candidates.map((candidate) => {
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
                            {isKulgoOptIn
                              ? "Kulgo Opt-In"
                              : "EU/Nordic Verified"}
                          </span>
                        </div>
                      </div>
                      {renderRiskBadge(candidate.riskStatus)}
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
                      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/80">
                        {candidate.esgBadges.map((badge) => (
                          <span
                            key={badge}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                          >
                            <Leaf className="h-2.5 w-2.5" />
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
