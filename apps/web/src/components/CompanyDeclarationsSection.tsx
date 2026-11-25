import {
  type CompanyRegistrySearchResponse,
  type CreateRelationshipDeclarationInput,
  type RelationshipDeclaration,
  type RelationshipDeclarationRole,
  type RelationshipDeclarationStatus,
} from "@kulgo/shared";

import { Loader2, Plus, RefreshCw, Search } from "lucide-react";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { searchCompanyRegistry } from "../lib/api.js";

export type DeclarationsLoadStatus = "loading" | "error" | "ready";

export interface CompanyDeclarationsSectionProps {
  declarations: readonly RelationshipDeclaration[];
  loadStatus: DeclarationsLoadStatus;
  saveError: string | null;
  busy: boolean;
  onRetryLoad: () => void;
  onCreateDeclaration: (
    input: CreateRelationshipDeclarationInput,
  ) => Promise<boolean>;
}

interface DeclarationDraft {
  name: string;
  role: RelationshipDeclarationRole;
  countryCode: string;
  registryId: string;
  contactEmail: string;
}

const EMPTY_DRAFT: DeclarationDraft = {
  name: "",
  role: "SUPPLIER",
  countryCode: "",
  registryId: "",
  contactEmail: "",
};

const ROLE_LABELS: Record<RelationshipDeclarationRole, string> = {
  SUPPLIER: "Supplier",
  CLIENT: "Buyer",
};

// Plain wording instead of the raw status codes.
const STATUS_LABELS: Record<RelationshipDeclarationStatus, string> = {
  DECLARED: "Unconfirmed",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
};

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20";
const labelClass = "block text-[11px] font-medium text-slate-300 mb-1";
const hintClass = "mt-1 text-[10px] text-slate-500";

/**
 * Private supplier/buyer declarations (issue #29, UI slice). Company name is
 * the only required detail; declarations carry no facility, product, volume,
 * or price, so each entry is shown with "Product unknown" and plain status
 * wording. All state is transient React state scoped to the signed-in
 * workspace — nothing is written to persistent browser storage, URLs, or
 * telemetry.
 */
