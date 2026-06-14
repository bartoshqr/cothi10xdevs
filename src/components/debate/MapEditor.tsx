import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
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
import { useStore, useShallow, reconcileFromServer, canWriteContentNow } from "./store";
import type { DebateNode, DebateEdge, ViewerContext, RFState } from "./store";
import type { DebateGraph } from "@/lib/debate/repository";
import { ownGraphIssues } from "./connectivityGraph";
import type { MarkState } from "./mapVisualLanguage";

// Cross-island contract for the "Submit turn" button, which lives in the page
// header (a separate hydration root that cannot read this store). MapEditor pushes
// the gate state over `wvmap:turn-gate`; the header button asks for a re-send on
// mount via `wvmap:request-turn-gate` and triggers the action via `wvmap:submit-turn`.
// Mirrors the `wvmap:set-can-edit` pattern used by InviteChallenger.
export interface TurnGateDetail {
  /** Whether it's the viewer's turn — drives "Submit turn" vs the disabled "Submitted". */
  isMyTurn: boolean;
  markedCount: number;
  total: number;
  /** The challenger's closing, marking-only turn is open — labels the header for either seat. */
  isMiniTurn: boolean;
  /** The exchange has closed — the header collapses to a static "Exchange complete" line. */
  isCompleted: boolean;
  /** Current round (1-based) — drives the header's "round" counter live for either seat. */
  currentRound: number;
  /** Count of the viewer's own statements that no longer reach the root (orphaned). Blocks
   * "Submit turn" until they delete/reconnect each. Forced to 0 in the mini-turn (content is
   * frozen there, so orphans are tolerated and surface in the summary instead). */
  danglingCount: number;
  /** Titles of those dangling statements, so the header can name them in the disabled reason. */
  danglingTitles: string[];
  /** Count of the viewer's own AND/OR connectives with <2 operands. Also blocks submit (a map
   * with an incomplete connective is malformed). Suppressed in the mini-turn like dangling. */
  incompleteConnectiveCount: number;
}

/** Cross-island connectivity signal: the viewer's own graph problems (orphaned statements +
 * incomplete connectives), broadcast on every nodes/edges change. Drives the advocate's
 * pre-invite guard (InviteChallenger), which lives in a separate hydration root and can't read
 * this store. */
export interface ConnectivityDetail {
  danglingIds: string[];
  danglingTitles: string[];
  incompleteConnectiveIds: string[];
}

// Both parties have a marking-driven live gate: you must mark every one of the
// counterpart's statements before submitting your turn. We count the counterpart's
// statements via `authorId !== viewerId` — the same test as `isMarkableNode` — which
// works for advocate and challenger alike without needing a `challengerId` on the viewer.
// An invalid mark (valid=false) counts as unmarked, mirroring the DB gate in submit_turn.
export function computeTurnGate(
  nodes: DebateNode[],
  marks: Partial<Record<string, MarkState>>,
  viewer: ViewerContext | null,
  edges: DebateEdge[] = [],
): TurnGateDetail {
  if (!viewer) {
    return {
      isMyTurn: false,
      markedCount: 0,
      total: 0,
      isMiniTurn: false,
      isCompleted: false,
      currentRound: 1,
      danglingCount: 0,
      danglingTitles: [],
      incompleteConnectiveCount: 0,
    };
  }
  const counterpartStatements = nodes.filter((n) => n.type === "statement" && n.data.authorId !== viewer.viewerId);
  const markedCount = counterpartStatements.filter((n) => marks[n.id]?.valid === true).length;

  // The viewer's own structural problems: statements that no longer reach root, and AND/OR
  // connectives with <2 operands. Both block submit. Suppressed in the mini-turn: the challenger
  // can't edit/delete/reattach there (frozen), so blocking on them would trap them.
  const { orphanStatementIds: danglingOwnIds, incompleteConnectiveIds: incompleteOwnIds } = viewer.inMiniTurn
    ? { orphanStatementIds: [], incompleteConnectiveIds: [] }
    : ownGraphIssues({ nodes, edges, authorId: viewer.viewerId });
  const danglingTitles = danglingOwnIds.map((id) => {
    const n = nodes.find((node) => node.id === id);
    return n?.type === "statement" ? n.data.title : "";
  });

  return {
    isMyTurn: viewer.isMyTurn,
    markedCount,
    total: counterpartStatements.length,
    isMiniTurn: viewer.inMiniTurn,
    isCompleted: viewer.isCompleted,
    currentRound: viewer.currentRound,
    danglingCount: danglingOwnIds.length,
    danglingTitles,
    incompleteConnectiveCount: incompleteOwnIds.length,
  };
}

