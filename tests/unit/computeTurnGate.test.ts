import { describe, expect, it } from "vitest";

import { computeTurnGate } from "@/components/debate/MapEditor";
import type { DebateNode, ViewerContext } from "@/components/debate/store";
import type { MarkStance } from "@/components/debate/mapVisualLanguage";

// The gate counts the *counterpart's* statements (authorId !== viewerId) and how many
// the viewer has marked. It is symmetric — these tests drive it from the advocate's seat
// (the S-04 addition) to prove it counts the challenger's statements, not the advocate's.

const ADVOCATE = "adv-1";
const CHALLENGER = "cha-1";

function statement(id: string, authorId: string): DebateNode {
  return { id, type: "statement", position: { x: 0, y: 0 }, data: { role: "claim", title: id, body: "", authorId } };
}

function connective(id: string, authorId: string): DebateNode {
  return { id, type: "connective", position: { x: 0, y: 0 }, data: { op: "and", authorId } };
}

function advocateViewer(isMyTurn = true): ViewerContext {
  return {
    viewerId: ADVOCATE,
    viewerRole: "advocate",
    advocateId: ADVOCATE,
    isMyTurn,
    inMiniTurn: false,
    isCompleted: false,
    currentRound: 1,
  };
}

describe("computeTurnGate", () => {
  it("returns a zero gate when there is no viewer (pre-exchange / local-only)", () => {
    const nodes = [statement("s1", CHALLENGER)];
    expect(computeTurnGate(nodes, {}, null)).toEqual({
      isMyTurn: false,
      markedCount: 0,
      total: 0,
      isMiniTurn: false,
      isCompleted: false,
      currentRound: 1,
    });
  });

  it("counts the counterpart's statements as the total for the advocate viewer", () => {
    // Two challenger statements + one of the advocate's own — total must be the 2 counterpart ones.
    const nodes = [statement("c1", CHALLENGER), statement("c2", CHALLENGER), statement("a1", ADVOCATE)];
    const gate = computeTurnGate(nodes, {}, advocateViewer());
    expect(gate.total).toBe(2);
    expect(gate.markedCount).toBe(0);
  });

  it("tracks markedCount as the viewer marks counterpart statements", () => {
    const nodes = [statement("c1", CHALLENGER), statement("c2", CHALLENGER), statement("a1", ADVOCATE)];
    const marks: Partial<Record<string, MarkStance>> = { c1: "agree" };
    const gate = computeTurnGate(nodes, marks, advocateViewer());
    expect(gate.total).toBe(2);
    expect(gate.markedCount).toBe(1);
  });

  it("ignores marks on the viewer's own statements", () => {
    const nodes = [statement("c1", CHALLENGER), statement("a1", ADVOCATE)];
    // A mark keyed on the advocate's own node must not inflate the count.
    const marks: Partial<Record<string, MarkStance>> = { a1: "agree" };
    const gate = computeTurnGate(nodes, marks, advocateViewer());
    expect(gate.total).toBe(1);
    expect(gate.markedCount).toBe(0);
  });

  it("excludes connective nodes from the count", () => {
    const nodes = [statement("c1", CHALLENGER), connective("k1", CHALLENGER)];
    const gate = computeTurnGate(nodes, {}, advocateViewer());
    expect(gate.total).toBe(1);
  });

  it("passes through the viewer's isMyTurn flag", () => {
    const nodes = [statement("c1", CHALLENGER)];
    expect(computeTurnGate(nodes, {}, advocateViewer(false)).isMyTurn).toBe(false);
    expect(computeTurnGate(nodes, {}, advocateViewer(true)).isMyTurn).toBe(true);
  });

  it("passes through the viewer's mini-turn and completed flags for a live header", () => {
    const nodes = [statement("c1", CHALLENGER)];
    const miniViewer: ViewerContext = { ...advocateViewer(false), inMiniTurn: true, isCompleted: false };
    const doneViewer: ViewerContext = { ...advocateViewer(false), inMiniTurn: false, isCompleted: true };
    expect(computeTurnGate(nodes, {}, miniViewer)).toMatchObject({ isMiniTurn: true, isCompleted: false });
    expect(computeTurnGate(nodes, {}, doneViewer)).toMatchObject({ isMiniTurn: false, isCompleted: true });
  });

  it("passes through the viewer's current round for a live header counter", () => {
    const nodes = [statement("c1", CHALLENGER)];
    const round2Viewer: ViewerContext = { ...advocateViewer(), currentRound: 2 };
    expect(computeTurnGate(nodes, {}, round2Viewer).currentRound).toBe(2);
  });
});
