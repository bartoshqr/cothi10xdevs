import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";
import type { Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection, XYPosition } from "@xyflow/react";
import type { StatementNodeData, StatementNodeType } from "./nodes/StatementNode";
import type { ConnectiveNodeData, ConnectiveNodeType } from "./nodes/ConnectiveNode";
import type { RelationEdgeData } from "./edges/RelationEdge";
import type { StatementRole, ConnectiveOp, RelationKind } from "./mapVisualLanguage";
import { CONNECTIVE_OPERAND_HANDLE, CONNECTIVE_OUTER_HANDLE } from "./mapVisualLanguage";
import type { Database } from "@/db/database.types";
import { isValidUrl } from "@/lib/debate/nodeConstraints";
import type { UpdateNodeInput } from "@/lib/debate/schemas";
import type { DebateGraph } from "@/lib/debate/repository";
import {
  apiCreateNode,
  apiUpdateNode,
  apiDeleteNode,
  apiCreateRelation,
  apiUpdateRelation,
  apiDeleteRelation,
  apiSetDebateRoot,
  apiGetGraph,
  apiGetMarks,
  apiUpsertMark,
  apiSubmitTurn,
} from "./persistence";
import { ApiError } from "./apiError";
import type { MarkStance, MarkState } from "./mapVisualLanguage";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

export interface ViewerContext {
  viewerId: string;
  viewerRole: "advocate" | "challenger";
  advocateId: string;
  isMyTurn: boolean;
  /** The challenger's closing, marking-only turn is open. Carried so the header can label
   * it ("My mini-turn" / "Challenger's mini-turn") live, for either seat, after a submit. */
  inMiniTurn: boolean;
  /** The exchange has closed — board is read-only for both parties and the header collapses
   * to a static "Exchange complete" line. */
  isCompleted: boolean;
  /** Current round (1-based). Carried so the header's round counter updates live for the
   * counterpart when a submit advances the round, alongside the turn/mini-turn/completed flags. */
  currentRound: number;
}

export type DebateNode = StatementNodeType | ConnectiveNodeType;
export type DebateEdge = Edge<RelationEdgeData, "relation">;

export interface NodeFieldPatch {
  title?: string;
  body?: string;
  url?: string;
  statementType?: StatementRole;
  connectiveOp?: ConnectiveOp;
}

export interface RFState {
  nodes: DebateNode[];
  edges: DebateEdge[];
  pendingConnection: Connection | null;
  inEditNodeId: string | null;
  inEditEdgeId: string | null;
  /** Set once the editor is mounted against a persisted debate. `null` = local-only (no autosave). */
  debateId: string | null;
  /**
   * When false the canvas is read-only: every mutator is a no-op and MapEditor
   * disables React Flow's interaction affordances. The advocate is locked the
   * moment an exchange exists; a challenger is always locked (S-02). Defaults to
   * true so the local-only playground stays editable. Server RLS is the real
   * boundary — this is the UX half so a frozen user isn't offered dead controls.
   */
  canEdit: boolean;
  /** Last non-blocking persistence error, surfaced as a dismissible banner. */
  error: string | null;
  /** Set when an active exchange exists (challenger's turn or advocate's turn). null = pre-exchange or local-only. */
  viewer: ViewerContext | null;
  /** Exchange id, set when viewer is set. Needed to call submit_turn. */
  exchangeId: string | null;
  /** Every mark in the debate: nodeId → { stance, valid }. Loaded from server and updated
   * optimistically. Round 1 has a single marker (the challenger), so one map serves both
   * views — the challenger's own marks (interactive on their turn) and, for the advocate,
   * the challenger's marks shown read-only. Interactivity is gated by `canMarkNode`, not
   * by mark authorship. The two-stance case (both parties marking) is S-04. */
  marks: Partial<Record<string, MarkState>>;

  onNodesChange: OnNodesChange<DebateNode>;
  onEdgesChange: OnEdgesChange<DebateEdge>;
  stagePendingConnection: OnConnect;
  commitConnection: (kind: RelationKind) => void;
  cancelConnection: () => void;
  addPendingPreview: (dropX: number, dropY: number) => void;

