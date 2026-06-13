<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-05 Multi-round Edit/Delete with Mark Invalidation

- **Plan**: context/changes/s05/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-13
- **Verdict**: NEEDS ATTENTION (triaged → resolved)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verification (automated success criteria)

- Unit: 103/103 pass · Integration: 54/54 pass · `npx astro check`: 0 errors · `npm run lint`: clean · `npm run db:types`: no diff (in sync).
- All 4 phases' Progress checkboxes `[x]`; manual items checked with evidence in the plan.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Service-role caller bypasses mark-invalidation authorization

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260612000002_invalidate_marks_on_edit.sql:90
- **Detail**: For a service-role caller (auth.uid() NULL) the DEFINER body — including the marks UPDATE that flips valid=false — runs unconditionally with no auth check. The DEFINER body bypasses RLS, so there is no backstop. Not reachable today (updateNode only uses the anon/RLS client); the safety property now rests on call-site discipline.
- **Fix A ⭐ Recommended**: Document the invariant (comment at migration + updateNode). Zero behavior change.
  - Strength: No behavior change; the bypass is intentional parity with patch_node and no service-role caller exists.
  - Tradeoff: Future direct service-role caller could still misuse it (now documented against).
  - Confidence: HIGH — only updateNode calls this, via the RLS client.
- **Decision**: FIXED via Fix A — added an INVARIANT comment block at the migration's auth guard and a call-site note in `updateNode` (repository.ts) stating the RPC must be called with the anon/RLS client and never a service-role client.

### F2 — Root-demotion guard lives only in the repo, not the now-sole edit RPC

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/debate/repository.ts:108-118
- **Detail**: `can_write_node_content` checks author + turn/owner but not the "root claim can't be demoted" rule, enforced only app-side in `updateNode`. Since the RPC is now the single edit path and bypasses RLS, a future direct caller would lose the guard. No bug on the current path.
- **Fix**: Document the coupling (root-demotion check must precede every call) or push it into the RPC.
- **Decision**: ACCEPTED — the F1 call-site comment already documents this coupling ("trusts that the root-demotion guard above ran first"). No further change.

### F3 — Optimistic mark rollback can resurrect a stale valid=true mark

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/debate/store.ts:846-859 (setMark)
- **Detail**: `setMark` snapshots `prevState` then restores it on server error. If a poll-driven `reconcileFromServer()` lands between the optimistic write and the failure (e.g. the counterpart's edit just invalidated this mark), the rollback writes back the stale snapshot, briefly showing a valid mark the server now treats as invalid. Small window, self-heals on next poll.
- **Fix**: On mark-save failure call `reconcileFromServer()` instead of (or after) restoring the captured snapshot.
- **Decision**: FIXED — after the rollback, when a prior server-side mark existed (`prevState !== undefined`), `setMark` now calls `reconcileFromServer()` to re-pull authoritative state. First-mark drops skip it (nothing server-side).

### F4 — Incomplete-connective gating added beyond plan scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/debate/connectivity.ts:91-98; MapEditor.tsx (ConnectivityDetail); TurnBar.tsx:96; InviteChallenger.tsx:393
- **Detail**: The plan's gate covers dangling/orphan statements only. The implementation also threads `incompleteConnectiveIds` (connectives with <2 operands, FR-007) through the gate, `TurnBar.canSubmit`, and the invite guard. Sound and consistent, but extends plan scope without an addendum.
- **Fix**: Document the connective gate as a plan addendum so the plan stays the source of truth.
- **Decision**: FIXED — added an "Addenda (discovered during implementation)" section to plan.md recording the incomplete-connective gating.

### F5 — Stale-mark label wording differs from plan

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/debate/nodes/StatementNode.tsx:531
- **Detail**: Label reads "CHANGED: Need re-evaluation"; plan specified "Needs re-evaluation" (also "Need" vs "Needs" grammar).
- **Fix**: Adjust the copy if exact plan wording matters; otherwise accept.
- **Decision**: NOTED — observation, no action taken (cosmetic copy).

### F6 — Out-of-feature dev-config fix bundled on the branch

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: astro.config.mjs (commit e9eb7ce)
- **Detail**: "pre-bundle React entry points to stop jsxDEV SSR crash" is a dev-tooling fix unrelated to S-05, build-config only, no runtime impact.
- **Fix**: None needed — benign; rode on this branch.
- **Decision**: NOTED — no action.

### F7 — incompleteConnectiveIds ignores connective op type

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/debate/connectivity.ts:91-98
- **Detail**: The ≥2-operands rule is applied to every connective regardless of AND/OR semantics. Consistent with current data (only AND/OR exist); name/comment promise more specificity than enforced. No bug today.
- **Fix**: None needed now; revisit if a single-operand connective type is added.
- **Decision**: NOTED — no action.
