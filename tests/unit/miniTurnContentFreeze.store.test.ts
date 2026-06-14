import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { useStore, canWriteContentNow } from "@/components/debate/store";
import type { DebateNode, ViewerContext } from "@/components/debate/store";

const ADVOCATE_ID = "advocate-1";
const CHALLENGER_ID = "challenger-1";

function makeViewer(overrides: Partial<ViewerContext>): ViewerContext {
  return {
    viewerId: CHALLENGER_ID,
    viewerRole: "challenger",
    advocateId: ADVOCATE_ID,
    isMyTurn: true,
    inMiniTurn: false,
    isCompleted: false,
    currentRound: 2,
    ...overrides,
  };
}

function seed(viewer: ViewerContext) {
  // An advocate statement (markable by the challenger) and the challenger's own statement.
  const nodes: DebateNode[] = [
    {
      id: "adv-stmt",
      type: "statement",
      position: { x: 0, y: 0 },
      data: { role: "claim", title: "Advocate claim", body: "", isRoot: true, authorId: ADVOCATE_ID },
    },
    {
      id: "chal-stmt",
      type: "statement",
      position: { x: 1, y: 1 },
      data: { role: "rebuttal", title: "Challenger rebuttal", body: "", authorId: CHALLENGER_ID },
    },
  ];
  useStore.setState({ debateId: "deb-1", nodes, edges: [], viewer, canEdit: false, error: null });
}

describe("mini-turn content freeze (Phase 4 store gates)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("canWriteContentNow pure helper", () => {
    it("is true for the challenger on a normal turn", () => {
      expect(canWriteContentNow(makeViewer({ isMyTurn: true, inMiniTurn: false }))).toBe(true);
    });

    it("is false for the challenger during their mini-turn", () => {
      expect(canWriteContentNow(makeViewer({ isMyTurn: true, inMiniTurn: true }))).toBe(false);
    });

    it("is true for the advocate even when the mini-turn flag is set (only the challenger is frozen)", () => {
      expect(
        canWriteContentNow(
          makeViewer({ viewerRole: "advocate", viewerId: ADVOCATE_ID, isMyTurn: true, inMiniTurn: true }),
        ),
      ).toBe(true);
    });

    it("is false off-turn regardless of mini-turn", () => {
      expect(canWriteContentNow(makeViewer({ isMyTurn: false, inMiniTurn: false }))).toBe(false);
    });
  });

  describe("store gates for the challenger in the mini-turn", () => {
    beforeEach(() => {
      seed(makeViewer({ isMyTurn: true, inMiniTurn: true }));
    });

    it("content gates are false (myTurnOrPreExchange, canEditNode on own node)", () => {
      const s = useStore.getState();
      expect(s.myTurnOrPreExchange()).toBe(false);
      expect(s.canEditNode("chal-stmt")).toBe(false);
    });

    it("but canMarkNode stays true on the counterpart's statement", () => {
      expect(useStore.getState().canMarkNode("adv-stmt")).toBe(true);
    });
  });

  describe("store gates for the challenger on a normal turn (control)", () => {
    beforeEach(() => {
      seed(makeViewer({ isMyTurn: true, inMiniTurn: false }));
    });

    it("content gates are true and marking stays true", () => {
      const s = useStore.getState();
      expect(s.myTurnOrPreExchange()).toBe(true);
      expect(s.canEditNode("chal-stmt")).toBe(true);
      expect(s.canMarkNode("adv-stmt")).toBe(true);
    });
  });
});
