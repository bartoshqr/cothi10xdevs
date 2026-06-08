import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the persistence layer so deleteNodes can be observed without a network call.
// The store imports several api* fns at module load; all must exist on the mock.
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

import { apiDeleteNode } from "@/components/debate/persistence";
import { useStore } from "@/components/debate/store";
import type { DebateNode } from "@/components/debate/store";

const mockedDelete = vi.mocked(apiDeleteNode);

const ROOT_DELETE_MESSAGE = "You cannot delete the root claim, but you can set a different claim as the root.";

function seedCanvas() {
  const nodes: DebateNode[] = [
    {
      id: "root",
      type: "statement",
      position: { x: 0, y: 0 },
      data: { role: "claim", title: "Root", body: "", isRoot: true },
    },
    { id: "leaf", type: "statement", position: { x: 1, y: 1 }, data: { role: "rebuttal", title: "Leaf", body: "" } },
  ];
  useStore.setState({ debateId: "deb-1", nodes, edges: [], error: null });
}

describe("deleteNodes root-delete block (D3-3a, client)", () => {
  beforeEach(() => {
    mockedDelete.mockResolvedValue(undefined);
    seedCanvas();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to delete the root node: keeps it on the canvas and makes no API call", () => {
    useStore.getState().deleteNodes(["root"]);

    expect(useStore.getState().nodes.some((n) => n.id === "root")).toBe(true);
    expect(useStore.getState().error).toBeTruthy();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  // Copy-contract canary: the plan (3a) and the manual step both specify this exact
  // sentence. Pinned once, on purpose — a reworded block message should trip here
  // (and prompt updating the manual step), not ride silently through the behavioral
  // tests above/below. The literal is the oracle (from the plan), not imported from
  // the store, so this stays a real assertion rather than a tautology.
  it("surfaces the exact contracted message when the root delete is blocked", () => {
    useStore.getState().deleteNodes(["root"]);

    expect(useStore.getState().error).toBe(ROOT_DELETE_MESSAGE);
  });

  it("still deletes a non-root node and persists the delete", () => {
    useStore.getState().deleteNodes(["leaf"]);

    expect(useStore.getState().nodes.some((n) => n.id === "leaf")).toBe(false);
    expect(mockedDelete).toHaveBeenCalledWith("deb-1", "leaf");
  });

  it("blocks a batch that includes the root without deleting any node in it", () => {
    useStore.getState().deleteNodes(["root", "leaf"]);

    // The whole batch is refused — the root cannot be silently spared while its
    // siblings vanish; the user re-issues the delete without the root.
    expect(useStore.getState().nodes.some((n) => n.id === "root")).toBe(true);
    expect(useStore.getState().nodes.some((n) => n.id === "leaf")).toBe(true);
    expect(useStore.getState().error).toBeTruthy();
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
