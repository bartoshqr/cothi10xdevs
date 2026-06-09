# S-02 — Advocate invites a challenger and opens the exchange — Implementation Plan

## Overview

S-02 introduces the **second participant** into a data model that is, today, strictly single-owner. The advocate opens an *exchange* on an existing debate (gated on a **well-formed** root map existing), picks a challenger and a round count (1–5, default 3, fixed at initiation) **in one UI box**, and sends an in-app invite the challenger can accept or decline. The invite itself — via a widened RLS predicate — unlocks **read** access to the debate graph that is owner-only today (the challenger can read the map while the invite is still `pending`, but cannot edit it). Accepting only confirms participation for the turn-taking that S-03 builds on; declining revokes read access and lets the advocate re-invite.

Covers PRD **FR-007** (initiation gate — root Claim exists **and** the map is well-formed: every `and`/`or` connective has ≥2 operands), **FR-008** (round count + challenger-first/advocate-last ordering, with `current_round` + `current_turn` tracked on the exchange), **FR-009** (username **substring** search returning a short ranked list, self excluded + invite), **FR-010** (accept/decline). Roadmap slice **S-02** (`invite-and-open-exchange`).

## Current State Analysis

- **Row shape is already two-author-ready.** `nodes.author_id` and `relations.author_id` are real FKs to `auth.users` (`supabase/migrations/20260528000001_create_debate_graph.sql:34,57`). Nothing in the row shape blocks a challenger — **only the owner-only RLS does**.
- **RLS is owner-only across three tables.** `debates_select using (owner_id = auth.uid())` (`20260528000001:84-85`); `nodes`/`relations` select scoped via `exists(... debates d where d.owner_id = auth.uid())` (`:98-105`, `:125-132`); writes tightened to `author_id = auth.uid()` AND ownership (`20260605000001_tighten_graph_write_policies.sql`). An accepted challenger currently has **zero** read access. The tightening migration's header comment explicitly flagged this as the hole for S-02.
- **No exchange/lifecycle/invite state exists.** `debates` has only `id, owner_id, title, root_node_id, created_at` — no `status` column, no enum, no second-participant column anywhere.
- **FR-007 gate has two parts.** Part one — `debates.root_node_id IS NOT NULL` — is already-guaranteed: creation always sets it (`create_debate_with_root`, `20260528000001:156-204`), the root can't be deleted (FK backstop → 409, `repository.ts:144-159`) or demoted (`repository.ts:108-118`). Part two is **new** for this slice: every `connective` node (`nodes.kind = 'connective'`, `metadata.op` = `'and'|'or'`, `20260528000001:7,14,31-46`) must have **≥2 operands**, where an operand is a node wired into the connective via a `link` relation. **Confirmed** against the map builder: a `link` relation must target a connective (`isLegalRelationTarget`, `relationRules.ts:11-14`; enforced in `createRelation`, `repository.ts:188-202`), so operands of connective `C` = `relations` with `kind = 'link'` AND `target_node_id = C`. A half-wired AND/OR (<2 inbound links) is not a valid argument and must not reach a challenger.
- **FR-009 search primitive ships but must be generalized.** `findUserByUsername` (`src/lib/users.ts:9-20`) is **exact** (`.eq` on the normalized lowercased value, deliberately not `.ilike` because usernames may contain `_`). S-02 needs a **substring** search returning a short ranked **list** (not a single user), excluding the caller. Reuse the `profiles` table + normalization, but add a new `searchUsersByUsername` rather than bending the exact-match helper. `profiles_select_authenticated using(true)` (`20260525142850_create_profiles.sql:20-26`) lets any authed user resolve profiles.
- **House conventions are strong:** `withAuth` + typed-error→status mapping (`src/lib/api.ts:10-46`), per-domain Zod schemas + repository with injected client (`src/lib/debate/`), centralized constants (`nodeConstraints.ts`, lessons §3), atomic RPCs `RETURNS SETOF` (lessons §4). S-02 mirrors these.
- **Integration test harness exists but is single-user + RLS-bypassing.** `globalSetup.ts` provisions one seeding user; `helpers.ts` exposes a service-role client that bypasses RLS. There is **no** two-user fixture and **no** as-user (anon) client helper — both must be added to test pair-visibility.

## Desired End State

An advocate viewing their own debate (with a well-formed root map) opens a **slide-over/dropdown panel** from the debate header, sees a short alphabetical list of registered users (themselves excluded), narrows it by typing a username substring, picks one user **and** a round count in that same box, and sends the invite. The invited user sees it on a `/invites` page and can Accept or Decline. **As soon as the invite is sent (`pending`), the challenger can read the debate graph** (RLS now permits it) but cannot edit it; on Accept the participation is confirmed; on Decline read access is revoked and the advocate may re-invite (a fresh exchange). A non-participant third user can never read the debate. The FR-007 gate (root + well-formedness), self-invite block (incl. self being absent from search results), and one-open-exchange-per-debate rule are all enforced server-side, not just in the UI.

**Verify:** the integration suite in Phase 5 proves the RLS pair-visibility matrix (pending **read** allowed, write denied), the two-part gate, and the invite semantics; `npm run build` + `npx astro check` pass; manual click-through of search→invite→accept works in two browser sessions.

### Key Discoveries:

- The hard part is **rewriting the membership predicate consistently** across `debates` + the `nodes`/`relations` subqueries (inline `EXISTS`, three copies kept in sync), not adding columns (`20260528000001:98-105,125-132`). The **read** predicate widens to owner-or-(pending-or-accepted challenger); the **write** predicates stay owner/author-scoped (S-02 grants no challenger writes — see comment: "pending challenger can read map, but can't edit it").
- The FR-007 gate is now **two predicates**: `root_node_id IS NOT NULL` (`20260528000001:27`) **and** no connective with <2 operands — both enforced server-side (roadmap:148 "thin maps reach challengers" risk).
- `create_debate_with_root` (`20260528000001:156-204`) and `set_debate_root` (`20260608000002:11-47` — the live definition; `…0002_strip_url` `create or replace`s the original `…0001`) are the `security definer` / `RETURNS SETOF` patterns to mirror if an RPC is used.
- `findUserByUsername` (`src/lib/users.ts:9-20`) is the *exact-match* substrate; FR-009 here needs a **new** `searchUsersByUsername` (substring, list, self-excluded) alongside it — do not bend the exact helper.
- `repository.ts` `createRelation` (`:188-223`) is the template for "pre-check app-side then insert, map SQLSTATE 23505 → ConflictError 409".

## What We're NOT Doing

- **No turn-submission machinery** (marking, lock-on-submit, round advance) — that is S-03/S-04. S-02 only *stores* the round count and *initializes* the turn state (`current_round = 1`, `current_turn = 'challenger'`); it never advances it.
- **No challenger write access** — a pending/accepted challenger can *read* the map but cannot add or edit nodes/relations. Challenger writes are S-03; the `*_insert/update/delete` policies stay author/owner-scoped.
- **No full debate-list / inbox UI** (FR-024/025) — that is the parallel slice S-06. S-02 ships only a *minimal* `/invites` accept/decline page so the slice is acceptable end-to-end; S-06 replaces it later.
- **No exhaustive Phase-2 RLS test matrix** — the test-plan's Phase 2 (Risk #1) owns that. S-02 ships a focused smoke suite for its own integrity boundaries, introducing the two-user fixture that Phase 2 reuses.
- **No `debate_participants` membership table** — MVP is strictly two-party (FR-021); a denormalized predicate over the exchange is sufficient.
- **No exchange close/complete state** — later slices. (Advocate-side **revoke of a still-`pending` invite** is now in scope — added in Phase 4.5 — but withdrawing an already-`accepted` exchange is not.)
- **No email search** — removed as unsafe (prd.md:126); username-only.

