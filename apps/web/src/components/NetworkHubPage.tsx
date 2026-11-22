import {
  resolveFacilityRole,
  type AnalyticsSummary,
  type Contract,
  type ContractLine,
  type CreateFacilityInput,
  type CreateInviteInput,
  type CreateProductInput,
  type CreateSupplyInputInput,
  type CreateSupplyLaneInput,
  type Facility,
  type FacilityKind,
  type FacilityRelationshipRole,
  type Invitation,
  type Product,
  type RiskStatus,
  type SupplyInput,
  type SupplyLane,
  type UpdateFacilityInput,
  type UpdateSupplyLaneInput,
  type UserRole,
} from "@kulgo/shared";
import {
  ArrowRight,
  Box,
  Building2,
  CheckCircle2,
  Factory,
  Package,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { NodeInspectorDrawer } from "./NodeInspectorDrawer.js";

export interface NetworkHubPageProps {
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  contracts: readonly Contract[];
  contractLines: readonly ContractLine[];
  invitations: readonly Invitation[];
  analytics: AnalyticsSummary | null;
  userRole: UserRole;
  busy: boolean;
  seedingDemo: boolean;
  selectedFacilityId: string | null;
  selectedLaneId: string | null;
  onSelectFacility: (facilityId: string | null) => void;
  onViewFacilityOnMap: (facilityId: string) => void;
  onOpenDirectory: (capability?: string) => void;
  onSeedDemo: () => void;
  onCreateFacility: (input: CreateFacilityInput) => Promise<boolean>;
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
  onDeleteLane: (laneId: string) => Promise<boolean>;
  onCreateProduct: (input: CreateProductInput) => Promise<boolean>;
  onCreateSupplyInput: (input: CreateSupplyInputInput) => Promise<boolean>;
  onCreateInvite: (input: CreateInviteInput) => Promise<boolean>;
  onContractsChanged: () => Promise<void> | void;
}

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  EE: [59.437, 24.7536],
  FI: [60.1699, 24.9384],
  LV: [56.9496, 24.1052],
  LT: [54.6872, 25.2797],
  SE: [59.3293, 18.0686],
  NO: [59.9139, 10.7522],
  DK: [55.6761, 12.5683],
  DE: [52.52, 13.405],
  PL: [52.2297, 21.0122],
  NL: [52.3676, 4.9041],
  FR: [48.8566, 2.3522],
  GB: [51.5072, -0.1276],
  US: [40.7128, -74.006],
  CN: [31.2304, 121.4737],
  JP: [35.6762, 139.6503],
  KR: [37.5665, 126.978],
  TW: [25.033, 121.5654],
};

function defaultCoordsForCountry(countryCode: string): [number, number] {
  return COUNTRY_CENTROIDS[countryCode.toUpperCase()] ?? [54.5, 15.2];
}

function worstRisk(statuses: readonly RiskStatus[]): RiskStatus {
  if (statuses.includes("RED")) return "RED";
  if (statuses.includes("YELLOW")) return "YELLOW";
  return "GREEN";
}

interface QuickCreateDraft {
  name: string;
  countryCode: string;
  kind: FacilityKind;
  sector: string;
  lat: string;
  lng: string;
  showCoords: boolean;
}

function makeDefaultDraft(role: FacilityRelationshipRole): QuickCreateDraft {
  return {
    name: "",
    countryCode: "EE",
    kind: role === "OWN" ? "WAREHOUSE" : role === "CLIENT" ? "CUSTOMER" : "FACTORY",
    sector: "",
    lat: "",
    lng: "",
    showCoords: false,
  };
}

