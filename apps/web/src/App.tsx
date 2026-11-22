import { PendingContractSavesProvider } from "./lib/pending-contract-saves.js";
import type {
  AnalyticsSummary,
  AuthMeResponse,
  CreateFacilityInput,
  CreateInviteInput,
  CreateInviteResponse,
  CreateProductInput,
  CreateSupplyInputInput,
  CreateSupplyLaneInput,
  Invitation,
  UpdateFacilityInput,
  UpdateSupplyLaneInput,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";
import { AlertCircle, Globe2, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AcceptInviteModal } from "./components/AcceptInviteModal.js";
import { AlternativeDirectoryModal } from "./components/AlternativeDirectoryModal.js";
import { AppShellNav, type AppPage } from "./components/AppShellNav.js";
import { AuthView } from "./components/AuthView.js";
import { ExecutiveDashboardPage } from "./components/ExecutiveDashboardPage.js";
import type { MapInteractionMode } from "./components/FilterBar.js";
import { ImportExportModal } from "./components/ImportExportModal.js";
import { LiveAlertsPanel } from "./components/LiveAlertsPanel.js";
import { LogicalGraphView } from "./components/LogicalGraphView.js";
import { NetworkHubPage } from "./components/NetworkHubPage.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { SupplyMap } from "./components/SupplyMap.js";
import { TopContextBar } from "./components/TopContextBar.js";
import { WhatIfSimulatorDrawer } from "./components/WhatIfSimulatorDrawer.js";
import {
  ApiError,
  acknowledgeAlert,
  applyAllocationSplits,
  createFacility,
  createInvite,
  createLane,
  createProduct,
  createSupplyInput,
  deleteFacility,
  deleteLane,
  getAlertFeed,
  getAnalyticsSummary,
  getMe,
  getNetwork,
  listInvites,
  logout,
  seedDemo,
  triggerAlertSweep,
  updateFacility,
  updateLane,
  type LiveAlertFeedResponse,
} from "./lib/api.js";
import { createRequestGuard, type RequestTicket } from "./lib/request-guard";
import {
  extractInviteTokenFromSearch,
  filterWorkspaceNetwork,
} from "./lib/workspace-utils.js";

const EMPTY_NETWORK: WorkspaceNetworkResponse = {
  products: [],
  inputs: [],
  facilities: [],
  lanes: [],
  riskSignals: [],
};

const VALID_PAGES: ReadonlySet<string> = new Set([
  "hub",
  "map",
  "dashboard",
  "settings",
]);

function readPageFromLocation(): AppPage {
  if (typeof window === "undefined") return "hub";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("page");
  if (raw && VALID_PAGES.has(raw)) {
    return raw as AppPage;
  }
  return "hub";
}

function writePageToLocation(page: AppPage): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("page") === page) return;
  url.searchParams.set("page", page);
  window.history.pushState({ page }, "", url.toString());
}