## Implementation Approach

A new `exchanges` table carries the second participant (`challenger_id`), the invite lifecycle (`status` pending→accepted/declined), the round count, and **both** turn markers — `current_round` and `current_turn` (challenger-first). The widened RLS *select* predicate — "owner OR (challenger whose invite is `pending` or `accepted`)" — is written as an **inline `EXISTS` with `(select auth.uid())`** in each of the three `*_select` policies (chosen over a `security definer` helper so the planner runs one semi-join per scan instead of a per-row function call); the *write* predicates are left owner/author-scoped. DB constraints (round-count CHECK, self-invite CHECK, partial-unique on one-open-exchange) are backstops; the repository pre-checks app-side to surface clean typed errors (mirroring the `createRelation`/`updateNode` pattern), including the **two-part FR-007 gate** (root exists + every connective has ≥2 operands). Endpoints follow `withAuth`; the username search is a **substring list** (self excluded, alphabetical, capped, 200-with-`[]` on no match); the UI is a slide-over panel that picks challenger + round count together before sending.

## Critical Implementation Details

- **Read access opens at invite time, not accept time.** Per the developer's instruction "pending challenger can read map, but can't edit it", the widened RLS *select* predicate keys off `status in ('pending','accepted')`. The challenger can read the graph the moment the invite is sent; `accept` does **not** open visibility (it was already open) — it only confirms participation for S-03's turn-taking. `decline` is the transition that *closes* read access (the row drops out of the `pending/accepted` set). The `*_insert`/`*_update`/`*_delete` policies on `nodes`/`relations` stay author/owner-scoped, so a pending or accepted challenger reads but cannot write — that is S-03.
- **Two-part FR-007 gate, both server-side.** `openExchange` must reject when (a) `root_node_id IS NULL` **or** (b) any `connective` node in the debate has <2 inbound `link` relations. Both are `ValidationError` (422) with distinct messages. **(b) is computed app-side, not as a raw aggregate** — supabase-js's PostgREST query builder cannot express a `LEFT JOIN … GROUP BY … HAVING`, and this repo routes anything beyond a flat select through an RPC, but `openExchange` deliberately stays app-side (mirroring `createRelation`, not an RPC). So fetch the inputs with two flat RLS-scoped selects (the same shape `getDebateGraph` already uses, `repository.ts:37-54`) and count in TypeScript:
  - `select id from nodes where debate_id = $1 and kind = 'connective'` → the connective ids.
  - `select target_node_id from relations where debate_id = $1 and kind = 'link'` → the inbound `link` targets.
  - Reject if **any** connective id has fewer than 2 matching `target_node_id`s. Connectives with **zero** inbound links must be included (a `Map`/tally seeded from the connective ids, not derived from the relations alone, so empties aren't silently skipped).
  Factor this into a **pure** `isMapWellFormed(nodes, relations): boolean` (or `findUnderwiredConnective`) helper so the same rule backs both this gate and the Phase-4 UI flag (no duplicated operand logic). A malformed map is an integrity hole exactly like a missing root: it must not reach a challenger.
- **`current_round` + `current_turn` both live on the exchange.** Not just the party marker — the round counter is stateful too (FR-008). S-02 only *initializes* them (`current_round = 1`, `current_turn = 'challenger'`); S-03/S-04 advance them. A `check (current_round between 1 and round_count)` keeps them coherent.
- **Re-invite after decline relies on a *partial* unique index.** "One open exchange per debate" must be `unique (debate_id) where status in ('pending','accepted')` — a plain unique on `debate_id` would block re-invite after a decline. Declined rows must not count toward the constraint.
- **Self-invite is blocked in three places by design.** (1) The search endpoint **excludes the caller** so the advocate never sees themselves as a pick ("advocates can't even see themselves in usernames search"); (2) app-side `advocate_id === challenger_id` → `ValidationError` 422 guards a hand-crafted request; (3) a DB `CHECK (advocate_id <> challenger_id)` backstops a direct write. Defense in depth across UI, API, and DB.
- **The read predicate is inline `EXISTS`, not a function — for the planner.** An opaque `security definer` helper would be evaluated per row and block the semi-join; an inline `EXISTS` with `(select auth.uid())` is rewritten into one semi-join per scan with `auth.uid()` hoisted once (matches the existing owner-only policy, `20260528000001:84-85`). Trade-off accepted: the predicate is duplicated across the three `*_select` policies and must be kept in sync (shared comment + the Phase 5 RLS matrix guards drift). The `exists` subquery on `exchanges` works under the *caller's* RLS because `exchanges_select` already lets a challenger see their own rows — no definer escalation needed for the read path.
- **Reads are not routed through an RPC in S-02.** A `get_debate_graph(debate_id)` `security definer` RPC (one membership check + bulk select, bypassing RLS) is the documented **scale lever** if argument maps ever grow past what per-scan semi-joins handle comfortably — see Performance Considerations. It is intentionally *not* built now (MVP maps are tens of nodes); RLS stays the read boundary.

## Phase 1: Schema + RLS migration

### Overview

Create the `exchanges` table and its enum, the DB constraints, and rewrite the owner-only RLS on `debates`/`nodes`/`relations` to an inline participant predicate (`EXISTS` + `(select auth.uid())`, repeated across the three `*_select` policies). Regenerate types. This is the load-bearing phase — the RLS rewrite is the slice's central risk.

### Changes Required:

#### 1. New migration — exchange schema + constraints

**File**: `supabase/migrations/<ts>_create_exchanges.sql` (new)

**Intent**: Introduce the exchange entity that carries the second participant, the invite lifecycle, the round count, and the challenger-first turn marker.

**Contract**:
- `create type public.exchange_status as enum ('pending', 'accepted', 'declined');`
- `create type public.turn_actor as enum ('challenger', 'advocate');`
- `public.exchanges` columns: `id uuid pk default gen_random_uuid()`, `debate_id uuid not null references public.debates on delete cascade`, `advocate_id uuid not null references auth.users on delete cascade`, `challenger_id uuid not null references auth.users on delete cascade`, `status public.exchange_status not null default 'pending'`, `round_count int not null`, `current_round int not null default 1`, `current_turn public.turn_actor not null default 'challenger'`, `created_at timestamptz not null default now()`, `responded_at timestamptz null`.
- Constraints (mirror constants with a comment pointing at `src/lib/exchange/constants.ts`, lessons §3):
  - `check (round_count between 1 and 5)` — comment: mirrors `ROUND_COUNT_MIN/MAX`.
  - `check (current_round between 1 and round_count)` — keeps the round counter coherent (FR-008).
  - `check (advocate_id <> challenger_id)` — self-invite backstop.
- Partial unique index (the re-invite-safe "one open exchange per debate"):
  ```sql
  create unique index exchanges_one_open_per_debate
    on public.exchanges (debate_id)
    where status in ('pending', 'accepted');
  ```
- Indexes: `(challenger_id)` (inbox lookup), `(debate_id)`.

#### 2. The canonical read-membership predicate (inline, not a helper)

**File**: same migration (used inside the `*_select` policies in step 4)

**Intent**: Define the **read** membership test once *as a reviewable snippet*, then inline it in each `*_select` policy. Membership = owner OR a challenger whose invite is `pending` *or* `accepted` (pending grants read; see Critical Implementation Details). We deliberately do **not** wrap this in a `security definer` function: an opaque function call is evaluated per row and defeats the planner's semi-join, whereas an inline `EXISTS` with `(select auth.uid())` is rewritten into a single semi-join per scan with `auth.uid()` hoisted to an InitPlan (the perf pattern the existing owner-only policy already uses, `20260528000001:84-85`). The cost is that the predicate is repeated across three tables — mitigated by a shared comment block; the predicate is *identical* except for the `<table>.debate_id` / `debates.id` column it keys on.

**Canonical snippet** (`<membership>`), parameterized by the debate-id column of the host table:
```sql
exists (
  select 1 from public.debates d
  where d.id = <debate_id_col> and d.owner_id = (select auth.uid())
)
or exists (
  select 1 from public.exchanges e
  where e.debate_id = <debate_id_col>
    and e.challenger_id = (select auth.uid())
    and e.status in ('pending', 'accepted')
)
```
For `debates` itself, `<debate_id_col>` is `debates.id`; for `nodes`/`relations` it is `nodes.debate_id` / `relations.debate_id`. Index support: `exchanges (challenger_id)` + `(debate_id)` already planned in step 1 keep the challenger branch a cheap index probe; the owner branch is a `debates` PK lookup that short-circuits the common case.

#### 3. Same migration — RLS on `exchanges`

**File**: same migration

**Intent**: The advocate and the invited challenger can each read the exchange; the advocate creates it; the challenger transitions it pending→accepted/declined.

**Contract**:
- `enable row level security`; `revoke select ... from anon`.
- `exchanges_select`: `using (advocate_id = (select auth.uid()) or challenger_id = (select auth.uid()))`.
- `exchanges_insert`: `with check (advocate_id = (select auth.uid()) and exists(select 1 from public.debates d where d.id = debate_id and d.owner_id = (select auth.uid())))`.
- `exchanges_update`: `using (challenger_id = (select auth.uid()) and status = 'pending') with check (status in ('accepted','declined'))` — confines the transition to the challenger responding once.
- **Column-level write lock (defense in depth).** An RLS `with check` can only validate the *new* row, not compare it to the old, so it cannot stop a challenger from also rewriting `round_count` / `current_round` / `current_turn` / `debate_id` / `advocate_id` while flipping status. Lock those columns with a **column-level grant** instead: `revoke update on public.exchanges from authenticated;` then `grant update (status, responded_at) on public.exchanges to authenticated;`. Now Postgres physically permits an authenticated caller to update only those two columns — the respond transition still works, every other column is immutable from the challenger's session. (Not exploitable today since `SUPABASE_KEY` is server-only and `respondToInvite` controls the SQL, but the slice treats RLS as the boundary, so the grant makes that boundary actually hold. The advocate's `insert` is unaffected; future advocate-side writes, if any, get their own grant.)