  hydrate: (
    debateId: string | null,
    graph: DebateGraph | null,
    canEdit?: boolean,
    viewer?: ViewerContext | null,
    exchangeId?: string | null,
    initialMarks?: Partial<Record<string, MarkState>>,
  ) => void;
  setGraph: (debate: DebateRow, nodes: NodeRow[], relations: RelationRow[]) => void;
  createStatementNode: (statementType: StatementRole, position: XYPosition) => string;
  createConnectiveNode: (op: ConnectiveOp, position: XYPosition) => string;
  updateNodeFields: (id: string, patch: NodeFieldPatch) => void;
  deleteNodes: (ids: string[]) => void;
  deleteEdge: (id: string) => void;
  updateRelationKind: (id: string, kind: RelationKind) => void;
  setRootNode: (id: string) => Promise<void>;
  setInEditNode: (id: string | null) => void;
  setInEditEdgeId: (id: string | null) => void;
  /** Flip read-only at runtime (advocate sends/revokes an invite in a sibling island). */
  setCanEdit: (canEdit: boolean) => void;
  isInEditBlocked: () => boolean;
  tryExitNodeEdit: () => void;
  clearError: () => void;
  /** Target node of the connection currently being chosen: the edited edge's target, or the pending connection's target. */
  getTargetNode: () => DebateNode | undefined;
  /** Whether the board is writable for the viewer right now — their turn during an
   * exchange, or the advocate's free-edit phase pre-exchange. Gates every structural
   * mutation (add/move/connect/delete); per-node edit rights are `canEditNode`. */
  myTurnOrPreExchange: () => boolean;
  /** Whether the viewer can edit/delete a specific node (own node && my turn, or all nodes pre-exchange). */
  canEditNode: (nodeId: string) => boolean;
  /** Whether the viewer can mark a specific node (challenger: other party's statement && my turn). */
  canMarkNode: (nodeId: string) => boolean;
  /** Whether a node can carry a mark from this viewer (other party's statement) — turn-agnostic,
   * so the mark bar stays visible read-only after the turn is submitted. */
  isMarkableNode: (nodeId: string) => boolean;
  /** Optimistically upsert a mark on a node; rolls back on server error. */
  setMark: (nodeId: string, stance: MarkStance) => void;
  /** Submit the challenger's turn; locks the board on success. */
  submitTurn: () => Promise<void>;
}

/**
 * Resolves which target handle an edge of the given kind should attach to.
 * Connective nodes have two target handles — `link` edges route into the operand body,
 * everything else to the outer point. Statement nodes have one unnamed handle, so we
 * return undefined and let React Flow use the default.
 */
function targetHandleFor(targetNode: DebateNode | undefined, kind: RelationKind): string | undefined {
  if (targetNode?.type !== "connective") return undefined;
  return kind === "link" ? CONNECTIVE_OPERAND_HANDLE : CONNECTIVE_OUTER_HANDLE;
}

function rowsToGraph(
  debate: DebateRow,
  nodeRows: NodeRow[],
  relationRows: RelationRow[],
  viewer: ViewerContext | null = null,
): { nodes: DebateNode[]; edges: DebateEdge[] } {
  // The per-node `draggable` value. During an exchange a node owned by the other party
  // gets `false` — pinned, overriding React Flow's global `nodesDraggable`. Own nodes are
  // left `undefined` so they inherit the global flag — which is the turn lock — keeping
  // them frozen once the turn is submitted. Pre-exchange (no viewer) everything inherits.
  const draggableForViewer = (authorId: string): false | undefined =>
    viewer && authorId !== viewer.viewerId ? false : undefined;
  const nodes: DebateNode[] = nodeRows.map((row) => {
    if (row.kind === "statement") {
      const meta = row.metadata as { statement_type: StatementRole; title: string; body?: string; url?: string };
      const data: StatementNodeData = {
        role: meta.statement_type,
        title: meta.title,
        body: meta.body ?? "",
        url: meta.url ?? undefined,
        isRoot: row.id === debate.root_node_id,
        authorId: row.author_id,
      };
      return {
        id: row.id,
        type: "statement" as const,
        position: { x: row.position_x, y: row.position_y },
        draggable: draggableForViewer(row.author_id),
        data,
      } satisfies StatementNodeType;
    } else {
      const meta = row.metadata as { op: ConnectiveOp };
      const data: ConnectiveNodeData = { op: meta.op, authorId: row.author_id };
      return {
        id: row.id,
        type: "connective" as const,
        position: { x: row.position_x, y: row.position_y },
        draggable: draggableForViewer(row.author_id),
        data,
      } satisfies ConnectiveNodeType;
    }
  });

  const edges: DebateEdge[] = relationRows.map((row) => ({
    id: row.id,
    type: "relation" as const,
    source: row.source_node_id,
    target: row.target_node_id,
    targetHandle: targetHandleFor(
      nodes.find((n) => n.id === row.target_node_id),
      row.kind,
    ),
    data: { kind: row.kind },
  }));

  return { nodes, edges };
}

