import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";
import type { Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection, XYPosition } from "@xyflow/react";
import type { StatementNodeData, StatementNodeType } from "./nodes/StatementNode";
import type { ConnectiveNodeData, ConnectiveNodeType } from "./nodes/ConnectiveNode";
import type { RelationEdgeData } from "./edges/RelationEdge";
import type { StatementRole, ConnectiveOp, RelationKind } from "./mapVisualLanguage";
import type { Database } from "@/db/database.types";

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

  onNodesChange: OnNodesChange<DebateNode>;
  onEdgesChange: OnEdgesChange<DebateEdge>;
  stagePendingConnection: OnConnect;
  commitConnection: (kind: RelationKind) => void;
  cancelConnection: () => void;
  addPendingPreview: (dropX: number, dropY: number) => void;

  setGraph: (debate: DebateRow, nodes: NodeRow[], relations: RelationRow[]) => void;
  createStatementNode: (statementType: StatementRole, position: XYPosition) => string;
  createConnectiveNode: (op: ConnectiveOp, position: XYPosition) => string;
  updateNodeFields: (id: string, patch: NodeFieldPatch) => void;
  deleteNodes: (ids: string[]) => void;
  deleteEdge: (id: string) => void;
  updateRelationKind: (id: string, kind: RelationKind) => void;
  setRootNode: (id: string) => void;
  addEdgeDirect: (connection: Connection, kind: RelationKind) => void;
  setInEditNode: (id: string | null) => void;
  setInEditEdgeId: (id: string | null) => void;
  isInEditBlocked: () => boolean;
  tryExitNodeEdit: () => void;
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
    data: { kind: row.kind },
  }));

  return { nodes, edges };
}

export const useStore = create<RFState>()((set, get) => ({
  nodes: [],
  edges: [],
  pendingConnection: null,
  inEditNodeId: null,
  inEditEdgeId: null,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
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
    const { pendingConnection } = get();
    if (!pendingConnection) return;
    const newEdge: DebateEdge = {
      ...pendingConnection,
      id: crypto.randomUUID(),
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
  },

  cancelConnection: () => {
    set((state) => ({ pendingConnection: null, edges: state.edges.filter((e) => e.id !== "__pending__") }));
  },

  setGraph: (debate, nodeRows, relationRows) => {
    const { nodes, edges } = rowsToGraph(debate, nodeRows, relationRows);
    set({ nodes, edges, pendingConnection: null });
  },

  createStatementNode: (statementType, position) => {
    const id = crypto.randomUUID();
    const node: StatementNodeType = {
      id,
      type: "statement",
      position,
      data: {
        role: statementType,
        title: statementType.charAt(0).toUpperCase() + statementType.slice(1),
        body: "",
      },
    };
    set((state) => ({ nodes: [...state.nodes, node] as DebateNode[] }));
    return id;
  },

  createConnectiveNode: (op, position) => {
    const id = crypto.randomUUID();
    const node: ConnectiveNodeType = {
      id,
      type: "connective",
      position,
      data: { op },
    };
    set((state) => ({ nodes: [...state.nodes, node] as DebateNode[] }));
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
  },

  deleteNodes: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      edges: state.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      inEditNodeId: state.inEditNodeId && idSet.has(state.inEditNodeId) ? null : state.inEditNodeId,
    }));
  },

  deleteEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    }));
  },

  updateRelationKind: (id, kind) => {
    set((state) => ({
      edges: state.edges.map((e) => (e.id === id ? { ...e, data: { kind } } : e)),
    }));
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
      const { inEditNodeId, nodes } = get();
      if (inEditNodeId !== null && inEditNodeId !== id) {
        const current = nodes.find((n) => n.id === inEditNodeId);
        if (current?.type === "statement") {
          if (!current.data.title) return;
          if (current.data.role === "source" && !current.data.url) return;
        }
      }
    }
    set({ inEditNodeId: id });
  },

  setInEditEdgeId: (id) => {
    set({ inEditEdgeId: id });
  },

  addEdgeDirect: (connection, kind) => {
    const edge: DebateEdge = {
      ...connection,
      id: crypto.randomUUID(),
      type: "relation" as const,
      data: { kind },
    };
    set((state) => ({ edges: addEdge(edge, state.edges) }));
  },

  isInEditBlocked: () => {
    const { inEditNodeId, nodes } = get();
    if (!inEditNodeId) return false;
    const node = nodes.find((n) => n.id === inEditNodeId);
    if (node?.type !== "statement") return false;
    if (!node.data.title) return true;
    if (node.data.role === "source" && !node.data.url) return true;
    return false;
  },

  tryExitNodeEdit: () => {
    if (get().isInEditBlocked()) return;
    set({ inEditNodeId: null });
  },
}));

export { useShallow };
