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
let liveScreenCursor = { x: 0, y: 0 };

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
  const [kindPickerPosition, setKindPickerPosition] = useState<{ x: number; y: number } | undefined>(undefined);

  const closeAllMenus = useCallback(() => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
  }, []);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    stagePendingConnection,
    pendingConnection,
    cancelConnection,
    deleteNodes,
    createStatementNode,
    setRootNode,
    addPendingPreview,
    inEditNodeId,
    inEditEdgeId,
    setInEditEdgeId,
    isInEditBlocked,
    tryExitNodeEdit,
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
      createStatementNode: s.createStatementNode,
      setRootNode: s.setRootNode,
      addPendingPreview: s.addPendingPreview,
      inEditNodeId: s.inEditNodeId,
      inEditEdgeId: s.inEditEdgeId,
      setInEditEdgeId: s.setInEditEdgeId,
      isInEditBlocked: s.isInEditBlocked,
      tryExitNodeEdit: s.tryExitNodeEdit,
    })),
  );

  const closeConnectionPicker = useCallback(() => {
    setInEditEdgeId(null);
    cancelConnection();
    setKindPickerPosition(undefined);
  }, [setInEditEdgeId, cancelConnection]);

  const cleanupFlow = useCallback(() => {
    closeAllMenus();
    closeConnectionPicker();
    tryExitNodeEdit();
  }, [closeAllMenus, tryExitNodeEdit, closeConnectionPicker]);

  const handleNodeClick: NodeMouseHandler<DebateNode> = useCallback(
    (_e, node) => {
      closeAllMenus();
      closeConnectionPicker();
      if (node.id !== inEditNodeId) tryExitNodeEdit();
    },
    [closeAllMenus, closeConnectionPicker, tryExitNodeEdit, inEditNodeId],
  );

  useEffect(() => {
    if (nodes.length === 0) {
      const id = createStatementNode("claim", { x: 0, y: 0 });
      setRootNode(id);
    }
  }, [nodes.length, createStatementNode, setRootNode]);

  const { screenToFlowPosition } = useReactFlow();

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      liveScreenCursor = { x: e.clientX, y: e.clientY };
      liveFlowCursor = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    },
    [screenToFlowPosition],
  );

  // connection
  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (isInEditBlocked()) return;

      const existingEdge = edges.find((e) => e.source === connection.source && e.target === connection.target);
      if (existingEdge) {
        setKindPickerPosition(liveScreenCursor);
        setInEditEdgeId(existingEdge.id);
        return;
      }
      stagePendingConnection(connection);
    },
    [edges, stagePendingConnection, isInEditBlocked, setInEditEdgeId],
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (e) => {
      if (isInEditBlocked()) {
        cancelConnection();
        return;
      }

      // Read the CURRENT state from the store, not the closure
      if (!useStore.getState().pendingConnection) return;
      const point = "changedTouches" in e ? e.changedTouches[0] : e;
      const screenPos = { x: point.clientX, y: point.clientY };
      setKindPickerPosition(screenPos);
      const flowPos = screenToFlowPosition(screenPos);
      addPendingPreview(flowPos.x, flowPos.y);
    },
    [screenToFlowPosition, addPendingPreview, cancelConnection, isInEditBlocked],
  );

  const showKindPicker = kindPickerPosition !== undefined && (pendingConnection !== null || inEditEdgeId !== null);

  // context menus
  const handlePaneContextMenu = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      e.preventDefault();
      cleanupFlow();
      if (isInEditBlocked()) return;
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [cleanupFlow, isInEditBlocked],
  );

  const handleNodeContextMenu: NodeMouseHandler<DebateNode> = useCallback(
    (e, node) => {
      e.preventDefault();
      cleanupFlow();
      if (isInEditBlocked()) return;
      setNodeContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
    },
    [cleanupFlow, isInEditBlocked],
  );

  const handleEdgeContextMenu: EdgeMouseHandler = useCallback(
    (e, edge) => {
      e.preventDefault();
      cleanupFlow();
      if (isInEditBlocked()) return;
      setEdgeContextMenu({ edgeId: edge.id, x: e.clientX, y: e.clientY });
    },
    [cleanupFlow, isInEditBlocked],
  );

  const handleNodesDelete = useCallback(
    (deleted: DebateNode[]) => {
      deleteNodes(deleted.map((n) => n.id));
    },
    [deleteNodes],
  );

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
        onNodesDelete={handleNodesDelete}
        onEdgeClick={cleanupFlow}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={cleanupFlow}
        onPaneContextMenu={handlePaneContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        isValidConnection={isValidConnection}
        connectionLineComponent={FloatingConnectionLine}
        onMouseMove={handleMouseMove}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={inEditNodeId ? null : "Delete"}
      >
        <Background />
        <Controls />
        <MapLegend />
      </ReactFlow>

      {showKindPicker && (
        <ConnectKindPicker
          edgeId={inEditEdgeId ?? undefined}
          position={kindPickerPosition}
          onClose={() => {
            setInEditEdgeId(null);
            setKindPickerPosition(undefined);
            if (!inEditEdgeId) cancelConnection();
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
            setInEditEdgeId(edgeContextMenu.edgeId);
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