// --- Persistence plumbing (module-scoped: the store is a singleton) ---------

const DEBOUNCE_MS = 400;
/** Latest unsent node patch per node id (position + field edits are coalesced together). */
const patchBuffers = new Map<string, UpdateNodeInput>();
const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Edge ids whose relation-create POST is still in flight (carry a client temp id). */
const unsavedEdgeIds = new Set<string>();

function reportError(message: string) {
  useStore.setState({ error: message });
}

function clearPatchState(nodeId: string) {
  const t = patchTimers.get(nodeId);
  if (t) clearTimeout(t);
  patchTimers.delete(nodeId);
  patchBuffers.delete(nodeId);
}

function schedulePatch(nodeId: string, patch: UpdateNodeInput) {
  patchBuffers.set(nodeId, { ...patchBuffers.get(nodeId), ...patch });
  const existing = patchTimers.get(nodeId);
  if (existing) clearTimeout(existing);
  patchTimers.set(
    nodeId,
    setTimeout(() => {
      void flushPatch(nodeId);
    }, DEBOUNCE_MS),
  );
}

async function flushPatch(nodeId: string) {
  patchTimers.delete(nodeId);
  const patch = patchBuffers.get(nodeId);
  if (!patch) return;
  const { debateId, nodes } = useStore.getState();
  if (!debateId) {
    patchBuffers.delete(nodeId);
    return;
  }
  const node = nodes.find((n) => n.id === nodeId);
  // Node is still awaiting its server id — retry shortly; the buffer keeps the latest values.
  if (node?.data.pending) {
    patchTimers.set(
      nodeId,
      setTimeout(() => {
        void flushPatch(nodeId);
      }, DEBOUNCE_MS),
    );
    return;
  }
  patchBuffers.delete(nodeId);
  if (!node) return; // deleted before the flush fired
  try {
    await apiUpdateNode(debateId, nodeId, patch);
  } catch (e) {
    reportError(e instanceof Error ? e.message : "Failed to save changes");
    void reconcileFromServer();
  }
}

/** Swap a node's client temp id for the server id and clear its pending flag, rewriting incident edges. */
function reconcileNode(tempId: string, realId: string) {
  useStore.setState((state) => ({
    nodes: state.nodes.map((n) =>
      n.id === tempId ? ({ ...n, id: realId, data: { ...n.data, pending: false } } as DebateNode) : n,
    ),
    edges: state.edges.map((e) => ({
      ...e,
      source: e.source === tempId ? realId : e.source,
      target: e.target === tempId ? realId : e.target,
    })),
    inEditNodeId: state.inEditNodeId === tempId ? realId : state.inEditNodeId,
  }));
}

/** Remove a node whose create POST failed, pruning incident edges. */
function rollbackNode(tempId: string) {
  clearPatchState(tempId);
  useStore.setState((state) => ({
    nodes: state.nodes.filter((n) => n.id !== tempId),
    edges: state.edges.filter((e) => e.source !== tempId && e.target !== tempId),
    inEditNodeId: state.inEditNodeId === tempId ? null : state.inEditNodeId,
  }));
}

