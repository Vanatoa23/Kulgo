import type {
  AnalyticsSummary,
  Organization,
  Product,
  SupplyInput,
  User,
} from "@kulgo/shared";
import {
  Crosshair,
  GitBranchPlus,
  Globe2,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPinPlus,
  Maximize2,
  Network,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  formatEur,
  type WorkspaceSummaryStats,
} from "../lib/workspace-utils.js";

export type MapInteractionMode =
  | "inspect"
  | "pick-new-facility"
  | "refine-site";

export type WorkspaceViewMode = "map" | "graph";

export interface FilterBarProps {
  user: User;
  organization: Organization;
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  activeProductId: string | null;
  activeInputId: string | null;
  stats: WorkspaceSummaryStats;
  analytics: AnalyticsSummary | null;
  viewMode: WorkspaceViewMode;
  mapMode: MapInteractionMode;
  seedingDemo: boolean;
  loggingOut: boolean;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  onSelectProduct: (productId: string | null) => void;
  onSelectInput: (inputId: string | null) => void;
  onSeedDemo: () => void;
  onToggleAddFacility: () => void;
  onOpenAddLane: () => void;
  onOpenAnalytics: () => void;
  onOpenSimulator: () => void;
  onFitNetwork: () => void;
  onFocusUnverifiedHq: () => void;
  onLogout: () => void;
}

export function FilterBar({
  user,
  organization,
  products,
  inputs,
  activeProductId,
  activeInputId,
  stats,
  analytics,
  viewMode,
  mapMode,
  seedingDemo,
  loggingOut,
  onChangeViewMode,
  onSelectProduct,
  onSelectInput,
  onSeedDemo,
  onToggleAddFacility,
  onOpenAddLane,
  onOpenAnalytics,
  onOpenSimulator,
  onFitNetwork,
  onFocusUnverifiedHq,
  onLogout,
}: FilterBarProps) {
  const isAddingFacility = mapMode === "pick-new-facility";

  return (
    <header className="shrink-0 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-md z-20">
      {/* Top command row */}
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Globe2 className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base font-semibold tracking-tight text-white">
              Kulgo
            </span>
            <span className="text-slate-700">/</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full truncate">
              <span className="truncate max-w-[180px]">{organization.name}</span>
              <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                {organization.countryCode}
              </span>
            </span>
            <span className="hidden xl:inline text-xs text-slate-500 truncate">
              {user.email}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Map View <-> Logical Graph View Toggle */}
          <div
            role="group"
            aria-label="Workspace view mode"
            className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode("map")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                viewMode === "map"
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span>Map View</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode("graph")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                viewMode === "graph"
                  ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <Network className="h-3.5 w-3.5" />
              <span>Logical Graph</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenSimulator}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 font-medium text-xs px-3 py-1.5 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>What-If Simulator</span>
          </button>

          <button
            type="button"
            onClick={onSeedDemo}
            disabled={seedingDemo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-xs px-3 py-1.5 transition-colors cursor-pointer shadow-sm shadow-emerald-500/20"
          >
            {seedingDemo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>Load Estonia Product X Demo</span>
          </button>

          <button
            type="button"
            onClick={onToggleAddFacility}
            className={`inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium px-3 py-1.5 transition-colors cursor-pointer ${
              isAddingFacility
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                : "border-slate-700/80 bg-slate-900 hover:bg-slate-800 text-slate-200"
            }`}
          >
            {isAddingFacility ? (
              <Crosshair className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <MapPinPlus className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span>{isAddingFacility ? "Click Map to Place..." : "+ Add Facility"}</span>
          </button>

          <button
            type="button"
            onClick={onOpenAddLane}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium px-3 py-1.5 transition-colors cursor-pointer"
          >
            <GitBranchPlus className="h-3.5 w-3.5 text-slate-400" />
            <span>+ Add Lane</span>
          </button>

          {viewMode === "map" && (
            <button
              type="button"
              onClick={onFitNetwork}
              title="Fit map to visible supply network"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-slate-300 text-xs font-medium px-2.5 py-1.5 transition-colors cursor-pointer"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Fit Network</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            title="Sign out"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-red-950/50 hover:border-red-500/40 hover:text-red-200 text-slate-400 text-xs font-medium px-2.5 py-1.5 transition-colors cursor-pointer"
          >
            {loggingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>

      {/* Filter pills & live metrics row */}
      <div className="px-4 py-2 border-t border-slate-800/70 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Product pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mr-0.5">
              Product
            </span>
            <button
              type="button"
              onClick={() => onSelectProduct(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                activeProductId === null
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              All Products
            </button>
            {products.map((product) => {
              const active = activeProductId === product.productId;
              return (
                <button
                  key={product.productId}
                  type="button"
                  onClick={() => onSelectProduct(product.productId)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {product.name}
                </button>
              );
            })}
          </div>

          <span className="hidden sm:inline text-slate-700">|</span>

          {/* Material / SupplyInput pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mr-0.5">
              Material
            </span>
            <button
              type="button"
              onClick={() => onSelectInput(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                activeInputId === null
                  ? "bg-sky-500/15 border-sky-500/50 text-sky-200"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              All Materials
            </button>
            {inputs.map((input) => {
              const active = activeInputId === input.inputId;
              return (
                <button
                  key={input.inputId}
                  type="button"
                  onClick={() => onSelectInput(input.inputId)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? "bg-sky-500/15 border-sky-500/50 text-sky-200"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {input.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live summary metrics */}
        <div className="flex items-center gap-2 text-xs shrink-0">
          {analytics && (
            <button
              type="button"
              onClick={onOpenAnalytics}
              className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                analytics.overallStatus === "RED"
                  ? "bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25"
                  : analytics.overallStatus === "YELLOW"
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25"
                    : "bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25"
              }`}
            >
              Resilience: <span className="font-mono font-semibold">{analytics.resilienceScore}/100</span>
            </button>
          )}
          <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 font-medium">
            Spend: <span className="text-white">{formatEur(stats.totalSpendEur)}</span>
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {stats.greenLaneCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {stats.yellowLaneCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/25 text-red-300 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            {stats.redLaneCount}
          </span>
          {stats.unverifiedHqCount > 0 && (
            <button
              type="button"
              onClick={onFocusUnverifiedHq}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 font-medium transition-colors cursor-pointer"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              {stats.unverifiedHqCount} HQ Est.
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
