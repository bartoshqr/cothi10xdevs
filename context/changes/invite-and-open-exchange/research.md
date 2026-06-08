---
date: 2026-06-08T16:48:54+02:00
researcher: bartoshqr
git_commit: 81e7dec8eae98506fdfbf4caf9aae58970ea1981
branch: develop
repository: cothi10xdevs
topic: "S-02 — Advocate invites a challenger and opens the exchange (FR-007/008/009/010)"
tags: [research, codebase, exchange, invites, rls, root-claim-gate, username-search]
status: complete
last_updated: 2026-06-08
last_updated_by: bartoshqr
---

# Research: S-02 — Advocate invites a challenger and opens the exchange

**Date**: 2026-06-08T16:48:54+02:00
**Researcher**: bartoshqr
**Git Commit**: 81e7dec8eae98506fdfbf4caf9aae58970ea1981
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

What is the oracle for roadmap slice **S-02 / `invite-and-open-exchange`** — what *should* the code do for **FR-007** (exchange initiation gated on a root Claim existing), **FR-008** (round count 1–5, default 3, fixed at initiation; challenger-first/advocate-last ordering), **FR-009** (search a registered user by username and send an in-app invite), and **FR-010** (challenger accepts or declines)? What already exists in the codebase that S-02 must extend, and where are the integrity boundaries?

> The oracle below is derived from sources — PRD (`context/foundation/prd.md`), roadmap, tech-stack, test-plan, and the *existing* schema/RLS conventions — **not** from any S-02 implementation (none exists yet). Where the PRD is silent, that is flagged as an Open Question, not guessed.

## Summary

S-02 introduces the **second participant** into a data model that is, today, strictly **single-owner**. That is the central finding and the source of the slice's risk.

- **What exists and is reusable as-is:** the debate/node/relation schema, the root-Claim designation mechanism (`debates.root_node_id`), the username-search primitive (`findUserByUsername`), the `withAuth` API wrapper, the typed-error→status mapping, and the `RETURNS SETOF` 404 convention. These are house patterns S-02 must mirror, not reinvent.
- **What is missing and must be built:** there is **no** exchange/lifecycle state, **no** invite entity, **no** round-config storage, and **no** second-participant (challenger) column or table anywhere. `debates` has no `status` column at all.
- **The load-bearing integrity boundary (two faces):**
  1. **FR-007 gate** — "no exchange without a root Claim." This maps to a concrete, already-guaranteed predicate: `debates.root_node_id IS NOT NULL`. *(safe face — easy to assert)*
  2. **RLS pair-visibility** — every RLS policy on `debates`/`nodes`/`relations` currently keys off `owner_id = auth.uid()`. **A challenger who accepts an invite cannot SELECT the debate, its nodes, or its relations today.** Widening this to participant-membership is the real, dangerous face of the slice — get it wrong and you either leak debates to non-participants or lock the challenger out. The tightening migration's own comment explicitly flagged this as the "latent hole … for S-02."
- **Round ordering (FR-008):** challenger acts first, advocate acts last, within each round. S-02 only needs to *store* the round count and *establish* the turn model's starting state (challenger-first); the turn machinery itself is S-03+.

## Detailed Findings

### A. The root-Claim initiation gate (FR-007)

The root Claim is modeled as a single nullable FK column **`debates.root_node_id`** (`supabase/migrations/20260528000001_create_debate_graph.sql:27`), with a **deferrable** FK to `nodes(id)` (`:49-52`) so a debate row can be inserted before its root node exists within the creation transaction.

- **Creation guarantees a root from birth:** `create_debate_with_root(p_title, p_root_title, p_root_body)` (`:156-204`, `security definer`) atomically inserts the debate, inserts one `statement`/`claim` node, and sets `root_node_id`. Every debate created through the app already has a root claim.
- **The root is protected:** it cannot be deleted (FK backstop → `23503` → `ConflictError`/409 in `src/lib/debate/repository.ts:144-157`), its type cannot be demoted from `claim` (`repository.ts:108-118`), and re-designation via `set_debate_root` (`20260608000002_set_debate_root_strip_url.sql:11-44`) keeps the apex a claim and strips its outgoing relations.