#### 4. Same migration — widen RLS on `debates` / `nodes` / `relations` (select)

**File**: same migration

**Intent**: Replace the owner-only *read* predicate with participant membership so an invited challenger (pending **or** accepted) can read the graph. Write policies stay author-scoped — a pending/accepted challenger reads but cannot edit (challenger writes are S-03).

**Contract**: drop & recreate the three `*_select` policies, inlining the `<membership>` snippet from step 2 (substituting the host table's debate-id column):
- `debates_select`: `using ( <membership with debates.id> )`.
- `nodes_select`: `using ( <membership with nodes.debate_id> )`.
- `relations_select`: `using ( <membership with relations.debate_id> )`.

Put an identical leading comment above all three (e.g. `-- READ membership: owner OR pending/accepted challenger — keep in sync across debates/nodes/relations`) so the three copies stay recognizably one rule. Leave `*_insert` / `*_update` / `*_delete` on `debates`/`nodes`/`relations` unchanged (still owner/author-scoped) — challenger write access is out of scope for S-02.

#### 5. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new table, enums, and function so the repository/schemas type-check.

**Contract**: run `npx supabase gen types typescript --local` then `npx astro sync`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (or `db push`)
- Types regenerated and present: `exchanges` row type exists in `src/db/database.types.ts`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- RLS pair-visibility behaves: an accepted challenger can SELECT the debate/nodes/relations; a non-participant cannot.
- Partial unique allows re-invite after decline but blocks a second open exchange.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Exchange domain module

### Overview

Create `src/lib/exchange/` mirroring `src/lib/debate/`: centralized round-count constants, Zod schemas, a substring user-search primitive, and a repository with app-side pre-checks (incl. the two-part gate). No HTTP yet.

### Changes Required:

#### 0. Substring user-search primitive

**File**: `src/lib/users.ts` (extend — keep `findUserByUsername` for the exact-match callers)

**Intent**: Back the FR-009 dropdown — return a short alphabetical list of users matching a username **substring**, with the caller excluded ("advocates can't even see themselves").

**Contract**: `searchUsersByUsername(supabase, query, excludeUserId, limit = USER_SEARCH_LIMIT)` returning `{ id, username }[]`:
- Normalize `query` with `normalizeUsername`, then **escape** the LIKE metacharacters `%` and `_` (usernames legitimately contain `_`) before interpolating into `.ilike("username", "%" + escaped + "%")`.
- Empty/whitespace query ⇒ match all (no `ilike` filter) — the dropdown opens pre-populated.
- `.neq("id", excludeUserId)` to drop the caller.
- `.order("username", { ascending: true }).limit(limit)`.
- `USER_SEARCH_LIMIT` (e.g. 5) lives in `src/lib/exchange/constants.ts` (or `username.ts`) — single source of truth, mirrored by the UI.

#### 1. Round-count constants

**File**: `src/lib/exchange/constants.ts` (new)

**Intent**: Single source of truth for the 1–5 / default-3 limits (lessons §3), imported by the schema, the React form, and mirrored by the DB CHECK.

**Contract**: `ROUND_COUNT = { min: 1, max: 5, default: 3 } as const;` and `USER_SEARCH_LIMIT = 5` (cap on the search dropdown — mirrored by the React island).

#### 2. Zod schemas

**File**: `src/lib/exchange/schemas.ts` (new)

**Intent**: Validate the open-exchange body, the respond body, and the search query param.

**Contract**:
- `openExchangeSchema` (`.strict()`): `{ debateId: z.uuid(), challengerId: z.uuid(), roundCount: z.number().int().min(ROUND_COUNT.min).max(ROUND_COUNT.max) }`.
- `respondInviteSchema` (`.strict()`): `{ accept: z.boolean() }`.
- `usernameSearchSchema`: a **lenient** substring query param — an optional, length-capped string (do **not** enforce the full `USERNAME_PATTERN`, since partial substrings won't satisfy it; empty is valid and means "match all"). Trim and cap length to avoid pathological queries.
- `exchangeIdParamSchema = z.uuid()`.
- Export inferred input types.

#### 3. Repository

**File**: `src/lib/exchange/repository.ts` (new)

**Intent**: Encapsulate the gate check, self-invite block, insert, the respond transition, and the inbox query — returning `null`/throwing typed errors per house convention.

**Contract** (`type DB = SupabaseClient<Database>`):
- `openExchange(supabase, input, advocateId)`: (a) load debate by `input.debateId` (RLS-scoped) → null ⇒ `NotFoundError` (404); (b) `root_node_id == null` ⇒ `ValidationError` (422, FR-007 gate part 1); (c) **well-formedness gate (part 2)** — for this debate, find any `connective` node with <2 inbound `link` relations (`relations.kind='link' and target_node_id = connective.id`); if any exists ⇒ `ValidationError` (422, e.g. "Every AND/OR group needs at least two operands before you can invite a challenger."). **Computed app-side via a pure helper, not a raw SQL aggregate** (PostgREST can't express `LEFT JOIN … GROUP BY … HAVING`; `openExchange` stays app-side per `createRelation`): two flat selects — `nodes where debate_id=$1 and kind='connective'` (connective ids) and `relations where debate_id=$1 and kind='link'` (inbound link targets) — then tally inbound links per connective in TS and reject if any connective (including ones with **zero** inbound links) has `< 2`. Factor as a pure `isMapWellFormed(nodes, relations)` so the Phase-4 UI flag reuses the identical rule. (d) `input.challengerId === advocateId` ⇒ `ValidationError` (422, self-invite); (e) insert the exchange row (status defaults `pending`, `current_round=1`, `current_turn='challenger'`); map SQLSTATE `23505` (partial-unique) ⇒ `ConflictError` (409, "An exchange is already open on this debate."). Mirror `createRelation` (`repository.ts:188-223`).
- `respondToInvite(supabase, exchangeId, accept)`: `update exchanges set status=<accepted|declined>, responded_at=now() where id=exchangeId and status='pending'` `.select().maybeSingle()` → null ⇒ `NotFoundError` (404; covers unknown id, already-responded, not-yours-via-RLS). RLS `exchanges_update` enforces challenger identity. (Direct table update, not an RPC — the SETOF trap does not apply.)
- `listInvites(supabase, userId)`: select `pending` **and** `accepted` exchanges where `challenger_id = userId`. Uses three flat queries: (1) exchanges, (2) debates for `id + title + root_node_id`, (3) root nodes for `metadata` (title + body). Returns `ChallengerInvite[]` with `status`, `debate_root_node_id`, `debate_root_claim_title`, and `debate_root_claim_body` so the inbox can show the root claim's content and render pending rows (Accept/Decline + View debate) vs accepted rows (Enter debate) without extra fetches. RLS already scopes to the challenger; `userId` filter is explicit.

#### 4. Unit tests

**File**: `tests/unit/exchangeSchemas.test.ts` (new)

**Intent**: Pin the schema contract at the cheapest layer.

**Contract**: round count rejects 0 and 6, accepts 1/3/5; default surfaced from `ROUND_COUNT`; `.strict()` rejects unknown fields; respond requires a boolean; the search schema accepts an empty string (match-all) and a partial substring, and caps length. Optionally unit-test the LIKE-escaping helper directly: a query containing `_`/`%` must be escaped so it matches literally, not as a wildcard.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Unit tests pass: `npm run test:unit` (or the repo's vitest unit command)
- Linting passes: `npm run lint`

#### Manual Verification:

- Repository functions are exercised against local Supabase in Phase 5 (no separate manual step here).

**Implementation Note**: Pause for confirmation after automated verification before Phase 3.

---

## Phase 3: API endpoints + middleware

### Overview

Wire the domain module to HTTP via `withAuth`, and protect the new challenger page route.

### Changes Required:

#### 1. Username search endpoint

**File**: `src/pages/api/users/search.ts` (new)

**Intent**: Resolve a username **substring** to a short alphabetical **list** of users (caller excluded) for the invite dropdown; soft empty list (no error).

**Contract**: `export const GET = withAuth(async (context, supabase, user) => …)`. Read `context.url.searchParams.get("username") ?? ""` (template: `src/pages/api/auth/username-available.ts:5-22`, but `withAuth`-wrapped). Validate against `usernameSearchSchema` (invalid → 400). Call `searchUsersByUsername(supabase, query, user.id, USER_SEARCH_LIMIT)` — `user.id` is the **exclude** arg so the advocate never appears in their own results. **Always 200**: `{ users: { id, username }[] }` (empty array when nothing matches; full list when the query is empty).

#### 2. Open-exchange endpoint

**File**: `src/pages/api/exchanges/index.ts` (new)

**Intent**: Open an exchange and invite the challenger; server-authoritative gate.

**Contract**: `export const POST = withAuth(async (context, supabase, user) => …)`. Parse JSON (`Invalid JSON` → 400), validate `openExchangeSchema` (→ 400 `z.treeifyError`), call `openExchange(supabase, parsed.data, user.id)`. Typed errors map via `withAuth`: gate/self-invite → 422, duplicate → 409, unknown debate → 404. Return `{ id }`.

#### 3. Respond endpoint

**File**: `src/pages/api/exchanges/[id]/respond.ts` (new)

**Intent**: Challenger accepts or declines.

**Contract**: `export const POST = withAuth(...)`. Validate `id` param (`exchangeIdParamSchema`, invalid → 400 `{ error: "Invalid exchange id" }`). Parse + validate `respondInviteSchema`. Call `respondToInvite`. Unknown/already-responded → 404. Return the updated `{ status }`.

#### 4. Protect the inbox route

**File**: `src/middleware.ts`

**Intent**: `/invites` is an authed page (CLAUDE.md hard rule); API routes self-guard via `withAuth`.

**Contract**: add `"/invites"` to `PROTECTED_ROUTES` (`src/middleware.ts:4`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Endpoints return the expected status codes for happy + edge paths (curl, see Phase 5 Progress steps).

**Implementation Note**: Pause for confirmation after automated verification before Phase 4.

---

## Phase 4: UI — advocate invite + challenger inbox

### Overview

Advocate-facing invite affordance on the debate page, and a minimal challenger inbox.

### Changes Required:

#### 1. Invite challenger affordance

**File**: `src/components/debate/InviteChallenger.tsx` (new) + mount in `src/pages/debates/[id].astro` (or `DebateHeader.astro`)

**Intent**: Let the advocate pick a challenger and a round count **in one slide-over/dropdown panel** and send the invite. Reflect the FR-007 gate and existing-exchange state in the UI (server remains authoritative).

**Contract**: a React island (`client:load`/`client:only`) shown only to the debate owner, opened from a header button as a **panel that slides from the header or the side** (dropdown/drawer). Layout (one box, advocate can do either field first):
- A username **search box** driving a list of selectable users. On open (empty query) the list shows up to `USER_SEARCH_LIMIT` users **sorted alphabetically**; typing narrows it by substring via debounced `GET /api/users/search`. Each result row is clickable to select; **a query matching no user shows an empty list with nothing to click** (no error text needed). The advocate is never in the list (server-excluded).
- A **round-count selector** defaulting to `ROUND_COUNT.default` (range from `ROUND_COUNT`).
- A single **Send** action, enabled only once a user is selected; submits `{ debateId, challengerId, roundCount }` to `POST /api/exchanges`.
- **Gate reflection:** the advocate **can** open the panel and click **Send** even when the map is not yet ready — the affordance is **not** hard-disabled on the gate. On a gate failure the server returns 422 and the UI **surfaces a clear message naming the specific cause** (no root Claim, or "Every AND/OR group needs at least two operands") so the advocate knows what to fix, rather than facing a silently-greyed button. (Compute `hasRoot` and a `mapWellFormed` flag from the already-loaded graph for optional inline hinting, but the server stays authoritative and its 422 message is what the user reads on failure.) When an exchange already exists, show its status instead of the form.
- Surface 409/422 via the existing `apiError` helper (`src/components/debate/apiError.ts`). The page already loads the graph (`[id].astro:13`) and root state — derive `hasRoot` + the `mapWellFormed` flag **from that graph via the shared `isMapWellFormed(nodes, relations)` helper** (the same pure function the Phase-2 gate uses — no duplicated operand logic), and pass them plus existing-exchange status as props.

#### 2. Minimal invites inbox page

**File**: `src/pages/invites.astro` (new) + small `RespondInvite.tsx` (new) or inline forms

**Intent**: List the signed-in user's pending invites and let them Accept/Decline — making the slice acceptable end-to-end before S-06.

**Contract**: server-side query via `listInvites` (RLS-scoped) listing debate title + advocate, returning both `pending` and `accepted` rows. Each pending row has:
- A **"View debate"** link to `/debates/:id` — the challenger can already read the map *while the invite is pending* (that is the whole point of opening reads at `pending`, not at accept), so they can inspect the argument **before** deciding. This is the primary reason the link must be on the pending invite, not gated behind Accept.
- **Accept / Decline** actions that `POST` to `/api/exchanges/:id/respond` and refresh.

Accepted rows show an **Enter debate** link to `/debates/:id` instead of Accept/Decline. `debate_id` and `status` are in the result so both link and action rendering work without extra fetches. Keep deliberately minimal — S-06 replaces it.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Two-session click-through: advocate searches + invites; challenger sees the invite, **opens "View debate" while still pending to read the map**, then accepts; decline hides it and allows re-invite.
- Attempting to invite when no root Claim exists **or** a connective has <2 operands shows a clear UI message naming the cause (server 422 surfaced via `apiError`); the advocate is not silently blocked by a greyed button.

**Implementation Note**: Pause for confirmation after automated verification before Phase 4.5.

---

## Phase 4.5: Editing lock during exchange + invite UX polish + seed/cursor fixes

### Overview

Phase 4 shipped the invite/inbox UI but a two-session walkthrough surfaced gaps that make the slice incorrect or confusing in practice. This phase closes them: (1) **lock graph editing** once an exchange exists — a challenger never edits, and the advocate is frozen the moment they send an invite — flipped **in place via a cross-island event** so there's no page-reload flicker; (2) **polish the invite affordance** — name the challenger + rounds in the status line, add a **revoke** action for a still-`pending` invite, keep the advocate's view fresh (a visibility-gated poll) so an accept isn't missed on a stale page, fix the search-open flash, and dismiss the panel on an outside click; (3) **fix the seed** — all valid v4 UUIDs and 10 ready users, then `db reset`; (4) a **global cursor affordance** plus reuse of the existing `Button` primitive; and (5) show the **owner's username** to a viewing challenger. All advocate transitions (send/revoke/accept/decline) update **without a reload**. These are corrections to Phase 4, scoped before the Phase 5 integration suite so the suite tests the corrected behaviour.

### Changes Required:

#### 1. Read-only editing lock (`canEdit` flag)

**Files**: `src/components/debate/store.ts`, `src/components/debate/MapEditor.tsx`, `src/components/debate/nodes/StatementNode.tsx`, `src/pages/debates/[id].astro` (only `StatementNode` has inline edit affordances; `ConnectiveNode` has none, so it needs no gating)

**Intent**: The map is editable **only** by the advocate **before** any exchange is opened. Per the developer:
- **1.1 — challenger is read-only now and always (for S-02).** A pending **or** accepted challenger can read the graph but cannot change a single node/edge. (S-03 will introduce author-scoped partial edits once `author_id` is surfaced into node/edge data; that is explicitly out of scope here — block everything for the challenger now.)
- **1.2 — advocate is frozen once an invite is sent.** As soon as an exchange exists (`pending` **or** `accepted`), the advocate can no longer edit either. Revoking a pending invite (item 5) re-opens editing.

**Contract**:
- `[id].astro` computes `const canEdit = isOwner && existingExchange === null;` — false for a challenger (non-owner participant) and false for the advocate once an exchange row exists. The **local-only** playground (CreateDebateForm, no `debateId`) stays `canEdit = true` by default.
- Thread a `canEdit?: boolean` prop (default `true`) through `MapEditor` → `hydrate(debateId, graph, canEdit)` → a new `canEdit: boolean` field on the store state.
- **Store is the chokepoint**: guard every mutator with an early return when `!get().canEdit` — `createStatementNode`, `createConnectiveNode`, `updateNodeFields`, `deleteNodes`, `deleteEdge`, `updateRelationKind`, `setRootNode`, `stagePendingConnection`, `commitConnection`, `setInEditNode`. (A read-only canvas never renders the menus that call these, but the guard makes the store the authoritative boundary — same philosophy as RLS being the server boundary.)
- **MapEditor**: set `nodesDraggable={canEdit}`, `nodesConnectable={canEdit}`, `elementsSelectable={canEdit}`; early-return the pane/node/edge context-menu and connect handlers when `!canEdit`; `deleteKeyCode={canEdit ? (inEditNodeId ? null : "Delete") : null}`.
- **Node components**: read `canEdit` from the store and gate edit entry — `handleNodeDoubleClick`, the role/badge dropdown (cursor/title also drop when locked), and the inline delete `×` no-op / don't render when `!canEdit`. (The server already denies challenger writes via RLS, and the advocate's own writes still succeed at the API; this lock is the **UX** half so a frozen user isn't offered controls that will silently fail.)
- **Runtime lock flip without a reload (cross-island).** The advocate's send/revoke happens in the `InviteChallenger` island, but the canvas is the separate `MapEditor` island, hydrated once with the SSR `canEdit`. To re-lock/unlock **in place** (no page reload, no flicker), add a `setCanEdit(canEdit)` store action and have `MapEditorInner` listen on `window` for a `wvmap:set-can-edit` `CustomEvent` (dispatched by `InviteChallenger`). A `window` event is used rather than a shared-store reference because the two islands aren't guaranteed to share the same store chunk. `setCanEdit(false)` also clears `inEditNodeId`/`inEditEdgeId`/`pendingConnection` so no stale editor lingers when the lock drops.

#### 2. Exchange read + revoke — migration, repository, endpoints

**Files**: `supabase/migrations/20260609000003_exchanges_delete_policy.sql` (new), `src/lib/exchange/repository.ts`, `src/pages/api/exchanges/[id]/index.ts` (new)

**Intent**: Back the revoke action (1.2 re-open) and the freshness poll (item 5) with a server boundary.

**Contract**:
- **Migration**: add an `exchanges_delete` RLS policy `using (advocate_id = (select auth.uid()) and status = 'pending')` and `grant delete on public.exchanges to authenticated;` — the advocate can delete **only** their own still-pending exchange; an accepted/declined row is immutable to delete. (Declined rows already drop out of the partial-unique index, so deleting a pending row is the clean re-invite path alongside decline.)
- **Repository**:
  - `getExchangeStatus(supabase, exchangeId)` → `{ status, challengerUsername, roundCount } | null` (two flat selects: the exchange row, then `profiles` for the challenger username; RLS scopes to advocate-or-challenger; null → 404).
  - `revokeInvite(supabase, exchangeId, advocateId)` → `delete from exchanges where id = $1 and advocate_id = $2 and status = 'pending'` `.select("id")`; `data.length === 0` → `NotFoundError` (404; unknown, not-yours, or already-responded). Returns `void`.
- **Endpoint** `src/pages/api/exchanges/[id]/index.ts` (sits alongside the existing `[id]/respond.ts`):
  - `GET = withAuth(...)` → validate `id` (`exchangeIdParamSchema`), `getExchangeStatus`, return `{ status, challengerUsername, roundCount }` (404 if null).
  - `DELETE = withAuth(...)` → validate `id`, `revokeInvite(supabase, id, user.id)`, return `{ ok: true }` (404 if nothing revoked).

#### 3. InviteChallenger UX polish

**File**: `src/components/debate/InviteChallenger.tsx`

**Intent**: Address the confusing status line (#2), the search-open flash (#4), and the stale advocate view (#5) — all **without page reloads** (a reload re-downloads the canvas and flickers).

**Contract**:
- **Live exchange state, no reload.** `[id].astro` loads the open exchange with challenger username + round_count + status and passes `existingExchange: { id, status, challengerUsername, roundCount } | null`. `InviteChallenger` seeds a local `activeExchange` state from that prop and mutates it **in place** on send/revoke/poll, pairing each transition with the cross-island `wvmap:set-can-edit` event (item 1) so the canvas re-locks/unlocks without a reload. Render:
  - `pending` → **"Invite sent to @{challengerUsername} for {roundCount} rounds — awaiting response"** plus a **Revoke** button (only while pending).
  - `accepted` → **"@{challengerUsername} accepted · {roundCount} rounds"** (no revoke).
- **Send** → `POST /api/exchanges` → on success set `activeExchange` to the new `pending` row (challenger username + rounds known from the selection) and `signalCanEdit(false)`; close the panel. No reload.
- **Revoke** → `DELETE /api/exchanges/:id` → on success clear `activeExchange` and `signalCanEdit(true)` (editing re-opens). No reload. Surface a 404/failure via the error line.
- **Search (#4) — no on-open fetch, no flash.** A single debounced effect that fires **only once the advocate has typed** (empty query ⇒ no request). Empty query renders a hint (**"Type a username to search."**); an in-flight request renders **"Searching…"**; the prior list stays visible during a re-search (no flicker); no matches renders **"No users found."** Clearing the box drops stale matches and returns to the hint. This supersedes the Phase-4 "pre-populated list on open" behaviour — there is no network call until the user types.
- **Freshness poll (#5)**: while `activeExchange?.status === "pending"`, poll `GET /api/exchanges/:id` on a **~1 s** interval **and** on `window` focus. On a status change, update **in place** (no reload): `accepted` ⇒ update the status line (the advocate stays locked — an accepted exchange still freezes edits); `declined` ⇒ clear the line and `signalCanEdit(true)` (editing re-opens, advocate can re-invite). **Gate the interval on tab visibility** — pause when `document.hidden`, resume with an immediate `check()` on `visibilitychange`/focus. This keeps 1 s safe rather than wasteful: the poll only fires while the tab is visible (feels live for an advocate watching), an abandoned background tab goes quiet instead of ~3600 req/hour, and the focus handler makes the tab-return case instant. The endpoint is a single-row indexed read.
- **Dismiss on outside click (incl. the canvas).** Close the panel on any click outside it via a **capture-phase `pointerdown`** listener on `document` scoped to the component's container ref. A `position:fixed` backdrop overlay does **not** work here: the debate header's `backdrop-blur` is a containing block, so a fixed overlay only covers the header strip, not the canvas below. Capture phase fires before React Flow can stop propagation on a canvas pointerdown.

#### 4. Seed overhaul — valid UUIDs + 10 users, then `db reset`

**File**: `supabase/seed.sql`

**Intent**: Fix the invalid-UUID invite error (#6) and the orphan rootless debate (#8), and give the dev environment a realistic pool to search/invite from (#9).

**Contract**:
- Replace the two seed users with **10**, generated by a `do $$ … for i in 1..10 … $$` loop, every id a valid **v4-shaped** UUID (version nibble `4`, variant nibble `8`) — `00000000-0000-4000-8000-0000000000` + the index in 2-hex (`…000000000001` … `…00000000000a`). Mirror each into `auth.identities` (provider_id = the uuid text) and `public.profiles` (usernames `user01`…`user10`, emails `user01@e.pl`…). Keep the empty-string token-column convention from the current file (GoTrue NULL-scan caveat).
- The demo debate graph already uses v4-shaped ids — keep it, owned by `user01`. **Do not seed any debate with a NULL `root_node_id`.** `create_debate_with_root` is the only creation path and always sets the root, so the orphan at `aaaaaaaa-…0001` (#8) is stray manual data — a `db reset` (which truncates + reseeds) removes it; nothing in code can recreate it.
- **Run `npx supabase db reset`** to apply migrations (incl. item 2's policy) + the new seed.

#### 5. Global cursor affordance + reuse the existing Button primitive

**Files**: `src/styles/global.css`, and adopt the existing `src/components/ui/button.tsx` in `InviteChallenger.tsx` / `RespondInvite.tsx`

**Intent**: Clickable things should always look clickable (#7), and the invite/respond buttons repeat enough markup to justify a shared primitive (#7 "reusable components").

**Contract**:
- In `global.css` `@layer base`, add: `button:not(:disabled), [role="button"]:not([aria-disabled="true"]), a[href], summary, label[for] { cursor: pointer; }` and `button:disabled, [aria-disabled="true"] { cursor: not-allowed; }`. (Tailwind v4 / Preflight no longer sets `cursor: pointer` on buttons by default — this restores it project-wide.)
- **Reuse the existing shadcn `Button`** (`src/components/ui/button.tsx`, named export, `variant`/`size` props) rather than creating a new primitive — a `ui/Button.tsx` would also collide on case-insensitive filesystems. Adopt it in `InviteChallenger` (trigger `ghost`/`sm`, Send `default`/`sm`, Revoke `outline`/`sm`) and `RespondInvite` (Accept `default`/`sm`, Decline `outline`/`sm`), passing `type="button"`. The inbox page (`invites.astro`) uses anchor links for navigation, which pick up the pointer cursor from the base layer. The round-count chips and search-result rows stay bespoke (special states).

#### 6. Rename `id` → `debateId` in the debate page

**File**: `src/pages/debates/[id].astro`

**Intent**: `const { id } = Astro.params;` is ambiguous next to node/exchange ids (#3).

**Contract**: rename the destructured param to `debateId` and update its uses on the page (the route filename stays `[id].astro`).

#### 7. Owner-username label for the challenger

**File**: `src/pages/debates/[id].astro`

**Intent**: The owner sees the `InviteChallenger` affordance in the header; a **challenger** viewing the debate should see whose debate it is.

**Contract**: when the viewer is **not** the owner, resolve the owner's username (`profiles` by `debate.owner_id`; `profiles_select_authenticated` lets any authed user read it) and render it muted in the header's `header-actions` slot — **"Advocate: @{ownerUsername}"** with `text-muted-foreground`. Only the owner branch renders `InviteChallenger`.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all migrations + the new seed cleanly (10 profiles present).
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- As a **challenger** (pending or accepted), the debate canvas is fully read-only — no drag, connect, context menu, role change, delete, or double-click edit; reads work. The header shows **"Advocate: @{owner}"**.
- As the **advocate**, editing freezes **in place** (no reload/flicker) the instant an invite is sent; **Revoke** re-opens editing and clears the status line in place.
- The status line reads **"Invite sent to @{user} for {n} rounds — awaiting response"** while pending, and flips to accepted **without a manual hard refresh** (poll/focus) once the challenger accepts; a decline re-opens editing.
- The username search shows **no list and a "Type a username to search." hint on open** (no network call); typing shows **"Searching…"** then matches, self excluded, with no empty-then-full flash.
- The invite panel **closes on an outside click**, including on the canvas.
- Inviting `user02` (a valid-UUID seed user) succeeds — no "Invalid UUID" 400 (#6).
- Buttons and links show a pointer cursor; disabled buttons show not-allowed.

**Implementation Note**: Pause for confirmation after automated verification before Phase 5.

---

## Phase 5: Integration smoke suite

### Overview

Extend the fixtures with a second user + an as-user (anon) client, then smoke-test the slice's integrity boundaries. This introduces the two-user fixture the test-plan's Phase 2 reuses.

### Changes Required:

#### 1. Two-user fixture + as-user client helper

**File**: `tests/integration/globalSetup.ts`, `tests/integration/helpers.ts`

**Intent**: Provision a second auth user and expose a helper that returns an anon-key client signed in as a given user (so RLS applies, unlike the service client).

**Contract**: `globalSetup` provisions a second user (mirror the first; provide `challengerUser`). `helpers.ts` adds `getClientAsUser(email, password)` returning an anon-key client (RLS-enforced), and a convenience to seed/sign-in the second user. Keep the existing `serviceClient` for teardown/assertions.

#### 2. Exchange integration tests

**File**: `tests/integration/exchange.test.ts` (new)

**Intent**: Prove the gate, RLS pair-visibility, and invite semantics server-side.

**Contract** (`describeIntegration`):
- **Gate part 1 (FR-007):** open against a debate whose `root_node_id` is null (insert via service client) ⇒ `ValidationError`. A debate with a root ⇒ succeeds.
- **Gate part 2 (well-formedness):** a debate containing a `connective` node with <2 operand relations ⇒ `ValidationError`; adding the 2nd operand ⇒ succeeds. (Seed the malformed map via the service client.)
- **RLS pair-visibility (Risk #1) — pending grants READ:** advocate opens exchange inviting userB. *While `pending`:* userB's as-user (anon) client CAN SELECT the debate/nodes/relations, but userB's INSERT/UPDATE on `nodes`/`relations` is **denied** (read-not-write). *After accept:* userB can still read (and still cannot write — writes are S-03). *After decline* (on a separate fresh exchange): userB can no longer read. A third non-participant user ⇒ denied throughout.
- **Self-invite:** `advocateId === challengerId` ⇒ `ValidationError` (422). Also assert `searchUsersByUsername` never returns the caller (advocate absent from their own results).
- **Duplicate open:** second open on the same debate while one is pending/accepted ⇒ `ConflictError` (409). After a decline, re-invite ⇒ succeeds.
- **Respond transitions:** accept flips `status='accepted'` + sets `responded_at` (and leaves `current_round=1`, `current_turn='challenger'`); decline flips `status='declined'`; responding to a non-pending exchange ⇒ `NotFoundError` (404).
- **Revoke (Phase 4.5 — `exchanges_delete`):** the advocate's as-user client deletes their own **pending** exchange ⇒ row gone, the partial-unique slot re-opens (re-invite succeeds), and userB can **no longer read** the graph (revoke closes read access like decline). The advocate cannot delete an **accepted** exchange (pending-only). A non-advocate (userB or a third user) cannot delete the exchange (RLS denies — 0 rows / 404 via `revokeInvite`). Exercise via `revokeInvite` and/or the as-user client directly.

### Success Criteria:

#### Automated Verification:

- Integration suite passes against local Supabase: `npm run test:integration` (or the repo's vitest integration command)
- Full type + lint + build clean: `npx astro check && npm run lint && npm run build`

#### Manual Verification:

- Suite is green with the integration env set; skips cleanly when env is absent (`describeIntegration` → `describe.skip`).

**Implementation Note**: Final phase — confirm the full slice end-to-end after the suite passes.

---

## Testing Strategy

### Unit Tests:

- Exchange schemas: round-count bounds (reject 0/6, accept 1/3/5), `.strict()` rejects unknown fields, respond requires boolean; search schema accepts empty + partial substring and caps length; LIKE-escaping keeps `_`/`%` literal.

### Integration Tests (the slice's real signal):

- FR-007 gate rejection server-side — **both** parts (missing root; connective with <2 operands).
- RLS pair-visibility: challenger **reads from `pending` onward** but cannot write; read access revoked on decline; non-participant always denied (two-user + as-user fixture).
- Self-invite (422) **and** caller absent from search results.
- Duplicate-open (409), re-invite-after-decline (success).
- Respond transitions incl. the not-found / already-responded branch.
- Revoke (Phase 4.5): advocate deletes a pending exchange (slot re-opens, challenger read closes); pending-only (accepted not deletable); non-advocate denied.

### Manual Testing Steps:

1. As advocate, open a debate with a root Claim; search a known username; set rounds to 4; send invite.
2. As that challenger (second browser), open `/invites`, accept; confirm `/debates/:id` now loads.
3. As challenger, decline a fresh invite; confirm the debate is not readable and the advocate can re-invite.
4. Confirm the invite affordance is hidden when a debate has no root Claim (edge — requires a manually nulled root).

## Performance Considerations

- **Why inline `EXISTS`, not a helper.** The widened RLS predicate adds an `exchanges` lookup to every graph read. Written as an inline `EXISTS` with `(select auth.uid())`, Postgres rewrites it into **one semi-join per scan** and hoists `auth.uid()` to a single InitPlan — not a per-row evaluation. A `security definer` helper (`is_debate_participant(debate_id)`) would instead be an opaque per-row function call, defeating that optimization. The owner branch short-circuits the common case (a `debates` PK probe); the `exchanges (challenger_id)` / `(debate_id)` indexes keep the challenger branch a cheap index lookup. At MVP scale (graphs are tens of nodes) this is sub-millisecond regardless.
- **Scale lever (deferred, not built in S-02): `get_debate_graph` RPC.** If argument maps ever grow large enough that per-scan semi-joins on every read become a measured cost, route the read path (`getDebateGraph`, `repository.ts:37-54`) through a `security definer` RPC that does the membership check **once** and bulk-returns nodes+relations — mirroring the repo's existing `create_debate_with_root` / `patch_node` / `set_debate_root` definer pattern. RLS stays enabled as the deny-by-default backstop (the definer function bypasses it by design). Trigger: a profiled regression on graph reads — not a guess. Rejected alternative: caching membership in a session variable via `init_debate_session` + `current_setting` — broken under Supabase's transaction-mode connection pooler (transaction-local settings don't survive across the separate init/read calls).

## Migration Notes

- Single forward migration; no existing data to migrate (no exchanges exist). The RLS `*_select` policies are dropped and recreated — existing owner access is preserved by the owner branch of the inline predicate.
- Run `npx supabase gen types typescript --local` + `npx astro sync` after the migration before lint/build.

## References

- Research: `context/changes/invite-and-open-exchange/research.md`
- Change identity: `context/changes/invite-and-open-exchange/change.md`
- RLS to widen: `supabase/migrations/20260528000001_create_debate_graph.sql:84-149`
- S-02 hole comment: `supabase/migrations/20260605000001_tighten_graph_write_policies.sql:1-4`
- Atomic RPC / SETOF patterns: `20260528000001:156-204`, `20260608000002:11-47` (live `set_debate_root`)
- Repository template (pre-check + 23505→409): `src/lib/debate/repository.ts:188-223`
- Operand-gate source (`link` must target a connective): `src/lib/debate/relationRules.ts:11-14`, enforced `repository.ts:188-202`
- Graph read path (the `get_debate_graph` scale-lever target): `src/lib/debate/repository.ts:37-54`
- `withAuth` + error mapping: `src/lib/api.ts:10-46`
- Search primitive: `src/lib/users.ts:9-20`; query-param endpoint template: `src/pages/api/auth/username-available.ts:5-22`
- Test fixtures: `tests/integration/globalSetup.ts`, `tests/integration/helpers.ts`
- Lessons: §1 (`withAuth`), §3 (centralize limits — round count), §4 (`RETURNS SETOF`)
- Test-plan Risk #1 (Phase 2 RLS), Risk #3 (gate): `context/foundation/test-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + RLS migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 2504fff
- [x] 1.2 Types regenerated — `exchanges` row type present in `src/db/database.types.ts` — 2504fff
- [x] 1.3 Type checking passes: `npx astro check` — 2504fff
- [x] 1.4 Linting passes: `npm run lint` — 2504fff

#### Manual

- [x] 1.5 RLS pair-visibility behaves (pending/accepted challenger reads; declined + non-participant denied) — 2504fff

  > **Agent-automatable**: Yes — two anon-key sessions via the password grant + SQL `set local role`.

  ```sql
  -- As the invited challenger (set local role to their uid), expect 1 row:
  set local role authenticated;
  set local "request.jwt.claims" to '{"sub":"<challenger_uuid>","role":"authenticated"}';
  select count(*) from public.debates where id = '<debate_uuid>';
  -- Expected: 1 when status in ('pending','accepted'), 0 when 'declined'.
  -- Repeat for a non-participant uuid. Expected: 0.
  -- Then confirm WRITE is still blocked even while readable:
  insert into public.nodes (debate_id, author_id, kind, metadata)
  values ('<debate_uuid>', '<challenger_uuid>', 'statement', '{"statement_type":"claim","title":"x"}');
  -- Expected: RLS denies (0 rows / error) — challenger reads but cannot edit.
  ```

- [x] 1.6 Partial unique allows re-invite after decline, blocks a second open — 2504fff

  > **Agent-automatable**: Yes — direct inserts via service client.

  ```sql
  -- Two pending rows on the same debate must violate exchanges_one_open_per_debate (23505).
  -- A row added after the prior is set status='declined' must succeed.
  ```

### Phase 2: Exchange domain module

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Unit tests pass: `npm run test:unit`
- [x] 2.3 Linting passes: `npm run lint`

### Phase 3: API endpoints + middleware

#### Automated

- [x] 3.1 Type checking passes: `npx astro check` — 0b7aadf
- [x] 3.2 Linting passes: `npm run lint` — 0b7aadf
- [x] 3.3 Build passes: `npm run build` — 0b7aadf

#### Manual

- [x] 3.4 Endpoints return expected status codes (happy + edge) — 0b7aadf

  > **Agent-automatable**: Yes — bearer token via `/auth/v1/token?grant_type=password`, then curl.

  ```bash
  # Get a bearer token for the advocate:
  TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" \
    -d '{"email":"<advocate_email>","password":"<pw>"}' | jq -r .access_token)

  # Search (200, {users:[...]} alphabetical, caller excluded; empty query => all up to the cap):
  curl -s "http://localhost:4321/api/users/search?username=<substr>" -H "Authorization: Bearer $TOKEN"
  curl -s "http://localhost:4321/api/users/search?username=" -H "Authorization: Bearer $TOKEN"  # match-all
  # Confirm the advocate's own username is NOT in either result set.
  # Open exchange (expect {id}):
  curl -s -X POST http://localhost:4321/api/exchanges -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"debateId":"<uuid>","challengerId":"<uuid>","roundCount":3}'
  # Self-invite (expect 422); duplicate open (expect 409);
  # gateless debate — missing root OR a connective with <2 operands (expect 422).
  ```

### Phase 4: UI — advocate invite + challenger inbox

#### Automated

- [x] 4.1 Type checking passes: `npx astro check` — 8bc88f1
- [x] 4.2 Linting passes: `npm run lint` — 8bc88f1
- [x] 4.3 Build passes: `npm run build` — 8bc88f1

#### Manual

- [x] 4.4 Slide-over panel: open shows alphabetical users (self excluded), substring narrows, no-match shows empty list; pick user + rounds in one box → invite → challenger reads map while pending → accept; decline → re-invite — 8bc88f1

  > **Agent-automatable**: No — requires two browser sessions and visual confirmation of the slide-over invite UI.

- [x] 4.5 Clicking Send when no root Claim **or** a connective has <2 operands surfaces a clear UI message naming the cause (server 422 via `apiError`); advocate not silently blocked — 8bc88f1

  > **Agent-automatable**: No — visual inspection of the debate page UI state.

### Phase 4.5: Editing lock during exchange + invite UX polish + seed/cursor fixes

#### Automated

- [x] 4.5.1 `canEdit` lock wired: store guards + MapEditor interaction props + node edit-entry gates; `[id].astro` computes `isOwner && existingExchange === null`; runtime flip via `setCanEdit` + cross-island `wvmap:set-can-edit` event (no reload) — 8bc88f1
- [x] 4.5.2 Exchange read+revoke shipped: `exchanges_delete` policy migration, `getExchangeStatus` + `revokeInvite` repo fns, `GET`/`DELETE /api/exchanges/[id]` — 8bc88f1
- [x] 4.5.3 InviteChallenger UX: status line names challenger + rounds, in-place Revoke, type-to-search (no on-open fetch, "Searching…"/hint states), visibility-gated freshness poll, outside-click dismiss — 8bc88f1
- [x] 4.5.4 Seed overhaul: 10 users with valid v4 UUIDs + identities + profiles; `npx supabase db reset` applies cleanly — 8bc88f1
- [x] 4.5.5 Global cursor affordance in `global.css` + existing shadcn `Button` adopted in invite/respond surfaces — 8bc88f1
- [x] 4.5.6 `id` → `debateId` rename in `[id].astro`; challenger sees "Advocate: @{owner}" in the header — 8bc88f1
- [x] 4.5.7 Type checking passes: `npx astro check` — 8bc88f1
- [x] 4.5.8 Linting passes: `npm run lint` — 8bc88f1
- [x] 4.5.9 Build passes: `npm run build` — 8bc88f1

#### Manual

- [x] 4.5.10 Challenger canvas fully read-only (no drag/connect/menu/role/delete/dbl-click); reads work — 8bc88f1

  > **Agent-automatable**: No — requires a second browser session and visual confirmation.

- [x] 4.5.11 Advocate frozen on invite send; Revoke re-opens editing; accept reflects without manual hard refresh (poll/focus) — 8bc88f1

  > **Agent-automatable**: No — two-session visual confirmation of the lock + freshness behaviour.

- [x] 4.5.12 Status line shows "@{user} for {n} rounds — awaiting response"; search lists 10 seed users self-excluded with no double fetch; inviting a seed user succeeds (no Invalid-UUID 400); pointer cursor on clickables — 8bc88f1

  > **Agent-automatable**: Partially — the search/invite/UUID path is curl-checkable; cursor + status line need visual inspection.

### Phase 5: Integration smoke suite

#### Automated

- [x] 5.1 Integration suite passes: `npm run test:integration` — f07c397
- [x] 5.2 Full type + lint + build clean: `npx astro check && npm run lint && npm run build` — f07c397

#### Manual

- [x] 5.3 Suite skips cleanly when integration env is absent — f07c397

  > **Agent-automatable**: Yes — unset `SUPABASE_SERVICE_ROLE_KEY` and confirm `describe.skip`.

  ```bash
  # Without integration env, the exchange suite must report as skipped, not failed.
  npm run test:integration
  ```
