import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic stub: drive each optimistic mutation to its failure branch without a
// network call, and resolve apiGetGraph with an authoritative graph that differs
// from the optimistic state so convergence is observable.
vi.mock("@/components/debate/persistence", () => ({
  apiCreateNode: vi.fn(),
  apiUpdateNode: vi.fn(),
  apiDeleteNode: vi.fn(),
  apiCreateRelation: vi.fn(),
  apiUpdateRelation: vi.fn(),
  apiDeleteRelation: vi.fn(),
  apiSetDebateRoot: vi.fn(),
  apiGetGraph: vi.fn(),
  apiGetMarks: vi.fn().mockResolvedValue({}),
  apiUpsertMark: vi.fn(),
  apiSubmitTurn: vi.fn(),
}));

import {
  apiDeleteNode,
  apiDeleteRelation,
  apiGetGraph,
  apiUpdateNode,
  apiUpdateRelation,
} from "@/components/debate/persistence";
import { useStore } from "@/components/debate/store";
import type { DebateEdge, DebateNode } from "@/components/debate/store";
import type { DebateGraph } from "@/lib/debate/repository";
import type { Database } from "@/db/database.types";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

const mockedUpdateNode = vi.mocked(apiUpdateNode);
const mockedUpdateRelation = vi.mocked(apiUpdateRelation);
const mockedDeleteRelation = vi.mocked(apiDeleteRelation);
const mockedDeleteNode = vi.mocked(apiDeleteNode);
const mockedGetGraph = vi.mocked(apiGetGraph);

const DEBOUNCE_MS = 400; // mirrors the store's internal debounce window

function debateRow(): DebateRow {
  return {
    id: "deb-1",
    title: "D",
    owner_id: "u",
    root_node_id: null,
    created_at: "t",
    public: false,
    published_at: null,
  };
}
function statementRow(id: string, title: string): NodeRow {
  return {
    id,
    debate_id: "deb-1",
    author_id: "u",
    kind: "statement",
    position_x: 0,
    position_y: 0,
    metadata: { statement_type: "rebuttal", title, body: "" },
    created_at: "t",
  };
}
function relationRow(id: string, source: string, target: string): RelationRow {
  return {
    id,
    debate_id: "deb-1",
    author_id: "u",
    kind: "supports",
    source_node_id: source,
    target_node_id: target,
    created_at: "t",
  };
}
function graph(nodes: NodeRow[], relations: RelationRow[]): DebateGraph {
  return { debate: debateRow(), nodes, relations };
}

// Authoritative server state: node `a` titled "Server A" at the origin, node `b`,
// and a supports edge `e1`. Every optimistic mutation below diverges from this.
const SERVER_GRAPH = graph([statementRow("a", "Server A"), statementRow("b", "B")], [relationRow("e1", "a", "b")]);

function seed() {
  const nodes: DebateNode[] = [
    { id: "a", type: "statement", position: { x: 50, y: 50 }, data: { role: "rebuttal", title: "Local A", body: "" } },
    { id: "b", type: "statement", position: { x: 10, y: 10 }, data: { role: "rebuttal", title: "B", body: "" } },
  ];
  const edges: DebateEdge[] = [{ id: "e1", type: "relation", source: "a", target: "b", data: { kind: "supports" } }];
  useStore.setState({ debateId: "deb-1", nodes, edges, error: null });
}

async function settle() {
  // Drain the debounce timer (field/position paths) and the reconcile promise chain
  // (apiGetGraph → setGraph) for the immediate paths.
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** The whole point: regardless of which mutation failed, the canvas snaps back to SERVER_GRAPH. */
function expectConvergedToServer() {
  const { nodes, edges } = useStore.getState();
  expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  const a = nodes.find((n) => n.id === "a");
  expect(a?.type === "statement" ? a.data.title : undefined).toBe("Server A");
  expect(a?.position).toEqual({ x: 0, y: 0 });
  expect(edges.map((e) => ({ id: e.id, kind: e.data?.kind }))).toEqual([{ id: "e1", kind: "supports" }]);
}

describe("optimistic mutation failure → canvas reconciles to the server", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().hydrate("deb-1", null); // reset module bookkeeping
    seed();
    mockedGetGraph.mockResolvedValue(SERVER_GRAPH);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const cases: { name: string; reject: () => void; mutate: () => void }[] = [
    {
      name: "node-field update (apiUpdateNode rejects)",
      reject: () => mockedUpdateNode.mockRejectedValue(new Error("save failed")),
      mutate: () => {
        useStore.getState().updateNodeFields("a", { title: "Local edit" });
      },
    },
    {
      name: "node-position update (apiUpdateNode rejects)",
      reject: () => mockedUpdateNode.mockRejectedValue(new Error("save failed")),
      mutate: () => {
        useStore.getState().onNodesChange([{ type: "position", id: "a", position: { x: 99, y: 99 }, dragging: false }]);
      },
    },
    {
      name: "edge-kind update (apiUpdateRelation rejects)",
      reject: () => mockedUpdateRelation.mockRejectedValue(new Error("save failed")),
      mutate: () => {
        useStore.getState().updateRelationKind("e1", "rebuts");
      },
    },
    {
      name: "edge delete (apiDeleteRelation rejects)",
      reject: () => mockedDeleteRelation.mockRejectedValue(new Error("delete failed")),
      mutate: () => {
        useStore.getState().deleteEdge("e1");
      },
    },
    {
      // Single-node delete convergence. The N>1 single-flight property is pinned
      // separately by the batched-delete test below; here we only assert the
      // node (and its incident edge `e1`) reappear once the delete is rejected.
      name: "node delete (apiDeleteNode rejects)",
      reject: () => mockedDeleteNode.mockRejectedValue(new Error("delete failed")),
      mutate: () => {
        useStore.getState().deleteNodes(["a"]);
      },
    },
  ];

  it.each(cases)("$name → re-syncs the canvas to authoritative state", async ({ reject, mutate }) => {
    reject();
    mutate();
    await settle();
    expectConvergedToServer();
  });

  it("batched delete failure converges and stays single-flight (≤2 fetches for N>1)", async () => {
    // Three deletable (non-root) nodes; every delete is rejected by the server.
    const nodes: DebateNode[] = ["a", "b", "c"].map((id) => ({
      id,
      type: "statement",
      position: { x: 0, y: 0 },
      data: { role: "rebuttal", title: id, body: "" },
    }));
    useStore.setState({ debateId: "deb-1", nodes, edges: [], error: null });
    mockedDeleteNode.mockRejectedValue(new Error("delete failed"));
    mockedGetGraph.mockResolvedValue(
      graph([statementRow("a", "a"), statementRow("b", "b"), statementRow("c", "c")], []),
    );

    useStore.getState().deleteNodes(["a", "b", "c"]);
    await settle();

    // The optimistically-deleted nodes reappear...
    expect(
      useStore
        .getState()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    // ...and the burst of three failures coalesced into at most two re-fetches.
    expect(mockedGetGraph.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockedGetGraph.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