export function NetworkHubPage({
  products,
  inputs,
  facilities,
  lanes,
  contracts,
  contractLines,
  invitations,
  analytics,
  userRole,
  busy,
  seedingDemo,
  selectedFacilityId,
  selectedLaneId,
  onSelectFacility,
  onViewFacilityOnMap,
  onOpenDirectory,
  onSeedDemo,
  onCreateFacility,
  onUpdateFacility,
  onDeleteFacility,
  onCreateLane,
  onUpdateLane,
  onDeleteLane,
  onCreateProduct,
  onCreateSupplyInput,
  onCreateInvite,
  onContractsChanged,
}: NetworkHubPageProps) {
  const [addingRole, setAddingRole] = useState<FacilityRelationshipRole | null>(
    null,
  );
  const [drafts, setDrafts] = useState<
    Record<FacilityRelationshipRole, QuickCreateDraft>
  >({
    SUPPLIER: makeDefaultDraft("SUPPLIER"),
    OWN: makeDefaultDraft("OWN"),
    CLIENT: makeDefaultDraft("CLIENT"),
  });
  const [createError, setCreateError] = useState<string | null>(null);

  // Quick Product & Material forms (strict draft preservation on failure #47B)
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [prodName, setProdName] = useState("");
  const [prodSku, setProdSku] = useState("");
  const [showAddInput, setShowAddInput] = useState(false);
  const [inpName, setInpName] = useState("");
  const [inpCategory, setInpCategory] = useState("");
  const [inpProductId, setInpProductId] = useState("");

  const suppliers = useMemo(
    () => facilities.filter((f) => resolveFacilityRole(f) === "SUPPLIER"),
    [facilities],
  );
  const ownFacilities = useMemo(
    () => facilities.filter((f) => resolveFacilityRole(f) === "OWN"),
    [facilities],
  );
  const clients = useMemo(
    () => facilities.filter((f) => resolveFacilityRole(f) === "CLIENT"),
    [facilities],
  );

  const selectedFacility = useMemo(
    () => facilities.find((f) => f.facilityId === selectedFacilityId) ?? null,
    [facilities, selectedFacilityId],
  );

  const laneStatsByFacilityId = useMemo(() => {
    const stats = new Map<
      string,
      { count: number; totalVolume: number; unit: string | null; risk: RiskStatus; hasSplit: boolean }
    >();
    for (const fac of facilities) {
      const connected = lanes.filter(
        (l) => l.fromFacilityId === fac.facilityId || l.toFacilityId === fac.facilityId,
      );
      const totalVolume = connected.reduce((sum, l) => sum + (l.annualVolume ?? 0), 0);
      const unit = connected.find((l) => l.annualVolume != null)?.volumeUnit ?? null;
      const risk = worstRisk(connected.map((l) => l.riskStatus));
      const hasSplit = connected.some((l) => l.allocationSplitPct != null);
      stats.set(fac.facilityId, {
        count: connected.length,
        totalVolume,
        unit,
        risk,
        hasSplit,
      });
    }
    return stats;
  }, [facilities, lanes]);

  const updateRoleDraft = (
    role: FacilityRelationshipRole,
    patch: Partial<QuickCreateDraft>,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [role]: { ...prev[role], ...patch },
    }));
  };

  const handleQuickCreateFacility = async (
    e: FormEvent,
    role: FacilityRelationshipRole,
  ) => {
    e.preventDefault();
    setCreateError(null);
    const draft = drafts[role];
    const trimmedName = draft.name.trim();
    const cc = draft.countryCode.trim().toUpperCase();

    if (!trimmedName) {
      setCreateError("Please enter a facility name.");
      return;
    }
    if (!/^[A-Z]{2}$/.test(cc)) {
      setCreateError("Country code must be 2 letters (e.g., EE, FI, DE).");
      return;
    }

    const [fallbackLat, fallbackLng] = defaultCoordsForCountry(cc);
    const lat = draft.lat.trim() ? Number(draft.lat) : fallbackLat;
    const lng = draft.lng.trim() ? Number(draft.lng) : fallbackLng;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setCreateError("Latitude must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setCreateError("Longitude must be between -180 and 180.");
      return;
    }

    const ok = await onCreateFacility({
      name: trimmedName,
      kind: draft.kind,
      locationPrecision: draft.lat.trim() && draft.lng.trim() ? "SITE_VERIFIED" : "HQ_ESTIMATED",
      countryCode: cc,
      lat,
      lng,
      isOwnFacility: role === "OWN",
      relationshipRole: role,
      sector: draft.sector.trim() || null,
    });

    // Preserve user-entered fields on failed saves (#47B)
    if (ok) {
      setDrafts((prev) => ({ ...prev, [role]: makeDefaultDraft(role) }));
      setAddingRole(null);
    }
  };

  const handleQuickCreateProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) return;
    const ok = await onCreateProduct({
      name: prodName.trim(),
      sku: prodSku.trim() || null,
    });
    if (ok) {
      setProdName("");
      setProdSku("");
      setShowAddProduct(false);
    }
  };

  const handleQuickCreateInput = async (e: FormEvent) => {
    e.preventDefault();
    if (!inpName.trim() || !inpCategory.trim()) return;
    const ok = await onCreateSupplyInput({
      name: inpName.trim(),
      category: inpCategory.trim(),
      productId: inpProductId || null,
      unit: "TONNES",
    });
    if (ok) {
      setInpName("");
      setInpCategory("");
      setInpProductId("");
      setShowAddInput(false);
    }
  };

  const columns: ReadonlyArray<{
    role: FacilityRelationshipRole;
    title: string;
    subtitle: string;
    addLabel: string;
    icon: typeof Factory;
    accentText: string;
    accentBorder: string;
    items: readonly Facility[];
  }> = [
    {
      role: "SUPPLIER",
      title: "Upstream Suppliers",
      subtitle: "Raw materials, components & subassemblies",
      addLabel: "+ Add Supplier",
      icon: Factory,
      accentText: "text-sky-300",
      accentBorder: "border-sky-500/35",
      items: suppliers,
    },
    {
      role: "OWN",
      title: "My Facilities & Warehouses",
      subtitle: "Plants, assembly hubs & storage sites",
      addLabel: "+ Add Warehouse / Factory",
      icon: Building2,
      accentText: "text-emerald-300",
      accentBorder: "border-emerald-500/35",
      items: ownFacilities,
    },
    {
      role: "CLIENT",
      title: "Downstream Clients",
      subtitle: "Key customers & distribution accounts",
      addLabel: "+ Add Client",
      icon: Users,
      accentText: "text-indigo-300",
      accentBorder: "border-indigo-500/35",
      items: clients,
    },
  ];

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-slate-950">
      {/* Main 3-Column Flow Workspace */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Page Header + Products/Materials Quick Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              Network Hub
            </h1>
            <p className="text-xs text-slate-400">
              Map your end-to-end flow from suppliers to your facilities and clients. Click any node to manage routes, 30/70 splits, and contracts.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setShowAddProduct((v) => !v);
                setShowAddInput(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Package className="h-3.5 w-3.5 text-emerald-400" />
              Products ({products.length})
              <Plus className="h-3 w-3 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddInput((v) => !v);
                setShowAddProduct(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Box className="h-3.5 w-3.5 text-sky-400" />
              Materials ({inputs.length})
              <Plus className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Inline Add Product Form */}
        {showAddProduct && (
          <form
            onSubmit={(e) => void handleQuickCreateProduct(e)}
            className="rounded-xl border border-emerald-500/35 bg-slate-900/80 p-3 flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              required
              aria-label="New product name"
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              placeholder="Product name (e.g., Product X)"
              className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            />
            <input
              type="text"
              aria-label="New product SKU"
              value={prodSku}
              onChange={(e) => setProdSku(e.target.value)}
              placeholder="SKU (optional)"
              className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 cursor-pointer disabled:opacity-50"
            >
              Add Product
            </button>
            <button
              type="button"
              onClick={() => setShowAddProduct(false)}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Inline Add Material Form */}
        {showAddInput && (
          <form
            onSubmit={(e) => void handleQuickCreateInput(e)}
            className="rounded-xl border border-sky-500/35 bg-slate-900/80 p-3 flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              required
              aria-label="New material name"
              value={inpName}
              onChange={(e) => setInpName(e.target.value)}
              placeholder="Material name (e.g., Aluminum Housing)"
              className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            />
            <input
              type="text"
              required
              aria-label="New material category"
              value={inpCategory}
              onChange={(e) => setInpCategory(e.target.value)}
              placeholder="Category (e.g., Metals)"
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            />
            {products.length > 0 && (
              <select
                aria-label="Material parent product"
                value={inpProductId}
                onChange={(e) => setInpProductId(e.target.value)}
                className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              >
                <option value="">Any Product</option>
                {products.map((p) => (
                  <option key={p.productId} value={p.productId}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-sky-500 hover:bg-sky-400 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
            >
              Add Material
            </button>
            <button
              type="button"
              onClick={() => setShowAddInput(false)}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Empty Workspace Onboarding Banner */}
        {facilities.length === 0 && (
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-sky-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-white">
                Start with Level 0 — or explore the Estonia Product X demo
              </div>
              <p className="text-xs text-slate-300 max-w-xl">
                Add a supplier, warehouse, or client with just a name and country — no volumes or costs required upfront. Or load the full demo with 30/70 warehouse splits and live risk signals.
              </p>
            </div>
            <button
              type="button"
              disabled={seedingDemo}
              onClick={onSeedDemo}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-bold text-slate-950 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {seedingDemo ? "Loading Demo..." : "Load Estonia Product X Demo"}
            </button>
          </div>
        )}

        {/* 3-Column Flow Layout: Suppliers → My Facilities → Clients */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {columns.map((col, colIndex) => {
            const Icon = col.icon;
            const isAddingHere = addingRole === col.role;
            const draft = drafts[col.role];

            return (
              <section
                key={col.role}
                data-testid={`hub-column-${col.role.toLowerCase()}`}
                className="rounded-2xl border border-slate-800/90 bg-slate-900/45 flex flex-col overflow-hidden"
              >
                {/* Column Header */}
                <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2 bg-slate-900/80">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 shrink-0 ${col.accentText}`} />
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100 truncate">
                        {col.title}
                      </h2>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {col.items.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {col.subtitle}
                    </p>
                  </div>
                  {colIndex < 2 && (
                    <ArrowRight className="hidden lg:block h-4 w-4 text-slate-700 shrink-0" />
                  )}
                </div>

                {/* Add Node Trigger / Level-0 Quick Form */}
                <div className="p-3 border-b border-slate-800/60">
                  {!isAddingHere ? (
                    <button
                      type="button"
                      data-testid={`add-${col.role.toLowerCase()}-btn`}
                      onClick={() => {
                        setCreateError(null);
                        setAddingRole(col.role);
                      }}
                      className={`w-full rounded-xl border border-dashed ${col.accentBorder} bg-slate-950/60 hover:bg-slate-900 px-3 py-2 text-xs font-medium ${col.accentText} transition cursor-pointer`}
                    >
                      {col.addLabel}
                    </button>
                  ) : (
                    <form
                      onSubmit={(e) => void handleQuickCreateFacility(e, col.role)}
                      className="rounded-xl border border-slate-700 bg-slate-950 p-3 space-y-2 text-xs"
                    >
                      <div className="text-[11px] font-semibold text-slate-200">
                        {col.addLabel.replace(/^\+\s*/, "")} (Level 0)
                      </div>
                      {createError && (
                        <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                          {createError}
                        </div>
                      )}
                      <input
                        type="text"
                        aria-label={`${col.role} name`}
                        value={draft.name}
                        onChange={(e) =>
                          updateRoleDraft(col.role, { name: e.target.value })
                        }
                        placeholder="Company or site name *"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          maxLength={2}
                          aria-label={`${col.role} country code`}
                          value={draft.countryCode}
                          onChange={(e) =>
                            updateRoleDraft(col.role, {
                              countryCode: e.target.value.toUpperCase(),
                            })
                          }
                          placeholder="Country (EE) *"
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white uppercase"
                        />
                        <input
                          type="text"
                          aria-label={`${col.role} sector`}
                          value={draft.sector}
                          onChange={(e) =>
                            updateRoleDraft(col.role, { sector: e.target.value })
                          }
                          placeholder="Sector (optional)"
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateRoleDraft(col.role, {
                            showCoords: !draft.showCoords,
                          })
                        }
                        className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        {draft.showCoords
                          ? "Hide coordinates"
                          : "+ Custom coordinates (optional)"}
                      </button>
                      {draft.showCoords && (
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            step="any"
                            aria-label={`${col.role} latitude`}
                            value={draft.lat}
                            onChange={(e) =>
                              updateRoleDraft(col.role, { lat: e.target.value })
                            }
                            placeholder="Lat"
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                          />
                          <input
                            type="number"
                            step="any"
                            aria-label={`${col.role} longitude`}
                            value={draft.lng}
                            onChange={(e) =>
                              updateRoleDraft(col.role, { lng: e.target.value })
                            }
                            placeholder="Lng"
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                          />
                        </div>
                      )}
                      <div className="flex justify-end gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => setAddingRole(null)}
                          className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded-md bg-emerald-500 hover:bg-emerald-400 px-3 py-1 text-[11px] font-semibold text-slate-950 cursor-pointer disabled:opacity-50"
                        >
                          {busy ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Node Cards */}
                <div className="p-3 space-y-2">
                  {col.items.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      No {col.title.toLowerCase()} yet.
                    </div>
                  ) : (
                    col.items.map((fac) => {
                      const isSelected = fac.facilityId === selectedFacilityId;
                      const stat = laneStatsByFacilityId.get(fac.facilityId);
                      const riskDotClass =
                        stat?.risk === "RED"
                          ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.65)]"
                          : stat?.risk === "YELLOW"
                            ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.55)]"
                            : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]";

                      return (
                        <button
                          key={fac.facilityId}
                          type="button"
                          data-testid={`hub-card-${fac.facilityId}`}
                          onClick={() => onSelectFacility(fac.facilityId)}
                          className={`w-full text-left rounded-xl border p-3 transition cursor-pointer ${
                            isSelected
                              ? "border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.12)]"
                              : "border-slate-800 bg-slate-950/75 hover:border-slate-700 hover:bg-slate-900/90"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                title={`Risk status: ${stat?.risk ?? "GREEN"}`}
                                className={`h-2.5 w-2.5 rounded-full shrink-0 ${riskDotClass}`}
                              />
                              <span className="text-xs font-semibold text-white truncate">
                                {fac.name}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                              {fac.countryCode}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <div className="flex items-center gap-1.5 min-w-0 truncate">
                              <span>{fac.sector ?? fac.kind}</span>
                              {fac.isPartnerVerified && (
                                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                              {stat?.hasSplit && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                                  Split
                                </span>
                              )}
                              {stat && stat.totalVolume > 0 ? (
                                <span className="text-slate-300">
                                  {Math.round(stat.totalVolume).toLocaleString("en-US")}{" "}
                                  {stat.unit}
                                </span>
                              ) : (
                                <span className="text-slate-500">
                                  {stat?.count ?? 0} route{(stat?.count ?? 0) === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Right-Hand Node Inspector Drawer */}
      {selectedFacility && (
        <NodeInspectorDrawer
          facility={selectedFacility}
          allFacilities={facilities}
          lanes={lanes}
          inputs={inputs}
          contracts={contracts}
          contractLines={contractLines}
          invitations={invitations}
          analytics={analytics}
          userRole={userRole}
          busy={busy}
          initialLaneId={selectedLaneId}
          onClose={() => onSelectFacility(null)}
          onViewOnMap={onViewFacilityOnMap}
          onOpenDirectory={onOpenDirectory}
          onUpdateFacility={onUpdateFacility}
          onDeleteFacility={onDeleteFacility}
          onCreateLane={onCreateLane}
          onUpdateLane={onUpdateLane}
          onDeleteLane={onDeleteLane}
          onCreateInvite={onCreateInvite}
          onContractsChanged={onContractsChanged}
        />
      )}
    </div>
  );
}
