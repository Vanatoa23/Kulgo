import { allocationPreviewPool, allocationPreviewVolume } from "../lib/allocation-preview.js";
import {
  resolveFacilityRole,
  resolveLaneDirection,
  type AnalyticsSummary,
  type Contract,
  type ContractLine,
  type CreateInviteInput,
  type CreateInviteResponse,
  type CreateSupplyLaneInput,
  type Facility,
  type FacilityKind,
  type FacilityRelationshipRole,
  type Invitation,
  type RiskStatus,
  type SupplyInput,
  type SupplyLane,
  type TransportMode,
  type UpdateFacilityInput,
  type UpdateSupplyLaneInput,
  type UserRole,
  type VolumeUnit,
} from "@kulgo/shared";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  Mail,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LaneContractsDrawerSection } from "./LaneContractsDrawerSection.js";

export interface NodeInspectorDrawerProps {
  facility: Facility;
  allFacilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  inputs: readonly SupplyInput[];
  contracts: readonly Contract[];
  contractLines: readonly ContractLine[];
  invitations: readonly Invitation[];
  analytics: AnalyticsSummary | null;
  userRole: UserRole;
  busy: boolean;
  initialLaneId?: string | null;
  onClose: () => void;
  onViewOnMap: (facilityId: string) => void;
  onOpenDirectory: (capability?: string) => void;
  onUpdateFacility: (
    facilityId: string,
    input: UpdateFacilityInput,
  ) => Promise<boolean>;
  onDeleteFacility: (facilityId: string) => Promise<boolean>;
  onCreateLane: (input: CreateSupplyLaneInput) => Promise<boolean>;
  onUpdateLane: (
    laneId: string,
    input: UpdateSupplyLaneInput,
  ) => Promise<boolean>;
  onApplyAllocationSplits: (
    splits: ReadonlyArray<{ laneId: string; allocationSplitPct: number }>,
  ) => Promise<boolean>;
  onDeleteLane: (laneId: string) => Promise<boolean>;
  onCreateInvite: (
    input: CreateInviteInput,
  ) => Promise<CreateInviteResponse | null>;
  onContractsChanged: () => Promise<boolean>;
}

const TRANSPORT_MODES: readonly TransportMode[] = [
  "ROAD",
  "SEA",
  "RAIL",
  "AIR",
  "MULTIMODAL",
];

const FACILITY_KINDS: readonly FacilityKind[] = [
  "FACTORY",
  "WAREHOUSE",
  "HQ",
  "PORT",
  "HUB",
  "EXTRACTION",
  "CUSTOMER",
];

const VOLUME_UNITS: readonly VolumeUnit[] = [
  "TONNES",
  "UNITS",
  "KG",
  "LITERS",
  "EUR_VALUE",
];

const SPLIT_BAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-amber-500",
  "bg-teal-500",
];

