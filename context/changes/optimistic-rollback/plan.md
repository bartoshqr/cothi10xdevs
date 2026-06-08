# Optimistic Rollback / Reconciliation Implementation Plan

## Overview

Five optimistic mutation paths in `src/components/debate/store.ts` currently apply a change to the
canvas, fire an API call, and on failure call **only** `reportError` — leaving the canvas diverged
from the database until a manual page reload. This change wires **re-fetch-on-failure
reconciliation** into all five paths through a single, single-flight `reconcileFromServer()` helper:
on any mutation failure the store re-fetches the authoritative graph (`apiGetGraph`), rebuilds the
canvas (`setGraph`), clears all in-flight bookkeeping, and closes any open editor — so the canvas
always converges to persisted state.

The reconcile primitives (`apiGetGraph` at `persistence.ts:87`, `setGraph` at `store.ts:346`) already
exist and have **no caller today** — they were scaffolded for exactly this change. This is a wiring
job over delicate, high-churn code, not new architecture.

## Current State Analysis

- **Creates already roll back; the other five paths don't.** `rollbackNode` (`store.ts:211`) and
  `rollbackEdge` (`store.ts:228`) restore canvas state when a create POST fails. The five non-create
  paths have no equivalent — they `reportError` and stop:
  1. **update node fields** — `updateNodeFields` → `schedulePatch` → `flushPatch` → `apiUpdateNode`
     (debounced/coalesced; catch at `store.ts:190-192`)
  2. **update node position** — `onNodesChange` → `schedulePatch` → `flushPatch` (**same catch** as #1)
  3. **update edge kind** — `updateRelationKind` → `apiUpdateRelation` (catch at `store.ts:508-510`)
  4. **delete node** — `deleteNodes` → `apiDeleteNode` (per-node catch at `store.ts:474-476`)
  5. **delete edge** — `deleteEdge` → `apiDeleteRelation` (catch at `store.ts:492-494`)

  Because paths #1 and #2 share `flushPatch`, the five logical paths reduce to **four catch sites**.

- **The reconcile primitives exist but are unwired.** `apiGetGraph(debateId)` returns the full
  `DebateGraph` (`{ debate, nodes, relations }`); `setGraph(debate, nodeRows, relationRows)` rebuilds
  `nodes`/`edges` via `rowsToGraph`. Neither is called anywhere in `src/components/debate/` today —
  only `hydrate` is (from `MapEditor.tsx:377`).

- **`setGraph` does NOT reset bookkeeping.** Unlike `hydrate` (`store.ts:331-337`, which clears
  `patchTimers`, `patchBuffers`, `unsavedEdgeIds` and resets `inEditNodeId`/`inEditEdgeId`),
  `setGraph` only swaps `nodes`/`edges`/`pendingConnection`. A reconcile that calls `setGraph`
  without clearing the module-scoped maps risks a stale buffered patch or in-flight edge id
  re-applying over fresh server data — the central hazard.

- **`setRootNode` needs no rollback.** It is already apply-on-success (`store.ts:538-545`): it touches
  the canvas only after the server confirms.

- **The root-identity gaps (3b/3c) are already shipped.** `testing-persistence-floor` delivered root
  re-designation (p4) and demotion/delete guards (p5). They are out of scope here.

- **The root-delete FK 500→409 mapping is already implemented and tested.** `repository.deleteNode`
  maps SQLSTATE `23503` → `ConflictError` (`repository.ts:154`); `tests/integration/rootProtection.test.ts`
  covers it. This change only **verifies** it, no implementation.

- **Hermetic stub pattern is established.** `tests/unit/deleteRootBlock.store.test.ts` and
  `setRootNode.store.test.ts` already `vi.mock("@/components/debate/persistence", …)` with **all**
  api fns (including `apiGetGraph`) mocked. The reconcile tests reuse this exact pattern.

## Desired End State

Every server-rejected mutation on a persisted debate leaves the canvas equal to the database. A
failed update/delete shows its existing error banner **and** the canvas snaps to authoritative state
(e.g. a node that was optimistically deleted but FK-blocked reappears immediately, not on refresh).
Concurrent/rapid failures (batched delete, drag-spam) trigger **at most one** in-flight re-fetch. If
the re-fetch itself fails, a distinct "reload the page" banner appears and the canvas is left as-is.

Verified by: the hermetic unit suite (`npm run test:unit`) proving per-path convergence + single-flight
coalescing + bookkeeping reset + editor close + refetch-failure message; and a two-session manual test
proving real convergence in the browser.

### Key Discoveries:

- `apiGetGraph` + `setGraph` are scaffolded but unwired — wiring them is the whole job (`persistence.ts:87`, `store.ts:346`).
- `hydrate` is the reference for "what to clear" on a graph swap (`store.ts:331-337`).
- Paths #1 and #2 share `flushPatch`'s single catch — four call sites, not five (`store.ts:190-192`).
- The hermetic mock already lists `apiGetGraph` (`tests/unit/deleteRootBlock.store.test.ts:12`).

## What We're NOT Doing

- **Not** adding rollback to `setRootNode` — already apply-on-success.
- **Not** touching root-identity logic 3b/3c — shipped in `testing-persistence-floor`.
- **Not** implementing the FK 500→409 mapping — already done (`repository.ts:154`); we only re-verify it.
- **Not** building per-entity (`apiGetNode`/`apiGetRelation`) re-fetch endpoints — whole-graph re-fetch only.
- **Not** adding retry/backoff on the reconcile fetch — one attempt, then a "reload" banner.
- **Not** running Stryker (deselected from scope).
- **Not** preserving local unsaved edits across a reconcile — server state wins (decided).
- **Not** adding new user-facing copy beyond the one distinct refetch-failure message.

## Implementation Approach

Add one module-scoped `reconcileFromServer()` helper that owns the single-flight guard, the
`apiGetGraph` + `setGraph` swap, the bookkeeping reset (mirroring `hydrate`), the editor close, and
the distinct refetch-failure message. Then replace the bare `reportError(...)` in each of the four
catch sites with `reportError(...)` **followed by** `void reconcileFromServer()`. The create paths
keep their existing `rollbackNode`/`rollbackEdge` behavior untouched. Prove every branch with hermetic
stub tests that force the api fns to reject and `apiGetGraph` to resolve with authoritative rows.

## Critical Implementation Details

- **Two independent mechanisms — keep create-rollback fully separate.** The existing create path
  (`reconcileNode`/`rollbackNode` at `store.ts:196/211`, `reconcileEdge`/`rollbackEdge` at
  `store.ts:220/228`, plus the `unsavedEdgeIds` set) is **not modified and not invoked** by this
  change. `reconcileFromServer` is a second, orthogonal mechanism for the five non-create paths. The
  one rule binding them: **reconcile must not disturb an in-flight create** (see next bullet).
- **Preserve in-flight creates across the swap — do NOT mirror `hydrate` blindly.** `hydrate` clears
  everything because it is a cold load with nothing in flight; reconcile can race a live create.
  `apiGetGraph` will not contain a node/edge whose create POST hasn't committed yet, so a naive
  `setGraph` erases the pending node — and when its POST later resolves, `reconcileNode` can't find the
  temp id, leaving a persisted-but-invisible node until reload (the exact bug this change exists to
  kill). Therefore `reconcileFromServer` must: (1) **snapshot** the in-flight creates before swapping —
  local nodes with `data.pending === true` and edges whose id is in `unsavedEdgeIds`; (2) clear **only**
  the committed-entity bookkeeping `patchTimers` (each `clearTimeout`) + `patchBuffers` — **leave
  `unsavedEdgeIds` intact** for the preserved edges; (3) `setGraph(server graph)` then **append** the
  snapshotted pending nodes/edges on top. Their own `.then(reconcileNode)/.catch(rollbackNode)` (and
  edge equivalents) handlers then resolve normally, and the user's typed-but-uncommitted content
  (carried in the local pending node's `data`) survives. **Server wins for committed entities only;
  in-flight creates are owned by the create mechanism, not reconcile.**
- **Single-flight, not lock-and-drop.** A second failure arriving while a reconcile is in flight must
  not be silently lost — it may reflect newer server state. Use a `reconciling` flag plus a
  `reconcileQueued` flag: if called while in flight, set `reconcileQueued = true` and return; in the
  `finally`, if `reconcileQueued`, clear it and run exactly one more reconcile. This coalesces a burst
  of N failures into 1–2 fetches, never zero.
- **Clear committed bookkeeping synchronously with `setGraph`, after the `await`.** Do the
  snapshot → clear `patchTimers`/`patchBuffers` → `setGraph` + append → null
  `inEditNodeId`/`inEditEdgeId` in one synchronous block once `apiGetGraph` resolves — not before the
  await — so edits made to committed nodes during the fetch window are also discarded consistently.
- **Local-only guard.** `reconcileFromServer` must read `debateId` and no-op when it is `null` (a
  local-only canvas has nothing to reconcile and no endpoint to call). The four call sites already sit
  behind a `debateId` check, but the helper must be independently safe.
- **`flushPatch` is `async`; the catch is a real `try/catch`.** The other three sites are
  `.catch((e) => …)` Promise chains. The wiring shape differs per site but the added call
  (`void reconcileFromServer()`) is identical.

---

## Phase 1: Reconcile primitive + wire all five paths

### Overview

Add `reconcileFromServer()` and route all four failure catch sites through it. Cover the helper's
contract and each path's convergence with hermetic stub tests.

### Changes Required:

#### 1. Reconcile helper

**File**: `src/components/debate/store.ts`

**Intent**: Add a module-scoped `reconcileFromServer()` that re-fetches authoritative graph state and
replaces the canvas, clearing all in-flight bookkeeping and closing any open editor, with a
single-flight guard so concurrent failures coalesce into one fetch. On fetch failure it surfaces a
distinct, actionable banner and leaves the canvas untouched.

**Contract**: New module-scoped `async function reconcileFromServer(): Promise<void>` placed beside
the existing `reportError`/`rollbackNode` helpers, but **independent of** the create-rollback helpers
(it does not call or modify `reconcileNode`/`rollbackNode`/`reconcileEdge`/`rollbackEdge`). Reads
`debateId` from `useStore.getState()`; no-ops when `null`. Uses module-scoped `let reconciling = false`
+ `let reconcileQueued = false`. On success, in one synchronous block after the `await`:
(1) snapshot in-flight creates — `state.nodes` with `data.pending === true` and `state.edges` whose id
is in `unsavedEdgeIds`; (2) clear `patchTimers` (each `clearTimeout`) + `patchBuffers` **only** — leave
`unsavedEdgeIds` untouched; (3) `setGraph(graph.debate, graph.nodes, graph.relations)` then append the
snapshotted pending nodes/edges; (4) `useStore.setState({ inEditNodeId: null, inEditEdgeId: null })`.
On failure: `reportError` with a distinct message (see below) and leave the canvas untouched. It calls
the already-exported `apiGetGraph` from `./persistence`.

```ts
// Distinct refetch-failure message (the only new user-facing copy):
"Couldn't refresh the canvas — reload the page to see the latest."
```

#### 2. Wire the four catch sites

**File**: `src/components/debate/store.ts`

**Intent**: After each existing `reportError(...)` in the five non-create paths, trigger a reconcile so
the canvas converges to the server. Create paths are left as-is (they already roll back).

**Contract**: Append `void reconcileFromServer();` immediately after `reportError(...)` at:
`flushPatch` (`store.ts:190-192`, covers node-field **and** position), `updateRelationKind`
(`store.ts:508-510`), the `deleteNodes` per-node `.catch` (`store.ts:474-476`), and `deleteEdge`
(`store.ts:492-494`). No change to `createStatementNode`/`createConnectiveNode`/`commitConnection`.

#### 3. Hermetic tests — helper contract

**File**: `tests/unit/reconcileFromServer.store.test.ts` (new)

**Intent**: Prove the helper's contract in isolation: single-flight coalescing, bookkeeping cleared,
editor closed, and the distinct message on refetch failure.

**Contract**: Reuse the `vi.mock("@/components/debate/persistence", …)` pattern from
`deleteRootBlock.store.test.ts`. Cases: (a) two failures racing a held `apiGetGraph` promise →
`apiGetGraph` invoked once while in flight, then once more iff a failure arrived during it;
(b) a seeded buffered patch / live timer is gone after reconcile; (c) `inEditNodeId`/`inEditEdgeId`
reset to `null`; (d) `apiGetGraph` rejects → `error` equals the distinct refetch-failure message and
`nodes`/`edges` are unchanged; (e) **in-flight create survives** — seed a `pending` node (and an edge
in `unsavedEdgeIds`) absent from the `apiGetGraph` result, run reconcile, assert the pending
node/edge are **still present** on the canvas and `unsavedEdgeIds` still contains the edge id, so their
create handlers can later resolve.

#### 4. Hermetic tests — per-path convergence

**File**: `tests/unit/optimisticReconcile.store.test.ts` (new)

**Intent**: Prove each of the five logical paths converges the canvas to authoritative server state
when its mutation rejects.

**Contract**: `it.each` over the four call sites (node-field update, node-position update, edge-kind
update, edge delete) plus an explicit `deleteNodes` batch case. For each: seed a canvas, stub the
relevant `api*` fn to reject, stub `apiGetGraph` to resolve with an authoritative graph that differs
from the optimistic state (e.g. a deleted node still present), invoke the action, flush
timers/microtasks, assert `useStore.getState().nodes/edges` deep-equal the server graph. The batch case
asserts `apiGetGraph` is called at most twice for N>1 simultaneous delete failures (single-flight).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test:unit`
- New helper test file runs green: `npx vitest run tests/unit/reconcileFromServer.store.test.ts`
- New per-path test file runs green: `npx vitest run tests/unit/optimisticReconcile.store.test.ts`

#### Manual Verification:

- Two-session convergence: a mutation rejected by the server because another session changed the data snaps the first session's canvas to server state without a reload.
- Batched delete failure does not flicker/refetch repeatedly.
- A simulated offline reconcile shows the distinct "reload the page" banner and leaves the canvas as-is.

**Implementation Note**: After Phase 1 automated verification passes, pause for human confirmation of the
manual two-session test before proceeding to Phase 2.

---

## Phase 2: Verify FK mapping + docs & sync

### Overview

Confirm the already-shipped root-delete FK 500→409 mapping is still covered, then update the test-plan
cookbook and this plan's Progress section.

### Changes Required:

#### 1. Verify FK 409 mapping coverage

**File**: `src/lib/debate/repository.ts` (read-only verify) + `tests/integration/rootProtection.test.ts`
(read-only verify)

**Intent**: Confirm the `23503 → ConflictError` mapping (`repository.ts:154`) and its integration
coverage are intact. No code change unless the integration test no longer asserts the 409.

**Contract**: `rootProtection.test.ts` asserts a root-delete attempt returns 409/`ConflictError`. If
the assertion is present and green, mark verified; if absent, add a single assertion (no new file).

#### 2. Cookbook + Progress sync

**File**: `context/foundation/test-plan.md` (§6 cookbook) + `context/changes/optimistic-rollback/plan.md`

**Intent**: Record the reconcile pattern (re-fetch-on-failure via single-flight `reconcileFromServer`)
as a §6 cookbook entry under Risk #2, and tick the `## Progress` checkboxes.

**Contract**: One concise §6 entry naming the pattern, the helper, and the regression it catches
(canvas diverged-until-reload). Progress checkboxes updated with commit shas.

### Success Criteria:

#### Automated Verification:

- Integration root-protection test passes: `npx vitest run tests/integration/rootProtection.test.ts`
- Full test suite passes: `npm run test`
- Cookbook entry present: `grep -n "reconcileFromServer" context/foundation/test-plan.md`

#### Manual Verification:

- §6 cookbook entry reads clearly to someone who didn't write the change.

**Implementation Note**: Phase 2 is documentation + verification; no pause required beyond the automated checks.

---

## Testing Strategy

### Unit Tests (hermetic stub — the primary layer):

- Single-flight coalescing: N concurrent failures → ≤2 `apiGetGraph` calls.
- Bookkeeping reset: `patchTimers`/`patchBuffers`/`unsavedEdgeIds` empty after reconcile.
- Editor close: `inEditNodeId`/`inEditEdgeId` null after reconcile.
- Refetch failure: distinct banner message; canvas unchanged.
- In-flight create survives: a `pending` node/edge absent from the re-fetch is preserved (create-rollback path untouched).
- Per-path convergence (`it.each`): each of the five logical paths re-syncs nodes/edges to the server graph on rejection.

### Integration Tests:

- Existing `rootProtection.test.ts` (FK 500→409) — verify still green; do not duplicate.

### Manual Testing Steps:

1. Open the same persisted debate in two browser sessions (A and B).
2. In B, delete a node; in A (stale), edit that node's title → A's save 404s → A's canvas reconciles (the node disappears in A).
3. In A, delete an edge B already deleted → 404 → A converges; no repeated flicker.
4. Throttle the network to offline, trigger a failed mutation → observe the distinct "reload the page" banner; canvas stays put.

## Performance Considerations

A whole-graph re-fetch per failure is heavier than a per-entity patch, but failures are the exception,
and the single-flight guard caps a burst (batch delete, drag-spam) at one in-flight fetch. No hot-path
impact on the success case — `reconcileFromServer` is only reached from a catch block.

## Migration Notes

None — no schema or data changes. `setGraph`/`apiGetGraph` already exist; this only adds a caller.

## References

- Origin research (3d): `context/archive/2026-06-05-testing-persistence-floor/research.md` (findings 3a/3d, Decisions D4)
- Reconcile primitives: `src/components/debate/persistence.ts:87` (`apiGetGraph`), `src/components/debate/store.ts:346` (`setGraph`)
- Bookkeeping-reset reference: `src/components/debate/store.ts:331-337` (`hydrate`)
- Hermetic stub pattern: `tests/unit/deleteRootBlock.store.test.ts:4-13`
- FK 409 mapping (already shipped): `src/lib/debate/repository.ts:144-159`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reconcile primitive + wire all five paths

#### Automated

- [x] 1.1 Type checking passes: `npx astro check`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Unit tests pass: `npm run test:unit`
- [x] 1.4 Helper test file green: `npx vitest run tests/unit/reconcileFromServer.store.test.ts`
- [x] 1.5 Per-path test file green: `npx vitest run tests/unit/optimisticReconcile.store.test.ts`

#### Manual

- [ ] 1.6 Two-session convergence

  > **Agent-automatable**: Partial — the DB layer (server returns 404/authoritative graph) is scriptable via curl + SQL, but observing the canvas snap-back requires two live browser sessions an agent can't drive.

  ```bash
  # App-layer: confirm apiGetGraph returns authoritative state after a delete.
  # 1) Get a bearer token (password grant — avoids browser cookie extraction):
  curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" \
    -d '{"email":"<test-user>","password":"<pw>"}' | jq -r .access_token
  # 2) Delete a node, then GET the graph and confirm it's gone server-side:
  curl -s -X DELETE "http://localhost:4321/api/debates/$DEBATE_ID/nodes/$NODE_ID" -b "<session-cookie>"
  curl -s "http://localhost:4321/api/debates/$DEBATE_ID" -b "<session-cookie>" | jq '.nodes[].id'
  # Expected: $NODE_ID absent from the returned nodes — this is what reconcileFromServer applies.
  ```

  ```sql
  -- DB-layer confirmation the delete persisted:
  select id from nodes where debate_id = '<DEBATE_ID>' and id = '<NODE_ID>';
  -- Expected: 0 rows.
  ```

- [ ] 1.7 Batched delete failure does not refetch repeatedly

  > **Agent-automatable**: Yes — asserted by the hermetic single-flight test (1.5); the browser check is confirmatory only.

  ```bash
  npx vitest run tests/unit/optimisticReconcile.store.test.ts -t "single-flight"
  # Expected: apiGetGraph called ≤2 times for N>1 simultaneous delete failures.
  ```

- [ ] 1.8 Offline reconcile shows the distinct banner, canvas unchanged

  > **Agent-automatable**: No — requires DevTools network throttling and visual inspection of the banner + unchanged canvas in a real browser.

### Phase 2: Verify FK mapping + docs & sync

#### Automated

- [ ] 2.1 Integration root-protection test passes: `npx vitest run tests/integration/rootProtection.test.ts`
- [ ] 2.2 Full suite passes: `npm run test`
- [ ] 2.3 Cookbook entry present: `grep -n "reconcileFromServer" context/foundation/test-plan.md`

#### Manual

- [ ] 2.4 §6 cookbook entry reads clearly

  > **Agent-automatable**: Partial — presence is greppable (2.3), but judging clarity for a fresh reader is a human review step.

  ```bash
  grep -n -A6 "reconcileFromServer" context/foundation/test-plan.md
  # Expected: an entry naming the pattern, the helper, and the regression it catches.
  ```