function reconcileEdge(tempId: string, realId: string) {
  unsavedEdgeIds.delete(tempId);
  useStore.setState((state) => ({
    edges: state.edges.map((e) => (e.id === tempId ? { ...e, id: realId } : e)),
    inEditEdgeId: state.inEditEdgeId === tempId ? realId : state.inEditEdgeId,
  }));
}

function rollbackEdge(tempId: string) {
  unsavedEdgeIds.delete(tempId);
  useStore.setState((state) => ({
    edges: state.edges.filter((e) => e.id !== tempId),
    inEditEdgeId: state.inEditEdgeId === tempId ? null : state.inEditEdgeId,
  }));
}

// --- Re-fetch-on-failure reconciliation (orthogonal to create-rollback above) ---
// Single-flight guard: a burst of failures (batch delete, drag-spam) coalesces into
// 1–2 fetches, never zero — a failure arriving mid-fetch is queued, not dropped.
let reconciling = false;
let reconcileQueued = false;

/**
 * Re-fetch the authoritative graph and snap the canvas to it after a mutation is
 * rejected by the server, so the canvas never stays diverged-until-reload. Server
 * state wins for committed entities; in-flight creates (owned by the create-rollback
 * mechanism) are snapshotted and re-applied on top so a live create isn't erased.
 * No-ops on a local-only canvas. On fetch failure it surfaces a distinct, actionable
 * banner and leaves the canvas untouched.
 */
export async function reconcileFromServer(): Promise<void> {
  const { debateId } = useStore.getState();
  if (!debateId) return; // local-only canvas: nothing to reconcile, no endpoint to call
  if (reconciling) {
    reconcileQueued = true;
    return;
  }
  reconciling = true;
  try {
    const [graph, marks] = await Promise.all([apiGetGraph(debateId), apiGetMarks(debateId)]);
    // One synchronous block once the fetches resolve: snapshot in-flight creates,
    // clear committed-entity bookkeeping, swap the canvas, re-append the creates.
    const { nodes, edges } = useStore.getState();
    const pendingNodes = nodes.filter((n) => n.data.pending === true);
    const pendingEdges = edges.filter((e) => unsavedEdgeIds.has(e.id));
    // Committed bookkeeping only — leave unsavedEdgeIds intact for the preserved edges.
    patchTimers.forEach((t) => {
      clearTimeout(t);
    });
    patchTimers.clear();
    patchBuffers.clear();
    useStore.getState().setGraph(graph.debate, graph.nodes, graph.relations);
    useStore.setState((state) => ({
      marks,
      nodes: [...state.nodes, ...pendingNodes],
      edges: [...state.edges, ...pendingEdges],
      inEditNodeId: null,
      inEditEdgeId: null,
    }));
  } catch {
    reportError("Couldn't refresh the canvas — reload the page to see the latest.");
  } finally {
    reconciling = false;
    if (reconcileQueued) {
      reconcileQueued = false;
      void reconcileFromServer();
    }
  }
}

/** Translate a UI field patch into the API's UpdateNode shape, dropping values that aren't safe to persist yet. */
function toApiNodePatch(patch: NodeFieldPatch): UpdateNodeInput {
  const apiPatch: UpdateNodeInput = {};
  if (patch.title !== undefined) apiPatch.title = patch.title;
  if (patch.body !== undefined) apiPatch.body = patch.body;
  if (patch.statementType !== undefined) apiPatch.statementType = patch.statementType;
  if (patch.connectiveOp !== undefined) apiPatch.connectiveOp = patch.connectiveOp;
  // Only persist a url once it's a valid http(s) url — half-typed values would 400 on every keystroke.
  if (patch.url !== undefined && patch.url && isValidUrl(patch.url)) apiPatch.url = patch.url;
  // Switching off the source role clears the url server-side so a stale link can't survive a reload.
  if (patch.statementType !== undefined && patch.statementType !== "source") apiPatch.url = null;
  return apiPatch;
}