export function NodeInspectorDrawer({
  facility,
  allFacilities,
  lanes,
  inputs,
  contracts,
  contractLines,
  invitations,
  analytics,
  userRole,
  busy,
  initialLaneId,
  onClose,
  onViewOnMap,
  onOpenDirectory,
  onUpdateFacility,
  onDeleteFacility,
  onCreateLane,
  onUpdateLane,
  onApplyAllocationSplits,
  onDeleteLane,
  onCreateInvite,
  onContractsChanged,
}: NodeInspectorDrawerProps) {
  const role = resolveFacilityRole(facility);
  const facilitiesById = useMemo(
    () => new Map(allFacilities.map((f) => [f.facilityId, f])),
    [allFacilities],
  );
  const inputsById = useMemo(
    () => new Map(inputs.map((i) => [i.inputId, i])),
    [inputs],
  );

  // Node edit state
  const [editingNode, setEditingNode] = useState(false);
  const [nodeName, setNodeName] = useState(facility.name);
  const [nodeCountry, setNodeCountry] = useState(facility.countryCode);
  const [nodeKind, setNodeKind] = useState<FacilityKind>(facility.kind);
  const [nodeRole, setNodeRole] = useState<FacilityRelationshipRole>(role);
  const [nodeSector, setNodeSector] = useState(facility.sector ?? "");
  const [nodeError, setNodeError] = useState<string | null>(null);

  // Connected lanes
  const outgoingLanes = useMemo(
    () => lanes.filter((l) => l.fromFacilityId === facility.facilityId),
    [lanes, facility.facilityId],
  );
  const incomingLanes = useMemo(
    () => lanes.filter((l) => l.toFacilityId === facility.facilityId),
    [lanes, facility.facilityId],
  );
  const connectedLanes = useMemo(
    () => [...outgoingLanes, ...incomingLanes],
    [outgoingLanes, incomingLanes],
  );

  // Active expanded lane in inspector
  const [expandedLaneId, setExpandedLaneId] = useState<string | null>(
    initialLaneId ?? outgoingLanes[0]?.laneId ?? incomingLanes[0]?.laneId ?? null,
  );
  const [showAdvancedLane, setShowAdvancedLane] = useState(false);

  // Lane edit state
  const expandedLane = useMemo(
    () => connectedLanes.find((l) => l.laneId === expandedLaneId) ?? null,
    [connectedLanes, expandedLaneId],
  );
  const [laneTransport, setLaneTransport] = useState<TransportMode>("ROAD");
  const [laneLeadTime, setLaneLeadTime] = useState("");
  const [laneDistance, setLaneDistance] = useState("");
  const [laneRisk, setLaneRisk] = useState<RiskStatus>("GREEN");
  const [laneRiskReason, setLaneRiskReason] = useState("");
  const [laneSafetyStock, setLaneSafetyStock] = useState("");
  const [laneDefectRate, setLaneDefectRate] = useState("");
  const [laneSaveNotice, setLaneSaveNotice] = useState<string | null>(null);

  // Allocation Split state for sibling outgoing lanes (e.g. 70/30 multi-warehouse or 60/40 client split)
  const splitGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; lanes: SupplyLane[] }
    >();
    for (const lane of outgoingLanes) {
      const dir = resolveLaneDirection(
        lane,
        facility,
        facilitiesById.get(lane.toFacilityId),
      );
      const groupKey = `${dir}:${lane.inputId ?? lane.materialCategory.toLowerCase()}`;
      const label = lane.inputId
        ? inputsById.get(lane.inputId)?.name ?? lane.materialCategory
        : lane.materialCategory;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.lanes.push(lane);
      } else {
        groups.set(groupKey, { key: groupKey, label, lanes: [lane] });
      }
    }
    return Array.from(groups.values()).filter((g) => g.lanes.length >= 2);
  }, [outgoingLanes, facility, facilitiesById, inputsById]);

  const [splitDrafts, setSplitDrafts] = useState<Record<string, number>>({});
  const [splitSavingKey, setSplitSavingKey] = useState<string | null>(null);
  const [splitNotice, setSplitNotice] = useState<string | null>(null);

  // Add Route form state (draft preserved on failure #47B)
  const [addingRoute, setAddingRoute] = useState(false);
  const [routeTargetId, setRouteTargetId] = useState("");
  const [routeInputId, setRouteInputId] = useState("");
  const [routeCategory, setRouteCategory] = useState("");
  const [routeMode, setRouteMode] = useState<TransportMode>("ROAD");
  const [routeLeadTime, setRouteLeadTime] = useState("");
  const [routeVolume, setRouteVolume] = useState("");
  const [routeUnit, setRouteUnit] = useState<VolumeUnit>("TONNES");
  const [routeSpend, setRouteSpend] = useState("");
  const [routeError, setRouteError] = useState<string | null>(null);

  // Partner invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(
    null,
  );
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);

  // Sync when facility changes
  useEffect(() => {
    setNodeName(facility.name);
    setNodeCountry(facility.countryCode);
    setNodeKind(facility.kind);
    setNodeRole(resolveFacilityRole(facility));
    setNodeSector(facility.sector ?? "");
    setEditingNode(false);
    setNodeError(null);
    setAddingRoute(false);
    setRouteError(null);
    setSplitNotice(null);
    setGeneratedInviteLink(null);
    setCopiedInviteLink(false);
    setExpandedLaneId(
      initialLaneId ??
        lanes.find((l) => l.fromFacilityId === facility.facilityId)?.laneId ??
        lanes.find((l) => l.toFacilityId === facility.facilityId)?.laneId ??
        null,
    );
  }, [facility.facilityId, initialLaneId]);

  // Sync split drafts when outgoing lanes change
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const group of splitGroups) {
      for (const lane of group.lanes) {
        next[lane.laneId] =
          lane.allocationSplitPct ?? lane.volumeSharePct ?? Math.round(100 / group.lanes.length);
      }
    }
    setSplitDrafts(next);
  }, [splitGroups]);

  // Sync expanded lane edit form
  useEffect(() => {
    if (!expandedLane) return;
    setLaneTransport(expandedLane.transportMode);
    setLaneLeadTime(
      expandedLane.leadTimeDays !== null ? String(expandedLane.leadTimeDays) : "",
    );
    setLaneDistance(
      expandedLane.distanceKm !== null ? String(Math.round(expandedLane.distanceKm)) : "",
    );
    setLaneRisk(expandedLane.riskStatus);
    setLaneRiskReason(expandedLane.riskReason ?? "");
    setLaneSafetyStock(
      expandedLane.safetyStockDays != null ? String(expandedLane.safetyStockDays) : "",
    );
    setLaneDefectRate(
      expandedLane.defectRatePct != null ? String(expandedLane.defectRatePct) : "",
    );
    setLaneSaveNotice(null);
  }, [expandedLane?.laneId]);

  const routeDestinationCandidates = useMemo(() => {
    return allFacilities.filter((f) => {
      if (f.facilityId === facility.facilityId) return false;
      const candidateRole = resolveFacilityRole(f);
      if (role === "SUPPLIER") return candidateRole === "OWN";
      if (role === "OWN") return candidateRole === "OWN" || candidateRole === "CLIENT";
      // For CLIENT, allow linking from an OWN facility
      return candidateRole === "OWN";
    });
  }, [allFacilities, facility.facilityId, role]);

  const handleSaveNode = async (e: FormEvent) => {
    e.preventDefault();
    setNodeError(null);
    if (!nodeName.trim()) {
      setNodeError("Facility name is required.");
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(nodeCountry.trim())) {
      setNodeError("Country code must be 2 letters (e.g., EE, FI, DE).");
      return;
    }
    const ok = await onUpdateFacility(facility.facilityId, {
      name: nodeName.trim(),
      countryCode: nodeCountry.trim().toUpperCase(),
      kind: nodeKind,
      relationshipRole: nodeRole,
      isOwnFacility: nodeRole === "OWN",
      sector: nodeSector.trim() || null,
    });
    if (ok) {
      setEditingNode(false);
    }
  };

  const handleSaveLaneDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!expandedLane) return;
    setLaneSaveNotice(null);
    const parsedLead = laneLeadTime.trim() ? Number(laneLeadTime) : null;
    const parsedDist = laneDistance.trim() ? Number(laneDistance) : null;
    const parsedSafety = laneSafetyStock.trim() ? Number(laneSafetyStock) : null;
    const parsedDefect = laneDefectRate.trim() ? Number(laneDefectRate) : null;

    const ok = await onUpdateLane(expandedLane.laneId, {
      transportMode: laneTransport,
      leadTimeDays:
        parsedLead !== null && Number.isFinite(parsedLead) && parsedLead >= 0
          ? Math.round(parsedLead)
          : null,
      distanceKm:
        parsedDist !== null && Number.isFinite(parsedDist) && parsedDist >= 0
          ? parsedDist
          : null,
      riskStatus: laneRisk,
      riskReason: laneRiskReason.trim() || null,
      safetyStockDays:
        parsedSafety !== null && Number.isFinite(parsedSafety) && parsedSafety >= 0
          ? parsedSafety
          : null,
      defectRatePct:
        parsedDefect !== null && Number.isFinite(parsedDefect) && parsedDefect >= 0
          ? parsedDefect
          : null,
    });
    if (ok) {
      setLaneSaveNotice("Route attributes saved.");
    }
  };

  const handleSaveSplitGroup = async (
    groupKey: string,
    groupLanes: readonly SupplyLane[],
  ) => {
    const total = groupLanes.reduce(
      (sum, l) => sum + (Number(splitDrafts[l.laneId]) || 0),
      0,
    );
    if (Math.abs(total - 100) > 0.01) return;

    setSplitSavingKey(groupKey);
    setSplitNotice(null);
    const ok = await onApplyAllocationSplits(
      groupLanes.map((lane) => ({
        laneId: lane.laneId,
        allocationSplitPct: Number(splitDrafts[lane.laneId]) || 0,
      })),
    );
    setSplitSavingKey(null);
    if (ok) {
      setSplitNotice("Destination allocation split updated to 100%.");
    }
  };

  const handleCreateRoute = async (e: FormEvent) => {
    e.preventDefault();
    setRouteError(null);
    if (!routeTargetId) {
      setRouteError("Select a connected facility.");
      return;
    }
    const linkedInput = routeInputId ? inputsById.get(routeInputId) : undefined;
    const category =
      routeCategory.trim() ||
      linkedInput?.category ||
      (role === "CLIENT" ? "Finished Goods Delivery" : "General Materials");

    const parsedVol = routeVolume.trim() ? Number(routeVolume) : null;
    if (parsedVol !== null && (!Number.isFinite(parsedVol) || parsedVol < 0)) {
      setRouteError("Annual volume must be a non-negative number.");
      return;
    }
    const parsedSpend = routeSpend.trim() ? Number(routeSpend) : null;
    if (
      parsedSpend !== null &&
      (!Number.isFinite(parsedSpend) || parsedSpend < 0)
    ) {
      setRouteError("Annual spend must be a non-negative number.");
      return;
    }
    const parsedLead = routeLeadTime.trim() ? Number(routeLeadTime) : null;
    if (parsedLead !== null && (!Number.isFinite(parsedLead) || parsedLead < 0)) {
      setRouteError("Lead time must be a non-negative integer.");
      return;
    }

    const fromFacilityId =
      role === "CLIENT" ? routeTargetId : facility.facilityId;
    const toFacilityId =
      role === "CLIENT" ? facility.facilityId : routeTargetId;
    const targetFac = facilitiesById.get(routeTargetId);
    const direction = resolveLaneDirection(
      {},
      role === "CLIENT" ? targetFac : facility,
      role === "CLIENT" ? facility : targetFac,
    );

    const ok = await onCreateLane({
      fromFacilityId,
      toFacilityId,
      direction,
      inputId: routeInputId || null,
      materialCategory: category,
      transportMode: routeMode,
      volumeSharePct: 100,
      annualVolume: parsedVol,
      volumeUnit: routeUnit,
      annualSpendEur: parsedSpend,
      leadTimeDays: parsedLead !== null ? Math.round(parsedLead) : null,
      riskStatus: "GREEN",
    });

    // Preserve entered fields if save fails (#47B)
    if (ok) {
      setRouteTargetId("");
      setRouteInputId("");
      setRouteCategory("");
      setRouteLeadTime("");
      setRouteVolume("");
      setRouteSpend("");
      setAddingRoute(false);
    }
  };

  const handleSendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setGeneratedInviteLink(null);
    setCopiedInviteLink(false);
    if (!inviteEmail.trim()) return;
    const result = await onCreateInvite({
      targetFacilityId: facility.facilityId,
      inviteeEmail: inviteEmail.trim(),
    });
    if (result) {
      setInviteEmail("");
      setGeneratedInviteLink(result.inviteLink);
    }
  };

  const pendingInvite = invitations.find(
    (inv) =>
      inv.targetFacilityId === facility.facilityId && inv.status === "PENDING",
  );

  const derivedByLaneId = useMemo(() => {
    const map = new Map(
      (analytics?.financialRisk?.laneCommercials ?? []).map((item) => [
        item.laneId,
        item,
      ]),
    );
    return map;
  }, [analytics]);

  const roleBadgeClass =
    role === "OWN"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/35"
      : role === "CLIENT"
        ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/35"
        : "bg-sky-500/15 text-sky-300 border-sky-500/35";

  return (
    <aside
      aria-label={`Inspector for ${facility.name}`}
      data-testid="node-inspector-drawer"
      className="w-full max-w-[440px] shrink-0 border-l border-slate-800 bg-slate-950/98 flex flex-col h-full overflow-hidden shadow-2xl"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-800 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${roleBadgeClass}`}
            >
              {role === "OWN" ? "Own Facility" : role}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {facility.countryCode} · {facility.kind}
            </span>
            {facility.isPartnerVerified && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                <CheckCircle2 className="h-3 w-3" />
                Verified
              </span>
            )}
          </div>
          <h2 className="text-sm font-bold text-white truncate mt-1">
            {facility.name}
          </h2>
          {facility.sector && (
            <p className="text-[11px] text-slate-400 truncate">
              {facility.sector}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick Action Bar */}
      <div className="px-4 py-2 border-b border-slate-800/80 flex items-center gap-2 flex-wrap bg-slate-900/40">
        <button
          type="button"
          onClick={() => onViewOnMap(facility.facilityId)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 cursor-pointer"
        >
          <Compass className="h-3.5 w-3.5 text-emerald-400" />
          Focus on Map
        </button>
        <button
          type="button"
          onClick={() => setEditingNode((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 cursor-pointer"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
          {editingNode ? "Cancel Edit" : "Edit Details"}
        </button>
        {role === "SUPPLIER" && (
          <button
            type="button"
            onClick={() => onOpenDirectory(facility.sector ?? undefined)}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/35 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1 text-[11px] text-sky-200 cursor-pointer"
          >
            <Search className="h-3.5 w-3.5" />
            See Alternatives
          </button>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Edit Facility Form */}
        {editingNode && (
          <form
            onSubmit={(e) => void handleSaveNode(e)}
            className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2.5"
          >
            <div className="text-xs font-semibold text-slate-200">
              Edit Node Profile
            </div>
            {nodeError && (
              <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                {nodeError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                aria-label="Edit facility name"
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
              <input
                type="text"
                maxLength={2}
                aria-label="Edit country code"
                value={nodeCountry}
                onChange={(e) => setNodeCountry(e.target.value.toUpperCase())}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white uppercase"
              />
              <select
                aria-label="Edit facility role"
                value={nodeRole}
                onChange={(e) =>
                  setNodeRole(e.target.value as FacilityRelationshipRole)
                }
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                <option value="SUPPLIER">Supplier</option>
                <option value="OWN">Own Facility</option>
                <option value="CLIENT">Client</option>
              </select>
              <select
                aria-label="Edit facility kind"
                value={nodeKind}
                onChange={(e) => setNodeKind(e.target.value as FacilityKind)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                {FACILITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label="Edit sector"
                value={nodeSector}
                onChange={(e) => setNodeSector(e.target.value)}
                placeholder="Sector (optional)"
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const ok = await onDeleteFacility(facility.facilityId);
                  if (ok) onClose();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 text-[11px] text-red-300 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                Delete Node
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1 text-xs font-semibold text-slate-950 cursor-pointer disabled:opacity-50"
              >
                Save Node
              </button>
            </div>
          </form>
        )}

        {/* Interactive Destination Allocation Split Bars (e.g., 70/30 Multi-Warehouse) */}
        {splitGroups.length > 0 && (
          <section
            data-testid="allocation-splits-section"
            className="rounded-xl border border-emerald-500/30 bg-slate-900/70 p-3 space-y-3"
          >
            <div>
              <h3 className="text-xs font-semibold text-emerald-300">
                Destination Allocation Splits
              </h3>
              <p className="text-[11px] text-slate-400">
                Distribute shipments across destinations. Splits must total 100%.
              </p>
            </div>
            {splitNotice && (
              <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1">
                {splitNotice}
              </div>
            )}
            {splitGroups.map((group) => {
              const totalPct = group.lanes.reduce(
                (sum, l) => sum + (Number(splitDrafts[l.laneId]) || 0),
                0,
              );
              const isValid = Math.abs(totalPct - 100) <= 0.01;
              const previewPool = allocationPreviewPool(group.lanes, derivedByLaneId, splitDrafts);

              return (
                <div
                  key={group.key}
                  className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-200 truncate">
                      {group.label}
                    </span>
                    <span
                      data-testid="split-total-badge"
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        isValid
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-red-500/15 text-red-300"
                      }`}
                    >
                      Total: {Math.round(totalPct)}%
                    </span>
                  </div>

                  {/* Visual stacked bar */}
                  <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden flex">
                    {group.lanes.map((lane, idx) => {
                      const pct = Math.max(
                        0,
                        Math.min(100, Number(splitDrafts[lane.laneId]) || 0),
                      );
                      return (
                        <div
                          key={lane.laneId}
                          style={{ width: `${pct}%` }}
                          className={`${SPLIT_BAR_COLORS[idx % SPLIT_BAR_COLORS.length]} transition-all`}
                        />
                      );
                    })}
                  </div>

                  {/* Per-destination split inputs */}
                  <div className="space-y-1.5">
                    {group.lanes.map((lane, idx) => {
                      const dest = facilitiesById.get(lane.toFacilityId);
                      const pct = Number(splitDrafts[lane.laneId]) || 0;
                      const derivedVol = allocationPreviewVolume(previewPool, pct, lane.volumeUnit, lane.laneId);
                      return (
                        <div
                          key={lane.laneId}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${SPLIT_BAR_COLORS[idx % SPLIT_BAR_COLORS.length]}`}
                            />
                            <span className="text-slate-200 truncate">
                              {dest?.name ?? "Destination"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {derivedVol && (
                              <span className="text-[10px] font-mono text-slate-400">
                                {derivedVol} {lane.volumeUnit}
                              </span>
                            )}
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              aria-label={`Split percentage for ${dest?.name ?? lane.laneId}`}
                              value={splitDrafts[lane.laneId] ?? 0}
                              onChange={(e) =>
                                setSplitDrafts((prev) => ({
                                  ...prev,
                                  [lane.laneId]: Number(e.target.value),
                                }))
                              }
                              className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-right font-mono text-xs text-white"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {!isValid ? (
                      <span className="text-[10px] text-red-300">
                        Adjust values to sum to 100%.
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">
                        Auto-updates per-lane derived volumes.
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={!isValid || busy || splitSavingKey === group.key}
                      onClick={() => void handleSaveSplitGroup(group.key, group.lanes)}
                      className="rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 px-2.5 py-1 text-[11px] font-semibold text-slate-950 cursor-pointer"
                    >
                      {splitSavingKey === group.key ? "Saving..." : "Save Split"}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Connected Routes & Commercial Contracts */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-200">
              Connected Routes ({connectedLanes.length})
            </h3>
            <button
              type="button"
              data-testid="add-route-btn"
              onClick={() => setAddingRoute((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 text-[11px] font-medium text-emerald-300 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Add Route
            </button>
          </div>

          {/* Add Route Form (preserves draft on failure #47B) */}
          {addingRoute && (
            <form
              onSubmit={(e) => void handleCreateRoute(e)}
              className="rounded-xl border border-emerald-500/35 bg-slate-900/90 p-3 space-y-2.5 text-xs"
            >
              <div className="font-semibold text-emerald-300 text-[11px]">
                {role === "CLIENT"
                  ? "Link Supplying Own Facility"
                  : "Add Outgoing Route"}
              </div>
              {routeError && (
                <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                  {routeError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Route connected facility"
                  value={routeTargetId}
                  onChange={(e) => setRouteTargetId(e.target.value)}
                  className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  <option value="">
                    {role === "CLIENT"
                      ? "Select supplying warehouse/plant..."
                      : "Select destination facility..."}
                  </option>
                  {routeDestinationCandidates.map((cand) => (
                    <option key={cand.facilityId} value={cand.facilityId}>
                      {cand.name} ({cand.countryCode})
                    </option>
                  ))}
                </select>
                {inputs.length > 0 && role !== "CLIENT" && (
                  <select
                    aria-label="Route material input"
                    value={routeInputId}
                    onChange={(e) => {
                      setRouteInputId(e.target.value);
                      const inp = inputsById.get(e.target.value);
                      if (inp && !routeCategory) setRouteCategory(inp.category);
                    }}
                    className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="">Material / Input (optional)</option>
                    {inputs.map((inp) => (
                      <option key={inp.inputId} value={inp.inputId}>
                        {inp.name} — {inp.category}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  aria-label="Route material category"
                  value={routeCategory}
                  onChange={(e) => setRouteCategory(e.target.value)}
                  placeholder="Material / product category"
                  className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                />
                <select
                  aria-label="Route transport mode"
                  value={routeMode}
                  onChange={(e) => setRouteMode(e.target.value as TransportMode)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  {TRANSPORT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  aria-label="Route lead time days"
                  value={routeLeadTime}
                  onChange={(e) => setRouteLeadTime(e.target.value)}
                  placeholder="Lead time (days)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                />
                <input
                  type="number"
                  step="any"
                  min={0}
                  aria-label="Route annual volume"
                  value={routeVolume}
                  onChange={(e) => setRouteVolume(e.target.value)}
                  placeholder="Annual volume (optional)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                />
                <select
                  aria-label="Route volume unit"
                  value={routeUnit}
                  onChange={(e) => setRouteUnit(e.target.value as VolumeUnit)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  {VOLUME_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  min={0}
                  aria-label="Route annual spend EUR"
                  value={routeSpend}
                  onChange={(e) => setRouteSpend(e.target.value)}
                  placeholder="Annual spend € (optional)"
                  className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingRoute(false)}
                  className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1 text-[11px] font-semibold text-slate-950 cursor-pointer disabled:opacity-50"
                >
                  Save Route
                </button>
              </div>
            </form>
          )}

          {connectedLanes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-400">
              No routes connected yet. Click <strong>Add Route</strong> to link
              this facility to your network.
            </div>
          ) : (
            <div className="space-y-2">
              {connectedLanes.map((lane) => {
                const isExpanded = lane.laneId === expandedLaneId;
                const fromFac = facilitiesById.get(lane.fromFacilityId);
                const toFac = facilitiesById.get(lane.toFacilityId);
                const linkedInput = lane.inputId
                  ? inputsById.get(lane.inputId)
                  : undefined;
                const derived = derivedByLaneId.get(lane.laneId);
                const riskDot =
                  lane.riskStatus === "RED"
                    ? "bg-red-500"
                    : lane.riskStatus === "YELLOW"
                      ? "bg-amber-400"
                      : "bg-emerald-400";

                return (
                  <div
                    key={lane.laneId}
                    className={`rounded-xl border transition ${
                      isExpanded
                        ? "border-slate-700 bg-slate-900/90"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                    }`}
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`Toggle route ${fromFac?.name ?? "Origin"} to ${toFac?.name ?? "Destination"}`}
                      onClick={() =>
                        setExpandedLaneId(isExpanded ? null : lane.laneId)
                      }
                      className="w-full p-3 flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-white">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${riskDot}`} />
                          <span className="truncate">
                            {fromFac?.name ?? "Origin"}
                          </span>
                          <ArrowRight className="h-3 w-3 text-slate-500 shrink-0" />
                          <span className="truncate">
                            {toFac?.name ?? "Destination"}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                          <span>{linkedInput?.name ?? lane.materialCategory}</span>
                          <span>· {lane.transportMode}</span>
                          {lane.allocationSplitPct != null && (
                            <span className="text-emerald-300 font-mono">
                              {lane.allocationSplitPct}% split
                            </span>
                          )}
                          {lane.annualVolume != null && (
                            <span className="font-mono">
                              {lane.annualVolume} {lane.volumeUnit}
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-slate-800/80 space-y-3">
                        {/* Physical & Operational Attributes */}
                        <form
                          onSubmit={(e) => void handleSaveLaneDetails(e)}
                          className="space-y-2 text-xs"
                        >
                          <div className="grid grid-cols-3 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">
                                Mode
                              </span>
                              <select
                                value={laneTransport}
                                onChange={(e) =>
                                  setLaneTransport(
                                    e.target.value as TransportMode,
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-white"
                              >
                                {TRANSPORT_MODES.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">
                                Lead (d)
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={laneLeadTime}
                                onChange={(e) => setLaneLeadTime(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">
                                Dist (km)
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={laneDistance}
                                onChange={(e) => setLaneDistance(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">
                                Risk
                              </span>
                              <select
                                value={laneRisk}
                                onChange={(e) =>
                                  setLaneRisk(e.target.value as RiskStatus)
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-white"
                              >
                                <option value="GREEN">GREEN</option>
                                <option value="YELLOW">AMBER</option>
                                <option value="RED">RED</option>
                              </select>
                            </label>
                            <label className="col-span-2 space-y-1">
                              <span className="text-[10px] text-slate-400">
                                Risk Reason
                              </span>
                              <input
                                type="text"
                                value={laneRiskReason}
                                onChange={(e) => setLaneRiskReason(e.target.value)}
                                placeholder="Optional corridor note"
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                              />
                            </label>
                          </div>

                          {/* Collapsible Operational Buffer Details (Level 2 progressive disclosure) */}
                          <button
                            type="button"
                            onClick={() => setShowAdvancedLane((v) => !v)}
                            className="text-[11px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                          >
                            {showAdvancedLane ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            Operational Buffer Details (Safety Stock, Defect %)
                          </button>
                          {showAdvancedLane && (
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <label className="space-y-1">
                                <span className="text-[10px] text-slate-400">
                                  Safety Stock (days)
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  value={laneSafetyStock}
                                  onChange={(e) =>
                                    setLaneSafetyStock(e.target.value)
                                  }
                                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-[10px] text-slate-400">
                                  Defect Rate (%)
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={95}
                                  step="0.1"
                                  value={laneDefectRate}
                                  onChange={(e) =>
                                    setLaneDefectRate(e.target.value)
                                  }
                                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                                />
                              </label>
                            </div>
                          )}

                          {laneSaveNotice && (
                            <div className="text-[11px] text-emerald-300">
                              {laneSaveNotice}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onDeleteLane(lane.laneId)}
                              className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                              Remove Route
                            </button>
                            <button
                              type="submit"
                              disabled={busy}
                              className="rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer"
                            >
                              Save Route
                            </button>
                          </div>
                        </form>

                        {/* Commercial Commitments (Contracts + Spot Top-Ups, #47A safe) */}
                        <LaneContractsDrawerSection
                          lane={lane}
                          contracts={contracts}
                          contractLines={contractLines}
                          derivedSummary={derived}
                          onChanged={onContractsChanged}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Supplier Partner Verification Invite (OWNER only) */}
        {role === "SUPPLIER" &&
          !facility.isPartnerVerified &&
          userRole === "OWNER" && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Mail className="h-3.5 w-3.5 text-emerald-400" />
                Verify Partner &amp; Unlock Tier-2 Risk
              </div>
              {pendingInvite ? (
                <p className="text-[11px] text-amber-300">
                  Invitation pending for {pendingInvite.inviteeEmail}.
                </p>
              ) : (
                <form
                  onSubmit={(e) => void handleSendInvite(e)}
                  className="flex gap-2"
                >
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="supplier@company.com"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-2.5 py-1.5 text-xs font-medium text-emerald-200 cursor-pointer"
                  >
                    Invite
                  </button>
                </form>
              )}
              {generatedInviteLink && (
                <div
                  data-testid="partner-invite-link"
                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-2 space-y-1.5"
                >
                  <div className="text-[11px] font-medium text-emerald-200">
                    Share this invite link with your partner (no email is sent automatically):
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      aria-label="Shareable partner invitation link"
                      value={generatedInviteLink}
                      className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[10px] text-emerald-200"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(generatedInviteLink);
                        setCopiedInviteLink(true);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 px-2 py-1 text-[10px] font-semibold text-emerald-200 cursor-pointer shrink-0"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedInviteLink ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

        {/* Coordinates Footer */}
        <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
          <MapPin className="h-3 w-3" />
          <span>
            {facility.lat.toFixed(4)}, {facility.lng.toFixed(4)} (
            {facility.locationPrecision})
          </span>
        </div>
      </div>
    </aside>
  );
}
