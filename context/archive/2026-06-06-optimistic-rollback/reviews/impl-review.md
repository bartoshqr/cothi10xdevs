<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Optimistic Rollback / Reconciliation

- **Plan**: context/changes/optimistic-rollback/plan.md
- **Scope**: Phase 1 + 2 of 2
- **Date**: 2026-06-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated checks (re-run live)

| Criterion | Result |
|---|---|
| 1.1 `npx astro check` | PASS — 0 errors |
| 1.2 `npm run lint` | PASS — clean |
| 1.4/1.5 new unit files | PASS — 13 tests |
| 2.1 `rootProtection.test.ts` | PASS — 6 tests |
| 2.3 cookbook grep | PASS — entry present |

## Summary

Clean implementation. The `reconcileFromServer` helper matches the plan's contract
precisely — single-flight (`reconciling`/`reconcileQueued`), committed-bookkeeping
reset (`patchTimers`/`patchBuffers` cleared, `unsavedEdgeIds` left intact),
in-flight-create snapshot-and-reappend, editor close, and the exact pinned
refetch-failure message. All four planned catch sites are wired; tests are
behavioural (oracle pinned from the plan, not mirrored from code) and green.

Note on git scope: the date-based scope sweep also includes commit `8f7d5eb`
(duplicate-directed-edge 409), which is a **separate** feature, not part of this
plan. It is addressed only in F1 for completeness.

## Findings

### F1 — A separate feature added a 5th reconcile call into a create path

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/debate/store.ts:382
- **Detail**: The plan is explicit that `reconcileFromServer` is "a second, orthogonal mechanism for the five NON-create paths" and create paths "keep their existing rollbackNode/rollbackEdge behavior untouched" (plan L91, L97-101). Commit `8f7d5eb` (the duplicate-directed-edge 409 feature — NOT part of this plan) later added a 5th call site inside `commitConnection`'s create `.catch`: `if (e instanceof ApiError && e.status === 409) void reconcileFromServer();`. This is a different change, so it is not scope creep within this plan — but it invokes the helper this plan owns, from a path the plan said it would not serve. Verified safe: `rollbackEdge(edgeId)` runs first (removing edgeId from `unsavedEdgeIds`), so the subsequent reconcile won't preserve the rolled-back edge, and the server's existing duplicate edge surfaces correctly.
- **Fix**: None required — behavior is correct and documented in-code. Optionally add a one-line plan addendum noting the create-409 path now also reconciles.
- **Decision**: SAVED (report-only)

### F2 — Manual 1.7 is effectively satisfied but left unchecked in Progress

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md:356 (Progress 1.7)
- **Detail**: 1.7 ("batched delete does not refetch repeatedly") is tagged "Agent-automatable: Yes" and is proven by the single-flight assertion in `optimisticReconcile.store.test.ts` (suite passes). It sits unchecked alongside the browser-only items 1.6 and 1.8. 1.6/1.8 genuinely need two live browser sessions / DevTools throttling and are legitimately pending.
- **Fix**: Tick 1.7 in Progress (cite the passing single-flight test); leave 1.6/1.8 as the only true manual remainder.
- **Decision**: SAVED (report-only)

### F3 — Helper is exported though plan specified "module-scoped function"

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/debate/store.ts:253
- **Detail**: Plan §1 says "New module-scoped async function reconcileFromServer()". The implementation exports it (`export async function`) so the hermetic tests can call it directly — a reasonable, test-driven deviation that mirrors how the test files import it. No leakage concern; it's a pure catch-block helper.
- **Fix**: None — the export is justified by the test contract.
- **Decision**: SAVED (report-only)
