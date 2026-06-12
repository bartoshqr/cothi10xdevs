<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-04 first-divergence-summary

- **Plan**: context/changes/s04/plan.md
- **Scope**: Full plan (Phases 1–5 of 5)
- **Date**: 2026-06-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria verification (run during review)

- `npx astro check` → 0 errors (127 files)
- `npm run test:unit` → 68/68 pass
- `npm run test:integration` → 45/45 pass (was 42; +3 from the F1 fix)
- `npm run build` → complete

## Findings

### F1 — New mini-turn + write-immutability authz behavior is untested

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260611000002_round_close_and_mini_turn.sql (can_add_content_as_current_actor + nodes/relations write policies)
- **Detail**: Phase 1 pulled the always-on mini-turn (challenger frozen from adding content while `in_mini_turn=true`) and full write-immutability (lock on `pending`, immutable on `completed`) forward from S-05. The plan epilogue admits the behavior "is not yet covered by dedicated tests," which contradicts the standing lesson "Enforce turn/phase as an RLS predicate … assert the off-turn write is RLS-rejected in the integration suite." Happy-path passed; the negative paths had no assertion.
- **Fix**: Add integration cases (challenger INSERT during mini-turn rejected; any write on `completed` rejected; owner write while `pending` rejected), reusing the marks.test.ts off-turn fixture.
  - Strength: Closes the exact gap the epilogue flags; satisfies the standing lesson; reuses the two-user fixture.
  - Tradeoff: ~3 new test cases — modest, no production change.
  - Confidence: HIGH — negative-path pattern already exists in marks.test.ts.
  - Blind spot: Fixture seeds `in_mini_turn=true` via a direct service-client UPDATE rather than driving a full advocate submit.
- **Decision**: FIXED — added `tests/integration/writeImmutability.test.ts` (3 cases): mini-turn content-freeze (mark still allowed), full immutability on `completed` (both parties rejected), owner lock-out on `pending`. Integration suite 42 → 45, all green.

### F2 — FR-019/FR-027 pulled forward from S-05 into this slice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: plan.md §"Shifts during implementation" §1–2
- **Detail**: The final-round mini-turn and write-immutability on close — both listed under "What We're NOT Doing" — were implemented anyway. Handled correctly (struck-through bullets, documented rationale, consolidated migration). Residual concern is bookkeeping: S-05 scope must be trimmed so it doesn't re-plan shipped work.
- **Fix**: When S-05 is framed, cross-check its scope against these two addenda (no code change — scope-tracking note).
- **Decision**: FIXED — added a "Scope already shipped in S-04 (do not re-plan)" section to `context/changes/s05/change.md` listing the mini-turn and write-immutability as done, and naming what remains genuinely S-05 (mark invalidation, orphan highlighting, explicit close, 7-day timeout).

### F3 — Leftover DRY TODO + duplicated round-gate predicate

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/debate/DivergenceSummary.tsx:172-174 (TODO); src/lib/summary/repository.ts:37 + DivergenceSummary.tsx:154 (gate dup)
- **Detail**: A committed `// TODO … DRY` sits above `counterpartLabel`. Separately, the round-gate rule `completed || currentRound >= 2` is hand-written in two spots (plus implicitly in `deriveViewer`). A future tweak to the gate would need multiple edits.
- **Fix**: Drop the TODO; extract `isSummaryGateMet({ status, currentRound })` in `src/lib/summary` and call it from the repository and the component.
- **Decision**: SKIPPED — cosmetic; left as-is.