function broadcastTurnGate(detail: TurnGateDetail) {
  window.dispatchEvent(new CustomEvent<TurnGateDetail>("wvmap:turn-gate", { detail }));
}

function broadcastConnectivity(detail: ConnectivityDetail) {
  window.dispatchEvent(new CustomEvent<ConnectivityDetail>("wvmap:connectivity", { detail }));
}

// Build the connectivity payload for the header islands from the current store state. Uses the
// turn-agnostic selectors (so it also covers the advocate's pre-exchange invite guard, where
// there's no turn) and resolves the dangling statement titles for the offending nodes.
function computeConnectivity(s: ReturnType<typeof useStore.getState>): ConnectivityDetail {
  const danglingIds = s.orphanedOwnNodeIds();
  return {
    danglingIds,
    danglingTitles: danglingIds.map((id) => {
      const n = s.nodes.find((node) => node.id === id);
      return n?.type === "statement" ? n.data.title : "";
    }),
    incompleteConnectiveIds: s.incompleteOwnConnectiveIds(),
  };
}

// The exact store slice MapEditorInner subscribes to (via useShallow). Exported so a unit test
// can pin the subscription contract — notably that `canEdit` is part of the slice, so a revoke's
// setCanEdit(true) re-renders the canvas and re-enables it (regression: it was previously omitted,
// and only the never-changing myTurnOrPreExchange function reference was selected).
export function selectMapEditorState(s: RFState) {
  return {
    nodes: s.nodes,
    edges: s.edges,
    debateId: s.debateId,
    error: s.error,
    clearError: s.clearError,
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
    // Subscribe to canEdit (not the myTurnOrPreExchange function, whose reference never
    // changes) so a revoke's setCanEdit(true) actually re-renders and re-enables the board.
    canEdit: s.canEdit,
    canEditNode: s.canEditNode,
    viewer: s.viewer,
    marks: s.marks,
  };
}

// Whether the board is writable for the viewer right now (their turn, or pre-exchange advocate).
// Derived from the subscribed primitives so it tracks canEdit/viewer flips; mirrors the store's
// myTurnOrPreExchange(). Exported for the same selector-contract test.
export function deriveCanAdd({ viewer, canEdit }: { viewer: ViewerContext | null; canEdit: boolean }): boolean {
  return viewer ? canWriteContentNow(viewer) : canEdit;
}

// Per-instance screen-coord cursor ref, provided by MapEditorInner. The connection
// line stays a module-level component (stable identity — no React Flow remount) and
// reads the live pointer through context, converting to flow coords itself. This
// avoids module-level mutable state while keeping the raw-pointer routing that
// React Flow's own toX/toY props did not reproduce.
const ScreenCursorContext = createContext<React.RefObject<{ x: number; y: number }> | null>(null);

function FloatingConnectionLine({ fromX, fromY, fromPosition }: ConnectionLineComponentProps) {
  // React Flow re-renders this on every pointer move during a drag; we read the live
  // screen cursor from context and convert to flow coords here so each render follows
  // the raw pointer. (react-compiler sees the ref read and leaves it un-memoized.)
  const { screenToFlowPosition } = useReactFlow();
  const screenCursor = useContext(ScreenCursorContext);
  const flow = screenToFlowPosition(screenCursor?.current ?? { x: 0, y: 0 });
  const dx = flow.x - fromX;
  const dy = flow.y - fromY;
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
    targetX: flow.x,
    targetY: flow.y,
    targetPosition,
  });
  return (
    <g>
      <path fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 3" d={path} />
    </g>
  );
}

