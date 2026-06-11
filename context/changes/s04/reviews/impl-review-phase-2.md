<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-04 first-divergence-summary

- **Plan**: context/changes/s04/plan.md
- **Scope**: Phase 2 of 5 (Frontend — advocate turn)
- **Date**: 2026-06-11
- **Verdict**: NEEDS ATTENTION (all findings triaged & resolved)
- **Findings**: 0 critical, 2 warnings, 2 observations
- **Commit reviewed**: 031fc5d

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated; manual 2.4–2.7 pending — browser-only) |

Automated criteria verified during review: `computeTurnGate` 8/8 · `npx astro check` 0 errors · modified store-test mocks 15/15.

## Findings

### F1 — Reload-free turn-flip is non-transactional: header can outrun the board

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/debate/MapEditor.tsx (poll ~283–322)
- **Detail**: The counterpart-sync poll patched viewer flags synchronously, then fired `reconcileFromServer()` as fire-and-forget `void`. The "already handled" guard keyed off the viewer patch, so the resync ran exactly once per flip. If that single reconcile rejected, the header flipped to "my turn"/"complete" while the canvas kept stale nodes/marks, with no self-recovery until a manual reload.
- **Fix**: Reorder so `reconcileFromServer()` is awaited BEFORE the viewer-flag `setState`. On rejection the catch leaves the flags un-patched, so the divergence persists and the next 1s tick retries. (Also dropped a redundant `stopped` guard ESLint flagged as always-falsy; safe because `useStore.setState` writes a global Zustand store, not React component state.)
  - Strength: Restores the reload's atomicity without the flicker; header and board can't disagree past one failed tick.
  - Tradeoff: Header update now waits on the graph fetch instead of leading it.
  - Confidence: HIGH — root cause clear in the diff; only the poll's control flow changes.
  - Blind spot: Haven't measured real-world resync failure rate on local/CF.
- **Decision**: FIXED via Fix now

### F2 — Undocumented seed.sql coordinate change in a Phase-2 commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/seed.sql (node x/y at ~179, 192, 200, 208)
- **Detail**: The Phase-2 commit repositions four challenger seed nodes (coordinates only). Cosmetic and harmless, but not named in CHANGE 1–3 or any "Shifts during implementation" entry — the only change in this commit outside the documented set.
- **Fix**: Add a one-line note to the plan's "Shifts during implementation" section (added as §7).
- **Decision**: FIXED via Fix now (plan.md §7)

### F3 — Stale "we reload …" comment after the reload was removed

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/debate/MapEditor.tsx (~265–272)
- **Detail**: The block comment above the poll still described the removed `window.location.reload()`, contradicting the now reload-free (patch + reconcile) code.
- **Fix**: Rewrote the comment to describe the reconcile-then-patch path and the order dependency.
- **Decision**: FIXED via Fix now

### F4 — submitTurn patches turn flags but not currentRound on the submitter's seat

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/debate/store.ts (submitTurn ~826–841)
- **Detail**: `submitTurn` derived `isMyTurn`/`inMiniTurn`/`isCompleted` from the authoritative row but left `currentRound` untouched, so the submitter's own `n/round_count` counter didn't advance until the next poll/reconcile. Consistent with shift §5's stated design, flagged for the record.
- **Fix**: Added `currentRound: row.current_round` to the `submitTurn` viewer patch.
- **Decision**: FIXED via Fix now

## Triage summary

- Fixed: F1, F3, F4 (code) — MapEditor.tsx, store.ts
- Documented: F2 — plan.md §7
- Skipped: none
- Accepted-as-risk: none

Post-fix verification: `npx astro check` 0 errors; per-edit hook (eslint + vitest related) green on the touched files.
