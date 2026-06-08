# Optimistic Rollback / Reconciliation — Plan Brief

> Full plan: `context/changes/optimistic-rollback/plan.md`

## What & Why

Five optimistic mutation paths in `src/components/debate/store.ts` apply a change to the canvas, fire
an API call, and on failure call **only** `reportError` — leaving the canvas diverged from the database
until the user reloads. This wires re-fetch-on-failure reconciliation into all five so the canvas always
converges to persisted state. The concrete trigger from research: an optimistically deleted node that the
server rejects vanishes, then reappears on refresh.

## Starting Point

Optimistic *creates* already roll back (`rollbackNode`/`rollbackEdge`). The five non-create paths
(node-field update, node-position update, edge-kind update, node delete, edge delete) do not. The
reconcile primitives `apiGetGraph` (`persistence.ts:87`) and `setGraph` (`store.ts:346`) already exist
but have **no caller** — scaffolded for this change.

## Desired End State

Every server-rejected mutation on a persisted debate leaves the canvas equal to the DB: the error banner
shows **and** the canvas snaps to authoritative state immediately, no reload. Concurrent/rapid failures
(batch delete, drag-spam) trigger at most one in-flight re-fetch. If the re-fetch itself fails, a distinct
"reload the page" banner appears and the canvas is left untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Reconcile granularity | Whole-graph re-fetch (`apiGetGraph`+`setGraph`) | Uses the already-scaffolded primitives; one path for all failures | Plan |
| Live unsaved edits vs reconcile | Server wins for committed entities; in-flight creates preserved | Canvas-equals-DB is the goal, but a reconcile must not erase a not-yet-committed create | Plan |
| Create-rollback vs reconcile | Two separate mechanisms | `reconcileFromServer` never touches `reconcileNode`/`rollbackNode`/`unsavedEdgeIds`-owned creates | Plan |
| Concurrent failures | Single-flight + coalesce | A batch delete failing N times triggers ≤1 re-fetch, not N | Plan |
| Re-fetch itself fails | Distinct banner, no retry | No infinite loop; honest, actionable message; no regression | Plan |
| Open editor on reconcile | Close editor, clear selection | No editing a node whose data just changed underneath | Plan |
| Error copy | Keep per-action message | Action message + reverted canvas already tell the story | Plan |
| Code shape | One `reconcileFromServer()` helper | One place owns the storm guard + bookkeeping reset; 5 paths become one-liners | Plan |
| Test layer | Hermetic stub client | Forcing a mid-sequence rejection is what real infra can't easily do | Plan |

## Scope

**In scope:** reconcile wiring for all 5 non-create paths; the `reconcileFromServer` helper; hermetic
tests; verify the already-shipped FK 500→409 mapping; cookbook + Progress sync.

**Out of scope:** `setRootNode` (already apply-on-success); root-identity 3b/3c (shipped in
`testing-persistence-floor`); implementing the FK mapping (already done, `repository.ts:154`); per-entity
re-fetch endpoints; retry/backoff; Stryker; preserving local unsaved edits.

## Architecture / Approach

Add one module-scoped `reconcileFromServer()` (single-flight guard → `apiGetGraph` → snapshot in-flight
creates → clear `patchBuffers`/`patchTimers` only → `setGraph` + re-append the pending creates → close
editor; distinct banner on fetch failure). It is a **second, independent mechanism** — the existing
create-rollback path (`reconcileNode`/`rollbackNode`/`unsavedEdgeIds`) is left untouched, and reconcile
deliberately preserves in-flight creates so their own handlers still resolve. Replace the bare
`reportError(...)` in the four catch sites (node-field and position share `flushPatch`) with
`reportError(...)` + `void reconcileFromServer()`. Prove every branch with hermetic stub tests that
reject the api fns and resolve `apiGetGraph` with authoritative rows.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reconcile + wiring | `reconcileFromServer()` + 4 catch sites wired + hermetic tests | Clobbering live edits via stale bookkeeping; single-flight correctness in a high-churn file |
| 2. Verify FK + docs | Confirm FK 409 coverage; §6 cookbook + Progress sync | FK mapping/test silently regressed upstream |

**Prerequisites:** none — `apiGetGraph`/`setGraph` already exist; hermetic mock pattern established.
**Estimated effort:** ~1–2 sessions (Phase 1 is the meat; Phase 2 is verification + docs).

## Open Risks & Assumptions

- Assumes `apiGetGraph` returns the full authoritative graph in the same shape `setGraph` consumes (confirmed: `hydrate` uses `rowsToGraph(graph.debate, graph.nodes, graph.relations)`).
- `store.ts` is the repo's highest-churn file — the wiring must not disturb the create-rollback or debounce paths; covered by keeping changes additive (append a call, no rewrites).
- Single-flight must coalesce-not-drop: a failure during an in-flight reconcile must schedule exactly one more, or newer server state is missed.

## Success Criteria (Summary)

- A server-rejected update/delete reconciles the canvas to the DB with no manual reload.
- A batch-delete failure re-fetches at most once; an offline re-fetch shows the distinct banner and leaves the canvas as-is.
- Hermetic suite (`npm run test:unit`) and the existing FK integration test stay green.