export function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [session, setSession] = useState<AuthMeResponse | null>(null);
  const [network, setNetwork] =
    useState<WorkspaceNetworkResponse>(EMPTY_NETWORK);
  const [loadingNetwork, setLoadingNetwork] = useState(false);

  // 4-Page App Shell state synced with ?page=...
  const [activePage, setActivePage] = useState<AppPage>(() =>
    readPageFromLocation(),
  );
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [alertsDrawerOpen, setAlertsDrawerOpen] = useState(false);

  // Map sub-view (Geo Map vs Logical Graph)
  const [mapViewMode, setMapViewMode] = useState<"map" | "graph">("map");
  const [financialViewMode, setFinancialViewMode] = useState<
    "RUN_RATE" | "PERIOD_WINDOW"
  >("RUN_RATE");
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // Sub-Project 1 Live Disruption Alerts state
  const [alertFeed, setAlertFeed] = useState<LiveAlertFeedResponse | null>(
    null,
  );
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [sweepingAlerts, setSweepingAlerts] = useState(false);

  // Partner Invites & Alternative Directory state
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [pendingInviteToken, setPendingInviteToken] = useState<string>(() =>
    typeof window !== "undefined"
      ? (extractInviteTokenFromSearch(window.location.search) ?? "")
      : "",
  );
  const [acceptInviteOpen, setAcceptInviteOpen] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? extractInviteTokenFromSearch(window.location.search) !== null
      : false,
  );
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryInitialCapability, setDirectoryInitialCapability] =
    useState("");
  const [importExportOpen, setImportExportOpen] = useState(false);

  // Filter & selection state
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
    null,
  );
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapInteractionMode>("inspect");
  const [fitTrigger, setFitTrigger] = useState(0);

  // Action states
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const networkGuard = useMemo(() => createRequestGuard(), []);
  const sessionGuard = useMemo(() => createRequestGuard(), []);
  const alertGuard = useMemo(() => createRequestGuard(), []);

  // Sync browser Back/Forward with activePage
  useEffect(() => {
    const onPopState = () => {
      setActivePage(readPageFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToPage = useCallback((page: AppPage) => {
    setActivePage(page);
    writePageToLocation(page);
  }, []);

  const loadWorkspaceNetwork = useCallback(
    async (shouldFit: boolean) => {
      const ticket = networkGuard.begin();
      setLoadingNetwork(true);
      try {
        const [data, invites] = await Promise.all([
          getNetwork(),
          listInvites().catch(() => [] as Invitation[]),
        ]);
        if (!ticket.isCurrent()) return;
        setNetwork(data);
        setInvitations(invites);
        if (shouldFit && data.facilities.length > 0) {
          setFitTrigger((n) => n + 1);
        }
      } catch (err) {
        if (!ticket.isCurrent()) return;
        if (err instanceof ApiError && err.status === 401) {
          setSession(null);
          return;
        }
        setBannerError(
          err instanceof Error
            ? err.message
            : "Failed to load workspace network.",
        );
      } finally {
        if (ticket.isCurrent()) {
          setLoadingNetwork(false);
        }
      }
    },
    [networkGuard],
  );

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const me = await getMe();
        if (!active) return;
        setSession(me);
        await loadWorkspaceNetwork(true);
      } catch {
        if (!active) return;
        setSession(null);
      } finally {
        if (active) setBootstrapping(false);
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, [loadWorkspaceNetwork]);

  const filtered = useMemo(
    () =>
      filterWorkspaceNetwork(network, {
        productId: activeProductId,
        inputId: activeInputId,
      }),
    [network, activeProductId, activeInputId],
  );

  // Fetch analytics whenever network, active filters, or financial time view change
  useEffect(() => {
    if (!session) {
      setAnalytics(null);
      return;
    }
    let active = true;
    setLoadingAnalytics(true);
    const load = async () => {
      try {
        const summary = await getAnalyticsSummary({
          productId: activeProductId ?? undefined,
          inputId: activeInputId ?? undefined,
          viewMode: financialViewMode,
        });
        if (!active) return;
        setAnalytics(summary);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          setSession(null);
        }
      } finally {
        if (active) setLoadingAnalytics(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [session, network, activeProductId, activeInputId, financialViewMode]);

  const refreshAlertFeed = useCallback(async () => {
    const ticket = alertGuard.begin();
    setLoadingAlerts(true);
    try {
      const feed = await getAlertFeed();
      if (!ticket.isCurrent()) return;
      setAlertFeed(feed);
    } catch {
      // Non-fatal
    } finally {
      if (ticket.isCurrent()) setLoadingAlerts(false);
    }
  }, [alertGuard]);

  useEffect(() => {
    if (!session) {
      setAlertFeed(null);
      return;
    }
    void refreshAlertFeed();
  }, [session, network, refreshAlertFeed]);

  const handleAcknowledgeAlert = useCallback(
    async (signalId: string, status: "ACKNOWLEDGED" | "MUTED") => {
      const sessionTicket = sessionGuard.capture();
      try {
        await acknowledgeAlert(signalId, { status });
        if (!sessionTicket.isCurrent()) return;
        await refreshAlertFeed();
      } catch (err) {
        if (!sessionTicket.isCurrent()) return;
        setBannerError(
          err instanceof Error ? err.message : "Failed to update alert status.",
        );
      }
    },
    [refreshAlertFeed, sessionGuard],
  );

  const handleTriggerAlertSweep = useCallback(async () => {
    const sessionTicket = sessionGuard.capture();
    setSweepingAlerts(true);
    try {
      await triggerAlertSweep();
      if (!sessionTicket.isCurrent()) return;
      await Promise.all([loadWorkspaceNetwork(false), refreshAlertFeed()]);
    } catch (err) {
      if (!sessionTicket.isCurrent()) return;
      setBannerError(
        err instanceof Error
          ? err.message
          : "Failed to run live disruption sweep.",
      );
    } finally {
      if (sessionTicket.isCurrent()) setSweepingAlerts(false);
    }
  }, [loadWorkspaceNetwork, refreshAlertFeed, sessionGuard]);

  const resetTenantState = () => {
    sessionGuard.invalidate();
    networkGuard.invalidate();
    alertGuard.invalidate();
    setNetwork(EMPTY_NETWORK);
    setInvitations([]);
    setAlertFeed(null);
    setAnalytics(null);
    setLoadingNetwork(false);
    setLoadingAlerts(false);
    setLoadingAnalytics(false);
    setSweepingAlerts(false);
  };

  const handleAuthenticated = (me: AuthMeResponse) => {
    resetTenantState();
    setSession(me);
    setBannerError(null);
    void loadWorkspaceNetwork(true);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    resetTenantState();
    try {
      await logout();
    } catch {
      // Clear local session regardless of network hiccup
    } finally {
      setLoggingOut(false);
      setSession(null);
      resetTenantState();
      setSimulatorOpen(false);
      setAlertsDrawerOpen(false);
      setActiveProductId(null);
      setActiveInputId(null);
      setSelectedFacilityId(null);
      setSelectedLaneId(null);
      setMapMode("inspect");
    }
  };

  const handleSelectProduct = (productId: string | null) => {
    setActiveProductId(productId);
    if (productId !== null && activeInputId !== null) {
      const inputBelongs = network.inputs.some(
        (i) => i.inputId === activeInputId && i.productId === productId,
      );
      if (!inputBelongs) {
        setActiveInputId(null);
      }
    }
  };

  const handleSeedDemo = async () => {
    const sessionTicket = sessionGuard.capture();
    setSeedingDemo(true);
    setBannerError(null);
    try {
      const seeded = await seedDemo();
      if (!sessionTicket.isCurrent()) return;
      networkGuard.invalidate();
      setLoadingNetwork(false);
      setNetwork(seeded);
      setActiveProductId(null);
      setActiveInputId(null);
      setSelectedFacilityId(null);
      setSelectedLaneId(null);
      setFitTrigger((n) => n + 1);
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : "Failed to load demo scenario.",
      );
    } finally {
      setSeedingDemo(false);
    }
  };

  const makeCommit = (sessionTicket: RequestTicket) => (apply: () => void) => {
    if (!sessionTicket.isCurrent()) return;
    networkGuard.invalidate();
    setLoadingNetwork(false);
    apply();
  };

  /**
   * Runs a workspace mutation and returns `true` ONLY when the server confirms
   * success in the current session. Returns `false` on any validation/network
   * failure so calling forms preserve user-entered drafts (#47B).
   */
  const runMutation = async (
    fn: (commit: (apply: () => void) => void) => Promise<void>,
  ): Promise<boolean> => {
    const sessionTicket = sessionGuard.capture();
    setBusy(true);
    setBannerError(null);
    try {
      await fn(makeCommit(sessionTicket));
      return sessionTicket.isCurrent();
    } catch (err) {
      if (!sessionTicket.isCurrent()) return false;
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return false;
      }
      setBannerError(
        err instanceof Error ? err.message : "Action failed. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFacility = (input: CreateFacilityInput) =>
    runMutation(async (commit) => {
      const created = await createFacility(input);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          facilities: [...prev.facilities, created],
        }));
        setSelectedFacilityId(created.facilityId);
      });
    });

  const handleUpdateFacility = (
    facilityId: string,
    input: UpdateFacilityInput,
  ) =>
    runMutation(async (commit) => {
      const updated = await updateFacility(facilityId, input);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          facilities: prev.facilities.map((f) =>
            f.facilityId === facilityId ? updated : f,
          ),
        }));
      });
      if (input.lat !== undefined || input.lng !== undefined) {
        const refreshed = await getNetwork();
        commit(() => setNetwork(refreshed));
      }
    });

  const handleDeleteFacility = (facilityId: string) =>
    runMutation(async (commit) => {
      await deleteFacility(facilityId);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          facilities: prev.facilities.filter(
            (f) => f.facilityId !== facilityId,
          ),
          lanes: prev.lanes.filter(
            (l) =>
              l.fromFacilityId !== facilityId && l.toFacilityId !== facilityId,
          ),
        }));
        if (selectedFacilityId === facilityId) {
          setSelectedFacilityId(null);
        }
      });
    });

  const handleCreateLane = (input: CreateSupplyLaneInput) =>
    runMutation(async (commit) => {
      const created = await createLane(input);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          lanes: [...prev.lanes, created],
        }));
        setSelectedLaneId(created.laneId);
      });
    });

  const handleUpdateLane = (laneId: string, input: UpdateSupplyLaneInput) =>
    runMutation(async (commit) => {
      const updated = await updateLane(laneId, input);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          lanes: prev.lanes.map((l) => (l.laneId === laneId ? updated : l)),
        }));
      });
    });

  const handleDeleteLane = (laneId: string) =>
    runMutation(async (commit) => {
      await deleteLane(laneId);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          lanes: prev.lanes.filter((l) => l.laneId !== laneId),
        }));
        if (selectedLaneId === laneId) {
          setSelectedLaneId(null);
        }
      });
    });

  const handleCreateProduct = (input: CreateProductInput) =>
    runMutation(async (commit) => {
      const created = await createProduct(input);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          products: [...prev.products, created],
        }));
      });
    });

  const handleCreateSupplyInput = (input: CreateSupplyInputInput) =>
    runMutation(async (commit) => {
      const created = await createSupplyInput(input);
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          inputs: [...prev.inputs, created],
        }));
      });
    });

  const handleApplyAllocationSplits = (
    splits: ReadonlyArray<{ laneId: string; allocationSplitPct: number }>,
  ) =>
    runMutation(async (commit) => {
      const result = await applyAllocationSplits(splits);
      const updatedLaneById = new Map(result.lanes.map((l) => [l.laneId, l]));
      const updatedLineById = new Map(
        result.contractLines.map((cl) => [cl.contractLineId, cl]),
      );
      commit(() => {
        setNetwork((prev) => ({
          ...prev,
          lanes: prev.lanes.map((l) => updatedLaneById.get(l.laneId) ?? l),
          contractLines: (prev.contractLines ?? []).map(
            (cl) => updatedLineById.get(cl.contractLineId) ?? cl,
          ),
        }));
      });
    });

  const handleCreateInvite = async (
    input: CreateInviteInput,
  ): Promise<CreateInviteResponse | null> => {
    const sessionTicket = sessionGuard.capture();
    setBusy(true);
    setBannerError(null);
    try {
      const result = await createInvite(input);
      if (!sessionTicket.isCurrent()) return null;
      setInvitations((prev) => [result.invitation, ...prev]);
      return result;
    } catch (err) {
      if (!sessionTicket.isCurrent()) return null;
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return null;
      }
      setBannerError(
        err instanceof Error
          ? err.message
          : "Failed to create partner invitation.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const clearInviteQueryParam = () => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("invite")) {
        url.searchParams.delete("invite");
        window.history.replaceState({}, "", url.toString());
      }
    }
  };

  if (bootstrapping) {
    return (
      <div className="h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
          <Globe2 className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          <span>Initializing Kulgo workspace...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthView onAuthenticated={handleAuthenticated} />;
  }

  const ackedSignalIds = new Set(
    (alertFeed?.acknowledgements ?? []).map((a) => a.signalId),
  );
  const unreadRedCount = (alertFeed?.signals ?? []).filter(
    (s) => s.severity === "RED" && !ackedSignalIds.has(s.signalId),
  ).length;
  const unreadAmberCount = (alertFeed?.signals ?? []).filter(
    (s) => s.severity === "YELLOW" && !ackedSignalIds.has(s.signalId),
  ).length;

  return (
    <PendingContractSavesProvider key={`${session.organization.orgId}:${session.user.userId}`}>
    <div className="h-screen w-screen flex overflow-hidden bg-slate-950 text-slate-100">
      {/* Slim Persistent Left Icon-Rail */}
      <AppShellNav
        activePage={activePage}
        onSelectPage={navigateToPage}
        collapsed={navCollapsed}
        onToggleCollapse={() => setNavCollapsed((v) => !v)}
        onOpenImportExport={() => setImportExportOpen(true)}
        onSeedDemo={() => void handleSeedDemo()}
        seedingDemo={seedingDemo}
        hasNetworkData={network.facilities.length > 0}
        unreadAlertCount={unreadRedCount + unreadAmberCount}
      />

      {/* Right Main Column: Minimal Top Context Bar + Active Page */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <TopContextBar
          organization={session.organization}
          user={session.user}
          products={network.products}
          inputs={network.inputs}
          activeProductId={activeProductId}
          activeInputId={activeInputId}
          onSelectProduct={handleSelectProduct}
          onSelectInput={setActiveInputId}
          financialViewMode={financialViewMode}
          onChangeFinancialViewMode={setFinancialViewMode}
          unreadRedCount={unreadRedCount}
          unreadAmberCount={unreadAmberCount}
          alertsOpen={alertsDrawerOpen}
          onToggleAlerts={() => setAlertsDrawerOpen((v) => !v)}
          onOpenAcceptInvite={() => setAcceptInviteOpen(true)}
          onLogout={() => void handleLogout()}
          loggingOut={loggingOut}
        />

        {bannerError && (
          <div className="shrink-0 bg-red-950/90 border-b border-red-800 px-4 py-2 text-xs text-red-200 flex items-center justify-between gap-2 z-20">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{bannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="p-0.5 rounded hover:bg-red-900/60 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Active Page Canvas */}
        <main className="relative flex-1 flex min-h-0 overflow-hidden">
          {loadingNetwork && (
            <div className="pointer-events-none absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-xs text-slate-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
              <span>Syncing network...</span>
            </div>
          )}

          {/* PAGE 1: Network Hub */}
          {activePage === "hub" && (
            <NetworkHubPage
              products={network.products}
              inputs={filtered.inputs}
              facilities={filtered.facilities}
              lanes={filtered.lanes}
              contracts={network.contracts ?? []}
              contractLines={network.contractLines ?? []}
              invitations={invitations}
              analytics={analytics}
              userRole={session.user.role}
              busy={busy}
              seedingDemo={seedingDemo}
              selectedFacilityId={selectedFacilityId}
              selectedLaneId={selectedLaneId}
              onSelectFacility={(facilityId) => {
                setSelectedFacilityId(facilityId);
                setSelectedLaneId(null);
              }}
              onViewFacilityOnMap={(facilityId) => {
                setSelectedFacilityId(facilityId);
                setMapViewMode("map");
                navigateToPage("map");
              }}
              onOpenDirectory={(cap) => {
                setDirectoryInitialCapability(cap ?? "");
                setDirectoryOpen(true);
              }}
              onSeedDemo={() => void handleSeedDemo()}
              onCreateFacility={handleCreateFacility}
              onUpdateFacility={handleUpdateFacility}
              onDeleteFacility={handleDeleteFacility}
              onCreateLane={handleCreateLane}
              onUpdateLane={handleUpdateLane}
              onApplyAllocationSplits={handleApplyAllocationSplits}
              onDeleteLane={handleDeleteLane}
              onCreateProduct={handleCreateProduct}
              onCreateSupplyInput={handleCreateSupplyInput}
              onCreateInvite={handleCreateInvite}
              onContractsChanged={() => loadWorkspaceNetwork(false)}
            />
          )}

          {/* PAGE 2: Strategy-Game Supply Map (+ Logical Graph toggle) */}
          {activePage === "map" && (
            <div className="relative flex-1 flex min-h-0 overflow-hidden">
              {mapViewMode === "map" ? (
                <SupplyMap
                  facilities={filtered.facilities}
                  lanes={filtered.lanes}
                  inputs={network.inputs}
                  riskSignals={network.riskSignals}
                  analytics={analytics}
                  selectedFacilityId={selectedFacilityId}
                  selectedLaneId={selectedLaneId}
                  mapMode={mapMode}
                  refiningFacilityName={null}
                  fitTrigger={fitTrigger}
                  onSelectFacility={(facilityId) => {
                    setSelectedFacilityId(facilityId);
                    setSelectedLaneId(null);
                  }}
                  onSelectLane={(laneId) => {
                    setSelectedLaneId(laneId);
                    setSelectedFacilityId(null);
                  }}
                  onMapPickCoordinates={() => {
                    setMapMode("inspect");
                  }}
                  onCancelMapMode={() => setMapMode("inspect")}
                  onAcknowledgeSignal={handleAcknowledgeAlert}
                  onToggleLogicalGraph={() => setMapViewMode("graph")}
                  onOpenSimulator={() => setSimulatorOpen(true)}
                  onInspectLaneInHub={(lane) => {
                    setSelectedFacilityId(lane.fromFacilityId);
                    setSelectedLaneId(lane.laneId);
                    navigateToPage("hub");
                  }}
                />
              ) : (
                <div className="relative flex-1 flex min-h-0">
                  <LogicalGraphView
                    products={network.products}
                    inputs={filtered.inputs}
                    facilities={filtered.facilities}
                    lanes={filtered.lanes}
                    activeProductId={activeProductId}
                    activeInputId={activeInputId}
                    selectedFacilityId={selectedFacilityId}
                    selectedLaneId={selectedLaneId}
                    onSelectProduct={handleSelectProduct}
                    onSelectInput={setActiveInputId}
                    onSelectFacility={(facilityId) => {
                      setSelectedFacilityId(facilityId);
                      navigateToPage("hub");
                    }}
                    onSelectLane={(laneId) => {
                      const lane = network.lanes.find(
                        (l) => l.laneId === laneId,
                      );
                      if (lane) {
                        setSelectedFacilityId(lane.fromFacilityId);
                        setSelectedLaneId(laneId);
                        navigateToPage("hub");
                      }
                    }}
                  />
                  <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMapViewMode("map")}
                      className="rounded-lg border border-emerald-500/40 bg-slate-950/90 hover:bg-slate-900 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-lg cursor-pointer"
                    >
                      Map View
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimulatorOpen(true)}
                      className="rounded-lg border border-sky-500/40 bg-slate-950/90 hover:bg-slate-900 px-3 py-1.5 text-xs font-medium text-sky-300 shadow-lg cursor-pointer"
                    >
                      What-If Simulator
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PAGE 3: Executive Dashboard */}
          {activePage === "dashboard" && (
            <ExecutiveDashboardPage
              analytics={analytics}
              loading={loadingAnalytics}
              organization={session.organization}
              facilities={network.facilities}
              activeProductId={activeProductId}
              activeInputId={activeInputId}
              financialViewMode={financialViewMode}
              activeRedDisruptions={unreadRedCount}
              activeAmberDisruptions={unreadAmberCount}
              onSelectFacility={(facilityId) => {
                setSelectedFacilityId(facilityId);
                navigateToPage("hub");
              }}
              onOpenSimulator={() => setSimulatorOpen(true)}
              onOpenDirectory={(cap) => {
                setDirectoryInitialCapability(cap ?? "");
                setDirectoryOpen(true);
              }}
              onOpenImportExport={() => setImportExportOpen(true)}
              onOpenSettings={() => navigateToPage("settings")}
            />
          )}

          {/* PAGE 4: User & Organization Settings */}
          {activePage === "settings" && (
            <SettingsPage
              currentUser={session.user}
              organization={session.organization}
              onUpdated={(updatedOrg) => {
                setSession((prev) =>
                  prev ? { ...prev, organization: updatedOrg } : prev,
                );
              }}
            />
          )}

          {/* Live Alerts Slide-Over Drawer (triggered by TopContextBar Alert Bell) */}
          {alertsDrawerOpen && (
            <aside
              aria-label="Live disruption alerts"
              className="absolute top-0 right-0 bottom-0 w-full max-w-md z-30 border-l border-slate-800 bg-slate-950/98 shadow-2xl flex flex-col"
            >
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Live Disruption Alerts
                </span>
                <button
                  type="button"
                  aria-label="Close live alerts"
                  onClick={() => setAlertsDrawerOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <LiveAlertsPanel
                  feed={alertFeed}
                  loading={loadingAlerts}
                  sweeping={sweepingAlerts}
                  userRole={session.user.role}
                  facilities={network.facilities}
                  lanes={network.lanes}
                  onAcknowledge={handleAcknowledgeAlert}
                  onTriggerSweep={handleTriggerAlertSweep}
                  onOpenSettings={() => {
                    setAlertsDrawerOpen(false);
                    navigateToPage("settings");
                  }}
                  onSelectFacility={(facilityId) => {
                    setAlertsDrawerOpen(false);
                    setSelectedFacilityId(facilityId);
                    navigateToPage("hub");
                  }}
                  onSelectLane={(laneId) => {
                    const lane = network.lanes.find((l) => l.laneId === laneId);
                    setAlertsDrawerOpen(false);
                    if (lane) {
                      setSelectedFacilityId(lane.fromFacilityId);
                      setSelectedLaneId(laneId);
                      navigateToPage("hub");
                    }
                  }}
                />
              </div>
            </aside>
          )}
        </main>
      </div>

      {/* Global Drawers & Modals */}
      <WhatIfSimulatorDrawer
        open={simulatorOpen}
        lanes={filtered.lanes}
        facilities={network.facilities}
        inputs={network.inputs}
        activeProductId={activeProductId}
        activeInputId={activeInputId}
        financialViewMode={financialViewMode}
        onClose={() => setSimulatorOpen(false)}
      />

      <AcceptInviteModal
        open={acceptInviteOpen && session.user.role === "OWNER"}
        initialToken={pendingInviteToken}
        organization={session.organization}
        onClose={() => {
          setAcceptInviteOpen(false);
          setPendingInviteToken("");
          clearInviteQueryParam();
        }}
        onAccepted={(result) => {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  organization: {
                    ...prev.organization,
                    openToNewBuyers: result.organization.openToNewBuyers,
                    capabilities: result.organization.capabilities,
                  },
                }
              : prev,
          );
          setPendingInviteToken("");
          clearInviteQueryParam();
          void loadWorkspaceNetwork(false);
        }}
      />

      <AlternativeDirectoryModal
        open={directoryOpen}
        initialCapability={directoryInitialCapability}
        onClose={() => setDirectoryOpen(false)}
      />

      <ImportExportModal
        open={importExportOpen}
        organization={session.organization}
        activeProductId={activeProductId}
        activeInputId={activeInputId}
        onClose={() => setImportExportOpen(false)}
        onImported={() => {
          void loadWorkspaceNetwork(true);
        }}
      />
    </div>
    </PendingContractSavesProvider>
  );
}
