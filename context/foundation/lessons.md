# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Extract Supabase setup and auth guard into a shared helper for API routes

- **Context**: All API route handlers under `src/pages/api/` (Astro `APIRoute` exports)
- **Problem**: Every handler copy-pastes the same 3-step preamble —
  `createClient` + 503 guard, `getAuthUser` + 401 guard, Zod param/body parse
  + 400 guard. A fix to the auth strategy (e.g. switching from bare `getUser`
  to `getAuthUser` for Bearer tokens, as caught in Phase 2) must be replicated
  across every route file manually.
- **Rule**: Before adding a new API route, extract the repeated preamble into a
  shared `withAuth` wrapper or `guardRequest` utility in `src/lib/`; route
  handlers should contain only param parsing, schema validation, and a single
  repository call. Plan the helper before the first route is written, not after
  the third.
- **Applies to**: plan, implement, impl-review

## Use backup branch and cherry-pick to surgically remove commits

- **Context**: Commit history cleanup
- **Problem**: Wrong commits ending up in the remote repo because commits were removed carelessly from the middle of a branch
- **Rule**: When removing specific commits from history, create a backup branch first. Reset to the commit before your targets, then cherry-pick everything from backup except what you want removed.
- **Applies to**: implement, impl-review

## Centralize shared validation limits — define once, import everywhere

- **Context**: Anywhere in the codebase — any validation limit/constant enforced in more than one layer (Zod schema, React form, DB check constraint, component).
- **Problem**: A magic number (e.g. debate title max `120`) gets hard-coded in the form AND the schema; changing one silently diverges from the other and from the DB check, producing inconsistent validation between UI, API, and database.
- **Rule**: Define every shared validation limit once in a constants module (e.g. `nodeConstraints.ts`) and import it into the schema and UI; never re-declare the literal. Mirror DB check-constraint values with a comment pointing at the constant.
- **Applies to**: plan, implement, impl-review

## Use `RETURNS SETOF` (not a bare composite) when a Postgres function must signal "no row"

- **Context**: Postgres functions / RPCs called via PostgREST/supabase-js that update or fetch a single row by id and whose caller needs to distinguish "found and changed" from "no such row" (e.g. mapping a missing/RLS-hidden row to a 404).
- **Problem**: A function declared `RETURNS <table>` / `RETURNS <composite>` always returns exactly one value. When its `UPDATE ... RETURNING *` (or `SELECT`) matches zero rows, Postgres yields a **row of all-NULL columns**, not SQL `NULL`. PostgREST serializes that as `{"id":null,...}` — a truthy object — so a `.maybeSingle()` + `if (!data)` guard never fires and the handler returns 200 with a garbage all-null record instead of 404. This passes `lint`/`build` and is only caught by a runtime test of the not-found path. (Found in S-01: the `patch_node` RPC 200'd on an unknown node id.)
- **Rule**: When a function needs to express "zero rows", declare it `RETURNS SETOF <table>`. Zero matches → empty set → PostgREST `[]` → `.maybeSingle()` returns real `null`. Bonus: SETOF makes the generated `Database` type for the function nullable, so the absence guard type-checks without an `eslint-disable`. Always smoke-test the not-found branch of any new mutating endpoint — `lint`+`build` cannot see this class of bug.
- **Applies to**: plan, implement, impl-review

## Break cross-table RLS recursion (42P17) with a SECURITY DEFINER helper on the policy that writes

- **Context**: Postgres RLS policies where table A's SELECT policy references table B, and table B's INSERT/UPDATE WITH CHECK references table A (mutual cross-table reference). Seen in S-02: `exchanges_insert` WITH CHECK queried `debates` to verify ownership, while the widened `debates_select` queried `exchanges` for the challenger read predicate.
- **Problem**: Evaluating the WITH CHECK on B triggers A's SELECT policy, which triggers B's policy again while B's RLS is mid-evaluation — Postgres fires its cycle detector and aborts with SQLSTATE 42P17 (infinite recursion). The plan's pure inline-EXISTS approach is correct for the *read* predicates but cannot be used unchanged on the *write* check that closes the loop. `lint`/`build` never see this — it only surfaces at runtime against real RLS (the integration suite or a manual insert).
- **Rule**: When an RLS WITH CHECK (or USING) must read another table whose own policy reads back into the first, wrap that cross-table check in a `SECURITY DEFINER` SQL function (`stable`, `set search_path = public`, EXECUTE revoked from public/anon and granted to authenticated). The definer reads as the function owner, bypassing the other table's RLS and breaking the cycle. `auth.uid()` still works inside the definer (PostgREST sets request.jwt.claims at session level). Keep the *read* predicates inline EXISTS — apply the definer only to the policy that closes the loop, not everywhere.
- **Applies to**: plan, implement, impl-review

## Enforce turn/phase as an RLS predicate, not just a UI lock

- **Context**: Multi-actor flows where only one party may write at a time (turn-based: challenger turn vs advocate turn in S-03/S-04). Write policies gated on a long-lived membership flag (e.g. `is_accepted_challenger` → `status='accepted'`).
- **Problem**: Membership stays true for the whole debate, so an RLS check that only verifies membership lets a party write *out of turn* — e.g. a challenger keeps inserting nodes/marks after submitting and the turn flips to the advocate. The client "locks the board" but the server doesn't; any direct API call bypasses it. `lint`/`build`/happy-path UI never see this — it surfaces only as cross-round data corruption once the other side's turn ships.
- **Rule**: Keep the membership predicate (read scope, turn-agnostic) separate from the **write** predicate (turn-gated). Add a second SECURITY DEFINER helper — same body **plus** `and current_turn = '<actor>'` — and use it in the INSERT/UPDATE WITH CHECK for that actor's content (nodes, relations, marks). Turn enforcement is an authorization boundary, not a UI convention. Assert the off-turn write is RLS-rejected in the integration suite.
- **Applies to**: plan, implement, impl-review

## Model invalidation as a flag the counterpart flips — never delete or overwrite

- **Context**: State that one party records about another party's content and that becomes stale when the content changes (e.g. marks: challenger's Agree/Challenge/Abstain on an advocate statement; round carry-over / invalidation in S-05).
- **Problem**: Deleting or overwriting the stale row destroys history needed for audit and for diffing across rounds, and a delete-based design forces a heavier migration + risks losing data. It also blurs *who* is allowed to invalidate.
- **Rule**: Store one mutable row and add a `valid boolean not null default true` column for invalidation. When a party changes their content, the **other** party's row about it is flipped `valid = false` (the counterpart invalidates, never the author); the stance/value stays intact. Gates then read `valid = true`. Designing the row as mutable-but-not-deleted keeps invalidation a pure column-add migration with no backfill and no data loss.
- **Applies to**: plan, implement, impl-review
