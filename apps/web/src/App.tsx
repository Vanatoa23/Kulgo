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
import { AuthView } from "./components/AuthView.js";
import {
  FilterBar,
  type MapInteractionMode,
  type WorkspaceViewMode,
} from "./components/FilterBar.js";
import { ImportExportModal } from "./components/ImportExportModal.js";
import { LogicalGraphView } from "./components/LogicalGraphView.js";
import { OrgSettingsModal } from "./components/OrgSettingsModal.js";
import { SupplyMap } from "./components/SupplyMap.js";
import { WhatIfSimulatorDrawer } from "./components/WhatIfSimulatorDrawer.js";
import {
  WorkspaceSidebar,
  type SidebarTab,
} from "./components/WorkspaceSidebar.js";
import {
  ApiError,
  acknowledgeAlert,
  createFacility,
  createInvite,
  createLane,
  createProduct,
  createSupplyInput,
  deleteFacility,
  deleteLane,
  deleteProduct,
  deleteSupplyInput,
  getAlertFeed,
  getAnalyticsSummary,
  getMe,
  getNetwork,
  listInvites,
  logout,
  revokeInvite,
  seedDemo,
  triggerAlertSweep,
  updateFacility,
  updateLane,
  type LiveAlertFeedResponse,
} from "./lib/api.js";
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