**Oracle for FR-007:** the gate check is **`debates.root_node_id IS NOT NULL`**. Given the invariants above, a non-null `root_node_id` is guaranteed to point at a `statement`/`claim` node, so the cheap predicate is authoritative. A stricter join (defensive) is available if desired:

```sql
select 1 from debates d
join nodes n on n.id = d.root_node_id
where d.id = $1 and n.kind = 'statement' and n.metadata->>'statement_type' = 'claim';
```

The gate must be enforced **server-side at exchange creation** (a UI-only block is insufficient — this is the "thin maps reach challengers" risk in `roadmap.md:148`). Test-plan **Risk #3** already covers "exchange initiated with no root Claim" and references `tests/integration/rootProtection.test.ts` (`test-plan.md:241`).

### B. The debate has no lifecycle/status today

`debates` columns are only `id, owner_id, title, root_node_id, created_at` (`20260528000001_create_debate_graph.sql:21-29`). There is **no `status`/`state` column** and no enum for drafting/in-progress/closed anywhere in the schema. S-02 must introduce whatever exchange/lifecycle state it needs (new column on `debates`, or — more cleanly — a new `exchanges` table). FR-024's debate-state display (drafting/in-progress/closed) is S-06's concern but depends on whatever lifecycle field S-02 lands, so choose the representation with S-06 in mind.

### C. RLS is owner-only — the pair-visibility problem (FR-021 implication for S-02)

Every policy is scoped to the single owner:

- `debates_select`: `using (owner_id = auth.uid())` (`20260528000001_create_debate_graph.sql:84-85`); insert/update/delete likewise (`:87-95`).
- `nodes` select scoped via `exists(... debates d where d.id = nodes.debate_id and d.owner_id = auth.uid())` (`:98-105`); write policies tightened to require `author_id = auth.uid()` **AND** debate-ownership (`20260605000001_tighten_graph_write_policies.sql:6-25`).
- `relations` — identical pattern (`20260528000001:125-142`, tightened `20260605000001:27-46`).

**Consequence:** an accepted challenger currently has **zero** read access to the debate graph. S-02 must widen the membership predicate in the `debates` select policy and in the `nodes`/`relations` select (and, for later slices, write) subqueries from `owner_id = auth.uid()` to a participant check — e.g. `owner_id = auth.uid() OR challenger_id = auth.uid()`, or `exists(select 1 from <participants> where debate_id = ... and user_id = auth.uid())`.

Note the **structural readiness**: `nodes.author_id` and `relations.author_id` are already real FK columns to `auth.users` (`20260528000001:34,57`) passed explicitly into the repo (`repository.ts:60,188`). So rows can already carry two distinct authors in one debate — **only the debate-ownership subquery blocks the challenger**, nothing in the row shape. The tightening migration's header comment (`20260605000001:1-4`) explicitly names this as the hole left for S-02.

This is exactly **test-plan Risk #1** (Authorization/RLS, High × High): "User B's request for User A's debate / node / relation is denied at the database … the API returns 404/403, never the row," requiring a **two-user fixture** (`test-plan.md:68`). Risk #1 is carried into Phase 2 of the test rollout (`test-plan.md:103,265`). S-02 establishes the schema that Phase 2 will test; S-02 should at minimum smoke-test that an accepted challenger can read and a non-participant cannot.

### D. Username search for invites (FR-009) — primitive already ships

The invite-search primitive **already exists** and is explicitly labelled for S-02:

```ts
// src/lib/users.ts:9-20  — "The S-02 invite-search primitive"
export async function findUserByUsername(
  supabase, username,
): Promise<{ id: string; username: string } | null> {
  const { data } = await supabase
    .from("profiles").select("id, username")
    .eq("username", normalizeUsername(username)).maybeSingle();
  return data;
}
```

- **Exact match, case-insensitive, not fuzzy.** It uses `.eq()` on the normalized (lowercased) value, *not* `.ilike()`, deliberately — usernames may contain `_`, which ILIKE treats as a wildcard (`src/lib/users.ts:5-8`).
- **RLS permits it:** `profiles_select_authenticated` is `to authenticated using (true)` (`20260525142850_create_profiles.sql:20-26`) — any authenticated user can read any profile (profiles hold only the public handle). Anon SELECT is revoked.
- **Normalization + validation primitives:** `normalizeUsername()` (trim + lowercase) and `USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/` in `src/lib/username.ts:1-10`; the lowercase uniqueness is enforced by `create unique index profiles_username_lower_key on public.profiles (lower(username))` (`20260525142850_create_profiles.sql:12`) plus a CHECK on the format (`:8`).
- **Username-only by design:** email search was removed as unsafe (leaks account existence / username) per `prd.md:126`. Usernames are immutable in MVP, so an invite can safely store the resolved `user_id`.

**Oracle for FR-009:** the search endpoint resolves a username to `{ id, username } | null` via `findUserByUsername`. Decide and document the self-invite case (advocate searching their own username) and the "no such user" response shape (likely `404`/empty, mirroring the not-found convention). Closest existing query-string endpoint template: `src/pages/api/auth/username-available.ts:5-22` (reads `context.url.searchParams.get(...)`), but the invite-search endpoint must be wrapped in `withAuth` (it is post-auth), unlike `username-available` which is public.

### E. Invite accept/decline (FR-010) and round config (FR-008)

No invite or exchange entity exists yet — both are net-new. From the PRD, the oracle for these entities:

- **FR-008:** round count is an integer **1–5, default 3**, **fixed at initiation** (`prd.md:123`). Per lessons.md §3 (centralize shared limits), define `ROUND_COUNT_MIN/MAX/DEFAULT` once in a constants module and import into the Zod schema, the React form, and mirror in a DB CHECK constraint with a comment pointing at the constant. Within each round **the challenger acts first, the advocate acts last** (`prd.md:123`) — S-02 sets the initial turn state to challenger-first; turn submission machinery is S-03/S-04.
- **FR-010:** challenger can **accept or decline** — no auto-accept (`prd.md:127-128`). The invite therefore has an explicit status (`pending`/`accepted`/`declined`). On accept, the challenger becomes a participant (unlocking the widened RLS from §C).
- **FR-021:** exchange content is private to the advocate/challenger pair — reinforces that the participant set is exactly two and drives the RLS predicate.

**Schema shape (oracle, from prior-decision patterns — F-01/S-01 used real FK columns, not JSONB):** model invite/participant fields as proper columns with FKs to `auth.users` — e.g. `debate_id`, `sender_id`/`advocate_id`, `recipient_id`/`challenger_id`, `status`, `round_count`, `created_at`, `responded_at`. Whether the round count and challenger live on a new `exchanges` table vs on `debates`, and whether invite is a separate row, is a **plan decision**, not resolved by sources — see Open Questions.

### F. API + repository conventions S-02 must mirror