const UserIdContext = createContext<string | null>(null);

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

function MapEditorInner() {
  // Screen-coord cursor, used only in event handlers (never read during render) to
  // place the kind picker when re-dragging an existing edge — impl-review F5.
  const screenCursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
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
    debateId,
    error,
    clearError,
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
    canEdit,
    canEditNode,
    viewer,
    marks,
  } = useStore(useShallow(selectMapEditorState));

  const canAdd = deriveCanAdd({ viewer, canEdit });

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

  // Cross-island lock signal: the InviteChallenger island (a separate hydration
  // root) dispatches `wvmap:set-can-edit` after the advocate sends or revokes an
  // invite. Listening on `window` works regardless of whether the two islands
  // share the store chunk, and avoids a full-page reload (no flicker).
  useEffect(() => {
    function onSetCanEdit(e: Event) {
      const detail = (e as CustomEvent<{ canEdit: boolean }>).detail;
      useStore.getState().setCanEdit(detail.canEdit);
    }
    window.addEventListener("wvmap:set-can-edit", onSetCanEdit);
    return () => {
      window.removeEventListener("wvmap:set-can-edit", onSetCanEdit);
    };
  }, []);

  const userId = useContext(UserIdContext);

  // When the advocate's page loaded with a pending exchange (viewer=null), the turn-change
  // poll below never starts. InviteChallenger's freshness poll fires `wvmap:exchange-accepted`
  // the moment the challenger accepts — initialise the store viewer here so the poll can start.
  useEffect(() => {
    function onExchangeAccepted(e: Event) {
      const {
        exchangeId: eid,
        currentTurn,
        currentRound,
        inMiniTurn,
      } = (e as CustomEvent<{ exchangeId: string; currentTurn: string; currentRound: number; inMiniTurn: boolean }>)
        .detail;
      if (!userId) return;
      useStore.setState({
        viewer: {
          viewerId: userId,
          viewerRole: "advocate",
          advocateId: userId,
          isMyTurn: currentTurn === "advocate",
          inMiniTurn,
          isCompleted: false,
          currentRound,
        },
        exchangeId: eid,
      });
      void reconcileFromServer();
    }
    window.addEventListener("wvmap:exchange-accepted", onExchangeAccepted);
    return () => {
      window.removeEventListener("wvmap:exchange-accepted", onExchangeAccepted);
    };
  }, [userId]);

  // Push the turn-submit gate state to the header's "Submit turn" button (separate
  // hydration root). Re-fires whenever the challenger marks a node so the count
  // stays live; after submit, `viewer.isMyTurn` flips false and the button hides.
  useEffect(() => {
    broadcastTurnGate(computeTurnGate(nodes, marks, viewer, edges));
  }, [nodes, marks, viewer, edges]);

  // Broadcast the viewer's own dangling-statement info to the header islands (the advocate's
  // pre-invite guard in InviteChallenger). Fires on every nodes/edges change regardless of
  // viewer state, so it works pre-exchange (all the advocate's nodes) and during a turn.
  useEffect(() => {
    broadcastConnectivity(computeConnectivity(useStore.getState()));
  }, [nodes, edges]);

  // Answer the button's mount-time request (handshake closes the island start-order
  // race) and run the submit action it asks for. The same handshake covers the
  // connectivity signal for InviteChallenger.
  useEffect(() => {
    function onRequest() {
      const s = useStore.getState();
      broadcastTurnGate(computeTurnGate(s.nodes, s.marks, s.viewer, s.edges));
    }
    function onSubmit() {
      void useStore.getState().submitTurn();
    }
    function onRequestConnectivity() {
      broadcastConnectivity(computeConnectivity(useStore.getState()));
    }
    window.addEventListener("wvmap:request-turn-gate", onRequest);
    window.addEventListener("wvmap:submit-turn", onSubmit);
    window.addEventListener("wvmap:request-connectivity", onRequestConnectivity);
    return () => {
      window.removeEventListener("wvmap:request-turn-gate", onRequest);
      window.removeEventListener("wvmap:submit-turn", onSubmit);
      window.removeEventListener("wvmap:request-connectivity", onRequestConnectivity);
    };
  }, []);

  // Live turn-state sync for the *counterpart*. The party who submits updates its own
  // header in place (store.submitTurn from the API response), but the other seat only
  // learns the turn flipped by polling. When the server's turn-state diverges from what
  // this board holds — the turn handed to me, the challenger's mini-turn opened, or the
  // exchange completed — we reconcile in place (no full-page reload): first
  // reconcileFromServer() pulls the counterpart's new nodes/marks (not otherwise streamed
  // across islands), then we patch the viewer's turn flags so the header flips. Order
  // matters — see the inline note below. Visibility-gated like InviteChallenger's poll: a
  // backgrounded tab goes quiet, and focus/visibility return triggers an immediate check.
  useEffect(() => {
    if (!viewer || viewer.isCompleted) return;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function check() {
      const exchangeId = useStore.getState().exchangeId;
      const v = useStore.getState().viewer;
      if (!exchangeId || !v) return;
      try {
        const res = await fetch(`/api/exchanges/${exchangeId}`);
        if (!res.ok || stopped) return;
        const s = (await res.json()) as {
          status: string;
          currentTurn: string;
          inMiniTurn: boolean;
          currentRound: number;
        };
        const serverMyTurn = s.status === "accepted" && s.currentTurn === v.viewerRole;
        const serverCompleted = s.status === "completed";
        if (
          serverMyTurn !== v.isMyTurn ||
          s.inMiniTurn !== v.inMiniTurn ||
          serverCompleted !== v.isCompleted ||
          s.currentRound !== v.currentRound
        ) {
          // Refresh the board (the counterpart's new nodes/marks) BEFORE flipping the
          // header flags. If the resync throws, the catch below swallows it and the
          // viewer flags stay un-patched — the divergence persists, so the next tick
          // retries. Header and board never disagree past one failed tick.
          await reconcileFromServer();
          useStore.setState({
            viewer: {
              ...v,
              isMyTurn: serverMyTurn,
              inMiniTurn: s.inMiniTurn,
              isCompleted: serverCompleted,
              currentRound: s.currentRound,
            },
          });
        }
      } catch {
        // transient — next tick retries
      }
    }
    function start() {
      intervalId ??= setInterval(() => void check(), 1000);
    }
    function stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onVisibility() {
      if (document.hidden) {
        stop();
      } else {
        void check();
        start();
      }
    }

    if (!document.hidden) {
      void check();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [viewer]);

  // Local-only mode (no debate backing) bootstraps a root claim. Persisted debates
  // always load with their root node, so this never fires there.
  useEffect(() => {
    if (debateId === null && nodes.length === 0) {
      const id = createStatementNode("claim", { x: 0, y: 0 });
      // Local-only (debateId === null): setRootNode applies synchronously, no await needed.
      void setRootNode(id);
    }
  }, [debateId, nodes.length, createStatementNode, setRootNode]);

  const { screenToFlowPosition } = useReactFlow();

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    screenCursorRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // An edge must start from a node the viewer owns (you connect FROM your own node).
  // Mirrors the store's `stagePendingConnection` gate so the connection line reads as
  // invalid while dragging off the other party's node.
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => connection.source !== connection.target && canEditNode(connection.source),
    [canEditNode],
  );

  // connection
  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (isInEditBlocked()) return;

      const existingEdge = edges.find((e) => e.source === connection.source && e.target === connection.target);
      if (existingEdge) {
        setKindPickerPosition(screenCursorRef.current);
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
      if (!canAdd || isInEditBlocked()) return;
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [cleanupFlow, isInEditBlocked, canAdd],
  );

  const handleNodeContextMenu: NodeMouseHandler<DebateNode> = useCallback(
    (e, node) => {
      e.preventDefault();
      cleanupFlow();
      // Only show the node context menu for nodes the viewer can edit.
      if (!canEditNode(node.id) || isInEditBlocked()) return;
      setNodeContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
    },
    [cleanupFlow, isInEditBlocked, canEditNode],
  );

  const handleEdgeContextMenu: EdgeMouseHandler = useCallback(
    (e, edge) => {
      e.preventDefault();
      cleanupFlow();
      // Edit/delete on an edge belongs to whoever owns its SOURCE node — you can only
      // draw relations FROM your own nodes. Don't offer the menu for the other party's
      // edges (symmetric for advocate and challenger). `canEditNode` also folds in the
      // turn check, so this subsumes the old `canAdd` gate.
      if (!canEditNode(edge.source) || isInEditBlocked()) return;
      setEdgeContextMenu({ edgeId: edge.id, x: e.clientX, y: e.clientY });
    },
    [cleanupFlow, isInEditBlocked, canEditNode],
  );

  const handleNodesDelete = useCallback(
    (deleted: DebateNode[]) => {
      deleteNodes(deleted.map((n) => n.id));
    },
    [deleteNodes],
  );

  return (
    <ScreenCursorContext.Provider value={screenCursorRef}>
      <div style={{ width: "100%", height: "100%" }}>
        {error && (
          <div
            className="fixed top-4 left-1/2 z-[60] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--destructive)",
              color: "var(--destructive)",
            }}
            role="alert"
          >
            <span>{error}</span>
            <button
              className="shrink-0 rounded px-1.5 leading-none transition-colors hover:bg-[var(--muted)]"
              style={{ color: "var(--muted-foreground)" }}
              onClick={clearError}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
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
          nodesDraggable={canAdd}
          nodesConnectable={canAdd}
          elementsSelectable={canAdd || viewer !== null}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={canAdd && !inEditNodeId ? "Delete" : null}
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
    </ScreenCursorContext.Provider>
  );
}

