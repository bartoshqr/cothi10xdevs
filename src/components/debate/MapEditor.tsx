import { useState, useCallback } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType } from "@xyflow/react";
import type {
  DefaultEdgeOptions,
  EdgeTypes,
  NodeTypes,
  IsValidConnection,
  NodeMouseHandler,
  EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import StatementNode from "./nodes/StatementNode";
import ConnectiveNode from "./nodes/ConnectiveNode";
import RelationEdge from "./edges/RelationEdge";
import MapLegend from "./MapLegend";
import AddNodeMenu from "./AddNodeMenu";
import ConnectKindPicker from "./ConnectKindPicker";
import DetailPanel from "./DetailPanel";
import { useStore, useShallow } from "./store";
import type { DebateNode } from "./store";

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

const isValidConnection: IsValidConnection = (connection) => {
  return connection.source !== connection.target;
};

function MapEditorInner() {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    pendingConnection,
    cancelConnection,
    deleteNodes,
    selectNode,
    selectEdge,
  } = useStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      onConnect: s.onConnect,
      pendingConnection: s.pendingConnection,
      cancelConnection: s.cancelConnection,
      deleteNodes: s.deleteNodes,
      selectNode: s.selectNode,
      selectEdge: s.selectEdge,
    })),
  );

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    setEditingEdgeId(null);
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const handleNodeClick: NodeMouseHandler<DebateNode> = useCallback(
    (_e, node) => {
      setContextMenu(null);
      setEditingEdgeId(null);
      selectNode(node.id);
    },
    [selectNode],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_e, edge) => {
      setContextMenu(null);
      selectNode(null);
      selectEdge(edge.id);
      setEditingEdgeId(edge.id);
    },
    [selectNode, selectEdge],
  );

  const handleNodesDelete = useCallback(
    (deleted: DebateNode[]) => {
      deleteNodes(deleted.map((n) => n.id));
    },
    [deleteNodes],
  );

  const showKindPicker = pendingConnection !== null || editingEdgeId !== null;

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodesDelete={handleNodesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        isValidConnection={isValidConnection}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode="Delete"
      >
        <Background />
        <Controls />
        <MapLegend />
        <DetailPanel />
        {showKindPicker && (
          <ConnectKindPicker
            edgeId={editingEdgeId ?? undefined}
            onClose={() => {
              setEditingEdgeId(null);
              if (!editingEdgeId) cancelConnection();
            }}
          />
        )}
      </ReactFlow>

      {contextMenu && (
        <AddNodeMenu
          screenX={contextMenu.x}
          screenY={contextMenu.y}
          onClose={() => {
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}

export default function MapEditor() {
  return (
    <ReactFlowProvider>
      <MapEditorInner />
    </ReactFlowProvider>
  );
}
