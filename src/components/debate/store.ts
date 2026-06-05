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
} from "./persistence";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

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
  /** Last non-blocking persistence error, surfaced as a dismissible banner. */
  error: string | null;

  onNodesChange: OnNodesChange<DebateNode>;
  onEdgesChange: OnEdgesChange<DebateEdge>;
  stagePendingConnection: OnConnect;
  commitConnection: (kind: RelationKind) => void;
  cancelConnection: () => void;
  addPendingPreview: (dropX: number, dropY: number) => void;

  hydrate: (debateId: string | null, graph: DebateGraph | null) => void;
  setGraph: (debate: DebateRow, nodes: NodeRow[], relations: RelationRow[]) => void;
  createStatementNode: (statementType: StatementRole, position: XYPosition) => string;
  createConnectiveNode: (op: ConnectiveOp, position: XYPosition) => string;
  updateNodeFields: (id: string, patch: NodeFieldPatch) => void;
  deleteNodes: (ids: string[]) => void;
  deleteEdge: (id: string) => void;
  updateRelationKind: (id: string, kind: RelationKind) => void;
  setRootNode: (id: string) => void;
  setInEditNode: (id: string | null) => void;
  setInEditEdgeId: (id: string | null) => void;
  isInEditBlocked: () => boolean;
  tryExitNodeEdit: () => void;
  clearError: () => void;
  /** Target node of the connection currently being chosen: the edited edge's target, or the pending connection's target. */
  getTargetNode: () => DebateNode | undefined;
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
): { nodes: DebateNode[]; edges: DebateEdge[] } {
  const nodes: DebateNode[] = nodeRows.map((row) => {
    if (row.kind === "statement") {
      const meta = row.metadata as { statement_type: StatementRole; title: string; body?: string; url?: string };
      const data: StatementNodeData = {
        role: meta.statement_type,
        title: meta.title,
        body: meta.body ?? "",
        url: meta.url ?? undefined,
        isRoot: row.id === debate.root_node_id,
      };
      return {
        id: row.id,
        type: "statement" as const,
        position: { x: row.position_x, y: row.position_y },
        data,
      } satisfies StatementNodeType;
    } else {
      const meta = row.metadata as { op: ConnectiveOp };
      const data: ConnectiveNodeData = { op: meta.op };
      return {
        id: row.id,
        type: "connective" as const,
        position: { x: row.position_x, y: row.position_y },
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
  error: null,

  onNodesChange: (changes) => {
    const next = applyNodeChanges(changes, get().nodes);
    set({ nodes: next });
    if (!get().debateId) return;
    for (const change of changes) {
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
    if (!pendingConnection) return;
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
        });
    }
  },

  cancelConnection: () => {
    set((state) => ({ pendingConnection: null, edges: state.edges.filter((e) => e.id !== "__pending__") }));
  },

  hydrate: (debateId, graph) => {
    patchTimers.forEach((t) => {
      clearTimeout(t);
    });
    patchTimers.clear();
    patchBuffers.clear();
    unsavedEdgeIds.clear();
    if (graph) {
      const { nodes, edges } = rowsToGraph(graph.debate, graph.nodes, graph.relations);
      set({ debateId, nodes, edges, pendingConnection: null, inEditNodeId: null, inEditEdgeId: null, error: null });
    } else {
      set({ debateId, error: null });
    }
  },

  setGraph: (debate, nodeRows, relationRows) => {
    const { nodes, edges } = rowsToGraph(debate, nodeRows, relationRows);
    set({ nodes, edges, pendingConnection: null });
  },

  createStatementNode: (statementType, position) => {
    const id = crypto.randomUUID();
    const { debateId } = get();
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
    const id = crypto.randomUUID();
    const { debateId } = get();
    const node: ConnectiveNodeType = {
      id,
      type: "connective",
      position,
      data: { op, pending: debateId ? true : undefined },
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
    const idSet = new Set(ids);
    const { debateId, nodes, edges } = get();
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
        });
      }
    }
  },

  deleteEdge: (id) => {
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
    });
  },

  updateRelationKind: (id, kind) => {
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
      });
    }
  },

  setRootNode: (id) => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.type !== "statement") return n;
        if (n.id === id) return { ...n, data: { ...n.data, isRoot: true, url: undefined } };
        return { ...n, data: { ...n.data, isRoot: false } };
      }),
    }));
  },

  setInEditNode: (id) => {
    if (id !== null) {
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

  getTargetNode: () => {
    const { inEditEdgeId, edges, pendingConnection, nodes } = get();
    const targetId = inEditEdgeId ? edges.find((e) => e.id === inEditEdgeId)?.target : pendingConnection?.target;
    if (!targetId) return undefined;
    return nodes.find((n) => n.id === targetId);
  },
}));

export { useShallow };