export const useStore = create<RFState>()((set, get) => ({
  nodes: [],
  edges: [],
  pendingConnection: null,
  inEditNodeId: null,
  inEditEdgeId: null,
  debateId: null,
  canEdit: true,
  error: null,
  viewer: null,
  exchangeId: null,
  marks: {},

  onNodesChange: (changes) => {
    // Drop position changes the viewer isn't allowed to make — the other party's
    // nodes during an exchange, or anything when it isn't their turn — so a foreign
    // node can't be moved on the canvas at all (not just left un-persisted). The
    // per-node `draggable: false` flag stops the drag gesture; this is the backstop
    // for any change that still slips through. Non-position changes (select/remove)
    // pass through untouched.
    const allowed = changes.filter((c) => c.type !== "position" || get().canEditNode(c.id));
    const next = applyNodeChanges(allowed, get().nodes);
    set({ nodes: next });
    // Read-only: never schedule a position patch. (The advocate still owns the
    // debate, so a stray drag WOULD persist server-side — guard it here, not just
    // via nodesDraggable in the UI.)
    if (!get().debateId || !get().myTurnOrPreExchange()) return;
    for (const change of allowed) {
      if (change.type === "position" && change.position) {
        const node = next.find((n) => n.id === change.id);
        if (node && !node.data.pending) {
          schedulePatch(change.id, { positionX: node.position.x, positionY: node.position.y });
        }
      }
    }
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  stagePendingConnection: (connection) => {
    if (!get().myTurnOrPreExchange()) return;
    // An edge may only originate from a node the viewer owns: you connect FROM your
    // own node TO any existing one. Blocks starting a relation off the other party's
    // node. (`canEditNode` is true pre-exchange, so the advocate's free-build flow is
    // unaffected.) RLS backstops the persisted write.
    if (!get().canEditNode(connection.source)) return;
    set({ pendingConnection: connection });
  },

  addPendingPreview: (dropX, dropY) => {
    const { pendingConnection } = get();
    if (!pendingConnection) return;
    const previewEdge: DebateEdge = {
      ...pendingConnection,
      id: "__pending__",
      type: "relation" as const,
      data: { kind: "pending", pending: true, dropX, dropY },
    };
    set((state) => ({ edges: addEdge(previewEdge, state.edges) }));
  },

  commitConnection: (kind) => {
    const { pendingConnection, nodes, debateId } = get();
    if (!get().myTurnOrPreExchange()) return;
    if (!pendingConnection) return;
    // Backstop the source-ownership rule here too (the connection could have been
    // staged before a turn flip).
    if (!get().canEditNode(pendingConnection.source)) return;
    const targetNode = nodes.find((n) => n.id === pendingConnection.target);
    const edgeId = crypto.randomUUID();
    const newEdge: DebateEdge = {
      ...pendingConnection,
      targetHandle: targetHandleFor(targetNode, kind),
      id: edgeId,
      type: "relation" as const,
      data: { kind },
    };
    set((state) => ({
      edges: addEdge(
        newEdge,
        state.edges.filter((e) => e.id !== "__pending__"),
      ),
      pendingConnection: null,
    }));

    const { source, target } = pendingConnection;
    if (debateId && source && target && kind !== "pending") {
      unsavedEdgeIds.add(edgeId);
      apiCreateRelation(debateId, { debateId, sourceNodeId: source, targetNodeId: target, kind })
        .then((row) => {
          reconcileEdge(edgeId, row.id);
        })
        .catch((e: unknown) => {
          rollbackEdge(edgeId);
          reportError(e instanceof Error ? e.message : "Failed to create relation");
          // A 409 means these two nodes are already connected server-side (another
          // session created the edge). Reconcile so that existing edge appears —
          // otherwise the canvas shows no connection at all, contradicting the banner.
          if (e instanceof ApiError && e.status === 409) void reconcileFromServer();
        });
    }
  },

  cancelConnection: () => {
    set((state) => ({ pendingConnection: null, edges: state.edges.filter((e) => e.id !== "__pending__") }));
  },

  hydrate: (debateId, graph, canEdit = true, viewer = null, exchangeId = null, initialMarks = {}) => {
    patchTimers.forEach((t) => {
      clearTimeout(t);
    });
    patchTimers.clear();
    patchBuffers.clear();
    unsavedEdgeIds.clear();
    if (graph) {
      const { nodes, edges } = rowsToGraph(graph.debate, graph.nodes, graph.relations, viewer);
      set({
        debateId,
        canEdit,
        viewer,
        exchangeId,
        marks: initialMarks,
        nodes,
        edges,
        pendingConnection: null,
        inEditNodeId: null,
        inEditEdgeId: null,
        error: null,
      });
    } else {
      // Local-only canvas: no persisted graph means no nodes, so there are no marks.
      set({ debateId, canEdit, viewer, exchangeId, marks: {}, error: null });
    }
  },

  setGraph: (debate, nodeRows, relationRows) => {
    const { nodes, edges } = rowsToGraph(debate, nodeRows, relationRows, get().viewer);
    set({ nodes, edges, pendingConnection: null });
  },

  createStatementNode: (statementType, position) => {
    if (!get().myTurnOrPreExchange()) return "";
    const id = crypto.randomUUID();
    const { debateId, viewer } = get();
    const title = statementType.charAt(0).toUpperCase() + statementType.slice(1);
    const node: StatementNodeType = {
      id,
      type: "statement",
      position,
      data: {
        role: statementType,
        title,
        body: "",
        pending: debateId ? true : undefined,
        authorId: viewer?.viewerId,
      },
    };
    set((state) => ({ nodes: [...state.nodes, node] as DebateNode[] }));

    if (debateId) {
      apiCreateNode(debateId, {
        nodeKind: "statement",
        debateId,
        statementType,
        title,
        positionX: position.x,
        positionY: position.y,
      })
        .then((row) => {
          reconcileNode(id, row.id);
        })
        .catch((e: unknown) => {
          rollbackNode(id);
          reportError(e instanceof Error ? e.message : "Failed to create node");
        });
    }
    return id;
  },

  createConnectiveNode: (op, position) => {
    if (!get().myTurnOrPreExchange()) return "";
    const id = crypto.randomUUID();
    const { debateId, viewer } = get();
    const node: ConnectiveNodeType = {
      id,
      type: "connective",
      position,
      data: { op, pending: debateId ? true : undefined, authorId: viewer?.viewerId },
    };
    set((state) => ({ nodes: [...state.nodes, node] as DebateNode[] }));

    if (debateId) {
      apiCreateNode(debateId, {
        nodeKind: "connective",
        debateId,
        connectiveOp: op,
        positionX: position.x,
        positionY: position.y,
      })
        .then((row) => {
          reconcileNode(id, row.id);
        })
        .catch((e: unknown) => {
          rollbackNode(id);
          reportError(e instanceof Error ? e.message : "Failed to create node");
        });
    }
    return id;
  },

  updateNodeFields: (id, patch) => {
    if (!get().canEditNode(id)) return;
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== id) return n;
        if (n.type === "statement") {
          const updated: StatementNodeData = { ...n.data };
          if (patch.title !== undefined) updated.title = patch.title;
          if (patch.body !== undefined) updated.body = patch.body;
          if ("url" in patch) updated.url = patch.url;
          if (patch.statementType !== undefined) {
            updated.role = patch.statementType;
            if (patch.statementType !== "source") updated.url = undefined;
          }
          return { ...n, data: updated };
        }
        if (patch.connectiveOp !== undefined) {
          return { ...n, data: { ...n.data, op: patch.connectiveOp } };
        }
        return n;
      }),
    }));

    const { debateId, nodes } = get();
    if (!debateId) return;
    const node = nodes.find((n) => n.id === id);
    if (!node || node.data.pending) return; // create still in flight — gated; inputs are disabled meanwhile
    const apiPatch = toApiNodePatch(patch);
    if (Object.keys(apiPatch).length > 0) schedulePatch(id, apiPatch);
  },

  deleteNodes: (ids) => {
    // Gate: all nodes being deleted must be editable by the current viewer.
    if (ids.some((id) => !get().canEditNode(id))) return;
    const idSet = new Set(ids);
    const { debateId, nodes, edges } = get();
    // D3-3a: the root claim cannot be deleted — only re-designated via "Set as Root
    // Claim". Block the whole batch (the server backstops this with a 409) so the
    // user re-issues the delete without the root rather than losing its siblings.
    if (nodes.some((n) => idSet.has(n.id) && n.type === "statement" && n.data.isRoot)) {
      reportError("You cannot delete the root claim, but you can set a different claim as the root.");
      return;
    }
    const persistedIds = debateId ? nodes.filter((n) => idSet.has(n.id) && !n.data.pending).map((n) => n.id) : [];
    // Relations cascade server-side; drop any in-flight edge bookkeeping for incident edges.
    for (const e of edges) {
      if (idSet.has(e.source) || idSet.has(e.target)) unsavedEdgeIds.delete(e.id);
    }

    set((state) => ({
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      edges: state.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      inEditNodeId: state.inEditNodeId && idSet.has(state.inEditNodeId) ? null : state.inEditNodeId,
    }));

    ids.forEach(clearPatchState);

    if (debateId) {
      for (const nodeId of persistedIds) {
        apiDeleteNode(debateId, nodeId).catch((e: unknown) => {
          reportError(e instanceof Error ? e.message : "Failed to delete node");
          void reconcileFromServer();
        });
      }
    }
  },

  deleteEdge: (id) => {
    if (!get().myTurnOrPreExchange()) return;
    // An edge is owned by its source node's author — only that party may delete it.
    const edge = get().edges.find((e) => e.id === id);
    if (edge && !get().canEditNode(edge.source)) return;
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    }));

    const { debateId } = get();
    if (!debateId) return;
    if (unsavedEdgeIds.has(id)) {
      unsavedEdgeIds.delete(id); // create still in flight; nothing persisted to delete yet
      return;
    }
    apiDeleteRelation(debateId, id).catch((e: unknown) => {
      reportError(e instanceof Error ? e.message : "Failed to delete relation");
      void reconcileFromServer();
    });
  },

  updateRelationKind: (id, kind) => {
    if (!get().myTurnOrPreExchange()) return;
    // Same ownership rule as deletion: only the source node's author may re-kind the edge.
    const edge = get().edges.find((e) => e.id === id);
    if (edge && !get().canEditNode(edge.source)) return;
    set((state) => ({
      edges: state.edges.map((e) => {
        if (e.id !== id) return e;
        const targetNode = state.nodes.find((n) => n.id === e.target);
        return { ...e, targetHandle: targetHandleFor(targetNode, kind), data: { kind } };
      }),
    }));

    const { debateId } = get();
    if (debateId && !unsavedEdgeIds.has(id) && kind !== "pending") {
      apiUpdateRelation(debateId, id, { kind }).catch((e: unknown) => {
        reportError(e instanceof Error ? e.message : "Failed to save relation");
        void reconcileFromServer();
      });
    }
  },

  setRootNode: async (id) => {
    if (!get().canEditNode(id)) return;
    // The root claim is locked once an exchange is open — no re-designating the debate's
    // central claim mid-exchange. UI/store-only gate for now (not enforced by RLS yet).
    if (get().viewer !== null) return;
    const { debateId } = get();

    // Apply all three effects together: the new root flips isRoot + role→claim
    // (a root is always a claim), every other statement loses isRoot, and the new
    // root's outgoing edges are dropped (server-side set_debate_root strips them —
    // a root claim is a sink). Mirrors the persisted operation exactly.
    const applyEffects = () => {
      set((state) => ({
        nodes: state.nodes.map((n) => {
          if (n.type !== "statement") return n;
          if (n.id === id) return { ...n, data: { ...n.data, isRoot: true, role: "claim", url: undefined } };
          return { ...n, data: { ...n.data, isRoot: false } };
        }),
        edges: state.edges.filter((e) => e.source !== id),
      }));
    };

    // Local-only canvas (no persisted debate): apply immediately, nothing to call.
    if (!debateId) {
      applyEffects();
      return;
    }

    // Apply-on-success (D4): touch the canvas only after the server confirms (200).
    // On failure the canvas is left untouched and the error banner surfaces.
    try {
      await apiSetDebateRoot(debateId, id);
      applyEffects();
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Failed to set root claim");
    }
  },

  setInEditNode: (id) => {
    if (id !== null) {
      if (!get().canEditNode(id)) return;
      const { inEditNodeId } = get();
      if (inEditNodeId !== null && inEditNodeId !== id) {
        if (get().isInEditBlocked()) return;
      }
    }
    set({ inEditNodeId: id });
  },

  setInEditEdgeId: (id) => {
    set({ inEditEdgeId: id });
  },

  setCanEdit: (canEdit) => {
    // Locking drops any in-progress edit/connection so no stale editor lingers.
    if (canEdit) {
      set({ canEdit: true });
    } else {
      set({ canEdit: false, inEditNodeId: null, inEditEdgeId: null, pendingConnection: null });
    }
  },

  isInEditBlocked: () => {
    const { inEditNodeId, nodes } = get();
    if (!inEditNodeId) return false;
    const node = nodes.find((n) => n.id === inEditNodeId);
    if (node?.type !== "statement") return false;
    if (!node.data.title) return true;
    if (node.data.role === "source" && (!node.data.url || !isValidUrl(node.data.url))) return true;
    return false;
  },

  tryExitNodeEdit: () => {
    if (get().isInEditBlocked()) return;
    set({ inEditNodeId: null });
  },

  clearError: () => {
    set({ error: null });
  },

  myTurnOrPreExchange: () => {
    const { viewer, canEdit } = get();
    if (!viewer) return canEdit; // pre-exchange: use the old canEdit flag
    return viewer.isMyTurn;
  },

  canEditNode: (nodeId) => {
    const { viewer, canEdit, nodes } = get();
    if (!viewer) return canEdit; // pre-exchange: all nodes editable if canEdit
    if (!viewer.isMyTurn) return false;
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data.authorId === viewer.viewerId;
  },

  canMarkNode: (nodeId) => {
    // Interactive marking also requires it to be the viewer's turn.
    return get().isMarkableNode(nodeId) && (get().viewer?.isMyTurn ?? false);
  },

  isMarkableNode: (nodeId) => {
    const { viewer, nodes } = get();
    if (!viewer) return false;
    const node = nodes.find((n) => n.id === nodeId);
    if (node?.type !== "statement") return false;
    // Only the other party's statements carry a mark — symmetric for challenger (S-03) and advocate (S-04).
    return node.data.authorId !== viewer.viewerId;
  },

  setMark: (nodeId, stance) => {
    const { debateId, viewer, marks } = get();
    if (!debateId || !viewer) return;
    const prevState = marks[nodeId];
    // Optimistic update: re-marking always makes the mark valid again.
    set({ marks: { ...get().marks, [nodeId]: { stance, valid: true } } });
    apiUpsertMark(debateId, nodeId, stance).catch((e: unknown) => {
      // Roll back the optimistic update for this node only: restore the previous
      // MarkState, or drop the entry entirely if this was its first (unsaved) mark.
      const { [nodeId]: _discarded, ...rest } = get().marks;
      set({ marks: prevState === undefined ? rest : { ...rest, [nodeId]: prevState } });
      reportError(e instanceof Error ? e.message : "Failed to save mark");
    });
  },

  submitTurn: async () => {
    const { exchangeId, viewer } = get();
    if (!exchangeId || !viewer) return;
    try {
      const row = await apiSubmitTurn(exchangeId);
      // Apply the authoritative post-submit state so the actor's OWN header updates in
      // place — turn handed off, or (on the advocate's final round) the challenger's
      // mini-turn opens, or the exchange completes — with no reload. The counterpart
      // learns of the flip via MapEditor's poll.
      set({
        viewer: {
          ...viewer,
          isMyTurn: row.status === "accepted" && row.current_turn === viewer.viewerRole,
          inMiniTurn: row.in_mini_turn,
          isCompleted: row.status === "completed",
          currentRound: row.current_round,
        },
      });
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Failed to submit turn");
    }
  },

  getTargetNode: () => {
    const { inEditEdgeId, edges, pendingConnection, nodes } = get();
    const targetId = inEditEdgeId ? edges.find((e) => e.id === inEditEdgeId)?.target : pendingConnection?.target;
    if (!targetId) return undefined;
    return nodes.find((n) => n.id === targetId);
  },
}));

export { useShallow };
