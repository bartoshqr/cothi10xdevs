import { describe, expect, it } from "vitest";
import { shallow } from "zustand/shallow";

import { selectMapEditorState, deriveCanAdd } from "@/components/debate/MapEditor";
import type { RFState, ViewerContext } from "@/components/debate/store";

// Regression (revoke didn't re-enable the board without a reload): MapEditorInner subscribes to
// the store via `useShallow(selectMapEditorState)`, and the canvas's writability (`canAdd`) is
// `deriveCanAdd`. The bug was that the selector subscribed to the *function* myTurnOrPreExchange
// (a stable reference) instead of `canEdit`, so setCanEdit(true) on revoke changed the store but
// produced an unchanged slice → no re-render → board stayed locked. These tests pin (1) canAdd's
// derivation and (2) that `canEdit` is part of the subscribed slice (flipping it changes the slice
// under the same shallow comparator useShallow uses).

// Stable shared references so two states differing only in `canEdit` are otherwise identical.
const NODES: RFState["nodes"] = [];
const EDGES: RFState["edges"] = [];
const MARKS: RFState["marks"] = {};
const noop = () => undefined;

function makeState(overrides: Partial<RFState>): RFState {
  return {
    nodes: NODES,
    edges: EDGES,
    debateId: "deb-1",
    error: null,
    clearError: noop,
    onNodesChange: noop,
    onEdgesChange: noop,
    stagePendingConnection: noop,
    pendingConnection: null,
    cancelConnection: noop,
    deleteNodes: noop,
    createStatementNode: noop,
    setRootNode: noop,
    addPendingPreview: noop,
    inEditNodeId: null,
    inEditEdgeId: null,
    setInEditEdgeId: noop,
    isInEditBlocked: noop,
    tryExitNodeEdit: noop,
    canEdit: true,
    canEditNode: noop,
    viewer: null,
    marks: MARKS,
    ...overrides,
  } as unknown as RFState;
}

function viewer(isMyTurn: boolean): ViewerContext {
  return {
    viewerId: "v",
    viewerRole: "advocate",
    advocateId: "v",
    isMyTurn,
    inMiniTurn: false,
    isCompleted: false,
    currentRound: 1,
  };
}

describe("deriveCanAdd", () => {
  it("follows canEdit pre-exchange (no viewer) — the revoke path", () => {
    expect(deriveCanAdd({ viewer: null, canEdit: false })).toBe(false);
    expect(deriveCanAdd({ viewer: null, canEdit: true })).toBe(true);
  });

  it("follows the viewer's turn during an exchange, ignoring canEdit", () => {
    expect(deriveCanAdd({ viewer: viewer(true), canEdit: false })).toBe(true);
    expect(deriveCanAdd({ viewer: viewer(false), canEdit: true })).toBe(false);
  });
});

describe("selectMapEditorState subscription contract", () => {
  it("yields a shallow-equal slice when nothing the canvas cares about changed", () => {
    expect(shallow(selectMapEditorState(makeState({})), selectMapEditorState(makeState({})))).toBe(true);
  });

  it("yields a *different* slice when canEdit flips — so revoke re-renders and re-enables", () => {
    // If canEdit were dropped from the selector again, these two slices would compare equal and
    // this assertion would fail — exactly the regression we're guarding.
    const locked = selectMapEditorState(makeState({ canEdit: false }));
    const unlocked = selectMapEditorState(makeState({ canEdit: true }));
    expect(shallow(locked, unlocked)).toBe(false);
  });
});
