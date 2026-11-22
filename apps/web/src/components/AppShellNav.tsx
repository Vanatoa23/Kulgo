import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  Globe2,
  Network,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";

export type AppPage = "hub" | "map" | "dashboard" | "settings";

export interface AppShellNavProps {
  activePage: AppPage;
  onSelectPage: (page: AppPage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenImportExport: () => void;
  onSeedDemo: () => void;
  seedingDemo: boolean;
  hasNetworkData: boolean;
  unreadAlertCount: number;
}

const NAV_ITEMS: ReadonlyArray<{
  id: AppPage;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Network;
}> = [
  {
    id: "hub",
    label: "Network Hub",
    shortLabel: "Hub",
    description: "Suppliers, Facilities & Clients",
    icon: Network,
  },
  {
    id: "map",
    label: "Supply Map",
    shortLabel: "Map",
    description: "Interactive Tactical Flow Map",
    icon: Globe2,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    shortLabel: "Dashboard",
    description: "Financial Risk, ESG & Compliance",
    icon: BarChart3,
  },
  {
    id: "settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Profile, Org, Team & Audit Log",
    icon: Settings,
  },
];

export function AppShellNav({
  activePage,
  onSelectPage,
  collapsed,
  onToggleCollapse,
  onOpenImportExport,
  onSeedDemo,
  seedingDemo,
  hasNetworkData,
}: AppShellNavProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className={`shrink-0 flex flex-col border-r border-slate-800/90 bg-slate-950/95 transition-all duration-200 z-30 ${
        collapsed ? "w-16" : "w-52"
      }`}
    >
      {/* Brand Header */}
      <div className="h-14 px-3 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/25 to-sky-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            <span className="text-sm font-black tracking-tight text-emerald-300">
              K
            </span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-white truncate">
                Kulgo
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                Supply Command
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/80 cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* 4-Page Navigation Links */}
      <nav className="flex-1 p-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}`}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? `${item.label} — ${item.description}` : undefined}
              onClick={() => onSelectPage(item.id)}
              className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition cursor-pointer ${
                isActive
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/90 border border-transparent"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  isActive ? "text-emerald-400" : "text-slate-400"
                }`}
              />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">
                    {item.label}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {item.description}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Utility Footer Actions */}
      <div className="p-2 border-t border-slate-800/80 space-y-1">
        <button
          type="button"
          onClick={onOpenImportExport}
          title={collapsed ? "Import / Export Workspace" : undefined}
          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Upload className="h-4 w-4 shrink-0 text-sky-400" />
          {!collapsed && <span className="truncate">Import / Export</span>}
        </button>

        {!hasNetworkData && (
          <button
            type="button"
            disabled={seedingDemo}
            onClick={onSeedDemo}
            title={collapsed ? "Load Estonia Product X Demo" : undefined}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition cursor-pointer disabled:opacity-50 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="truncate">
                {seedingDemo ? "Loading Demo..." : "Load Estonia Product X Demo"}
              </span>
            )}
          </button>
        )}

        {hasNetworkData && !collapsed && (
          <button
            type="button"
            disabled={seedingDemo}
            onClick={onSeedDemo}
            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition cursor-pointer disabled:opacity-50"
          >
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {seedingDemo ? "Seeding..." : "Load Estonia Product X Demo"}
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
