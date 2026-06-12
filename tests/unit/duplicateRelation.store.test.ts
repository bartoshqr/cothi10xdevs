import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic stub: drive commitConnection's create-relation failure branch without a
// network call. The real ApiError lives in its own module (not persistence), so it
// survives this mock and the store's `e instanceof ApiError` check still works.
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

import { apiCreateRelation, apiGetGraph } from "@/components/debate/persistence";
import { ApiError } from "@/components/debate/apiError";
import { useStore } from "@/components/debate/store";
import type { DebateNode } from "@/components/debate/store";
import type { DebateGraph } from "@/lib/debate/repository";
import type { Database } from "@/db/database.types";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

const mockedCreateRelation = vi.mocked(apiCreateRelation);
const mockedGetGraph = vi.mocked(apiGetGraph);

const DUP_MESSAGE = "These two nodes are already connected.";

function debateRow(): DebateRow {
  return { id: "deb-1", title: "D", owner_id: "u", root_node_id: null, created_at: "t" };
}
function statementRow(id: string): NodeRow {
  return {
    id,
    debate_id: "deb-1",
    author_id: "u",
    kind: "statement",
    position_x: 0,
    position_y: 0,
    metadata: { statement_type: "rebuttal", title: id, body: "" },
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

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function seed() {
  const nodes: DebateNode[] = [
    { id: "a", type: "statement", position: { x: 0, y: 0 }, data: { role: "claim", title: "A", body: "" } },
    { id: "b", type: "statement", position: { x: 1, y: 1 }, data: { role: "rebuttal", title: "B", body: "" } },
  ];
  useStore.getState().hydrate("deb-1", null); // reset module bookkeeping (unsavedEdgeIds etc.)
  useStore.setState({ debateId: "deb-1", nodes, edges: [], pendingConnection: null, error: null });
}

function connectAtoB() {
  useStore.getState().stagePendingConnection({ source: "a", target: "b", sourceHandle: null, targetHandle: null });
  useStore.getState().commitConnection("supports");
}

describe("duplicate-relation 409 reaction (commitConnection)", () => {
  beforeEach(() => {
    seed();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("on a 409, rolls back the optimistic edge, shows the server message, and reconciles in the existing edge", async () => {
    mockedCreateRelation.mockRejectedValue(new ApiError(DUP_MESSAGE, 409));
    // The authoritative graph already holds the edge the other session created.
    mockedGetGraph.mockResolvedValue(
      graph([statementRow("a"), statementRow("b")], [relationRow("existing", "a", "b")]),
    );

    connectAtoB();
    await flush();

    // Friendly, server-owned message (not a bare status).
    expect(useStore.getState().error).toBe(DUP_MESSAGE);
    // Reconcile ran and pulled in the already-existing edge, so the canvas isn't left
    // showing no connection at all.
    expect(mockedGetGraph).toHaveBeenCalledTimes(1);
    expect(useStore.getState().edges.map((e) => e.id)).toEqual(["existing"]);
  });

  it("on a non-conflict failure, rolls back and reports but does NOT reconcile", async () => {
    mockedCreateRelation.mockRejectedValue(new ApiError("Internal error", 500));

    connectAtoB();
    await flush();

    expect(useStore.getState().error).toBe("Internal error");
    // The optimistic edge is gone (create-rollback), and no re-fetch was triggered —
    // a 500/network failure isn't a "the edge already exists" situation.
    expect(useStore.getState().edges).toEqual([]);
    expect(mockedGetGraph).not.toHaveBeenCalled();
  });
});
