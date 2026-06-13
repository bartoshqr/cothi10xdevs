import { describe, expect, it } from "vitest";

import { computeTurnGate } from "@/components/debate/MapEditor";
import type { DebateNode, DebateEdge, ViewerContext } from "@/components/debate/store";
import type { MarkState } from "@/components/debate/mapVisualLanguage";

// The gate counts the *counterpart's* statements (authorId !== viewerId) and how many
// the viewer has marked. It is symmetric — these tests drive it from the advocate's seat
// (the S-04 addition) to prove it counts the challenger's statements, not the advocate's.

const ADVOCATE = "adv-1";
const CHALLENGER = "cha-1";

function statement(id: string, authorId: string): DebateNode {
  return { id, type: "statement", position: { x: 0, y: 0 }, data: { role: "claim", title: id, body: "", authorId } };
}

function rootStatement(id: string, authorId: string): DebateNode {
  return {
    id,
    type: "statement",
    position: { x: 0, y: 0 },
    data: { role: "claim", title: id, body: "", authorId, isRoot: true },
  };
}

function edge(source: string, target: string): DebateEdge {
  return { id: `${source}->${target}`, type: "relation", source, target, data: { kind: "supports" } };
}

function linkEdge(source: string, target: string): DebateEdge {
  return { id: `${source}-link->${target}`, type: "relation", source, target, data: { kind: "link" } };
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

function valid(stance: MarkState["stance"]): MarkState {
  return { stance, valid: true };
}

function stale(stance: MarkState["stance"]): MarkState {
  return { stance, valid: false };
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
      danglingCount: 0,
      danglingTitles: [],
      incompleteConnectiveCount: 0,
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
    const marks: Partial<Record<string, MarkState>> = { c1: valid("accept") };
    const gate = computeTurnGate(nodes, marks, advocateViewer());
    expect(gate.total).toBe(2);
    expect(gate.markedCount).toBe(1);
  });

  it("ignores marks on the viewer's own statements", () => {
    const nodes = [statement("c1", CHALLENGER), statement("a1", ADVOCATE)];
    // A mark keyed on the advocate's own node must not inflate the count.
    const marks: Partial<Record<string, MarkState>> = { a1: valid("accept") };
    const gate = computeTurnGate(nodes, marks, advocateViewer());
    expect(gate.total).toBe(1);
    expect(gate.markedCount).toBe(0);
  });

  it("treats an invalid (stale) mark as unmarked", () => {
    const nodes = [statement("c1", CHALLENGER), statement("c2", CHALLENGER)];
    // c1 has a stale mark (valid=false) — should not count toward markedCount
    const marks: Partial<Record<string, MarkState>> = { c1: stale("accept"), c2: valid("challenge") };
    const gate = computeTurnGate(nodes, marks, advocateViewer());
    expect(gate.total).toBe(2);
    expect(gate.markedCount).toBe(1);
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

  it("counts the viewer's own statements that no longer reach root as dangling", () => {
    // root (advocate) ← a1 connected; a2 is severed (no edge). a2 is the advocate's own orphan.
    const nodes = [rootStatement("root", ADVOCATE), statement("a1", ADVOCATE), statement("a2", ADVOCATE)];
    const edges = [edge("a1", "root")];
    const gate = computeTurnGate(nodes, {}, advocateViewer(), edges);
    expect(gate.danglingCount).toBe(1);
    expect(gate.danglingTitles).toEqual(["a2"]);
  });

  it("does not flag the counterpart's orphaned statements as the viewer's dangling", () => {
    // The challenger's orphan (c1) is not the advocate's problem — only own statements block.
    const nodes = [rootStatement("root", ADVOCATE), statement("c1", CHALLENGER)];
    const gate = computeTurnGate(nodes, {}, advocateViewer(), []);
    expect(gate.danglingCount).toBe(0);
    expect(gate.danglingTitles).toEqual([]);
  });

  it("suppresses the dangling count in the mini-turn (content frozen, orphans tolerated)", () => {
    const nodes = [rootStatement("root", ADVOCATE), statement("a2", ADVOCATE)];
    const miniViewer: ViewerContext = { ...advocateViewer(), inMiniTurn: true };
    const gate = computeTurnGate(nodes, {}, miniViewer, []);
    expect(gate.danglingCount).toBe(0);
  });

  it("reports zero dangling when every own statement reaches root", () => {
    const nodes = [rootStatement("root", ADVOCATE), statement("a1", ADVOCATE)];
    const edges = [edge("a1", "root")];
    const gate = computeTurnGate(nodes, {}, advocateViewer(), edges);
    expect(gate.danglingCount).toBe(0);
  });

  it("flags the viewer's own AND/OR connective with fewer than two operands", () => {
    // k1 (advocate's) has only one inbound link → incomplete.
    const nodes = [rootStatement("root", ADVOCATE), connective("k1", ADVOCATE), statement("a1", ADVOCATE)];
    const edges = [edge("k1", "root"), linkEdge("a1", "k1")];
    const gate = computeTurnGate(nodes, {}, advocateViewer(), edges);
    expect(gate.incompleteConnectiveCount).toBe(1);
  });

  it("does not flag a connective once it has two operands", () => {
    const nodes = [
      rootStatement("root", ADVOCATE),
      connective("k1", ADVOCATE),
      statement("a1", ADVOCATE),
      statement("a2", ADVOCATE),
    ];
    const edges = [edge("k1", "root"), linkEdge("a1", "k1"), linkEdge("a2", "k1")];
    const gate = computeTurnGate(nodes, {}, advocateViewer(), edges);
    expect(gate.incompleteConnectiveCount).toBe(0);
  });

  it("does not flag the counterpart's incomplete connectives as the viewer's problem", () => {
    // A challenger-owned connective with no operands is not the advocate's gate.
    const nodes = [rootStatement("root", ADVOCATE), connective("k1", CHALLENGER)];
    const gate = computeTurnGate(nodes, {}, advocateViewer(), []);
    expect(gate.incompleteConnectiveCount).toBe(0);
  });

  it("suppresses the incomplete-connective count in the mini-turn", () => {
    const nodes = [rootStatement("root", ADVOCATE), connective("k1", ADVOCATE)];
    const miniViewer: ViewerContext = { ...advocateViewer(), inMiniTurn: true };
    const gate = computeTurnGate(nodes, {}, miniViewer, []);
    expect(gate.incompleteConnectiveCount).toBe(0);
  });
});
