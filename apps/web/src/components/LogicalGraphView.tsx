import type {
  Facility,
  Product,
  SupplyInput,
  SupplyLane,
} from "@kulgo/shared";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Factory, Layers, Network } from "lucide-react";
import { useMemo } from "react";
import {
  buildLogicalGraphModel,
  type LogicalGraphNodeModel,
} from "../lib/workspace-utils.js";

export interface LogicalGraphViewProps {
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  activeProductId: string | null;
  activeInputId: string | null;
  selectedFacilityId: string | null;
  selectedLaneId: string | null;
  onSelectProduct: (productId: string | null) => void;
  onSelectInput: (inputId: string | null) => void;
  onSelectFacility: (facilityId: string) => void;
  onSelectLane: (laneId: string) => void;
}

type KulgoFlowNodeData = LogicalGraphNodeModel & Record<string, unknown>;
type KulgoFlowNode = Node<KulgoFlowNodeData, "kulgoNode">;

function KulgoGraphNode({ data }: NodeProps<KulgoFlowNode>) {
  const isProduct = data.kind === "product";
  const isInput = data.kind === "input";
  const isOwn = Boolean(data.isOwnFacility);
  const isVerifiedPartner = Boolean(data.isPartnerVerified);

  const borderClass = data.isSelected
    ? "border-white ring-2 ring-emerald-400/70"
    : data.riskStatus === "RED"
      ? "border-red-500/60"
      : data.riskStatus === "YELLOW"
        ? "border-amber-500/50"
        : isVerifiedPartner
          ? "border-teal-400/70"
          : isOwn
            ? "border-emerald-500/60"
            : isProduct
              ? "border-indigo-500/50"
              : isInput
                ? "border-sky-500/45"
                : "border-slate-700";

  const iconBgClass = isProduct
    ? "bg-indigo-500/15 text-indigo-300"
    : isInput
      ? "bg-sky-500/15 text-sky-300"
      : isOwn
        ? "bg-emerald-500/15 text-emerald-300"
        : isVerifiedPartner
          ? "bg-teal-500/20 text-teal-300"
          : "bg-cyan-500/15 text-cyan-300";

  const badgeClass = data.isSpof
    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
    : isVerifiedPartner
      ? "bg-teal-500/20 text-teal-200 border-teal-400/50"
      : isOwn
        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
        : data.badge === "HQ_ESTIMATED"
          ? "bg-amber-500/15 text-amber-300 border-amber-500/35"
          : "bg-slate-800 text-slate-300 border-slate-700";

  const riskDotClass =
    data.riskStatus === "RED"
      ? "bg-red-500"
      : data.riskStatus === "YELLOW"
        ? "bg-amber-400"
        : "bg-emerald-400";

  return (
    <div
      className={`w-[245px] rounded-xl border bg-slate-950/95 px-3 py-2.5 shadow-xl transition-all cursor-pointer hover:border-slate-500 ${borderClass}`}
    >
      {!isProduct && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !bg-slate-400 !border-slate-950"
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${iconBgClass}`}
          >
            {isProduct ? (
              <Box className="h-3.5 w-3.5" />
            ) : isInput ? (
              <Layers className="h-3.5 w-3.5" />
            ) : (
              <Factory className="h-3.5 w-3.5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {data.label}
            </p>
            <p className="text-[10px] text-slate-400 truncate">
              {data.subtitle}
            </p>
          </div>
        </div>
        <span
          className={`h-2 w-2 rounded-full shrink-0 mt-1 ${riskDotClass}`}
          title={`Risk status: ${data.riskStatus}`}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {data.kind}
        </span>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${badgeClass}`}
        >
          {isVerifiedPartner ? "✓ Network-Verified" : data.badge}
        </span>
      </div>

      {!isOwn && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !bg-slate-400 !border-slate-950"
        />
      )}
    </div>
  );
}

const NODE_TYPES = {
  kulgoNode: KulgoGraphNode,
};

