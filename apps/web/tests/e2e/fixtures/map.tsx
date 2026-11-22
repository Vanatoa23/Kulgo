import { Map } from "maplibre-gl";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SupplyMap } from "../../../src/components/SupplyMap";
import "../../../src/index.css";

declare global {
  interface Window { testMap: Map }
}

// Observe the component's map without adding a test hook to production code.
const addControl = Map.prototype.addControl;
Map.prototype.addControl = function (...args) {
  window.testMap = this;
  return addControl.apply(this, args);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ display: "flex", height: "100vh" }}>
      <SupplyMap
        facilities={[]} lanes={[]} inputs={[]}
        selectedFacilityId={null} selectedLaneId={null}
        mapMode="inspect" refiningFacilityName={null} fitTrigger={0}
        onSelectFacility={() => {}} onSelectLane={() => {}}
        onMapPickCoordinates={() => {}} onCancelMapMode={() => {}}
      />
    </div>
  </StrictMode>,
);