export function CompanyDeclarationsSection({
  declarations,
  loadStatus,
  saveError,
  busy,
  onRetryLoad,
  onCreateDeclaration,
}: CompanyDeclarationsSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<DeclarationDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [registrySearching, setRegistrySearching] = useState(false);
  const [registryResult, setRegistryResult] =
    useState<CompanyRegistrySearchResponse | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const updateDraft = (patch: Partial<DeclarationDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const lookupSeqRef = useRef(0);

  const handleRegistryLookup = async () => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) return;
    const seq = ++lookupSeqRef.current;
    setRegistrySearching(true);
    setRegistryError(null);
    setRegistryResult(null);
    try {
      const country = draft.countryCode.trim().toUpperCase();
      const regId = draft.registryId.trim();
      const result = await searchCompanyRegistry({
        name: trimmedName,
        ...(country.length === 2 ? { countryCode: country } : {}),
        ...(regId.length > 0 ? { registryId: regId } : {}),
      });
      if (seq === lookupSeqRef.current) {
        setRegistryResult(result);
      }
    } catch (err) {
      if (seq === lookupSeqRef.current) {
        setRegistryError(
          err instanceof Error ? err.message : "Registry lookup failed.",
        );
      }
    } finally {
      if (seq === lookupSeqRef.current) {
        setRegistrySearching(false);
      }
    }
  };

  // Move focus into the form when it opens. The Add company button only exists
  // once the form is closed, so focus is restored to it after the closing
  // render (cancel or successful save); calling focus() directly in the event
  // handler would hit a null ref while the button is still unmounted.
  const formWasOpenRef = useRef(false);
  useEffect(() => {
    if (showForm) {
      nameInputRef.current?.focus();
    } else if (formWasOpenRef.current) {
      addButtonRef.current?.focus();
    }
    formWasOpenRef.current = showForm;
  }, [showForm]);

  // Announce and focus form errors after a failed save; the draft stays put.
  useEffect(() => {
    if (saveError && showForm) {
      errorRef.current?.focus();
    }
  }, [saveError, showForm]);

  const handleOpenForm = () => {
    lookupSeqRef.current++;
    setStatusMessage(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    lookupSeqRef.current++;
    setShowForm(false);
    setStatusMessage(null);
    setRegistryResult(null);
    setRegistryError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || busy) return; // one active submission for the form
    const name = draft.name.trim();
    if (!name) return;
    lookupSeqRef.current++;
    const roleLabel = ROLE_LABELS[draft.role];
    const payload: CreateRelationshipDeclarationInput = {
      name,
      role: draft.role,
      countryCode: draft.countryCode.trim()
        ? draft.countryCode.trim().toUpperCase()
        : null,
      registryId: draft.registryId.trim() ? draft.registryId.trim() : null,
      contactEmail: draft.contactEmail.trim()
        ? draft.contactEmail.trim()
        : null,
    };
    setSaving(true);
    setStatusMessage("Saving company...");
    try {
      const ok = await onCreateDeclaration(payload);
      if (!ok) {
        // Failed save: keep the draft untouched; saveError is announced via
        // role="alert" and the top banner.
        setStatusMessage(null);
        return;
      }
      setDraft(EMPTY_DRAFT);
      setRegistryResult(null);
      setRegistryError(null);
      setShowForm(false);
      setStatusMessage(
        `Saved ${name} as ${roleLabel.toLowerCase()} in your private network.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="company-declarations-section"
      aria-labelledby="company-declarations-heading"
      className="rounded-2xl border border-slate-800/90 bg-slate-900/45 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-slate-900/80">
        <div className="min-w-0">
          <h2
            id="company-declarations-heading"
            className="text-xs font-bold uppercase tracking-wider text-slate-100"
          >
            Declared Companies
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Your private supplier and buyer declarations. A name is enough — no
            location, product, volume, or price required.
          </p>
        </div>
        {!showForm && (
          <button
            ref={addButtonRef}
            type="button"
            data-testid="add-company-btn"
            onClick={handleOpenForm}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-sky-500/35 bg-slate-950/60 hover:bg-slate-900 px-3 py-1.5 text-xs font-medium text-sky-300 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add company
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* AJAX submission results announced via role="status" / aria-live */}
        <div role="status" aria-live="polite" className="min-h-[1rem] text-[11px] text-emerald-300">
          {statusMessage}
        </div>

        {showForm && (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="rounded-xl border border-slate-700 bg-slate-950 p-3 space-y-3 text-xs"
            aria-label="Add a supplier or buyer company"
          >
            {saveError && (
              <div
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 focus:outline-none"
              >
                {saveError} Your entries are still here — try saving again.
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="decl-name" className="block text-[11px] font-medium text-slate-300">
                  Company name
                </label>
                <button
                  type="button"
                  disabled={registrySearching || draft.name.trim().length === 0}
                  onClick={() => void handleRegistryLookup()}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 px-2 py-0.5 text-[10px] text-sky-300 cursor-pointer"
                >
                  {registrySearching ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  Lookup EE Registry
                </button>
              </div>
              <input
                id="decl-name"
                ref={nameInputRef}
                type="text"
                required
                maxLength={160}
                value={draft.name}
                onChange={(e) => {
                  updateDraft({ name: e.target.value });
                  setRegistryResult(null);
                }}
                className={inputClass}
              />
              {registryError && (
                <p className="mt-1 text-[10px] text-amber-300">{registryError}</p>
              )}
              {registryResult && (
                <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>
                      {registryResult.outcome === "CONCLUSIVE_MATCH"
                        ? "Exact match found in Estonian e-Business Register:"
                        : registryResult.outcome === "CANDIDATES"
                          ? "Select a matching company (optional):"
                          : registryResult.outcome === "SNAPSHOT_UNAVAILABLE"
                            ? "Local registry snapshot unavailable — you can still save manually."
                            : registryResult.outcome === "UNSUPPORTED_COUNTRY"
                              ? "Registry lookup currently supports Estonia (EE) — you can still save manually."
                              : "No matching company found in registry snapshot."}
                    </span>
                    <span className="text-[9px] text-slate-500">
                      {registryResult.source.licence}
                    </span>
                  </div>
                  {registryResult.candidates.length > 0 && (
                    <ul className="space-y-1">
                      {registryResult.candidates.slice(0, 5).map((cand) => (
                        <li
                          key={`${cand.countryCode}-${cand.registryId}`}
                          className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1"
                        >
                          <div className="min-w-0 truncate">
                            <span className="font-medium text-slate-100">
                              {cand.legalName}
                            </span>{" "}
                            <span className="font-mono text-[10px] text-slate-400">
                              ({cand.countryCode} · {cand.registryId} · {cand.status})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              updateDraft({
                                name: cand.legalName,
                                countryCode: cand.countryCode,
                                registryId: cand.registryId,
                              });
                              setRegistryResult(null);
                            }}
                            className="shrink-0 rounded bg-sky-600/20 border border-sky-500/40 hover:bg-sky-600/30 px-2 py-0.5 text-[10px] text-sky-200 cursor-pointer"
                          >
                            Use
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <fieldset>
              <legend className={`${labelClass} mb-1`}>Relationship</legend>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="decl-role"
                    value="SUPPLIER"
                    checked={draft.role === "SUPPLIER"}
                    onChange={() => updateDraft({ role: "SUPPLIER" })}
                    className="accent-emerald-500"
                  />
                  Supplier
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="decl-role"
                    value="CLIENT"
                    checked={draft.role === "CLIENT"}
                    onChange={() => updateDraft({ role: "CLIENT" })}
                    className="accent-emerald-500"
                  />
                  Buyer
                </label>
              </div>
            </fieldset>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label htmlFor="decl-country" className={labelClass}>
                  Country (optional)
                </label>
                <input
                  id="decl-country"
                  type="text"
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  title="2-letter ISO country code, e.g. EE"
                  value={draft.countryCode}
                  onChange={(e) =>
                    updateDraft({ countryCode: e.target.value.toUpperCase() })
                  }
                  className={`${inputClass} uppercase`}
                />
                <p className={hintClass}>
                  Format: 2-letter country code (e.g., EE, FI, DE).
                </p>
              </div>
              <div>
                <label htmlFor="decl-registry" className={labelClass}>
                  Registry ID (optional)
                </label>
                <input
                  id="decl-registry"
                  type="text"
                  maxLength={64}
                  value={draft.registryId}
                  onChange={(e) => updateDraft({ registryId: e.target.value })}
                  className={inputClass}
                />
                <p className={hintClass}>
                  Format: up to 64 characters from the company registry.
                </p>
              </div>
              <div>
                <label htmlFor="decl-email" className={labelClass}>
                  Contact email (optional)
                </label>
                <input
                  id="decl-email"
                  type="email"
                  maxLength={254}
                  autoComplete="off"
                  value={draft.contactEmail}
                  onChange={(e) =>
                    updateDraft({ contactEmail: e.target.value })
                  }
                  className={inputClass}
                />
                <p className={hintClass}>
                  Format: name@example.com — used for confirmation outreach.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="save-company-btn"
                disabled={saving || busy}
                className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1 text-[11px] font-semibold text-slate-950 cursor-pointer disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save company"}
              </button>
            </div>
          </form>
        )}

        {loadStatus === "loading" && (
          <div
            data-testid="declarations-loading"
            className="flex items-center gap-2 py-2 text-xs text-slate-400"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            Loading your declared companies...
          </div>
        )}

        {loadStatus === "error" && (
          <div
            data-testid="declarations-error"
            className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            <span>Could not load your declared companies.</span>
            <button
              type="button"
              onClick={onRetryLoad}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/20 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              Try again
            </button>
          </div>
        )}

        {loadStatus === "ready" && declarations.length === 0 && (
          <div
            data-testid="declarations-empty"
            className="py-3 text-center text-xs text-slate-500"
          >
            No companies yet. Add your first supplier or buyer by name.
          </div>
        )}

        {/* Rows render in every list state: a saved company must stay visible
            while a later list read is loading or has failed (the retryable
            error below still offers recovery). */}
        {declarations.length > 0 && (
          <ul data-testid="declarations-list" className="space-y-2">
            {declarations.map((d) => (
              <li
                key={d.declarationId}
                data-testid={`declaration-item-${d.declarationId}`}
                className="rounded-xl border border-slate-800 bg-slate-950/75 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white truncate">
                    {d.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                    {ROLE_LABELS[d.role]}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span data-testid={`declaration-status-${d.declarationId}`}>
                    {STATUS_LABELS[d.status]}
                  </span>
                  <span className="text-slate-500">Product unknown</span>
                  {d.countryCode && <span>{d.countryCode}</span>}
                  {d.registryId && <span>Reg. {d.registryId}</span>}
                  {d.contactEmail && <span>{d.contactEmail}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
