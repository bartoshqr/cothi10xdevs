import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the persistence layer so the store's apply-on-success action can be driven
// without a network call. The store imports several api* fns at module load; all
// must exist on the mock even if a given test only exercises apiSetDebateRoot.
vi.mock("@/components/debate/persistence", () => ({
  apiCreateNode: vi.fn(),
  apiUpdateNode: vi.fn(),
  apiDeleteNode: vi.fn(),
  apiCreateRelation: vi.fn(),
  apiUpdateRelation: vi.fn(),
  apiDeleteRelation: vi.fn(),
  apiSetDebateRoot: vi.fn(),
  apiGetGraph: vi.fn(),
}));

import { apiSetDebateRoot } from "@/components/debate/persistence";
import { useStore } from "@/components/debate/store";
import type { DebateEdge, DebateNode } from "@/components/debate/store";

const mockedSetRoot = vi.mocked(apiSetDebateRoot);

function seedCanvas() {
  const nodes: DebateNode[] = [
    {
      id: "old",
      type: "statement",
      position: { x: 0, y: 0 },
      data: { role: "claim", title: "Old", body: "", isRoot: true },
    },
    { id: "new", type: "statement", position: { x: 1, y: 1 }, data: { role: "rebuttal", title: "New", body: "" } },
  ];
  const edges: DebateEdge[] = [
    { id: "e1", type: "relation", source: "new", target: "old", data: { kind: "supports" } },
    { id: "e2", type: "relation", source: "old", target: "new", data: { kind: "rebuts" } },
  ];
  useStore.setState({ debateId: "deb-1", nodes, edges, error: null });
}

function statement(id: string) {
  const n = useStore.getState().nodes.find((x) => x.id === id);
  if (n?.type !== "statement") throw new Error(`no statement ${id}`);
  return n.data;
}

describe("setRootNode apply-on-success (D3-3c)", () => {
  beforeEach(() => {
    seedCanvas();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("on a 200, flips isRoot, coerces role → claim, and strips the new root's outgoing edges", async () => {
    mockedSetRoot.mockResolvedValueOnce({} as never);

    await useStore.getState().setRootNode("new");

    expect(mockedSetRoot).toHaveBeenCalledWith("deb-1", "new");
    expect(statement("new").isRoot).toBe(true);
    expect(statement("new").role).toBe("claim");
    expect(statement("old").isRoot).toBe(false);
    // e1 (source === "new") is gone; e2 (source === "old") survives.
    const edgeIds = useStore.getState().edges.map((e) => e.id);
    expect(edgeIds).toEqual(["e2"]);
    expect(useStore.getState().error).toBeNull();
  });

  it("on failure, leaves the canvas untouched and surfaces an error", async () => {
    mockedSetRoot.mockRejectedValueOnce(new Error("boom"));

    await useStore.getState().setRootNode("new");

    expect(statement("new").isRoot).toBeUndefined();
    expect(statement("new").role).toBe("rebuttal");
    expect(statement("old").isRoot).toBe(true);
    expect(useStore.getState().edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(useStore.getState().error).toBeTruthy();
  });
});