export function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [session, setSession] = useState<AuthMeResponse | null>(null);
  const [network, setNetwork] =
    useState<WorkspaceNetworkResponse>(EMPTY_NETWORK);
  const [loadingNetwork, setLoadingNetwork] = useState(false);

  // M2 Analytics & View Mode state
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>("map");
  const [financialViewMode, setFinancialViewMode] = useState<
    "RUN_RATE" | "PERIOD_WINDOW"
  >("PERIOD_WINDOW");
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // Sub-Project 1 Live Disruption Alerts state
  const [alertFeed, setAlertFeed] = useState<LiveAlertFeedResponse | null>(null);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [sweepingAlerts, setSweepingAlerts] = useState(false);

  // M3 Partner Invites & Alternative Directory state
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

  // M4 Org ESG Settings & Import/Export modal state
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);

  // Filter & selection state
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
    null,
  );
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("analytics");
  const [mapMode, setMapMode] = useState<MapInteractionMode>("inspect");
  const [refiningFacilityId, setRefiningFacilityId] = useState<string | null>(
    null,
  );
  const [pickedCoords, setPickedCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);

  // Action states
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const loadWorkspaceNetwork = useCallback(async (shouldFit: boolean) => {
    setLoadingNetwork(true);
    try {
      const [data, invites] = await Promise.all([
        getNetwork(),
        listInvites().catch(() => [] as Invitation[]),
      ]);
      setNetwork(data);
      setInvitations(invites);
      if (shouldFit && data.facilities.length > 0) {
        setFitTrigger((n) => n + 1);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
      } else {
        setBannerError(
          err instanceof Error
            ? err.message
            : "Failed to load supply network.",
        );
      }
    } finally {
      setLoadingNetwork(false);
    }
  }, []);

  // Session bootstrap via /api/v1/auth/me
  useEffect(() => {
    let active = true;
    getMe()
      .then((me) => {
        if (!active) return;
        setSession(me);
        void loadWorkspaceNetwork(true);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
      })
      .finally(() => {
        if (active) setBootstrapping(false);
      });

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

  // Sync live Risk & ESG analytics whenever session, network, or active filters change
  useEffect(() => {
    if (!session) {
      setAnalytics(null);
      return;
    }

    let cancelled = false;
    setLoadingAnalytics(true);
    getAnalyticsSummary({
      productId: activeProductId ?? undefined,
      inputId: activeInputId ?? undefined,
      viewMode: financialViewMode,
    })
      .then((summary) => {
        if (!cancelled) {
          setAnalytics(summary);
        }
      })
      .catch((err) => {
        if (!cancelled && err instanceof ApiError && err.status === 401) {
          setSession(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAnalytics(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session, network, activeProductId, activeInputId, financialViewMode]);

  const refreshAlertFeed = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const feed = await getAlertFeed();
      setAlertFeed(feed);
    } catch {
      // Non-fatal; keep existing feed state
    } finally {
      setLoadingAlerts(false);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setAlertFeed(null);
      return;
    }
    void refreshAlertFeed();
  }, [session, network, refreshAlertFeed]);

  const handleAcknowledgeAlert = useCallback(
    async (signalId: string, status: "ACKNOWLEDGED" | "MUTED") => {
      await acknowledgeAlert(signalId, { status });
      await refreshAlertFeed();
    },
    [refreshAlertFeed],
  );

  const handleTriggerAlertSweep = useCallback(async () => {
    setSweepingAlerts(true);
    try {
      await triggerAlertSweep();
      await Promise.all([loadWorkspaceNetwork(false), refreshAlertFeed()]);
    } finally {
      setSweepingAlerts(false);
    }
  }, [loadWorkspaceNetwork, refreshAlertFeed]);

  const handleAuthenticated = (me: AuthMeResponse) => {
    setSession(me);
    setBannerError(null);
    void loadWorkspaceNetwork(true);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Clear local session regardless of network hiccup
    } finally {
      setLoggingOut(false);
      setSession(null);
      setNetwork(EMPTY_NETWORK);
      setAnalytics(null);
      setSimulatorOpen(false);
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
    setSeedingDemo(true);
    setBannerError(null);
    try {
      const seeded = await seedDemo();
      setNetwork(seeded);
      setActiveProductId(null);
      setActiveInputId(null);
      setSelectedFacilityId(null);
      setSelectedLaneId(null);
      setActiveTab("overview");
      setMapMode("inspect");
      setFitTrigger((n) => n + 1);
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : "Failed to load demo scenario.",
      );
    } finally {
      setSeedingDemo(false);
    }
  };

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setBannerError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return;
      }
      setBannerError(
        err instanceof Error ? err.message : "Action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFacility = (input: CreateFacilityInput) =>
    runMutation(async () => {
      const created = await createFacility(input);
      setNetwork((prev) => ({
        ...prev,
        facilities: [...prev.facilities, created],
      }));
      setSelectedFacilityId(created.facilityId);
      setMapMode("inspect");
      setPickedCoords(null);
    });

  const handleUpdateFacility = (
    facilityId: string,
    input: UpdateFacilityInput,
  ) =>
    runMutation(async () => {
      const updated = await updateFacility(facilityId, input);
      setNetwork((prev) => ({
        ...prev,
        facilities: prev.facilities.map((f) =>
          f.facilityId === facilityId ? updated : f,
        ),
      }));
      if (input.lat !== undefined || input.lng !== undefined) {
        const refreshed = await getNetwork();
        setNetwork(refreshed);
      }
      if (refiningFacilityId === facilityId) {
        setRefiningFacilityId(null);
      }
      setMapMode("inspect");
      setPickedCoords(null);
    });

  const handleDeleteFacility = (facilityId: string) =>
    runMutation(async () => {
      await deleteFacility(facilityId);
      setNetwork((prev) => ({
        ...prev,
        facilities: prev.facilities.filter((f) => f.facilityId !== facilityId),
        lanes: prev.lanes.filter(
          (l) =>
            l.fromFacilityId !== facilityId && l.toFacilityId !== facilityId,
        ),
      }));
      if (selectedFacilityId === facilityId) {
        setSelectedFacilityId(null);
      }
    });

  const handleCreateLane = (input: CreateSupplyLaneInput) =>
    runMutation(async () => {
      const created = await createLane(input);
      setNetwork((prev) => ({
        ...prev,
        lanes: [...prev.lanes, created],
      }));
      setSelectedLaneId(created.laneId);
    });

  const handleUpdateLane = (laneId: string, input: UpdateSupplyLaneInput) =>
    runMutation(async () => {
      const updated = await updateLane(laneId, input);
      setNetwork((prev) => ({
        ...prev,
        lanes: prev.lanes.map((l) => (l.laneId === laneId ? updated : l)),
      }));
    });

  const handleDeleteLane = (laneId: string) =>
    runMutation(async () => {
      await deleteLane(laneId);
      setNetwork((prev) => ({
        ...prev,
        lanes: prev.lanes.filter((l) => l.laneId !== laneId),
      }));
      if (selectedLaneId === laneId) {
        setSelectedLaneId(null);
      }
    });

  const handleCreateProduct = (input: CreateProductInput) =>
    runMutation(async () => {
      const created = await createProduct(input);
      setNetwork((prev) => ({
        ...prev,
        products: [...prev.products, created],
      }));
    });

  const handleDeleteProduct = (productId: string) =>
    runMutation(async () => {
      await deleteProduct(productId);
      setNetwork((prev) => ({
        ...prev,
        products: prev.products.filter((p) => p.productId !== productId),
        inputs: prev.inputs.map((i) =>
          i.productId === productId ? { ...i, productId: null } : i,
        ),
      }));
      if (activeProductId === productId) {
        setActiveProductId(null);
      }
    });

  const handleCreateSupplyInput = (input: CreateSupplyInputInput) =>
    runMutation(async () => {
      const created = await createSupplyInput(input);
      setNetwork((prev) => ({
        ...prev,
        inputs: [...prev.inputs, created],
      }));
    });

  const handleDeleteSupplyInput = (inputId: string) =>
    runMutation(async () => {
      await deleteSupplyInput(inputId);
      setNetwork((prev) => ({
        ...prev,
        inputs: prev.inputs.filter((i) => i.inputId !== inputId),
        lanes: prev.lanes.map((l) =>
          l.inputId === inputId ? { ...l, inputId: null } : l,
        ),
      }));
      if (activeInputId === inputId) {
        setActiveInputId(null);
      }
    });

  const handleCreateInvite = async (
    input: CreateInviteInput,
  ): Promise<CreateInviteResponse | null> => {
    setBusy(true);
    setBannerError(null);
    try {
      const result = await createInvite(input);
      setInvitations((prev) => [result.invitation, ...prev]);
      return result;
    } catch (err) {
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

  const handleRevokeInvite = (inviteId: string) =>
    runMutation(async () => {
      const result = await revokeInvite(inviteId);
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.inviteId === inviteId ? result.invitation : inv,
        ),
      );
    });

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

  const refiningFacilityName =
    network.facilities.find((f) => f.facilityId === refiningFacilityId)?.name ??
    null;

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      <FilterBar
        user={session.user}
        userRole={session.user.role}
        organization={session.organization}
        products={network.products}
        inputs={filtered.inputs}
        activeProductId={activeProductId}
        activeInputId={activeInputId}
        stats={filtered.stats}
        analytics={analytics}
        viewMode={viewMode}
        mapMode={mapMode}
        seedingDemo={seedingDemo}
        loggingOut={loggingOut}
        onChangeViewMode={(nextMode) => {
          setViewMode(nextMode);
          if (nextMode === "graph") {
            setMapMode("inspect");
          }
        }}
        onSelectProduct={handleSelectProduct}
        onSelectInput={setActiveInputId}
        onSeedDemo={handleSeedDemo}
        onToggleAddFacility={() => {
          if (mapMode === "pick-new-facility") {
            setMapMode("inspect");
          } else {
            setViewMode("map");
            setSelectedFacilityId(null);
            setActiveTab("facility");
            setMapMode("pick-new-facility");
          }
        }}
        onOpenAddLane={() => {
          setSelectedLaneId(null);
          setMapMode("inspect");
          setActiveTab("lane");
        }}
        onOpenAnalytics={() => {
          setActiveTab("analytics");
        }}
        onOpenSimulator={() => {
          setSimulatorOpen(true);
        }}
        onOpenDirectory={() => {
          setDirectoryInitialCapability("");
          setDirectoryOpen(true);
        }}
        onOpenAcceptInvite={() => {
          setAcceptInviteOpen(true);
        }}
        onOpenOrgSettings={() => {
          setOrgSettingsOpen(true);
        }}
        onOpenImportExport={() => {
          setImportExportOpen(true);
        }}
        onFitNetwork={() => setFitTrigger((n) => n + 1)}
        onFocusUnverifiedHq={() => {
          setMapMode("inspect");
          setActiveTab("overview");
        }}
        onLogout={handleLogout}
      />

      {bannerError && (
        <div
          role="alert"
          className="shrink-0 flex items-center justify-between gap-3 bg-red-950/90 border-b border-red-500/40 px-4 py-2 text-xs text-red-200"
        >
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            {bannerError}
          </span>
          <button
            type="button"
            onClick={() => setBannerError(null)}
            className="rounded p-0.5 hover:bg-red-500/20 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 relative">
        {viewMode === "map" ? (
          <SupplyMap
            facilities={filtered.facilities}
            lanes={filtered.lanes}
            inputs={network.inputs}
            riskSignals={network.riskSignals}
            selectedFacilityId={selectedFacilityId}
            selectedLaneId={selectedLaneId}
            mapMode={mapMode}
            refiningFacilityName={refiningFacilityName}
            fitTrigger={fitTrigger}
            onSelectFacility={(facilityId) => {
              setSelectedFacilityId(facilityId);
              setSelectedLaneId(null);
              setActiveTab("facility");
            }}
            onSelectLane={(laneId) => {
              setSelectedLaneId(laneId);
              setSelectedFacilityId(null);
              setActiveTab("lane");
            }}
            onMapPickCoordinates={(coords) => {
              setPickedCoords(coords);
              if (mapMode === "pick-new-facility") {
                setSelectedFacilityId(null);
                setActiveTab("facility");
              } else if (mapMode === "refine-site") {
                setActiveTab("overview");
              }
              setMapMode("inspect");
            }}
            onCancelMapMode={() => {
              setMapMode("inspect");
              setRefiningFacilityId(null);
            }}
            onAcknowledgeSignal={handleAcknowledgeAlert}
          />
        ) : (
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
              setSelectedLaneId(null);
              setActiveTab("facility");
            }}
            onSelectLane={(laneId) => {
              setSelectedLaneId(laneId);
              setSelectedFacilityId(null);
              setActiveTab("lane");
            }}
          />
        )}

        {loadingNetwork && (
          <div className="pointer-events-none absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-xs text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            <span>Syncing network...</span>
          </div>
        )}

        <WorkspaceSidebar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          userRole={session.user.role}
          organization={session.organization}
          products={network.products}
          inputs={network.inputs}
          facilities={network.facilities}
          visibleLanes={filtered.lanes}
          contracts={network.contracts ?? []}
          contractLines={network.contractLines ?? []}
          invitations={invitations}
          stats={filtered.stats}
          analytics={analytics}
          loadingAnalytics={loadingAnalytics}
          financialViewMode={financialViewMode}
          onChangeFinancialViewMode={setFinancialViewMode}
          onContractsChanged={() => loadWorkspaceNetwork(false)}
          selectedFacilityId={selectedFacilityId}
          selectedLaneId={selectedLaneId}
          pickedCoords={pickedCoords}
          mapMode={mapMode}
          refiningFacilityId={refiningFacilityId}
          busy={busy}
          onSelectFacility={(facilityId) => {
            setSelectedFacilityId(facilityId);
            setSelectedLaneId(null);
            setActiveTab("facility");
          }}
          onSelectLane={(laneId) => {
            setSelectedLaneId(laneId);
            setSelectedFacilityId(null);
            setActiveTab("lane");
          }}
          onOpenSimulator={() => setSimulatorOpen(true)}
          onOpenDirectory={(cap) => {
            setDirectoryInitialCapability(cap ?? "");
            setDirectoryOpen(true);
          }}
          onStartPickNewFacility={() => {
            setViewMode("map");
            setMapMode("pick-new-facility");
          }}
          onStartRefineFacilityOnMap={(facilityId) => {
            setViewMode("map");
            setRefiningFacilityId(facilityId);
            setMapMode("refine-site");
          }}
          onCreateFacility={handleCreateFacility}
          onUpdateFacility={handleUpdateFacility}
          onDeleteFacility={handleDeleteFacility}
          onCreateLane={handleCreateLane}
          onUpdateLane={handleUpdateLane}
          onDeleteLane={handleDeleteLane}
          onCreateProduct={handleCreateProduct}
          onDeleteProduct={handleDeleteProduct}
          onCreateSupplyInput={handleCreateSupplyInput}
          onDeleteSupplyInput={handleDeleteSupplyInput}
          onCreateInvite={handleCreateInvite}
          onRevokeInvite={handleRevokeInvite}
          alertFeed={alertFeed}
          loadingAlerts={loadingAlerts}
          sweepingAlerts={sweepingAlerts}
          onAcknowledgeAlert={handleAcknowledgeAlert}
          onTriggerAlertSweep={handleTriggerAlertSweep}
          onOpenOrgSettings={() => setOrgSettingsOpen(true)}
        />

        <WhatIfSimulatorDrawer
          open={simulatorOpen}
          lanes={filtered.lanes}
          facilities={network.facilities}
          inputs={network.inputs}
          activeProductId={activeProductId}
          activeInputId={activeInputId}
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

        <OrgSettingsModal
          open={orgSettingsOpen}
          currentUser={session.user}
          organization={session.organization}
          onClose={() => setOrgSettingsOpen(false)}
          onUpdated={(updatedOrg) => {
            setSession((prev) =>
              prev ? { ...prev, organization: updatedOrg } : prev,
            );
          }}
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
    </div>
  );
}
