import { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  getBezierPath,
  Position,
  useReactFlow,
} from "@xyflow/react";
import type {
  DefaultEdgeOptions,
  EdgeTypes,
  NodeTypes,
  IsValidConnection,
  NodeMouseHandler,
  EdgeMouseHandler,
  OnConnectEnd,
  OnConnect,
  ConnectionLineComponentProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import StatementNode from "./nodes/StatementNode";
import ConnectiveNode from "./nodes/ConnectiveNode";
import RelationEdge from "./edges/RelationEdge";
import MapLegend from "./MapLegend";
import AddNodeMenu from "./AddNodeMenu";
import NodeContextMenu from "./NodeContextMenu";
import EdgeContextMenu from "./EdgeContextMenu";
import ConnectKindPicker from "./ConnectKindPicker";
import { useStore, useShallow } from "./store";
import type { DebateNode } from "./store";

let liveFlowCursor = { x: 0, y: 0 };

function FloatingConnectionLine({ fromX, fromY, fromPosition }: ConnectionLineComponentProps) {
  const dx = liveFlowCursor.x - fromX;
  const dy = liveFlowCursor.y - fromY;
  let targetPosition: Position;
  if (Math.abs(dx) > Math.abs(dy)) {
    targetPosition = dx > 0 ? Position.Left : Position.Right;
  } else {
    targetPosition = dy > 0 ? Position.Top : Position.Bottom;
  }
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: liveFlowCursor.x,
    targetY: liveFlowCursor.y,
    targetPosition,
  });
  return (
    <g>
      <path fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 3" d={path} />
    </g>
  );
}

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
  const [nodeContextMenu, setNodeContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [kindPickerPosition, setKindPickerPosition] = useState<{ x: number; y: number } | undefined>(undefined);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    stagePendingConnection,
    pendingConnection,
    cancelConnection,
    deleteNodes,
    selectNode,
    selectEdge,
    createStatementNode,
    setRootNode,
    addPendingPreview,
    addEdgeDirect,
    editingNodeId,
    setEditingNode,
  } = useStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      stagePendingConnection: s.stagePendingConnection,
      pendingConnection: s.pendingConnection,
      cancelConnection: s.cancelConnection,
      deleteNodes: s.deleteNodes,
      selectNode: s.selectNode,
      selectEdge: s.selectEdge,
      createStatementNode: s.createStatementNode,
      setRootNode: s.setRootNode,
      addPendingPreview: s.addPendingPreview,
      addEdgeDirect: s.addEdgeDirect,
      editingNodeId: s.editingNodeId,
      setEditingNode: s.setEditingNode,
    })),
  );

  const { screenToFlowPosition } = useReactFlow();

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (targetNode?.type === "connective") {
        addEdgeDirect(connection, "link");
      } else {
        stagePendingConnection(connection);
      }
    },
    [nodes, stagePendingConnection, addEdgeDirect],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      liveFlowCursor = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    },
    [screenToFlowPosition],
  );

  useEffect(() => {
    if (nodes.length === 0) {
      const id = createStatementNode("claim", { x: 0, y: 0 });
      setRootNode(id);
    }
  }, [nodes.length, createStatementNode, setRootNode]);

  const closeAllMenus = useCallback(() => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
  }, []);

  const tryExitEditing = useCallback(() => {
    if (editingNodeId) {
      const editingNode = nodes.find((n) => n.id === editingNodeId);
      if (editingNode?.type === "statement" && editingNode.data.role === "source" && !editingNode.data.url) return;
    }
    setEditingNode(null);
  }, [editingNodeId, nodes, setEditingNode]);

  const handlePaneContextMenu = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      e.preventDefault();
      closeAllMenus();
      tryExitEditing();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [closeAllMenus, tryExitEditing],
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (e) => {
      const point = "changedTouches" in e ? e.changedTouches[0] : e;
      const screenPos = { x: point.clientX, y: point.clientY };
      setKindPickerPosition(screenPos);
      const flowPos = screenToFlowPosition(screenPos);
      addPendingPreview(flowPos.x, flowPos.y);
    },
    [screenToFlowPosition, addPendingPreview],
  );

  const handlePaneClick = useCallback(() => {
    closeAllMenus();
    setEditingEdgeId(null);
    cancelConnection();
    setKindPickerPosition(undefined);
    selectNode(null);
    selectEdge(null);
    tryExitEditing();
  }, [closeAllMenus, selectNode, selectEdge, cancelConnection, tryExitEditing]);

  const handleNodeClick: NodeMouseHandler<DebateNode> = useCallback(
    (_e, _node) => {
      closeAllMenus();
      setEditingEdgeId(null);
      cancelConnection();
      tryExitEditing();
      selectNode(null);
    },
    [closeAllMenus, selectNode, cancelConnection, tryExitEditing],
  );

  const handleNodeContextMenu: NodeMouseHandler<DebateNode> = useCallback(
    (e, node) => {
      e.preventDefault();
      closeAllMenus();
      setEditingEdgeId(null);
      tryExitEditing();
      selectNode(null);
      setNodeContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
    },
    [closeAllMenus, selectNode, tryExitEditing],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_e, edge) => {
      closeAllMenus();
      setEditingEdgeId(null);
      selectNode(null);
      selectEdge(edge.id);
      tryExitEditing();
    },
    [closeAllMenus, selectNode, selectEdge, tryExitEditing],
  );

  const handleEdgeContextMenu: EdgeMouseHandler = useCallback(
    (e, edge) => {
      e.preventDefault();
      closeAllMenus();
      setEditingEdgeId(null);
      selectEdge(edge.id);
      setEdgeContextMenu({ edgeId: edge.id, x: e.clientX, y: e.clientY });
    },
    [closeAllMenus, selectEdge],
  );

  const handleNodesDelete = useCallback(
    (deleted: DebateNode[]) => {
      deleteNodes(deleted.map((n) => n.id));
    },
    [deleteNodes],
  );

  const showKindPicker = pendingConnection !== null || editingEdgeId !== null;

  const pickerTargetNodeType = (() => {
    if (editingEdgeId) {
      const edge = edges.find((e) => e.id === editingEdgeId);
      return edge ? nodes.find((n) => n.id === edge.target)?.type : undefined;
    }
    if (pendingConnection) {
      return nodes.find((n) => n.id === pendingConnection.target)?.type;
    }
    return undefined;
  })();

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeClick={handleEdgeClick}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodesDelete={handleNodesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        isValidConnection={isValidConnection}
        connectionLineComponent={FloatingConnectionLine}
        onMouseMove={handleMouseMove}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={editingNodeId ? null : "Delete"}
      >
        <Background />
        <Controls />
        <MapLegend />
      </ReactFlow>

      {showKindPicker && (
        <ConnectKindPicker
          edgeId={editingEdgeId ?? undefined}
          position={kindPickerPosition}
          targetNodeType={pickerTargetNodeType}
          onClose={() => {
            setEditingEdgeId(null);
            setKindPickerPosition(undefined);
            if (!editingEdgeId) cancelConnection();
          }}
        />
      )}

      {contextMenu && (
        <AddNodeMenu
          screenX={contextMenu.x}
          screenY={contextMenu.y}
          onClose={() => {
            setContextMenu(null);
          }}
        />
      )}

      {nodeContextMenu && (
        <NodeContextMenu
          nodeId={nodeContextMenu.nodeId}
          screenX={nodeContextMenu.x}
          screenY={nodeContextMenu.y}
          onClose={() => {
            setNodeContextMenu(null);
          }}
        />
      )}

      {edgeContextMenu && (
        <EdgeContextMenu
          edgeId={edgeContextMenu.edgeId}
          screenX={edgeContextMenu.x}
          screenY={edgeContextMenu.y}
          onClose={() => {
            setEdgeContextMenu(null);
          }}
          onEdit={() => {
            setKindPickerPosition({ x: edgeContextMenu.x, y: edgeContextMenu.y });
            setEditingEdgeId(edgeContextMenu.edgeId);
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
