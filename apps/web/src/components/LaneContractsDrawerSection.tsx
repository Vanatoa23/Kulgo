import { usePendingContractSave } from "../lib/pending-contract-saves.js";
import type {
  Contract,
  ContractLine,
  DerivedLaneCommercialSummary,
  SupplyLane,
} from "@kulgo/shared";
import { Archive, CalendarPlus, FileText, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  createContract,
  updateContract,
} from "../lib/api.js";

export interface LaneContractsDrawerSectionProps {
  lane: SupplyLane;
  contracts: readonly Contract[];
  contractLines: readonly ContractLine[];
  derivedSummary?: DerivedLaneCommercialSummary;
  onChanged: () => Promise<boolean>;
}

function addOneYearIso(isoDate: string | null): string {
  const base = isoDate ? new Date(`${isoDate}T00:00:00Z`) : new Date();
  base.setUTCFullYear(base.getUTCFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function LaneContractsDrawerSection({
  lane,
  contracts,
  contractLines,
  derivedSummary,
  onChanged,
}: LaneContractsDrawerSectionProps) {
  const { pending, setPending } = usePendingContractSave(lane.laneId);
  const restored = pending?.confirmed ? undefined : pending?.request;
  const restoredLine = restored?.lines?.[0];
  const [adding, setAdding] = useState(restored !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(restored?.title ?? "Spot Top-Up");
  const [contractType, setContractType] = useState<
    "FRAMEWORK" | "SPOT_PO" | "ESTIMATE"
  >(restored?.contractType ?? "SPOT_PO");
  const [pricingModel, setPricingModel] = useState<"FIXED" | "INDEXED">(restored?.pricingModel ?? "FIXED");
  const [expiryBehavior, setExpiryBehavior] = useState<
    "HOLDOVER" | "AUTO_RENEW" | "AUTO_ARCHIVE"
  >(restored?.expiryBehavior ?? "AUTO_ARCHIVE");
  const [noticePeriodDays, setNoticePeriodDays] = useState(String(restored?.noticePeriodDays ?? 30));
  const [cadence, setCadence] = useState<"PER_YEAR" | "TOTAL_OVER_TERM">(
    restoredLine?.cadence ?? "TOTAL_OVER_TERM",
  );
  const [volume, setVolume] = useState(String(restoredLine?.committedVolume ?? ""));
  const [spend, setSpend] = useState(String(restoredLine?.committedSpend ?? ""));
  const [startDate, setStartDate] = useState(() =>
    restored?.startDate ?? new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState(() => restored ? (restored.endDate ?? "") : addOneYearIso(null));
  const inFlight = useRef(false);
  const awaitingConfirmation = pending !== undefined && !pending.confirmed;
  const busy = saving || pending?.saving === true;

  useEffect(() => {
    if (!pending?.confirmed) return;
    // A response may arrive after the submitting route view unmounts. Consume
    // confirmation in whichever view is mounted, never unlock its stale draft.
    setAdding(false);
    setVolume("");
    setSpend("");
    setError(null);
    setPending(null);
  }, [pending?.confirmed, setPending]);

  const laneLines = contractLines.filter((l) => l.laneId === lane.laneId);
  const contractById = new Map(contracts.map((c) => [c.contractId, c]));
  const laneContracts = laneLines
    .map((line) => ({ line, contract: contractById.get(line.contractId) }))
    .filter(
      (item): item is { line: ContractLine; contract: Contract } =>
        item.contract !== undefined,
    );

  const hasMultiContractView = laneContracts.length > 0 || adding;

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current || pending?.saving || pending?.conflict) return;
    setError(null);

    const trimmedStart = startDate.trim();
    const trimmedEnd = endDate.trim();
    if (!isValidIsoDate(trimmedStart)) {
      setError("Please enter a valid start date (YYYY-MM-DD).");
      return;
    }
    if (trimmedEnd && !isValidIsoDate(trimmedEnd)) {
      setError("Please enter a valid end date (YYYY-MM-DD) or leave it blank.");
      return;
    }
    if (trimmedEnd && trimmedEnd < trimmedStart) {
      setError("End date must be on or after the start date.");
      return;
    }

    const parsedVol = volume.trim() ? Number(volume) : null;
    if (parsedVol !== null && (!Number.isFinite(parsedVol) || parsedVol < 0)) {
      setError("Volume must be a non-negative number.");
      return;
    }
    const parsedSpend = spend.trim() ? Number(spend) : null;
    if (
      parsedSpend !== null &&
      (!Number.isFinite(parsedSpend) || parsedSpend < 0)
    ) {
      setError("Spend must be a non-negative number.");
      return;
    }
    const parsedNotice =
      contractType === "FRAMEWORK" && noticePeriodDays.trim()
        ? Math.max(0, Math.round(Number(noticePeriodDays) || 0))
        : 0;

    let submittedRequest = pending?.request;
    inFlight.current = true;
    setSaving(true);
    try {
      const shouldPreserveLegacyBase =
        laneContracts.length === 0 &&
        contractType === "SPOT_PO" &&
        ((lane.annualVolume !== null && lane.annualVolume > 0) ||
          (lane.annualSpendEur !== null && lane.annualSpendEur > 0));

      const defaultTitle =
        contractType === "SPOT_PO"
          ? "Spot Top-Up"
          : contractType === "ESTIMATE"
            ? "Quick Commercial Estimate"
            : "Framework Agreement";

      // Single atomic/idempotent server request so partial failures or lost-response
      // retries can never create orphaned or duplicate contracts (#47).
      // Keep the exact submitted snapshot until a response confirms its outcome.
      const request = pending?.request ?? {
        supplierFacilityId: lane.fromFacilityId,
        title: title.trim() || defaultTitle,
        contractType,
        pricingModel: contractType === "FRAMEWORK" ? pricingModel : "FIXED",
        expiryBehavior,
        confidence: contractType === "ESTIMATE" ? "ESTIMATED" : "CONTRACTED",
        startDate: trimmedStart,
        endDate: trimmedEnd ? trimmedEnd : null,
        noticePeriodDays: parsedNotice,
        nonRenewalNoticeGiven: false,
        idempotencyKey: typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...(shouldPreserveLegacyBase
          ? { preserveLegacyBaseForLaneId: lane.laneId }
          : {}),
        lines: [
          {
            laneId: lane.laneId,
            inputId: lane.inputId,
            cadence,
            committedVolume: parsedVol,
            unit: lane.volumeUnit,
            committedSpend: parsedSpend,
            currency: "EUR",
          },
        ],
      };
      submittedRequest = request;
      setPending({ request, saving: true });
      await createContract(request);
      setPending({ request, saving: false, confirmed: true });
      submittedRequest = undefined;

      // Clear the draft only after confirmed server success.
      setVolume("");
      setSpend("");
      setAdding(false);
      await onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save contract";
      const definitiveRejection = err instanceof ApiError && err.status < 500 && err.status !== 409;
      if (definitiveRejection) setPending(null);
      // This account-scoped state survives even if the route view unmounts.
      else if (submittedRequest) setPending({
        request: submittedRequest, saving: false,
        conflict: err instanceof ApiError && err.status === 409, error: message,
      });
      setError(message);
      // Reconcile contracts state with server so retries never act on stale client state (#47)
      try {
        await onChanged();
      } catch {
        // Keep the original save error visible
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const handleExtendOneYear = async (contract: Contract) => {
    setSaving(true);
    setError(null);
    try {
      await updateContract(contract.contractId, {
        endDate: addOneYearIso(contract.endDate),
        isManuallyArchived: false,
        archiveEffectiveDate: null,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extend contract");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (contract: Contract) => {
    setSaving(true);
    setError(null);
    try {
      await updateContract(contract.contractId, {
        isManuallyArchived: true,
        archiveEffectiveDate: new Date().toISOString().slice(0, 10),
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive contract");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-sky-400" />
          Contracts &amp; Commercials
        </span>
        {!adding && (
          <button
            type="button"
            data-testid="add-contract-topup-btn"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-200 cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            Add Contract / Spot Top-Up
          </button>
        )}
      </div>

      {/* Live Aggregated Summary Banner (Level 1B progressive upgrade) */}
      {hasMultiContractView && derivedSummary && (
        <div
          data-testid="live-aggregated-summary-banner"
          className={`rounded-lg border p-2 text-[11px] space-y-1 ${
            derivedSummary.laneCommercialState === "HOLDOVER"
              ? "border-amber-500/50 border-dashed bg-amber-500/10"
              : derivedSummary.laneCommercialState === "LAPSED_UNCONTRACTED"
                ? "border-red-500/40 bg-red-500/10"
                : "border-emerald-500/35 bg-emerald-500/10"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">
              Live Aggregated Summary ({derivedSummary.viewMode === "RUN_RATE" ? "Run-Rate" : "12M Window"})
            </span>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-900/80 text-slate-200">
              {derivedSummary.laneCommercialState}
            </span>
          </div>
          <div className="font-mono text-xs text-white font-semibold flex flex-wrap items-center gap-x-2">
            <span>
              {derivedSummary.activeVolume !== null
                ? `${derivedSummary.activeVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${derivedSummary.baseUnit ?? lane.volumeUnit}`
                : "Vol —"}
            </span>
            <span className="text-slate-500">|</span>
            <span>
              {derivedSummary.activeSpendEur !== null
                ? `€${derivedSummary.activeSpendEur.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                : "€—"}
            </span>
            <span className="text-slate-500">|</span>
            <span>
              {derivedSummary.weightedAvgUnitPrice !== null
                ? `€${derivedSummary.weightedAvgUnitPrice.toFixed(3)}/u`
                : "Unit €—"}
            </span>
            {derivedSummary.knownMappedSharePct !== null && (
              <>
                <span className="text-slate-500">|</span>
                <span className="text-emerald-300">
                  {derivedSummary.knownMappedSharePct}% share
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {(error || pending?.error) && (
        <div role="alert" className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
          {error || pending?.error}
        </div>
      )}

      {/* Stacked Contract Cards */}
      {laneContracts.length > 0 && (
        <div className="space-y-1.5">
          {laneContracts.map(({ contract, line }) => (
            <div
              key={line.contractLineId}
              className={`rounded-md border p-2 text-[11px] space-y-1 ${
                contract.isManuallyArchived
                  ? "border-slate-800 bg-slate-900/40 opacity-60"
                  : "border-slate-700 bg-slate-900/80"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100 truncate">
                  {contract.title}
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                  {contract.contractType} · {contract.confidence}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono flex flex-wrap gap-x-2">
                <span>
                  {line.committedVolume ?? "—"} {line.unit} ({line.cadence === "PER_YEAR" ? "/yr" : "total"})
                </span>
                <span>€{line.committedSpend ?? "—"}</span>
                <span>
                  {contract.startDate} → {contract.endDate ?? "Evergreen"}
                </span>
              </div>
              {!contract.isManuallyArchived && (
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleExtendOneYear(contract)}
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200 cursor-pointer"
                  >
                    <CalendarPlus className="h-3 w-3" />
                    Extend 1 yr
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleArchive(contract)}
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 cursor-pointer"
                  >
                    <Archive className="h-3 w-3" />
                    Archive
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Inline Add Contract / Spot Top-Up Form */}
      {adding && (
        <form
          onSubmit={(e) => void handleCreateContract(e)}
          className="rounded-md border border-sky-500/35 bg-slate-900/90 p-2.5 space-y-2 text-xs"
        >
          {awaitingConfirmation && (
            <p role="status" className="text-amber-200">
              {pending?.conflict
                ? "This request conflicts with an existing save. Review saved contracts before starting another draft."
                : "The previous save is unconfirmed. Retry that save to check its outcome before editing."}
            </p>
          )}
          <fieldset disabled={busy || awaitingConfirmation} className="grid grid-cols-2 gap-2">
            <legend className="sr-only">Contract details</legend>
            <input
              type="text"
              aria-label="Contract title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contract title"
              className="col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <select
              aria-label="Contract type"
              value={contractType}
              onChange={(e) => {
                const v = e.target.value as "FRAMEWORK" | "SPOT_PO" | "ESTIMATE";
                setContractType(v);
                if (v === "SPOT_PO") {
                  setCadence("TOTAL_OVER_TERM");
                  setExpiryBehavior("AUTO_ARCHIVE");
                } else if (v === "ESTIMATE") {
                  setCadence("PER_YEAR");
                  setExpiryBehavior("HOLDOVER");
                } else {
                  setCadence("PER_YEAR");
                  setExpiryBehavior("HOLDOVER");
                }
              }}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            >
              <option value="SPOT_PO">Spot Top-Up (AUTO_ARCHIVE)</option>
              <option value="FRAMEWORK">Framework Agreement</option>
              <option value="ESTIMATE">Quick Estimate (Level 1)</option>
            </select>
            <select
              aria-label="Contract cadence"
              value={cadence}
              onChange={(e) =>
                setCadence(e.target.value as "PER_YEAR" | "TOTAL_OVER_TERM")
              }
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            >
              <option value="TOTAL_OVER_TERM">Total Over Term</option>
              <option value="PER_YEAR">Per Year</option>
            </select>
            {contractType === "FRAMEWORK" && (
              <>
                <select
                  aria-label="Pricing model"
                  value={pricingModel}
                  onChange={(e) =>
                    setPricingModel(e.target.value as "FIXED" | "INDEXED")
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                >
                  <option value="FIXED">Fixed Price</option>
                  <option value="INDEXED">Indexed Price</option>
                </select>
                <select
                  aria-label="Expiry behavior"
                  value={expiryBehavior}
                  onChange={(e) =>
                    setExpiryBehavior(
                      e.target.value as "HOLDOVER" | "AUTO_RENEW" | "AUTO_ARCHIVE",
                    )
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                >
                  <option value="HOLDOVER">Holdover</option>
                  <option value="AUTO_RENEW">Auto-Renew</option>
                  <option value="AUTO_ARCHIVE">Auto-Archive</option>
                </select>
                <input
                  type="number"
                  min="0"
                  aria-label="Notice period days"
                  value={noticePeriodDays}
                  onChange={(e) => setNoticePeriodDays(e.target.value)}
                  placeholder="Notice period (days)"
                  className="col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </>
            )}
            <input
              type="number"
              step="any"
              min="0"
              aria-label="Committed volume"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              placeholder={`Volume (${lane.volumeUnit})`}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <input
              type="number"
              step="any"
              min="0"
              aria-label="Committed spend"
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
              placeholder="Spend (€ EUR)"
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <input
              type="date"
              required
              aria-label="Contract start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <input
              type="date"
              aria-label="Contract end date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </fieldset>
          <div className="flex justify-end gap-1.5">
            {pending?.conflict && (
              <button type="button" disabled={busy} onClick={async () => {
                setSaving(true);
                try {
                  const refreshed = await onChanged();
                  if (!refreshed) {
                    setError("Could not refresh saved contracts. Try again.");
                    return;
                  }
                  setPending(null);
                  setAdding(false);
                  setVolume("");
                  setSpend("");
                  setError(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to refresh saved contracts");
                } finally { setSaving(false); }
              }} className="rounded border border-amber-500 px-2 py-1 text-amber-200">
                Review Saved Contracts
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || pending?.conflict}
              className="rounded bg-sky-500 hover:bg-sky-400 px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer"
            >
              {busy ? "Saving..." : awaitingConfirmation ? "Retry Previous Save" : "Save Contract"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
