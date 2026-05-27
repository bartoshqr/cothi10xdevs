import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import type { DefaultEdgeOptions, EdgeTypes, NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import StatementNode from "./StatementNode";
import ConnectiveNode from "./ConnectiveNode";
import RelationEdge from "./RelationEdge";
import { initialNodes, initialEdges } from "./demoData";

const nodeTypes: NodeTypes = {
  statement: StatementNode,
  connective: ConnectiveNode,
};

const edgeTypes: EdgeTypes = {
  relation: RelationEdge,
};

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: "relation",
  markerEnd: { type: MarkerType.ArrowClosed },
};

function MapSpikeCanvasInner() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function MapSpikeCanvas() {
  return (
    <ReactFlowProvider>
      <MapSpikeCanvasInner />
    </ReactFlowProvider>
  );
}
