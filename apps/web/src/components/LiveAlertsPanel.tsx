import type {
  AlertAckReason,
  Facility,
  OrgAlertAck,   RiskSignal,
  SupplyLane,
  UserRole,
} from "@kulgo/shared";
import { useState } from "react";
import {
  BellOff,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Radio,
  RefreshCw,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import type { LiveAlertFeedResponse } from "../lib/api.js";

export interface LiveAlertsPanelProps {
  feed: LiveAlertFeedResponse | null;
  loading: boolean;
  sweeping: boolean;
  userRole?: UserRole;
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  onAcknowledge: (
    signalId: string,
    status: "ACKNOWLEDGED" | "MUTED",
    reason?: AlertAckReason | null,
  ) => Promise<void>;
  onTriggerSweep: () => Promise<void>;
  onOpenSettings: () => void;
  onSelectFacility: (facilityId: string) => void;
  onSelectLane: (laneId: string) => void;
}

function verificationBadgeStyle(status: RiskSignal["verificationStatus"]): string {
  if (status === "CONFIRMED") {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/35";
  }
  if (status === "CORROBORATED") {
    return "bg-sky-500/15 text-sky-300 border-sky-500/35";
  }
  return "bg-slate-700/50 text-slate-300 border-slate-600/60";
}

const ACK_REASON_LABELS: Record<AlertAckReason, string> = {
  HANDLED: "Handled",
  WRONG_ENTITY_OR_SITE: "Wrong entity / site",
  FALSE_OR_OUTDATED_EVENT: "False or outdated event",
  NOT_RELEVANT_TO_LANE: "Not relevant to lane",
};

export function LiveAlertsPanel({
  feed,
  loading,
  sweeping,
  userRole,
  facilities,
  lanes,
  onAcknowledge,
  onTriggerSweep,
  onOpenSettings,
  onSelectFacility,
  onSelectLane,
}: LiveAlertsPanelProps) {
  const [reasonBySignal, setReasonBySignal] = useState<
    Record<string, AlertAckReason | "">
  >({});
  const signals = feed?.signals ?? [];
  const ackBySignalId = new Map<string, OrgAlertAck>(
    (feed?.acknowledgements ?? []).map((a) => [a.signalId, a]),
  );
  const facById = new Map(facilities.map((f) => [f.facilityId, f]));
  const laneById = new Map(lanes.map((l) => [l.laneId, l]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-red-400" />
            Live Disruption Feed
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            3x daily UTC sweeps · Pull Once, Match Many
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenSettings}
            title="Configure email & webhook alert preferences"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            <Settings2 className="h-3 w-3" />
            Channels
          </button>
          {userRole === "OWNER" && (
            <button
              type="button"
              disabled={sweeping}
              onClick={() => void onTriggerSweep()}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 transition"
            >
              {sweeping ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Sweep
            </button>
          )}
        </div>
      </div>

      {loading && !feed ? (
        <div className="flex items-center justify-center py-8 text-xs text-slate-400 gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
          Loading live risk signals…
        </div>
      ) : signals.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-400">
          No active disruption signals detected.
        </div>
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => {
            const ack = ackBySignalId.get(signal.signalId);
            const facHits = (feed?.facilityMatches ?? []).filter(
              (m) => m.signalId === signal.signalId,
            );
            const laneHits = (feed?.laneMatches ?? []).filter(
              (m) => m.signalId === signal.signalId,
            );
            const partnerHits = (feed?.partnerRegionAlerts ?? []).filter(
              (a) => a.signalId === signal.signalId,
            );
            const isMuted = ack?.status === "MUTED";
            const isAcked = ack?.status === "ACKNOWLEDGED";

            return (
              <div
                key={signal.signalId}
                data-testid={`alert-card-${signal.signalId}`}
                className={`rounded-xl border p-3 space-y-2 transition ${
                  isMuted
                    ? "border-slate-800/70 bg-slate-900/30 opacity-65"
                    : signal.severity === "RED"
                      ? "border-red-500/35 bg-red-950/20"
                      : "border-amber-500/35 bg-amber-950/15"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          signal.severity === "RED"
                            ? "bg-red-500/20 text-red-300 border border-red-500/40"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        }`}
                      >
                        {signal.severity} · {signal.kind.replace(/_/g, " ")}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${verificationBadgeStyle(signal.verificationStatus)}`}
                      >
                        {signal.verificationStatus}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-white leading-snug">
                      {signal.title}
                    </h4>
                  </div>
                </div>

                {signal.description && (
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {signal.description}
                  </p>
                )}

                {/* Affected Network Matches */}
                {(facHits.length > 0 ||
                  laneHits.length > 0 ||
                  partnerHits.length > 0) && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                    {facHits.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-400">
                          Facilities:
                        </span>
                        {facHits.map((m) => (
                          <button
                            key={`${m.facilityId}-${m.matchType}`}
                            type="button"
                            onClick={() => onSelectFacility(m.facilityId)}
                            className="rounded bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 text-[10px] text-cyan-200 transition"
                          >
                            {facById.get(m.facilityId)?.name ?? m.facilityId.slice(0, 8)}
                          </button>
                        ))}
                      </div>
                    )}
                    {laneHits.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-400">
                          Lanes:
                        </span>
                        {laneHits.map((m) => {
                          const lane = laneById.get(m.laneId);
                          return (
                            <button
                              key={m.laneId}
                              type="button"
                              onClick={() => onSelectLane(m.laneId)}
                              className="rounded bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 text-[10px] text-amber-200 transition"
                            >
                              {lane?.materialCategory ?? "Lane"} (
                              {m.matchedChokepoints.join(", ")})
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {partnerHits.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[10px] text-rose-300">
                        <ShieldAlert className="h-3 w-3 shrink-0" />
                        <span>
                          Anonymized Tier-2+ partner exposure:{" "}
                          {partnerHits
                            .map((p) => p.countryCode ?? p.regionCode ?? "Regional")
                            .join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Chokepoint & Source links */}
                {signal.sourceUrls.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {signal.sourceUrls.slice(0, 3).map((url, idx) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:text-cyan-200 underline"
                      >
                        Source {idx + 1}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ))}
                  </div>
                )}

                {/* Acknowledge / Mute Controls */}
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/70">
                  <span className="text-[10px] text-slate-400">
                    {isAcked
                      ? "✓ Acknowledged"
                      : isMuted
                        ? "Muted for org"
                        : "Unacknowledged"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label="Reason"
                      value={
                        reasonBySignal[signal.signalId] ??
                        ackBySignalId.get(signal.signalId)?.reason ??
                        ""
                      }
                      onChange={(e) =>
                        setReasonBySignal((prev) => ({
                          ...prev,
                          [signal.signalId]: e.target.value as
                            | AlertAckReason
                            | "",
                        }))
                      }
                      className="rounded-md border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10px] text-slate-300"
                    >
                      <option value="">Reason (optional)</option>
                      {(Object.keys(ACK_REASON_LABELS) as AlertAckReason[]).map(
                        (r) => (
                          <option key={r} value={r}>
                            {ACK_REASON_LABELS[r]}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        void onAcknowledge(
                          signal.signalId,
                          "ACKNOWLEDGED",
                          (reasonBySignal[signal.signalId] ?? ackBySignalId.get(signal.signalId)?.reason) || null,
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                        isAcked
                          ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-200"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void onAcknowledge(
                          signal.signalId,
                          "MUTED",
                          (reasonBySignal[signal.signalId] ?? ackBySignalId.get(signal.signalId)?.reason) || null,
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                        isMuted
                          ? "border-amber-500/50 bg-amber-500/20 text-amber-200"
                          : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <BellOff className="h-3 w-3" />
                      Mute
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
