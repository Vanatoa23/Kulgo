import type {
  FinancialViewMode,
  Organization,
  Product,
  SupplyInput,
  User,
} from "@kulgo/shared";
import {
  Bell,
  Building2,
  Clock,
  Filter,
  Link2,
  LogOut,
  X,
} from "lucide-react";

export interface TopContextBarProps {
  organization: Organization;
  user: User;
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  activeProductId: string | null;
  activeInputId: string | null;
  onSelectProduct: (productId: string | null) => void;
  onSelectInput: (inputId: string | null) => void;
  financialViewMode: FinancialViewMode;
  onChangeFinancialViewMode: (mode: FinancialViewMode) => void;
  unreadRedCount: number;
  unreadAmberCount: number;
  alertsOpen: boolean;
  onToggleAlerts: () => void;
  onOpenAcceptInvite: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function TopContextBar({
  organization,
  user,
  products,
  inputs,
  activeProductId,
  activeInputId,
  onSelectProduct,
  onSelectInput,
  financialViewMode,
  onChangeFinancialViewMode,
  unreadRedCount,
  unreadAmberCount,
  alertsOpen,
  onToggleAlerts,
  onOpenAcceptInvite,
  onLogout,
  loggingOut,
}: TopContextBarProps) {
  const totalUnread = unreadRedCount + unreadAmberCount;
  const visibleInputs = activeProductId
    ? inputs.filter((i) => i.productId === activeProductId)
    : inputs;

  return (
    <header className="h-14 shrink-0 border-b border-slate-800/90 bg-slate-950/95 px-4 flex items-center justify-between gap-3 z-20">
      {/* Left: Org Badge + Product/Material Filter Pills */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 min-w-0">
          <Building2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-white truncate max-w-[180px]">
            {organization.name}
          </span>
          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
            {organization.countryCode}
          </span>
          <span
            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
              user.role === "OWNER"
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                : "bg-slate-800 text-slate-400 border border-slate-700"
            }`}
          >
            {user.role}
          </span>
        </div>

        {/* Product / Material Context Filter */}
        {(products.length > 0 || inputs.length > 0) && (
          <div className="hidden md:flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <select
              aria-label="Filter by product"
              value={activeProductId ?? ""}
              onChange={(e) => onSelectProduct(e.target.value || null)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer pr-1"
            >
              <option value="" className="bg-slate-950">
                All Products
              </option>
              {products.map((p) => (
                <option key={p.productId} value={p.productId} className="bg-slate-950">
                  {p.name}
                </option>
              ))}
            </select>
            {visibleInputs.length > 0 && (
              <>
                <span className="text-slate-700">/</span>
                <select
                  aria-label="Filter by material"
                  value={activeInputId ?? ""}
                  onChange={(e) => onSelectInput(e.target.value || null)}
                  className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer pr-1"
                >
                  <option value="" className="bg-slate-950">
                    All Materials
                  </option>
                  {visibleInputs.map((inp) => (
                    <option key={inp.inputId} value={inp.inputId} className="bg-slate-950">
                      {inp.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {(activeProductId || activeInputId) && (
              <button
                type="button"
                aria-label="Clear product and material filters"
                onClick={() => {
                  onSelectProduct(null);
                  onSelectInput(null);
                }}
                className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right: Time View Toggle + Alert Bell + User Menu */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Global Time View Toggle: Current Run-Rate vs. Period Window T */}
        <div
          role="group"
          aria-label="Commercial time view"
          className="hidden sm:inline-flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]"
        >
          <span className="px-1.5 text-slate-500 flex items-center">
            <Clock className="h-3 w-3" />
          </span>
          <button
            type="button"
            data-testid="time-view-run-rate"
            onClick={() => onChangeFinancialViewMode("RUN_RATE")}
            className={`px-2 py-1 rounded-md font-medium transition cursor-pointer ${
              financialViewMode === "RUN_RATE"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            Current Run-Rate
          </button>
          <button
            type="button"
            data-testid="time-view-period-window"
            onClick={() => onChangeFinancialViewMode("PERIOD_WINDOW")}
            className={`px-2 py-1 rounded-md font-medium transition cursor-pointer ${
              financialViewMode === "PERIOD_WINDOW"
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/35"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            Period Window T
          </button>
        </div>

        {/* Partner Invite Acceptance (OWNER) */}
        {user.role === "OWNER" && (
          <button
            type="button"
            onClick={onOpenAcceptInvite}
            title="Accept Partner Invite"
            className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition cursor-pointer"
          >
            <Link2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Accept Invite</span>
          </button>
        )}

        {/* Live Alert Bell */}
        <button
          type="button"
          data-testid="alert-bell-btn"
          aria-label={`Live risk alerts (${totalUnread} unread)`}
          onClick={onToggleAlerts}
          className={`relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
            alertsOpen
              ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
              : unreadRedCount > 0
                ? "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                : unreadAmberCount > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
          }`}
        >
          <Bell className="h-3.5 w-3.5" />
          {totalUnread > 0 && (
            <span className="font-mono text-[10px] font-bold">
              {totalUnread}
            </span>
          )}
        </button>

        {/* User Email & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <div
            title={user.email}
            className="hidden xl:flex h-7 w-7 rounded-full bg-slate-800 border border-slate-700 items-center justify-center text-[11px] font-bold text-emerald-300 uppercase"
          >
            {user.email.slice(0, 2)}
          </div>
          <button
            type="button"
            disabled={loggingOut}
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
