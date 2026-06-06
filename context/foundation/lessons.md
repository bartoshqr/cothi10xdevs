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