- **`withAuth` already exists** (`src/lib/api.ts:10-46`) — the lessons.md §1 helper is done; do **not** re-copy the auth preamble. It does the 503 (unconfigured) + 401 (no user) guards and maps thrown domain errors: `NotFoundError`→404, `ValidationError`→422, `ConflictError`→409, else logged 500 (`api.ts:24-44`). New endpoints: `export const POST = withAuth(async (context, supabase, user) => {…})`.
- **Auth resolution:** `getAuthUser(supabase, headers)` supports both `Authorization: Bearer` and the cookie SSR session via network-validated `auth.getUser()` (`src/lib/supabase.ts:36-46`). Never use bare `getUser()`/`getSession()`.
- **Validation:** per-handler Zod. Param schemas are bare `z.uuid()`; body schemas use `.strict()` to whitelist writable fields. 400 shapes: `{ error: "Invalid <thing> id" }` for params, `{ error: z.treeifyError(parsed.error) }` for bodies, `{ error: "Invalid JSON" }` for parse failure. Schemas live per-domain (`src/lib/debate/schemas.ts`) — add `src/lib/invite/` (or `src/lib/exchange/`) schemas + repository.
- **Repository pattern:** client injected as first arg (`type DB = SupabaseClient<Database>`); functions return `null`/throw typed errors; SQLSTATE translation (`23505`→`ConflictError`, `.maybeSingle()` null → `NotFoundError`). `user.id` passed explicitly when the repo needs author/owner.
- **RPC/atomicity:** multi-step writes go in a `plpgsql`/`sql` function with `security definer`/invoker as appropriate, `set search_path = ''`, **`returns setof <table>`** (never bare composite — lessons.md §4 / impl-review F2), and `revoke execute from public, anon; grant execute to authenticated`. Atomic exchange-open (gate-check + create exchange + create invite + set initial turn) is a natural fit for one such RPC.
- **Middleware:** add any new authed **page** prefixes (e.g. `/invites`) to `PROTECTED_ROUTES` in `src/middleware.ts:4` (CLAUDE.md hard rule). API routes self-guard via `withAuth` and are not listed.
- **Type regen:** run `npx supabase gen types typescript --local` after the migration so repository functions get the generated `Database` types (and `astro sync` before lint/build).

## Code References