interface MapEditorProps {
  /** When set, the editor autosaves to this debate's API. Omitted = local-only playground. */
  debateId?: string;
  /** Server-loaded graph to hydrate the canvas with (passed by the `/debates/[id]` page). */
  initialGraph?: DebateGraph;
  /** When false the canvas is read-only (challenger, or advocate after an invite). Default true. */
  canEdit?: boolean;
  /** Viewer identity: set when an active exchange exists. null = pre-exchange or local-only. */
  viewer?: ViewerContext | null;
  /** Exchange id, required when viewer is set. */
  exchangeId?: string | null;
  /** Pre-loaded marks for the debate (server-side hydration). */
  initialMarks?: Partial<Record<string, MarkState>>;
  /** Authenticated user's id. Stored in the store so cross-island events can build a
   * ViewerContext when the exchange transitions from pending → accepted while the page
   * is open (the InviteChallenger freshness poll fires `wvmap:exchange-accepted`). */
  userId?: string | null;
}

export default function MapEditor({
  debateId,
  initialGraph,
  canEdit = true,
  viewer = null,
  exchangeId = null,
  initialMarks = {},
  userId = null,
}: MapEditorProps) {
  // Hydrate the store synchronously, before the canvas first renders, so the local-only
  // auto-create effect sees the right debateId and there's no empty-canvas flash.
  useState(() => {
    useStore.getState().hydrate(debateId ?? null, initialGraph ?? null, canEdit, viewer, exchangeId, initialMarks);
    return null;
  });

  return (
    <UserIdContext.Provider value={userId ?? null}>
      <ReactFlowProvider>
        <MapEditorInner />
      </ReactFlowProvider>
    </UserIdContext.Provider>
  );
}
