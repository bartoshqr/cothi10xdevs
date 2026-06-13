import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression (S-05 manual testing): clearing a statement's title mid-edit used to autosave
// `title: ""`, which the server's required-title rule 400s on. That failure ran
// reconcileFromServer(), discarding the in-progress edit and reverting the field. The fix:
// `toApiNodePatch` only persists a non-blank title (mirroring the valid-url rule). These tests
// pin that an empty/whitespace title is never sent (so no 400 → no reconcile → edit stays open),
// while a non-blank title still persists.
vi.mock("@/components/debate/persistence", () => ({
  apiCreateNode: vi.fn(),
  apiUpdateNode: vi.fn().mockResolvedValue(undefined),
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

import { apiUpdateNode, apiGetGraph } from "@/components/debate/persistence";
import { useStore } from "@/components/debate/store";
import type { DebateNode } from "@/components/debate/store";

const mockedUpdateNode = vi.mocked(apiUpdateNode);
const mockedGetGraph = vi.mocked(apiGetGraph);
const DEBOUNCE_MS = 400; // mirrors the store's internal debounce window

function seedEditingNode(title: string) {
  const nodes: DebateNode[] = [
    { id: "a", type: "statement", position: { x: 0, y: 0 }, data: { role: "rebuttal", title, body: "" } },
  ];
  // inEditNodeId set => simulate an open edit session on node `a`.
  useStore.setState({ debateId: "deb-1", nodes, edges: [], error: null, inEditNodeId: "a" });
}

async function flush() {
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function titleOf(id: string): string | undefined {
  const node = useStore.getState().nodes.find((n) => n.id === id);
  return node?.type === "statement" ? node.data.title : undefined;
}

describe("title autosave guard (empty title must not be persisted)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().hydrate("deb-1", null); // reset module bookkeeping (timers/buffers)
    seedEditingNode("Original");
    mockedGetGraph.mockResolvedValue({
      debate: { id: "deb-1", title: "D", owner_id: "u", root_node_id: null, created_at: "t" },
      nodes: [],
      relations: [],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("never autosaves a cleared title — no 400, no reconcile, edit stays open", async () => {
    useStore.getState().updateNodeFields("a", { title: "" });
    await flush();

    expect(mockedUpdateNode).not.toHaveBeenCalled();
    // No failure-driven reconcile fired, and the edit session is still on node `a`.
    expect(mockedGetGraph).not.toHaveBeenCalled();
    expect(useStore.getState().inEditNodeId).toBe("a");
    // Local state still shows the cleared value, so the "Title is required" hint renders.
    expect(titleOf("a")).toBe("");
  });

  it("does not persist a whitespace-only title", async () => {
    useStore.getState().updateNodeFields("a", { title: "   " });
    await flush();
    expect(mockedUpdateNode).not.toHaveBeenCalled();
  });

  it("persists a non-blank title once one is typed", async () => {
    useStore.getState().updateNodeFields("a", { title: "Rebuttal" });
    await flush();
    expect(mockedUpdateNode).toHaveBeenCalledWith("deb-1", "a", { title: "Rebuttal" });
  });
});
