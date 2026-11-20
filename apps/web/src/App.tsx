import type {
  AuthMeResponse,
  CreateFacilityInput,
  CreateProductInput,
  CreateSupplyInputInput,
  CreateSupplyLaneInput,
  UpdateFacilityInput,
  UpdateSupplyLaneInput,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";
import { AlertCircle, Globe2, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthView } from "./components/AuthView.js";
import {
  FilterBar,
  type MapInteractionMode,
} from "./components/FilterBar.js";
import { SupplyMap } from "./components/SupplyMap.js";
import {
  WorkspaceSidebar,
  type SidebarTab,
} from "./components/WorkspaceSidebar.js";
import {
  ApiError,
  createFacility,
  createLane,
  createProduct,
  createSupplyInput,
  deleteFacility,
  deleteLane,
  deleteProduct,
  deleteSupplyInput,
  getMe,
  getNetwork,
  logout,
  seedDemo,
  updateFacility,
  updateLane,
} from "./lib/api.js";
import { filterWorkspaceNetwork } from "./lib/workspace-utils.js";

const EMPTY_NETWORK: WorkspaceNetworkResponse = {
  products: [],
  inputs: [],
  facilities: [],
  lanes: [],
};

export function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [session, setSession] = useState<AuthMeResponse | null>(null);
  const [network, setNetwork] =
    useState<WorkspaceNetworkResponse>(EMPTY_NETWORK);
  const [loadingNetwork, setLoadingNetwork] = useState(false);

  // Filter & selection state
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
    null,
  );
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("overview");
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
      const data = await getNetwork();
      setNetwork(data);
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
      }));
      if (activeInputId === inputId) {
        setActiveInputId(null);
      }
    });

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
        organization={session.organization}
        products={network.products}
        inputs={filtered.inputs}
        activeProductId={activeProductId}
        activeInputId={activeInputId}
        stats={filtered.stats}
        mapMode={mapMode}
        seedingDemo={seedingDemo}
        loggingOut={loggingOut}
        onSelectProduct={handleSelectProduct}
        onSelectInput={setActiveInputId}
        onSeedDemo={handleSeedDemo}
        onToggleAddFacility={() => {
          if (mapMode === "pick-new-facility") {
            setMapMode("inspect");
          } else {
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
        <SupplyMap
          facilities={filtered.facilities}
          lanes={filtered.lanes}
          inputs={network.inputs}
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
        />

        {loadingNetwork && (
          <div className="pointer-events-none absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-xs text-slate-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            <span>Syncing network...</span>
          </div>
        )}

        <WorkspaceSidebar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          products={network.products}
          inputs={network.inputs}
          facilities={network.facilities}
          visibleLanes={filtered.lanes}
          stats={filtered.stats}
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
          onStartPickNewFacility={() => {
            setMapMode("pick-new-facility");
          }}
          onStartRefineFacilityOnMap={(facilityId) => {
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
        />
      </div>
    </div>
  );
}
