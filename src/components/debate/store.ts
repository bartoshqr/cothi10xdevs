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
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  pendingConnection: Connection | null;

  onNodesChange: OnNodesChange<DebateNode>;
  onEdgesChange: OnEdgesChange<DebateEdge>;
  onConnect: OnConnect;
  commitConnection: (kind: RelationKind) => void;
  cancelConnection: () => void;
  addPendingPreview: (dropX: number, dropY: number) => void;

  setGraph: (debate: DebateRow, nodes: NodeRow[], relations: RelationRow[]) => void;
  createStatementNode: (statementType: StatementRole, position: XYPosition) => string;
  createConnectiveNode: (op: ConnectiveOp, position: XYPosition) => string;
  updateNodeFields: (id: string, patch: NodeFieldPatch) => void;
  deleteNodes: (ids: string[]) => void;
  deleteEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  updateRelationKind: (id: string, kind: RelationKind) => void;
  setRootNode: (id: string) => void;
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
  selectedNodeId: null,
  selectedEdgeId: null,
  pendingConnection: null,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    set({ pendingConnection: connection });
  },

  addPendingPreview: (dropX, dropY) => {
    const pending = get().pendingConnection;
    if (!pending) return;
    const previewEdge: DebateEdge = {
      ...pending,
      id: "__pending__",
      type: "relation" as const,
      data: { kind: "supports", pending: true, dropX, dropY },
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
    set({ nodes, edges, selectedNodeId: null, selectedEdgeId: null, pendingConnection: null });
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
          if (patch.url !== undefined) updated.url = patch.url;
          if (patch.statementType !== undefined) updated.role = patch.statementType;
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
      selectedNodeId: state.selectedNodeId && idSet.has(state.selectedNodeId) ? null : state.selectedNodeId,
    }));
  },

  deleteEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
    }));
  },

  selectNode: (id) => {
    set({ selectedNodeId: id, selectedEdgeId: null });
  },

  selectEdge: (id) => {
    set({ selectedEdgeId: id, selectedNodeId: null });
  },

  updateRelationKind: (id, kind) => {
    set((state) => ({
      edges: state.edges.map((e) => (e.id === id ? { ...e, data: { kind } } : e)),
    }));
  },

  setRootNode: (id) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.type === "statement" ? { ...n, data: { ...n.data, isRoot: n.id === id } } : n)),
    }));
  },
}));

export { useShallow };