export function LogicalGraphView({
  products,
  inputs,
  facilities,
  lanes,
  activeProductId,
  activeInputId,
  selectedFacilityId,
  selectedLaneId,
  onSelectProduct,
  onSelectInput,
  onSelectFacility,
  onSelectLane,
}: LogicalGraphViewProps) {
  const model = useMemo(
    () =>
      buildLogicalGraphModel({
        products,
        inputs,
        facilities,
        lanes,
        activeProductId,
        activeInputId,
        selectedFacilityId,
        selectedLaneId,
      }),
    [
      products,
      inputs,
      facilities,
      lanes,
      activeProductId,
      activeInputId,
      selectedFacilityId,
      selectedLaneId,
    ],
  );

  const flowNodes: KulgoFlowNode[] = useMemo(
    () =>
      model.nodes.map((n) => ({
        id: n.id,
        type: "kulgoNode",
        position: n.position,
        data: { ...n },
      })),
    [model.nodes],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      model.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || undefined,
        animated: e.animated,
        data: { laneId: e.laneId },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: e.isSelected ? "#ffffff" : e.color,
          width: 16,
          height: 16,
        },
        style: {
          stroke: e.isSelected ? "#ffffff" : e.color,
          strokeWidth: e.isSelected ? 3.5 : e.kind === "bom" ? 1.5 : 2.5,
          strokeDasharray: e.kind === "bom" ? "4 4" : undefined,
        },
        labelStyle: {
          fill: "#e2e8f0",
          fontSize: 10,
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: "#020617",
          fillOpacity: 0.88,
        },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      })),
    [model.edges],
  );

  if (flowNodes.length === 0) {
    return (
      <div className="relative flex-1 min-h-0 bg-slate-950 flex flex-col items-center justify-center text-center p-8">
        <div className="h-12 w-12 rounded-2xl border border-slate-800 bg-slate-900 flex items-center justify-center text-slate-400 mb-3">
          <Network className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-white">
          No supply graph nodes visible
        </h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          Load the Estonia Product X demo or add Products, Materials, and
          Facilities to inspect the logical supply topology.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 bg-slate-950 overflow-hidden">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => {
          const nodeData = node.data as KulgoFlowNodeData;
          if (nodeData.kind === "facility") {
            onSelectFacility(nodeData.entityId);
          } else if (nodeData.kind === "input") {
            onSelectInput(
              activeInputId === nodeData.entityId ? null : nodeData.entityId,
            );
          } else if (nodeData.kind === "product") {
            onSelectProduct(
              activeProductId === nodeData.entityId ? null : nodeData.entityId,
            );
          }
        }}
        onEdgeClick={(_event, edge) => {
          const laneId = (edge.data as { laneId?: string | null } | undefined)
            ?.laneId;
          if (laneId) {
            onSelectLane(laneId);
          }
        }}
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls className="!bg-slate-900 !border-slate-800 !text-slate-200" />
        <MiniMap
          nodeColor={(node) => {
            const d = node.data as KulgoFlowNodeData | undefined;
            if (d?.riskStatus === "RED") return "#ef4444";
            if (d?.riskStatus === "YELLOW") return "#f59e0b";
            if (d?.kind === "product") return "#6366f1";
            if (d?.kind === "input") return "#38bdf8";
            return "#10b981";
          }}
          maskColor="rgba(2, 6, 23, 0.72)"
          className="!bg-slate-950 !border !border-slate-800"
        />
      </ReactFlow>

      {/* Column Flow Header Legend */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 rounded-xl border border-slate-800/90 bg-slate-950/90 backdrop-blur-md px-3 py-1.5 text-[11px] text-slate-300 shadow-lg">
        <span className="text-indigo-300 font-medium">Products</span>
        <span className="text-slate-600">→</span>
        <span className="text-sky-300 font-medium">Materials (A–F)</span>
        <span className="text-slate-600">→</span>
        <span className="text-cyan-300 font-medium">Tier-1 Suppliers</span>
        <span className="text-slate-600">→</span>
        <span className="text-emerald-300 font-medium">Own HQ</span>
      </div>

      {/* Edge Risk Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-slate-800/90 bg-slate-950/90 backdrop-blur-md px-3.5 py-2 text-[11px] text-slate-300 flex items-center gap-3 shadow-lg">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-emerald-500" />
          Green Lane
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-amber-500" />
          Yellow Risk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-red-500" />
          Red Risk
        </span>
        <span className="text-slate-500 hidden sm:inline">
          · Click nodes or edges to filter &amp; inspect
        </span>
      </div>
    </div>
  );
}
