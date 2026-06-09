<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-02 — Advocate invites a challenger and opens the exchange

- **Plan**: context/changes/invite-and-open-exchange/plan.md
- **Scope**: All phases (1–5 + 4.5)
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Automated verification (re-run live during review)

| Check | Result |
|-------|--------|
| `npm run test:unit` | 52 passed |
| `npm run lint` | clean (exit 0) |
| `npx astro check` | 0 errors |
| `npm run test:integration` | 32 passed |
| `npm run build` | success |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Phase 5 checked complete but uncommitted (no SHA)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Success Criteria
- **Location**: plan.md:687-688 ; git working tree
- **Detail**: Progress marks 5.1/5.2 as `[x]` without an appended commit SHA (unlike every prior phase). The Phase 5 files were uncommitted at review time (`tests/integration/exchange.test.ts` untracked; `globalSetup.ts` + `helpers.ts` modified). All checks pass green, but the work was not captured; 5.3 (skip-when-env-absent) remains `[ ]`. The test file was also observed being edited mid-review (an inline `service.auth.admin.createUser` block that failed `eslint .` with 9 `no-unsafe-*` errors was refactored to the typed `createTestUser`/`deleteTestUser` helpers and now lints clean).
- **Fix**: Commit the Phase 5 fixtures + suite and append the SHA to 5.1/5.2 in Progress; finish or explicitly defer 5.3.
- **Decision**: SKIPPED

### F2 — Unplanned migration adds a SECURITY DEFINER fn to break RLS recursion

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql
- **Detail**: `exchanges_insert` WITH CHECK queries `debates`, whose widened `debates_select` queries `exchanges` — a cross-table RLS cycle that Postgres rejects with SQLSTATE 42P17. Fixed correctly by wrapping the ownership check in a `SECURITY DEFINER` `is_debate_owner(uuid)` (stable, `search_path` pinned, EXECUTE revoked from public/anon). Migration not in the plan and in mild tension with the plan's "no security-definer function" stance — but that stance was about the READ predicate (still inline EXISTS, untouched); the fix is correctly scoped to the INSERT check only. No code change needed.
- **Fix**: None required. Recorded as a reusable lesson.
- **Decision**: ACCEPTED-AS-RULE: Break cross-table RLS recursion (42P17) with a SECURITY DEFINER helper on the policy that writes (added to context/foundation/lessons.md). Code already correct — no fix applied.

### F3 — hasRoot / isWellFormed props threaded to InviteChallenger but unused

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Pattern Consistency
- **Location**: src/pages/debates/[id].astro:91-92 ; src/components/debate/InviteChallenger.tsx:17-31
- **Detail**: Both props are declared in `Props` and passed from the page, but the component only destructures `{ debateId, existingExchange }`. The plan's optional inline gate-hint was dropped (server 422 via `apiError` is the sole gate feedback — consistent with "server stays authoritative"). The props are dead, plus a wasted `isMapWellFormed` call in the page frontmatter. No lint error (never bound).
- **Fix**: Remove both props from the interface, the JSX, and the two derive lines in `[id].astro` (or wire them into an inline hint if desired).
- **Decision**: SKIPPED

## Strengths

- RLS read-membership rewrite faithful to the plan: inline `EXISTS` kept in sync across `debates`/`nodes`/`relations` with the shared comment block.
- Column-level grant locks `exchanges` updates to `status`/`responded_at` — the defense-in-depth the plan specified.
- Two-part FR-007 gate uses the shared pure `isMapWellFormed` helper for both the server gate and the page flag (no duplicated operand logic).
- Integration suite genuinely proves the pending-grants-READ-not-WRITE matrix, decline/revoke closing reads, self-invite (422), duplicate-open (409), and respond transitions.
