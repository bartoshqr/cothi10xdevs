<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Publishable Debate Showcase (S-09)

- **Plan**: context/changes/publishable-debate-showcase/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Summary

The security-critical core is solid. Two independent review agents confirmed the
anon/IDOR boundary: no `using(true)` policy, both SECURITY DEFINER helpers pin
`search_path = public`, the anon SELECT re-grant set is exactly the six tables the base
migrations revoked, and the owner-can-read-own-unpublished edge case is closed by
`isPublishedGraph`. Proven by 14 passing integration tests (incl. direct-by-`debate_id`
enumeration). All documented deviations are present as approved. Findings are polish, not
blockers.

Automated verification re-run live during review: `astro check` 0 errors; `lint` 0 errors
(3 pre-existing e2e warnings); `build` complete; 114 unit tests pass; 14 showcase
integration tests pass. Manual criteria 3.5–3.9 remain unchecked in Progress — expected
(browser/human pass), not rubber-stamped.

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

### F1 — Unplanned second migration (showcase_authenticated_visibility)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260624000002_showcase_authenticated_visibility.sql
- **Detail**: Plan specified ONE migration. A second was added: a
  `debates_select_authenticated_public` policy so a logged-in non-participant sees
  published debates in `listPublicDebates` (existing `debates_select` only matched
  owner/challenger, so the authenticated listing silently returned nothing for outsiders).
  Additive, OR'd, correct — a genuine functional gap, not scope creep. Not recorded in
  plan.md's Phase 1 contract; its companion test (`showcaseVisibility.test.ts`) is likewise
  unplanned.
- **Fix**: Add a one-line addendum under Phase 1 / Migration Notes in plan.md noting the
  authenticated-visibility policy + its test, so the plan stays the source of truth.
- **Decision**: FIXED — addendum appended to plan.md Migration Notes (2026-06-24)

### F2 — Swallowed Supabase error in a touched file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/debates/[id].astro:25
- **Detail**: Username fetch uses `const { data } = await supabase.from("profiles")…` with
  no `if (error) throw` — the swallowed-error idiom called out in the lessons register
  ("Keep all Supabase calls in a repository… surface failures with if (error) throw").
  PRE-EXISTING, not introduced by this change, but the file was edited here (PublishControl
  embed), so it's in the diff. Masks a real DB failure as an empty result.
- **Fix**: Route the lookup through a repository function that throws on error (consistent
  with the rest of the file's repository calls), or at minimum destructure `error` and throw.
- **Decision**: FIXED — added `getUsernameById` repository fn (throws on error) in src/lib/users.ts; [id].astro now calls it instead of inlining the query (2026-06-24). astro check 0 errors.

### F3 — listPublicDebates has no limit/pagination

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/debate/repository.ts (listPublicDebates)
- **Detail**: Single indexed query, no N+1 — but unbounded. Fine at launch (one debate);
  returns the full published set on every `/showcase` load as content grows. Plan itself
  flagged "index on debates.public only if the list grows large."
- **Fix**: Add a `.limit()` (+ pagination later) when the showcase grows. Not needed for the
  one-debate launch.
- **Decision**: FIXED (differently — full pagination, per user request "add pagination") —
  `listPublicDebates` now takes `{ page, pageSize }` (default `SHOWCASE_PAGE_SIZE=20`), fetches
  `pageSize+1` to derive `hasMore`, and returns `{ items, page, pageSize, hasMore }`. `/showcase`
  reads `?page=` and renders Prev/Next controls. New integration test covers cap/hasMore/no-overlap;
  2 test call sites updated to `.items`. lint+build+astro check green; showcase tests 5 passed.

### F4 — Sequential awaits on the showcase detail page

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/pages/showcase/[id].astro:23-34
- **Detail**: graph → marks → exchange → summary are awaited sequentially; marks, exchange,
  and summary are independent and could be `Promise.all`'d. Minor latency only, no
  correctness impact.
- **Fix**: Wrap the three independent fetches in Promise.all after the graph load (and 404
  gate) resolves.
- **Decision**: FIXED — marks/exchange/summary now load via `Promise.all` after the
  published-graph gate in src/pages/showcase/[id].astro (2026-06-24). astro check + lint + build green.

## Note (not a finding)

`DivergenceSummary` starts **closed** on the showcase page, where plan text said "default
open." The component comment documents this as a deliberate choice (match the authed page;
the button toggles without fetching). Treated as an intentional refinement, not a defect.
