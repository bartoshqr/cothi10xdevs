import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic stub: the store imports several api* fns at module load; all must exist
// on the mock even when a given test only drives one of them. apiGetGraph is the
// reconcile primitive under test here.
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

import { apiCreateNode, apiCreateRelation, apiGetGraph, apiUpdateNode } from "@/components/debate/persistence";
import { reconcileFromServer, useStore } from "@/components/debate/store";
import type { DebateEdge, DebateNode } from "@/components/debate/store";
import type { DebateGraph } from "@/lib/debate/repository";
import type { Database } from "@/db/database.types";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

const mockedGetGraph = vi.mocked(apiGetGraph);
const mockedCreateNode = vi.mocked(apiCreateNode);
const mockedCreateRelation = vi.mocked(apiCreateRelation);
const mockedUpdateNode = vi.mocked(apiUpdateNode);

// The only new user-facing copy this change introduces. Pinned as the oracle (from
// the plan), not imported from the store — so a reworded banner trips this test.
const REFETCH_FAIL_MESSAGE = "Couldn't refresh the canvas — reload the page to see the latest.";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function debateRow(rootId: string | null = null): DebateRow {
  return { id: "deb-1", title: "D", owner_id: "u", root_node_id: rootId, created_at: "t" };
}
function statementRow(id: string, title = id): NodeRow {
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
function graph(nodes: NodeRow[] = [], relations: RelationRow[] = [], rootId: string | null = null): DebateGraph {
  return { debate: debateRow(rootId), nodes, relations };
}
function statementNode(id: string): DebateNode {
  return { id, type: "statement", position: { x: 0, y: 0 }, data: { role: "rebuttal", title: id, body: "" } };
}

describe("reconcileFromServer (single-flight re-fetch on mutation failure)", () => {
  beforeEach(() => {
    // hydrate(_, null) resets the module-scoped bookkeeping (patchTimers/patchBuffers/
    // unsavedEdgeIds) and sets debateId, giving each test a clean reconcile substrate.
    useStore.getState().hydrate("deb-1", null);
    useStore.setState({ nodes: [], edges: [], inEditNodeId: null, inEditEdgeId: null, error: null });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops on a local-only canvas (debateId === null): never calls apiGetGraph", async () => {
    useStore.getState().hydrate(null, null);
    await reconcileFromServer();
    expect(mockedGetGraph).not.toHaveBeenCalled();
  });

  it("coalesces concurrent failures into at most two fetches (single-flight)", async () => {
    const held = deferred<DebateGraph>();
    mockedGetGraph.mockReturnValueOnce(held.promise);
    mockedGetGraph.mockResolvedValue(graph());

    const first = reconcileFromServer();
    const second = reconcileFromServer(); // arrives while the first is in flight → queued, not dropped
    expect(mockedGetGraph).toHaveBeenCalledTimes(1);

    held.resolve(graph());
    await first;
    await second;
    // The queued failure triggers exactly one more fetch — a burst of N coalesces to 1–2, never 0.
    expect(mockedGetGraph).toHaveBeenCalledTimes(2);
  });

  it("closes any open editor after a reconcile", async () => {
    useStore.setState({ nodes: [statementNode("a")], inEditNodeId: "a", inEditEdgeId: "e1" });
    mockedGetGraph.mockResolvedValue(graph([statementRow("a")]));

    await reconcileFromServer();

    expect(useStore.getState().inEditNodeId).toBeNull();
    expect(useStore.getState().inEditEdgeId).toBeNull();
  });

  it("clears buffered patches so a pending debounced save never fires after reconcile", async () => {
    vi.useFakeTimers();
    try {
      useStore.setState({ nodes: [statementNode("a")] });
      // schedules a 400ms debounced field patch (timer + buffer)
      useStore.getState().updateNodeFields("a", { title: "edited" });
      expect(mockedUpdateNode).not.toHaveBeenCalled();

      mockedGetGraph.mockResolvedValue(graph([statementRow("a")]));
      await reconcileFromServer();

      // The debounce window elapses, but reconcile cleared the timer + buffer.
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockedUpdateNode).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("on re-fetch failure surfaces the distinct reload banner and leaves the canvas untouched", async () => {
    const nodes = [statementNode("a")];
    const edges: DebateEdge[] = [];
    useStore.setState({ nodes, edges });
    mockedGetGraph.mockRejectedValue(new Error("offline"));

    await reconcileFromServer();

    expect(useStore.getState().error).toBe(REFETCH_FAIL_MESSAGE);
    // Same array reference: the failure path must not rebuild the canvas.
    expect(useStore.getState().nodes).toBe(nodes);
    expect(useStore.getState().edges).toBe(edges);
  });

  it("preserves an in-flight create absent from the re-fetch (create-rollback path untouched)", async () => {
    // Held create promises keep the optimistic node/edge in flight across the swap.
    mockedCreateNode.mockReturnValue(new Promise(() => undefined));
    mockedCreateRelation.mockReturnValue(new Promise(() => undefined));

    useStore.setState({ nodes: [statementNode("committed")], edges: [] });
    const pendingId = useStore.getState().createStatementNode("rebuttal", { x: 5, y: 5 });
    useStore
      .getState()
      .stagePendingConnection({ source: "committed", target: pendingId, sourceHandle: null, targetHandle: null });
    useStore.getState().commitConnection("supports");
    const pendingEdgeId = useStore.getState().edges.find((e) => e.data?.kind === "supports")?.id;
    expect(pendingEdgeId).toBeDefined();

    // Server graph has only the committed node — none of the in-flight creates.
    mockedGetGraph.mockResolvedValue(graph([statementRow("committed")]));

    await reconcileFromServer();

    const nodeIds = useStore.getState().nodes.map((n) => n.id);
    expect(nodeIds).toContain("committed");
    expect(nodeIds).toContain(pendingId); // the pending create survived; not erased by server state
    expect(useStore.getState().edges.map((e) => e.id)).toContain(pendingEdgeId);
  });

  it("rebuilds the canvas from authoritative server rows on success", async () => {
    // Optimistic state diverged: a node the server still has was locally removed.
    useStore.setState({ nodes: [statementNode("kept")], edges: [] });
    mockedGetGraph.mockResolvedValue(
      graph([statementRow("kept"), statementRow("reappears")], [relationRow("r1", "kept", "reappears")]),
    );

    await reconcileFromServer();

    expect(
      useStore
        .getState()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["kept", "reappears"]);
    expect(useStore.getState().edges.map((e) => e.id)).toEqual(["r1"]);
    expect(useStore.getState().error).toBeNull();
  });
});
