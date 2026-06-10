<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Challenger Marks Statements and Submits the First Turn

- **Plan**: context/changes/challenger-first-turn/plan.md
- **Mode**: Deep
- **Date**: 2026-06-10
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING → resolved (F2) |
| Blind Spots | WARNING → resolved (F1, F3) |
| Plan Completeness | PASS |

## Grounding
15/15 paths ✓, key symbols ✓ (canEdit @ `[id].astro:64`, column grant lock @ `create_exchanges.sql:75-76`, `is_debate_owner` definer, `nodes_update/delete` owner+author gate, `node_kind` enum, `var(--card)` paint @ `StatementNode.tsx:270`, S-02 no-write assertions @ `exchange.test.ts:184-189,257`), brief↔plan↔change ✓.

## Findings

### F1 — Turn phase is not enforced server-side for writes/marks

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (RLS) + Phase 2 (submit_turn) vs. Desired End State
- **Detail**: The widened nodes/relations INSERT and the marks INSERT/UPDATE gated only on `is_accepted_challenger()` (status='accepted', true the whole debate), not `current_turn`. After submit flips the turn to 'advocate', RLS still let the challenger write out of turn — only the client board locked. Lands as real corruption risk when S-04 ships.
- **Fix A ⭐ Recommended**: Add a turn-gated `can_write_as_challenger()` definer (membership + `current_turn='challenger'`), used by the widened INSERT and marks policies; keep `is_accepted_challenger` for read scope.
  - Strength: Closes the hole at the RLS layer while the code is already open.
  - Tradeoff: Needs a second definer to keep read-membership vs turn-gated-write distinct.
  - Confidence: MED — helper pattern proven (is_debate_owner); read/write split not spiked.
  - Blind spot: Confirm no read path depends on the turn arm.
- **Fix B**: Document as an accepted S-03 boundary; enforce turn in S-04.
- **Decision**: FIXED via Fix A — added `can_write_as_challenger` across widened INSERT, marks RLS, Critical Implementation Details, Phase 1 manual verification, and Phase 5 test contract.

### F2 — Mark grain drops the "per turn" dimension change.md requires

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — marks table (unique (node_id, marker_id))
- **Detail**: change.md says "persist mark state per statement per user per turn"; the plan's unique `(node_id, marker_id)` has no round/turn column — a later-round re-mark overwrites round-1 in place. Documented as a conscious "S-05 clears/flags the row" choice but contradicts change.md verbatim and assumes summaries never need round-1 history.
- **Fix A ⭐ Recommended**: Keep the mutable row; record the decision against change.md's "per turn" wording and the S-04 summary-input assumption.
  - Strength: No schema cost now; coherent if summaries read current state only.
  - Tradeoff: A later need to diff round N vs N-1 forces a migration.
  - Confidence: MED — depends on S-04 summary contract, not yet pinned.
  - Blind spot: Exact inputs S-04's divergence algorithm consumes.
- **Fix B**: Add `round_number` to marks now; unique `(node_id, marker_id, round)`.
- **Decision**: FIXED via Fix A + user-specified S-05 forward path — documented that S-05 adds a `valid boolean default true` column flipped to false **by the counterpart** (not the author) on invalidation, never deleting/overwriting the stance row; submit gate becomes "every advocate statement has a `valid=true` mark." Recorded at the marks-table contract and in Migration Notes.

### F3 — marks RLS doesn't restrict marks to kind='statement'

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — marks_insert / marks_update policy
- **Detail**: Spec says connectives carry no mark; submit_turn's gate filters `kind='statement'` so a stray connective mark won't break submission, but nothing in marks RLS stopped a direct API call from marking a connective. Plan's own Phase 5 bullet hedged.
- **Fix**: Add `and n.kind='statement'` to the marks_insert/update WITH CHECK (join nodes); enforce statement-only marking at RLS.
- **Decision**: FIXED — statement-only EXISTS predicate added to the marks RLS contract; Phase 5 test bullet firmed up to assert RLS rejects a connective mark.
