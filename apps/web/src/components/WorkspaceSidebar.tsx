import {
  FacilityKindSchema,
  LocationPrecisionSchema,
  RiskStatusSchema,
  TransportModeSchema,
  VolumeUnitSchema,
  type AnalyticsSummary,
  type CreateFacilityInput,
  type CreateInviteInput,
  type CreateInviteResponse,
  type CreateProductInput,
  type CreateSupplyInputInput,
  type CreateSupplyLaneInput,
  type Facility,
  type FacilityKind,
  type Invitation,
  type LocationPrecision,
  type Product,
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
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Crosshair,
  GitBranch,
  Layers,
  Loader2,
  Mail,
  MapPin,
  Package,
  Plus,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { LiveAlertFeedResponse } from "../lib/api.js";
import type {
  Contract,
  ContractLine,
  FinancialViewMode,
} from "@kulgo/shared";
import {
  formatEur,
  type WorkspaceSummaryStats,
} from "../lib/workspace-utils.js";
import { AnalyticsPanel } from "./AnalyticsPanel.js";
import type { MapInteractionMode } from "./FilterBar.js";
import { LaneContractsDrawerSection } from "./LaneContractsDrawerSection.js";
import { LiveAlertsPanel } from "./LiveAlertsPanel.js";

export type SidebarTab =
  | "analytics"
  | "alerts"
  | "overview"
  | "facility"
  | "lane"
  | "catalog";

export interface WorkspaceSidebarProps {
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  userRole?: UserRole;
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  visibleLanes: readonly SupplyLane[];
  contracts?: readonly Contract[];
  contractLines?: readonly ContractLine[];
  invitations: readonly Invitation[];
  stats: WorkspaceSummaryStats;
  analytics: AnalyticsSummary | null;
  loadingAnalytics: boolean;
  financialViewMode?: FinancialViewMode;
  onChangeFinancialViewMode?: (mode: FinancialViewMode) => void;
  onContractsChanged?: () => Promise<void> | void;
  selectedFacilityId: string | null;
  selectedLaneId: string | null;
  pickedCoords: { lat: number; lng: number } | null;
  mapMode: MapInteractionMode;
  refiningFacilityId: string | null;
  busy: boolean;
  onSelectFacility: (facilityId: string | null) => void;
  onSelectLane: (laneId: string | null) => void;
  onOpenSimulator: () => void;
  onOpenDirectory: (capability?: string) => void;
  onStartPickNewFacility: () => void;
  onStartRefineFacilityOnMap: (facilityId: string) => void;
  onCreateFacility: (input: CreateFacilityInput) => Promise<void>;
  onUpdateFacility: (
    facilityId: string,
    input: UpdateFacilityInput,
  ) => Promise<void>;
  onDeleteFacility: (facilityId: string) => Promise<void>;
  onCreateLane: (input: CreateSupplyLaneInput) => Promise<void>;
  onUpdateLane: (
    laneId: string,
    input: UpdateSupplyLaneInput,
  ) => Promise<void>;
  onDeleteLane: (laneId: string) => Promise<void>;
  onCreateProduct: (input: CreateProductInput) => Promise<void>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onCreateSupplyInput: (input: CreateSupplyInputInput) => Promise<void>;
  onDeleteSupplyInput: (inputId: string) => Promise<void>;
  onCreateInvite: (
    input: CreateInviteInput,
  ) => Promise<CreateInviteResponse | null>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  alertFeed?: LiveAlertFeedResponse | null;
  loadingAlerts?: boolean;
  sweepingAlerts?: boolean;
  onAcknowledgeAlert?: (
    signalId: string,
    status: "ACKNOWLEDGED" | "MUTED",
  ) => Promise<void>;
  onTriggerAlertSweep?: () => Promise<void>;
  onOpenOrgSettings?: () => void;
}

const FACILITY_KINDS = FacilityKindSchema.options;
const LOCATION_PRECISIONS = LocationPrecisionSchema.options;
const TRANSPORT_MODES = TransportModeSchema.options;
const RISK_STATUSES = RiskStatusSchema.options;
const VOLUME_UNITS = VolumeUnitSchema.options;

export function WorkspaceSidebar({
  activeTab,
  onChangeTab,
  userRole = "OWNER",
  products,
  inputs,
  facilities,
  visibleLanes,
  contracts = [],
  contractLines = [],
  invitations,
  stats,
  analytics,
  loadingAnalytics,
  financialViewMode = "PERIOD_WINDOW",
  onChangeFinancialViewMode,
  onContractsChanged,
  selectedFacilityId,
  selectedLaneId,
  pickedCoords,
  mapMode,
  refiningFacilityId,
  busy,
  onSelectFacility,
  onSelectLane,
  onOpenSimulator,
  onOpenDirectory,
  onStartPickNewFacility,
  onStartRefineFacilityOnMap,
  onCreateFacility,
  onUpdateFacility,
  onDeleteFacility,
  onCreateLane,
  onUpdateLane,
  onDeleteLane,
  onCreateProduct,
  onDeleteProduct,
  onCreateSupplyInput,
  onDeleteSupplyInput,
  onCreateInvite,
  onRevokeInvite,
  alertFeed = null,
  loadingAlerts = false,
  sweepingAlerts = false,
  onAcknowledgeAlert,
  onTriggerAlertSweep,
  onOpenOrgSettings,
}: WorkspaceSidebarProps) {
  const isOwner = userRole === "OWNER";
  const selectedFacility =
    facilities.find((f) => f.facilityId === selectedFacilityId) ?? null;
  const selectedLane =
    visibleLanes.find((l) => l.laneId === selectedLaneId) ?? null;

  const hqEstimatedFacilities = facilities.filter(
    (f) => f.locationPrecision === "HQ_ESTIMATED",
  );
  const flaggedLanes = visibleLanes.filter(
    (l) => l.riskStatus === "RED" || l.riskStatus === "YELLOW",
  );

  // --- HQ-to-Site Refinement Inline Form State ---
  const [refineTargetId, setRefineTargetId] = useState<string | null>(null);
  const [refineLat, setRefineLat] = useState("");
  const [refineLng, setRefineLng] = useState("");
  const [refineKind, setRefineKind] = useState<FacilityKind>("FACTORY");

  useEffect(() => {
    if (refiningFacilityId) {
      const target = facilities.find(
        (f) => f.facilityId === refiningFacilityId,
      );
      if (target) {
        setRefineTargetId(target.facilityId);
        setRefineLat(String(target.lat));
        setRefineLng(String(target.lng));
        setRefineKind(target.kind === "HQ" ? "FACTORY" : target.kind);
      }
    }
  }, [refiningFacilityId, facilities]);

  useEffect(() => {
    if (pickedCoords && refineTargetId && activeTab === "overview") {
      setRefineLat(String(pickedCoords.lat));
      setRefineLng(String(pickedCoords.lng));
    }
  }, [pickedCoords, refineTargetId, activeTab]);

  // --- Partner Invite State ---
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInvite, setGeneratedInvite] =
    useState<CreateInviteResponse | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);

  useEffect(() => {
    setInviteEmail("");
    setGeneratedInvite(null);
    setCopiedLink(false);
    setInviteFormError(null);
  }, [selectedFacilityId]);

  // --- Facility Form State ---
  const [facName, setFacName] = useState("");
  const [facKind, setFacKind] = useState<FacilityKind>("FACTORY");
  const [facPrecision, setFacPrecision] =
    useState<LocationPrecision>("HQ_ESTIMATED");
  const [facCountry, setFacCountry] = useState("EE");
  const [facLat, setFacLat] = useState("59.4370");
  const [facLng, setFacLng] = useState("24.7536");
  const [facIsOwn, setFacIsOwn] = useState(false);
  const [facSector, setFacSector] = useState("");
  const [facFormError, setFacFormError] = useState<string | null>(null);

  useEffect(() => {
    setFacFormError(null);
    if (selectedFacility) {
      setFacName(selectedFacility.name);
      setFacKind(selectedFacility.kind);
      setFacPrecision(selectedFacility.locationPrecision);
      setFacCountry(selectedFacility.countryCode);
      setFacLat(String(selectedFacility.lat));
      setFacLng(String(selectedFacility.lng));
      setFacIsOwn(selectedFacility.isOwnFacility);
      setFacSector(selectedFacility.sector ?? "");
    } else {
      setFacName("");
      setFacKind("FACTORY");
      setFacPrecision("HQ_ESTIMATED");
      setFacCountry("EE");
      setFacIsOwn(false);
      setFacSector("");
    }
  }, [selectedFacility]);

  useEffect(() => {
    if (pickedCoords && activeTab === "facility") {
      setFacLat(String(pickedCoords.lat));
      setFacLng(String(pickedCoords.lng));
    }
  }, [pickedCoords, activeTab]);

  // --- Lane Form State ---
  const [laneFromId, setLaneFromId] = useState("");
  const [laneToId, setLaneToId] = useState("");
  const [laneInputId, setLaneInputId] = useState("");
  const [laneMaterial, setLaneMaterial] = useState("");
  const [laneMode, setLaneMode] = useState<TransportMode>("ROAD");
  const [laneSharePct, setLaneSharePct] = useState("100");
  const [laneAnnualVolume, setLaneAnnualVolume] = useState("");
  const [laneVolumeUnit, setLaneVolumeUnit] = useState<VolumeUnit>("TONNES");
  const [laneSpendEur, setLaneSpendEur] = useState("");
  const [laneContractEnd, setLaneContractEnd] = useState("");
  const [laneRisk, setLaneRisk] = useState<RiskStatus>("GREEN");
  const [laneRiskReason, setLaneRiskReason] = useState("");
  const [laneFormError, setLaneFormError] = useState<string | null>(null);

  useEffect(() => {
    setLaneFormError(null);
    if (selectedLane) {
      setLaneFromId(selectedLane.fromFacilityId);
      setLaneToId(selectedLane.toFacilityId);
      setLaneInputId(selectedLane.inputId ?? "");
      setLaneMaterial(selectedLane.materialCategory);
      setLaneMode(selectedLane.transportMode);
      setLaneSharePct(String(selectedLane.volumeSharePct));
      setLaneAnnualVolume(
        selectedLane.annualVolume !== null &&
          selectedLane.annualVolume !== undefined
          ? String(selectedLane.annualVolume)
          : "",
      );
      setLaneVolumeUnit(selectedLane.volumeUnit ?? "TONNES");
      setLaneSpendEur(
        selectedLane.annualSpendEur !== null
          ? String(selectedLane.annualSpendEur)
          : "",
      );
      setLaneContractEnd(selectedLane.contractEndDate ?? "");
      setLaneRisk(selectedLane.riskStatus);
      setLaneRiskReason(selectedLane.riskReason ?? "");
      setLaneSafetyStockDays(
        selectedLane.safetyStockDays !== null &&
          selectedLane.safetyStockDays !== undefined
          ? String(selectedLane.safetyStockDays)
          : "",
      );
      setLaneDefectRatePct(
        selectedLane.defectRatePct !== null &&
          selectedLane.defectRatePct !== undefined
          ? String(selectedLane.defectRatePct)
          : "",
      );
      setLaneCarryingCostPct(
        selectedLane.carryingCostPct !== null &&
          selectedLane.carryingCostPct !== undefined
          ? String(selectedLane.carryingCostPct)
          : "",
      );
    } else {
      const ownFac = facilities.find((f) => f.isOwnFacility);
      const supplierFac = facilities.find((f) => !f.isOwnFacility);
      setLaneFromId(supplierFac?.facilityId ?? facilities[0]?.facilityId ?? "");
      setLaneToId(ownFac?.facilityId ?? facilities[1]?.facilityId ?? "");
      setLaneInputId(inputs[0]?.inputId ?? "");
      setLaneMaterial(inputs[0]?.category ?? "");
      setLaneMode("ROAD");
      setLaneSharePct("100");
      setLaneAnnualVolume("");
      setLaneVolumeUnit("TONNES");
      setLaneSpendEur("");
      setLaneContractEnd("");
      setLaneRisk("GREEN");
      setLaneRiskReason("");
      setLaneSafetyStockDays("");
      setLaneDefectRatePct("");
      setLaneCarryingCostPct("");
    }
  }, [selectedLane, facilities, inputs]);

  const [laneSafetyStockDays, setLaneSafetyStockDays] = useState("");
  const [laneDefectRatePct, setLaneDefectRatePct] = useState("");
  const [laneCarryingCostPct, setLaneCarryingCostPct] = useState("");

  // --- Catalog Form State ---
  const [prodName, setProdName] = useState("");
  const [prodSku, setProdSku] = useState("");
  const [inputName, setInputName] = useState("");
  const [inputCategory, setInputCategory] = useState("");
  const [inputProductId, setInputProductId] = useState("");
  const [inputUnit, setInputUnit] = useState<VolumeUnit>("TONNES");

  const handleFacilitySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFacFormError(null);
    const lat = Number(facLat);
    const lng = Number(facLng);
    if (!facName.trim()) {
      setFacFormError("Facility name is required.");
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(facCountry.trim())) {
      setFacFormError("Country code must be 2 letters (e.g. EE, DE, FI).");
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setFacFormError("Latitude must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setFacFormError("Longitude must be between -180 and 180.");
      return;
    }

    if (selectedFacility) {
      await onUpdateFacility(selectedFacility.facilityId, {
        name: facName.trim(),
        kind: facKind,
        locationPrecision: facPrecision,
        countryCode: facCountry.trim().toUpperCase(),
        lat,
        lng,
        isOwnFacility: facIsOwn,
        sector: facSector.trim() || null,
      });
    } else {
      await onCreateFacility({
        name: facName.trim(),
        kind: facKind,
        locationPrecision: facPrecision,
        countryCode: facCountry.trim().toUpperCase(),
        lat,
        lng,
        isOwnFacility: facIsOwn,
        sector: facSector.trim() || null,
      });
      setFacName("");
      setFacSector("");
    }
  };

  const handleLaneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLaneFormError(null);

    if (!laneFromId || !laneToId) {
      setLaneFormError("Select both origin and destination facilities.");
      return;
    }
    if (laneFromId === laneToId) {
      setLaneFormError("Origin and destination facilities must be different.");
      return;
    }
    const share = Number(laneSharePct);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      setLaneFormError("Volume share must be between 0 and 100.");
      return;
    }
    const annualVolume =
      laneAnnualVolume.trim() !== "" ? Number(laneAnnualVolume) : null;
    if (
      annualVolume !== null &&
      (!Number.isFinite(annualVolume) || annualVolume < 0)
    ) {
      setLaneFormError("Annual volume must be a non-negative number.");
      return;
    }
    const spend =
      laneSpendEur.trim() !== "" ? Number(laneSpendEur) : null;
    if (spend !== null && (!Number.isFinite(spend) || spend < 0)) {
      setLaneFormError("Annual spend must be a non-negative number.");
      return;
    }
    const material = laneMaterial.trim();
    if (!material) {
      setLaneFormError("Material category is required.");
      return;
    }
    const contractDate = laneContractEnd.trim() || null;
    if (contractDate && !/^\d{4}-\d{2}-\d{2}$/.test(contractDate)) {
      setLaneFormError("Contract end date must use YYYY-MM-DD format.");
      return;
    }

    const safetyStockDays = laneSafetyStockDays.trim()
      ? Number(laneSafetyStockDays)
      : null;
    const defectRatePct = laneDefectRatePct.trim()
      ? Number(laneDefectRatePct)
      : null;
    const carryingCostPct = laneCarryingCostPct.trim()
      ? Number(laneCarryingCostPct)
      : null;

    if (selectedLane) {
      await onUpdateLane(selectedLane.laneId, {
        fromFacilityId: laneFromId,
        toFacilityId: laneToId,
        inputId: laneInputId || null,
        materialCategory: material,
        transportMode: laneMode,
        volumeSharePct: share,
        annualVolume,
        volumeUnit: laneVolumeUnit,
        annualSpendEur: spend,
        contractEndDate: contractDate,
        riskStatus: laneRisk,
        riskReason: laneRiskReason.trim() || null,
        safetyStockDays:
          safetyStockDays !== null && Number.isFinite(safetyStockDays)
            ? safetyStockDays
            : null,
        defectRatePct:
          defectRatePct !== null && Number.isFinite(defectRatePct)
            ? defectRatePct
            : null,
        carryingCostPct:
          carryingCostPct !== null && Number.isFinite(carryingCostPct)
            ? carryingCostPct
            : null,
      });
    } else {
      await onCreateLane({
        fromFacilityId: laneFromId,
        toFacilityId: laneToId,
        inputId: laneInputId || null,
        materialCategory: material,
        transportMode: laneMode,
        volumeSharePct: share,
        annualVolume,
        volumeUnit: laneVolumeUnit,
        annualSpendEur: spend,
        contractEndDate: contractDate,
        riskStatus: laneRisk,
        riskReason: laneRiskReason.trim() || null,
        safetyStockDays:
          safetyStockDays !== null && Number.isFinite(safetyStockDays)
            ? safetyStockDays
            : null,
        defectRatePct:
          defectRatePct !== null && Number.isFinite(defectRatePct)
            ? defectRatePct
            : null,
        carryingCostPct:
          carryingCostPct !== null && Number.isFinite(carryingCostPct)
            ? carryingCostPct
            : null,
      });
    }
  };

  const handleVerifySite = async (facilityId: string) => {
    const lat = Number(refineLat);
    const lng = Number(refineLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    await onUpdateFacility(facilityId, {
      lat,
      lng,
      kind: refineKind,
      locationPrecision: "SITE_VERIFIED",
    });
    setRefineTargetId(null);
  };

  const handleCreateProductSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) return;
    await onCreateProduct({
      name: prodName.trim(),
      sku: prodSku.trim() || null,
    });
    setProdName("");
    setProdSku("");
  };

  const handleCreateInputSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputName.trim() || !inputCategory.trim()) return;
    await onCreateSupplyInput({
      name: inputName.trim(),
      category: inputCategory.trim(),
      productId: inputProductId || null,
      unit: inputUnit,
    });
    setInputName("");
    setInputCategory("");
  };

  return (
    <aside className="w-full lg:w-[390px] shrink-0 border-l border-slate-800/90 bg-slate-950 flex flex-col min-h-0">
      {/* Sidebar Tabs */}
      <nav
        aria-label="Workspace editor tabs"
        className="grid grid-cols-6 border-b border-slate-800 bg-slate-900/60 p-1 gap-1 shrink-0"
      >
        {(
          [
            { id: "analytics", label: "ESG/Risk", icon: BarChart3 },
            { id: "alerts", label: "Alerts", icon: Radio },
            { id: "overview", label: "Refine", icon: ShieldAlert },
            { id: "facility", label: "Facility", icon: MapPin },
            { id: "lane", label: "Lane", icon: GitBranch },
            { id: "catalog", label: "Catalog", icon: Package },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeTab(id)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors cursor-pointer ${
                active
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {activeTab === "analytics" && (
          <AnalyticsPanel
            analytics={analytics}
            loading={loadingAnalytics}
            facilities={facilities}
            onSelectFacility={(facilityId) => onSelectFacility(facilityId)}
            onOpenSimulator={onOpenSimulator}
            onOpenDirectory={onOpenDirectory}
          />
        )}

        {activeTab === "alerts" && (
          <LiveAlertsPanel
            feed={alertFeed}
            loading={loadingAlerts}
            sweeping={sweepingAlerts}
            userRole={userRole}
            facilities={facilities}
            lanes={visibleLanes}
            onAcknowledge={
              onAcknowledgeAlert ?? (async () => {})
            }
            onTriggerSweep={onTriggerAlertSweep ?? (async () => {})}
            onOpenSettings={onOpenOrgSettings ?? (() => {})}
            onSelectFacility={(facilityId) => onSelectFacility(facilityId)}
            onSelectLane={(laneId) => onSelectLane(laneId)}
          />
        )}

        {activeTab === "overview" && (
          <>
            {/* Risk & Spend Summary Strip */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Network Risk &amp; Spend
                </h2>
                <span className="text-sm font-semibold text-white">
                  {formatEur(stats.totalSpendEur)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 py-2">
                  <div className="text-lg font-semibold text-emerald-300">
                    {stats.greenLaneCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400/80">
                    Green
                  </div>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 py-2">
                  <div className="text-lg font-semibold text-amber-300">
                    {stats.yellowLaneCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-amber-400/80">
                    Yellow
                  </div>
                </div>
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 py-2">
                  <div className="text-lg font-semibold text-red-300">
                    {stats.redLaneCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-red-400/80">
                    Red Risk
                  </div>
                </div>
              </div>

              {flaggedLanes.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-slate-800">
                  <p className="text-[11px] font-medium text-slate-400">
                    Flagged Corridors
                  </p>
                  {flaggedLanes.map((lane) => {
                    const isRed = lane.riskStatus === "RED";
                    return (
                      <button
                        key={lane.laneId}
                        type="button"
                        onClick={() => onSelectLane(lane.laneId)}
                        className={`w-full text-left rounded-lg border p-2.5 text-xs transition-colors cursor-pointer ${
                          isRed
                            ? "border-red-500/30 bg-red-500/10 hover:bg-red-500/15"
                            : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100 truncate">
                            {lane.materialCategory}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              isRed
                                ? "bg-red-500/25 text-red-200"
                                : "bg-amber-500/25 text-amber-200"
                            }`}
                          >
                            {lane.riskStatus}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                          {lane.riskReason ??
                            `${lane.volumeSharePct}% volume · ${formatEur(lane.annualSpendEur)}`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* HQ-to-Site Refinement Panel */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    HQ-to-Site Refinement
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Relocate estimated HQs to exact manufacturing or port sites.
                  </p>
                </div>
                <span className="text-xs font-mono text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  {hqEstimatedFacilities.length}
                </span>
              </div>

              {hqEstimatedFacilities.length === 0 ? (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>
                    {facilities.length === 0
                      ? "Load the Estonia Product X demo or click + Add Facility to start mapping."
                      : "All facilities are verified to exact site coordinates."}
                  </span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {hqEstimatedFacilities.map((facility) => {
                    const isEditing = refineTargetId === facility.facilityId;
                    return (
                      <div
                        key={facility.facilityId}
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-100 truncate">
                              {facility.name}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {facility.countryCode} · {facility.lat.toFixed(4)},{" "}
                              {facility.lng.toFixed(4)}
                            </p>
                          </div>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                            HQ_ESTIMATED
                          </span>
                        </div>

                        {isEditing ? (
                          <div className="space-y-2 pt-1 border-t border-slate-800">
                            <button
                              type="button"
                              onClick={() =>
                                onStartRefineFacilityOnMap(facility.facilityId)
                              }
                              className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                mapMode === "refine-site" &&
                                refiningFacilityId === facility.facilityId
                                  ? "border-amber-400 bg-amber-500/20 text-amber-100"
                                  : "border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200"
                              }`}
                            >
                              <Crosshair className="h-3.5 w-3.5 text-amber-400" />
                              <span>Pick Exact Site on Map</span>
                            </button>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] uppercase text-slate-500 mb-0.5">
                                  Lat
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  value={refineLat}
                                  onChange={(e) => setRefineLat(e.target.value)}
                                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs font-mono text-slate-100"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] uppercase text-slate-500 mb-0.5">
                                  Lng
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  value={refineLng}
                                  onChange={(e) => setRefineLng(e.target.value)}
                                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs font-mono text-slate-100"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] uppercase text-slate-500 mb-0.5">
                                Verified Site Kind
                              </label>
                              <select
                                value={refineKind}
                                onChange={(e) =>
                                  setRefineKind(e.target.value as FacilityKind)
                                }
                                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                              >
                                {FACILITY_KINDS.map((kind) => (
                                  <option key={kind} value={kind}>
                                    {kind}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  handleVerifySite(facility.facilityId)
                                }
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-xs py-1.5 px-3 transition-colors cursor-pointer"
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                <span>Verify Site (SITE_VERIFIED)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setRefineTargetId(null)}
                                className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs py-1.5 px-2.5 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setRefineTargetId(facility.facilityId);
                                setRefineLat(String(facility.lat));
                                setRefineLng(String(facility.lng));
                                setRefineKind(
                                  facility.kind === "HQ"
                                    ? "FACTORY"
                                    : facility.kind,
                                );
                                onStartRefineFacilityOnMap(facility.facilityId);
                              }}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-medium py-1.5 px-2.5 transition-colors cursor-pointer"
                            >
                              <Crosshair className="h-3.5 w-3.5" />
                              <span>Pick Exact Site on Map</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onSelectFacility(facility.facilityId)
                              }
                              className="rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs py-1.5 px-2.5 cursor-pointer"
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === "facility" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                {selectedFacility ? "Edit Facility" : "New Facility"}
              </h2>
              {selectedFacility && (
                <button
                  type="button"
                  onClick={() => onSelectFacility(null)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  + Create New
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onStartPickNewFacility}
              className={`w-full inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                mapMode === "pick-new-facility"
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                  : "border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200"
              }`}
            >
              <Crosshair className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                {mapMode === "pick-new-facility"
                  ? "Click Map to Fill Coordinates..."
                  : "Pick Coordinates on Map"}
              </span>
            </button>

            {facFormError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {facFormError}
              </p>
            )}

            <form onSubmit={handleFacilitySubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Facility Name
                </label>
                <input
                  type="text"
                  required
                  value={facName}
                  onChange={(e) => setFacName(e.target.value)}
                  placeholder="Tallinn Assembly Plant"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500/60 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Kind
                  </label>
                  <select
                    value={facKind}
                    onChange={(e) => setFacKind(e.target.value as FacilityKind)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                  >
                    {FACILITY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Precision
                  </label>
                  <select
                    value={facPrecision}
                    onChange={(e) =>
                      setFacPrecision(e.target.value as LocationPrecision)
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                  >
                    {LOCATION_PRECISIONS.map((precision) => (
                      <option key={precision} value={precision}>
                        {precision}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    required
                    value={facCountry}
                    onChange={(e) => setFacCountry(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono uppercase text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={facLat}
                    onChange={(e) => setFacLat(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={facLng}
                    onChange={(e) => setFacLng(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Sector (Optional)
                </label>
                <input
                  type="text"
                  value={facSector}
                  onChange={(e) => setFacSector(e.target.value)}
                  placeholder="Precision Metallurgy"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={facIsOwn}
                  onChange={(e) => setFacIsOwn(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                />
                <span>Own organization facility (e.g. Tallinn HQ)</span>
              </label>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-xs py-2.5 px-4 transition-colors cursor-pointer"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>
                    {selectedFacility ? "Save Facility" : "Create Facility"}
                  </span>
                </button>
                {selectedFacility && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDeleteFacility(selectedFacility.facilityId)}
                    title="Delete facility and connected lanes"
                    className="inline-flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 p-2.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </form>

            {/* Partner Invite & Verification Workflow (Tier-1 Supplier Nodes) */}
            {selectedFacility && !selectedFacility.isOwnFacility && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-teal-300 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Partner Verification
                  </h3>
                  {selectedFacility.isPartnerVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/20 border border-teal-400/40 px-2 py-0.5 text-[10px] font-semibold text-teal-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Network-Verified
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                      Unverified
                    </span>
                  )}
                </div>

                {selectedFacility.isPartnerVerified ? (
                  <p className="text-[11px] text-teal-100/90 leading-snug rounded-lg border border-teal-500/25 bg-teal-500/10 p-2.5">
                    This Tier-1 supplier is linked via{" "}
                    <code className="font-mono text-[10px]">
                      VERIFIED_PARTNER_LINK
                    </code>
                    . Hidden Tier-2+ Scope 3 emissions and anonymized sanctions /
                    chokepoint alerts roll up automatically without exposing any
                    upstream identities.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Invite this Tier-1 supplier to join Kulgo, verify exact site
                    coordinates, and unlock anonymized Tier-2+ risk &amp; Scope
                    3 roll-ups.
                  </p>
                )}

                {isOwner ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setInviteFormError(null);
                      const trimmed = inviteEmail.trim();
                      if (!trimmed) {
                        setInviteFormError("Enter the supplier contact email.");
                        return;
                      }
                      const created = await onCreateInvite({
                        targetFacilityId: selectedFacility.facilityId,
                        inviteeEmail: trimmed,
                      });
                      if (created) {
                        setGeneratedInvite(created);
                        setInviteEmail("");
                        setCopiedLink(false);
                      }
                    }}
                    className="space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Mail className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="supplier@partner-company.eu"
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-2.5 py-1.5 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-xs px-3 py-1.5 transition-colors cursor-pointer shrink-0"
                      >
                        <span>Send Invite</span>
                      </button>
                    </div>
                    {inviteFormError && (
                      <p className="text-[11px] text-red-300">{inviteFormError}</p>
                    )}
                  </form>
                ) : (
                  <p className="text-[11px] text-slate-500 rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2">
                    Only organization <strong>OWNER</strong> users can send or
                    revoke partner verification invitations.
                  </p>
                )}

                {generatedInvite && (
                  <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-2.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-emerald-200">
                        One-Time Invite Link Ready
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              generatedInvite.inviteLink,
                            );
                            setCopiedLink(true);
                          } catch {
                            setCopiedLink(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-100 cursor-pointer"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy Invite Link</span>
                          </>
                        )}
                      </button>
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={generatedInvite.inviteLink}
                      className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] font-mono text-slate-300"
                    />
                  </div>
                )}

                {/* Sent invitations for this facility */}
                {invitations.filter(
                  (inv) => inv.targetFacilityId === selectedFacility.facilityId,
                ).length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Sent Invitations
                    </p>
                    {invitations
                      .filter(
                        (inv) =>
                          inv.targetFacilityId === selectedFacility.facilityId,
                      )
                      .map((inv) => {
                        const statusStyle =
                          inv.status === "ACCEPTED"
                            ? "bg-teal-500/20 text-teal-200 border-teal-500/40"
                            : inv.status === "PENDING"
                              ? "bg-amber-500/15 text-amber-200 border-amber-500/35"
                              : "bg-slate-800 text-slate-400 border-slate-700";

                        return (
                          <div
                            key={inv.inviteId}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-2 text-[11px]"
                          >
                            <div className="min-w-0">
                              <p className="text-slate-200 truncate font-medium">
                                {inv.inviteeEmail}
                              </p>
                              <span
                                className={`inline-block mt-1 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border ${statusStyle}`}
                              >
                                {inv.status}
                              </span>
                            </div>
                            {isOwner && inv.status === "PENDING" && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onRevokeInvite(inv.inviteId)}
                                title="Revoke pending invitation"
                                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer shrink-0"
                              >
                                <XCircle className="h-3 w-3" />
                                <span>Revoke</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {activeTab === "lane" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                {selectedLane ? "Edit Supply Lane" : "New Supply Lane"}
              </h2>
              {selectedLane && (
                <button
                  type="button"
                  onClick={() => onSelectLane(null)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  + Create New
                </button>
              )}
            </div>

            {facilities.length < 2 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
                Add at least two facilities (or load the Estonia Product X demo)
                before creating a supply corridor.
              </p>
            ) : (
              <>
                {laneFormError && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {laneFormError}
                  </p>
                )}

                <form onSubmit={handleLaneSubmit} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      From Facility (Supplier)
                    </label>
                    <select
                      value={laneFromId}
                      onChange={(e) => setLaneFromId(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                    >
                      {facilities.map((f) => (
                        <option key={f.facilityId} value={f.facilityId}>
                          {f.name} ({f.countryCode})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      To Facility (Destination)
                    </label>
                    <select
                      value={laneToId}
                      onChange={(e) => setLaneToId(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                    >
                      {facilities.map((f) => (
                        <option key={f.facilityId} value={f.facilityId}>
                          {f.name} ({f.countryCode})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Linked Material / Supply Input
                    </label>
                    <select
                      value={laneInputId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setLaneInputId(nextId);
                        const match = inputs.find((i) => i.inputId === nextId);
                        if (match && !laneMaterial) {
                          setLaneMaterial(match.category);
                        }
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">Unlinked</option>
                      {inputs.map((item) => (
                        <option key={item.inputId} value={item.inputId}>
                          {item.name} ({item.category})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Material Category
                      </label>
                      <input
                        type="text"
                        required
                        value={laneMaterial}
                        onChange={(e) => setLaneMaterial(e.target.value)}
                        placeholder="Steel Alloy"
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Transport Mode
                      </label>
                      <select
                        value={laneMode}
                        onChange={(e) =>
                          setLaneMode(e.target.value as TransportMode)
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                      >
                        {TRANSPORT_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Volume Share (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        required
                        value={laneSharePct}
                        onChange={(e) => setLaneSharePct(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Annual Spend (EUR)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={laneSpendEur}
                        onChange={(e) => setLaneSpendEur(e.target.value)}
                        placeholder="250000"
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Annual Volume
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={laneAnnualVolume}
                        onChange={(e) => setLaneAnnualVolume(e.target.value)}
                        placeholder="e.g. 800"
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Volume Unit
                      </label>
                      <select
                        value={laneVolumeUnit}
                        onChange={(e) =>
                          setLaneVolumeUnit(e.target.value as VolumeUnit)
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                      >
                        {VOLUME_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Contract End Date
                      </label>
                      <input
                        type="date"
                        value={laneContractEnd}
                        onChange={(e) => setLaneContractEnd(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Risk Status
                      </label>
                      <select
                        value={laneRisk}
                        onChange={(e) =>
                          setLaneRisk(e.target.value as RiskStatus)
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                      >
                        {RISK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Risk Reason (Optional)
                    </label>
                    <input
                      type="text"
                      value={laneRiskReason}
                      onChange={(e) => setLaneRiskReason(e.target.value)}
                      placeholder="e.g. Red Sea transit delay or sanctions exposure"
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                    />
                  </div>

                  {/* Progressive Disclosure: Collapsed Financial & Operational Buffer Details */}
                  <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                    <summary className="cursor-pointer text-[11px] font-semibold text-slate-300 select-none">
                      Financial &amp; Buffer Details (Optional — narrows EAL)
                    </summary>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Safety Stock (d)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={laneSafetyStockDays}
                          onChange={(e) => setLaneSafetyStockDays(e.target.value)}
                          placeholder="10"
                          className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Defect Rate (%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="95"
                          step="0.1"
                          value={laneDefectRatePct}
                          onChange={(e) => setLaneDefectRatePct(e.target.value)}
                          placeholder="2.0"
                          className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Carry Cost (%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={laneCarryingCostPct}
                          onChange={(e) => setLaneCarryingCostPct(e.target.value)}
                          placeholder="20"
                          className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                    </div>
                  </details>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-xs py-2.5 px-4 transition-colors cursor-pointer"
                    >
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>
                        {selectedLane ? "Save Lane" : "Create Supply Lane"}
                      </span>
                    </button>
                    {selectedLane && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDeleteLane(selectedLane.laneId)}
                        title="Delete lane"
                        className="inline-flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 p-2.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </form>

                {selectedLane && (
                  <LaneContractsDrawerSection
                    lane={selectedLane}
                    contracts={contracts}
                    contractLines={contractLines}
                    derivedSummary={analytics?.financialRisk?.laneCommercials.find(
                      (c) => c.laneId === selectedLane.laneId,
                    )}
                    onChanged={onContractsChanged ?? (() => {})}
                  />
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "catalog" && (
          <div className="space-y-6">
            {/* Products */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-emerald-400" />
                Products ({products.length})
              </h2>

              <form onSubmit={handleCreateProductSubmit} className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="Product name"
                    className="col-span-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <input
                    type="text"
                    value={prodSku}
                    onChange={(e) => setProdSku(e.target.value)}
                    placeholder="SKU"
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium py-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Product</span>
                </button>
              </form>

              <div className="space-y-1.5">
                {products.map((product) => (
                  <div
                    key={product.productId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-100 truncate">
                        {product.name}
                      </p>
                      {product.sku && (
                        <p className="text-[10px] font-mono text-slate-500">
                          {product.sku}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDeleteProduct(product.productId)}
                      className="text-slate-500 hover:text-red-400 p-1 cursor-pointer"
                      title="Delete product"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Supply Inputs / Materials */}
            <section className="space-y-3 pt-4 border-t border-slate-800">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-sky-400" />
                Materials / Inputs ({inputs.length})
              </h2>

              <form onSubmit={handleCreateInputSubmit} className="space-y-2">
                <input
                  type="text"
                  required
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  placeholder="Material name (e.g. Material A — Cold-Rolled Steel)"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    value={inputCategory}
                    onChange={(e) => setInputCategory(e.target.value)}
                    placeholder="Category"
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <select
                    value={inputUnit}
                    onChange={(e) =>
                      setInputUnit(e.target.value as VolumeUnit)
                    }
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                  >
                    {VOLUME_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  value={inputProductId}
                  onChange={(e) => setInputProductId(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="">All / Shared Product</option>
                  {products.map((p) => (
                    <option key={p.productId} value={p.productId}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium py-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Material</span>
                </button>
              </form>

              <div className="space-y-1.5">
                {inputs.map((item) => (
                  <div
                    key={item.inputId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-100 truncate">
                        {item.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {item.category} · {item.unit}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDeleteSupplyInput(item.inputId)}
                      className="text-slate-500 hover:text-red-400 p-1 cursor-pointer"
                      title="Delete material"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