- `supabase/migrations/20260528000001_create_debate_graph.sql:21-29` — `debates` table (no status column; `root_node_id` at `:27`, deferrable FK `:49-52`).
- `supabase/migrations/20260528000001_create_debate_graph.sql:84-95` — owner-only `debates` RLS (the predicate S-02 must widen).
- `supabase/migrations/20260605000001_tighten_graph_write_policies.sql:1-46` — tightened node/relation write policies; header comment flags the S-02 collaboration hole.
- `supabase/migrations/20260528000001_create_debate_graph.sql:156-204` — `create_debate_with_root` RPC (atomic root creation pattern to mirror).
- `supabase/migrations/20260608000002_set_debate_root_strip_url.sql:11-47` — `set_debate_root … returns setof public.debates` (SETOF + invoker pattern).
- `supabase/migrations/20260525142850_create_profiles.sql:8,12,20-26` — username format CHECK, lowercase unique index, `profiles_select_authenticated using(true)`.
- `supabase/migrations/20260525170303_add_username_available.sql:7-21` — `username_available(text) returns boolean` RPC.
- `src/lib/users.ts:9-20` — `findUserByUsername` (the S-02 invite-search primitive, exact + case-insensitive).
- `src/lib/username.ts:1-10` — `normalizeUsername`, `USERNAME_PATTERN`.
- `src/lib/api.ts:10-46` — `withAuth` wrapper + domain-error→status mapping.
- `src/lib/supabase.ts:7-46` — `createClient` (Bearer + cookie) and `getAuthUser`.
- `src/lib/errors.ts:7-41` — `NotFoundError` / `ValidationError` / `ConflictError`.
- `src/lib/debate/repository.ts:13-22,108-118,130-157,179-184` — repo shape, root-demotion block, SETOF `.maybeSingle()`→404 pattern.
- `src/lib/debate/schemas.ts:49-56` — `.strict()` PATCH whitelisting convention.
- `src/pages/api/auth/username-available.ts:5-22` — query-string endpoint template (public; S-02's must be `withAuth`).
- `src/pages/api/debates/index.ts:7-19` — body-validation + repo-call handler template.
- `src/middleware.ts:4,18-21` — `PROTECTED_ROUTES` prefix matching.

## Architecture Insights

- **The row shape is already two-author ready; only RLS is single-owner.** The hard work of S-02's authorization is *not* adding author columns (they exist) — it is rewriting the membership predicate consistently across `debates` + the `nodes`/`relations` subqueries, and proving denial for non-participants. Treat the RLS change as one atomic migration with a two-user test.
- **Two faces of the slice's risk (per the test-plan's "one safe, one real" framing):** the FR-007 root gate is the *cheap, safe* face (a single non-null predicate, already partly covered by Risk #3); the *real* face is pair-visibility RLS (Risk #1, High×High, two-user fixture). Plan effort accordingly — don't over-invest in the gate and under-invest in RLS.
- **House conventions are strong and consistent** — `withAuth`, typed errors, `RETURNS SETOF`, injected client, centralized constants, atomic plpgsql RPCs. S-02 has little license to deviate; the plan should explicitly reuse each.
- **Lifecycle representation is a forward-coupling decision.** S-02 lands the first exchange-state field; S-06 (debate list) and S-03–S-05 (turn machine) all read it. Choosing `exchanges` table vs `debates.status` now affects all of them.

## Historical Context (from prior changes)

- `context/archive/2026-05-26-advocate-map-builder/` — established the debate-graph schema, the root-Claim lifecycle (FR-007 impl note), real `author_id` columns (not JSONB), and the RLS-tightening + SETOF + `withAuth` lessons (impl-review F1–F4, F6). S-02 inherits all of these.
- `context/archive/2026-05-25-username-profiles/` — shipped `findUserByUsername`, the `profiles_select_authenticated using(true)` policy, lowercase-unique usernames, immutability, and the deliberate removal of email search. This is the entire FR-009 substrate.
- `context/foundation/lessons.md` §1 (`withAuth`), §3 (centralize limits — applies to round count 1–5), §4 (`RETURNS SETOF` for 404) — all directly applicable.
- `context/foundation/test-plan.md` — Risk #1 (authorization, two-user fixture, Phase 2), Risk #3 (illegal graphs incl. no-root-Claim initiation, Phase 1 complete, `rootProtection.test.ts`).

## Related Research

- `context/archive/2026-05-26-advocate-map-builder/research.md` — prior exploration of the graph schema.
- `context/archive/2026-05-25-username-profiles/research.md` — prior exploration of profiles/username lookup.

## Open Questions

1. **Lifecycle representation** — new `exchanges` table (FK → `debates`) vs a `status` column on `debates`? Affects S-03–S-06. *Plan decision; recommend a dedicated table since round count, turn state, and close state all hang off it.*
2. **Invite vs participant modeling** — is the invite a separate row (with `pending/accepted/declined`) that, on accept, populates a `challenger_id`/participant, or is the challenger field on the exchange nullable-until-accept? Sources require accept/decline (FR-010) and privacy-to-the-pair (FR-021) but don't dictate the table layout.
3. **RLS predicate form** — `owner_id = auth.uid() OR challenger_id = auth.uid()` (denormalized, fast) vs a `debate_participants` membership table (extensible). MVP is strictly two-party (FR-021), favoring the simpler denormalized form; confirm at plan time.
4. **Self-invite / re-invite / duplicate-invite semantics** — can an advocate invite themselves? Re-invite after a decline? Invite while an exchange is already open on that debate? Not specified in the PRD — **stop and confirm with the user at plan time** rather than guessing.
5. **"No such user" response shape for FR-009 search** — 404 vs 200-with-empty. Mirror the existing not-found convention but confirm the UX (search box wants a soft "not found", not an error toast).
6. **When does the FR-007 gate run** — only at exchange-open, or also surfaced as a UI affordance (disabled "Invite" button)? PRD says initiation is blocked; recommend enforcing server-side and reflecting in UI.
