import type {
  Contract,
  ContractLine,
  DerivedLaneCommercialSummary,
  SupplyLane,
} from "@kulgo/shared";
import { Archive, CalendarPlus, FileText, Plus } from "lucide-react";
import { useState } from "react";
import {
  createContract,
  updateContract,
} from "../lib/api.js";

export interface LaneContractsDrawerSectionProps {
  lane: SupplyLane;
  contracts: readonly Contract[];
  contractLines: readonly ContractLine[];
  derivedSummary?: DerivedLaneCommercialSummary;
  onChanged: () => Promise<void> | void;
}

function addOneYearIso(isoDate: string | null): string {
  const base = isoDate ? new Date(`${isoDate}T00:00:00Z`) : new Date();
  base.setUTCFullYear(base.getUTCFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

export function LaneContractsDrawerSection({
  lane,
  contracts,
  contractLines,
  derivedSummary,
  onChanged,
}: LaneContractsDrawerSectionProps) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("Spot Top-Up");
  const [contractType, setContractType] = useState<"FRAMEWORK" | "SPOT_PO">(
    "SPOT_PO",
  );
  const [cadence, setCadence] = useState<"PER_YEAR" | "TOTAL_OVER_TERM">(
    "TOTAL_OVER_TERM",
  );
  const [volume, setVolume] = useState("");
  const [spend, setSpend] = useState("");
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState(() => addOneYearIso(null));

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
    setSaving(true);
    setError(null);
    try {
      const parsedVol = volume.trim() ? Number(volume) : null;
      const parsedSpend = spend.trim() ? Number(spend) : null;

      // If this is the very first formal contract on a lane that already had quick flat-form values,
      // preserve the base entry as Contract #1 (FRAMEWORK) before adding the new top-up.
      if (
        laneContracts.length === 0 &&
        contractType === "SPOT_PO" &&
        ((lane.annualVolume !== null && lane.annualVolume > 0) ||
          (lane.annualSpendEur !== null && lane.annualSpendEur > 0))
      ) {
        await createContract({
          supplierFacilityId: lane.fromFacilityId,
          title: "Base Agreement",
          contractType: "FRAMEWORK",
          pricingModel: "FIXED",
          expiryBehavior: "HOLDOVER",
          confidence: "ESTIMATED",
          startDate: `${new Date().getUTCFullYear()}-01-01`,
          endDate: null,
          noticePeriodDays: 30,
          nonRenewalNoticeGiven: false,
          lines: [
            {
              laneId: lane.laneId,
              inputId: lane.inputId,
              cadence: "PER_YEAR",
              committedVolume: lane.annualVolume,
              unit: lane.volumeUnit,
              committedSpend: lane.annualSpendEur,
              currency: "EUR",
            },
          ],
        });
      }

      await createContract({
        supplierFacilityId: lane.fromFacilityId,
        title: title.trim() || (contractType === "SPOT_PO" ? "Spot Top-Up" : "Framework Agreement"),
        contractType,
        pricingModel: "FIXED",
        expiryBehavior: contractType === "SPOT_PO" ? "AUTO_ARCHIVE" : "HOLDOVER",
        confidence: "CONTRACTED",
        startDate,
        endDate: endDate.trim() ? endDate.trim() : null,
        noticePeriodDays: contractType === "FRAMEWORK" ? 30 : 0,
        nonRenewalNoticeGiven: false,
        lines: [
          {
            laneId: lane.laneId,
            inputId: lane.inputId,
            cadence,
            committedVolume:
              parsedVol !== null && Number.isFinite(parsedVol) ? parsedVol : null,
            unit: lane.volumeUnit,
            committedSpend:
              parsedSpend !== null && Number.isFinite(parsedSpend)
                ? parsedSpend
                : null,
            currency: "EUR",
          },
        ],
      });

      setVolume("");
      setSpend("");
      setAdding(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contract");
    } finally {
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

      {error && (
        <div className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
          {error}
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
                    disabled={saving}
                    onClick={() => void handleExtendOneYear(contract)}
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200 cursor-pointer"
                  >
                    <CalendarPlus className="h-3 w-3" />
                    Extend 1 yr
                  </button>
                  <button
                    type="button"
                    disabled={saving}
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
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contract title"
              className="col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <select
              value={contractType}
              onChange={(e) => {
                const v = e.target.value as "FRAMEWORK" | "SPOT_PO";
                setContractType(v);
                setCadence(v === "SPOT_PO" ? "TOTAL_OVER_TERM" : "PER_YEAR");
              }}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            >
              <option value="SPOT_PO">Spot Top-Up (AUTO_ARCHIVE)</option>
              <option value="FRAMEWORK">Framework (HOLDOVER)</option>
            </select>
            <select
              value={cadence}
              onChange={(e) =>
                setCadence(e.target.value as "PER_YEAR" | "TOTAL_OVER_TERM")
              }
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            >
              <option value="TOTAL_OVER_TERM">Total Over Term</option>
              <option value="PER_YEAR">Per Year</option>
            </select>
            <input
              type="number"
              step="any"
              min="0"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              placeholder={`Volume (${lane.volumeUnit})`}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <input
              type="number"
              step="any"
              min="0"
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
              placeholder="Spend (€ EUR)"
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-sky-500 hover:bg-sky-400 px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer"
            >
              {saving ? "Saving..." : "Save Contract"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
