# Publishable Debate Showcase (S-09) Implementation Plan

## Overview

Let an advocate **publish** a completed debate (one whose divergence summary exists) so its map
**and** divergence summary become readable by anyone — logged in or not — at a public, read-only URL.
Strangers reach a `/showcase` index that lists every published debate and a `/showcase/[id]` detail
page that renders the real interactive map (frozen) plus the computed divergence summary. The landing
page links to the index as its "see a live debate" hook (`main_goal: market-feedback`).

The work is two pieces, exactly as change.md framed:

1. **Publish primitive** — a `public` boolean + `published_at` on `debates`, a repository mutation, a
   `{ public }` branch on the existing PATCH endpoint, and an advocate-facing publish/unpublish toggle.
2. **Public anon read path** (the meaty, security-critical part) — anon `SELECT` RLS across all five
   graph tables gated on `debates.public = true`, two public Astro routes kept out of
   `PROTECTED_ROUTES`, and the existing `MapEditor` reused in a frozen mode.

## Current State Analysis

Grounded in `context/changes/publishable-debate-showcase/research.md` (codebase baseline; all five of
its open questions are resolved into the Net design):

- **The feature is greenfield.** No publish/showcase/`public`/`published` code exists anywhere in
  `src/` or `supabase/`. The `public: boolean` at `database.types.ts:443` is `storage.buckets`, not
  `debates`.
- **The debate graph is a flat star.** Every child table (`nodes`, `relations`, `exchanges`, `marks`)
  FKs directly to `debates` via its own `debate_id`. No multi-hop chains → every anon policy is a single
  `EXISTS (… debates where id = debate_id and public = true)`.
- **No `statements` table, no `summary` table.** "Statements" are `nodes` rows with `kind='statement'`.
  The divergence summary is **computed at read time** by `getDivergenceSummary` from
  `nodes`+`marks`+`relations` and the `exchanges` gate — so the anon read needs those four tables plus
  `exchanges`, not a separate summary table.
- **The canvas already freezes via existing props.** `MapEditor` with `canEdit={false}` + `viewer={null}`
  collapses every content gate (`myTurnOrPreExchange`, `canEditNode` → `store.ts:806-818`) to off while
  pan/zoom stay on. No new client flag needed (S-02 `canEdit` + S-05 `canWriteContentNow` payoff).
- **The publishable precondition already exists as code.** `getDivergenceSummary(...) !== null`
  (`src/lib/summary/repository.ts:31-38`, gate `status==='completed' || currentRound>=2`) is exactly "a
  divergence summary exists." Reuse it so publishability and summary-availability can never drift.
- **Current RLS is `to authenticated` only; anon sees nothing** (`20260528000001:79-81` revokes select
  from anon). SECURITY DEFINER helper convention already established: `is_debate_owner`,
  `is_accepted_challenger` (stable, `set search_path`, execute revoked from `anon`).
- **Middleware is prefix-match** (`src/middleware.ts`): `PROTECTED_ROUTES = ["/dashboard", "/debates"]`.
  Anon requests still get an RLS-scoped Supabase client (`src/lib/supabase.ts`).
- **Existing PATCH** `/api/debates/[id]` (`src/pages/api/debates/[id]/index.ts:44-69`) handles only
  `rootNodeId` today and is wrapped in `withAuth` (maps `ValidationError`→422, `ConflictError`→409).
- **The landing page** (`src/pages/index.astro`) has **no** live-debate embed yet.

## Desired End State

- An advocate viewing their own completed debate at `/debates/[id]` sees a **Publish** toggle. Clicking
  it makes the debate public and reveals a **View** link to `/showcase/[id]`; clicking again (Unpublish)
  immediately makes it private. The toggle is not rendered at all while the debate is not yet
  publishable (see Phase 2 deviation notes).
- `/showcase` lists every published debate (anon-readable). `/showcase/[id]` renders that debate's real
  map, frozen and read-only, with marks displayed and the divergence summary shown — for anyone,
  logged in or not.
- The landing page has a CTA linking to `/showcase`.
- **Security invariant (verifiable):** an anonymous Supabase client can read **only** rows reachable
  from a `public = true` debate. An unpublished debate returns **zero** anon rows across all five graph
  tables; a published one returns exactly its own graph + summary. The one identity surface beyond the
  graph is `profiles`, scoped to the two participants of a published debate (their usernames). Proven by
  DB-level integration tests.

### Key Discoveries:

- Flat-star schema → one uniform `is_public_debate(debate_id)` predicate per child table
  (`research.md` Area 1; `20260528000001_create_debate_graph.sql:31-63`).
- Frozen board = configuration of existing props, no new code (`MapEditor.tsx:701-743`;
  `store.ts:806-818,820,827`; `StatementNode.tsx:78`).
- Publishable precondition already encoded by `getDivergenceSummary(...) !== null`
  (`src/lib/summary/repository.ts:38`). **Superseded during Phase 2 impl (2026-06-24, deviation
  approved):** that gate also opens mid-exchange at `current_round >= 2`, which is too early to publish.
  `isPublishable` now checks `getDebateExchange(...).status === 'completed'` directly instead — see the
  Phase 2 deviation note.
- `exchanges` **must** get an anon policy too, or the summary 404s for anon even on a published debate
  (`src/lib/summary/repository.ts:35-38`).
- `is_public_debate` helper is the **exception** to the helper convention: it must
  `grant execute … to anon` (existing helpers revoke from anon — easy to get backwards).

## What We're NOT Doing

- **No challenger consent flow.** Advocate-only publish in MVP (showcase authored by two team-owned
  accounts). General-user consent is a later slice.
- **No recorded/Playwright video asset** — the showcase IS the live interactive map; no staleness
  pipeline.
- **No admin role / RBAC.** Publishing is content-agnostic; more topics later = publish more debates.
- **No new `summary`/`statements` table** — summary stays a read-time computation.
- **No Playwright E2E in this change** — Risk #1 is proven at the DB/RLS layer (the IDOR boundary). A
  browser E2E pass is a possible follow-up, not part of this change.
- **No publish-time consent warning modal** and **no unpublish confirm** — unpublish is a one-click,
  instantly reversible toggle.
- **No embedded live-map demo on the landing page.** change.md's Outcome framed the landing page as
  featuring "one published debate as a live, interactive demo"; we deliver a CTA link to `/showcase`
  instead (avoids coupling the landing page to the `MapEditor` island; scales to many topics). The live
  interactive map lives at `/showcase/[id]`, one click away.
- **Not addressing the Cloudflare deploy blocker** (Open Roadmap Q4) — out of scope; flagged as a watch
  item for the eventual public deploy.

## Implementation Approach

Build the **security boundary first** (Phase 1: migration + anon RLS + DB-level leak tests), so the
anon read path is proven safe before any page can expose it. Then the **advocate-facing publish
primitive** (Phase 2: repository + endpoint + toggle UI). Then the **anon-facing read pages** (Phase 3:
showcase index + detail + landing CTA), which simply consume the now-anon-reachable repository
functions. Every Supabase access goes through a typed repository function — the showcase pages never
call `supabase.from()` inline (hard lesson: _Keep all Supabase calls in a repository_).

## Critical Implementation Details

- **`is_public_debate(uuid)` must grant execute to `anon`.** This inverts the existing helper
  convention (`is_debate_owner`/`is_accepted_challenger` revoke from anon). The helper reads `debates`
  as a SECURITY DEFINER so the anon policy never back-references the child table that called it —
  recursion-proof (42P17). The `debates` anon policy itself stays a plain `public = true` column
  predicate (no subquery, so no cycle).
- **Anon RLS policies are additive.** RLS policies are OR'd per role; adding `for select to anon`
  policies leaves the existing `to authenticated` owner/challenger policies untouched. Do not modify
  the authenticated policies.
- **`exchanges` is the easy-to-forget table.** It holds no map content but the summary gate reads its
  `status`/`current_round`; omitting its anon policy yields no leak but a silent summary 404.
- **`profiles` is the easy-to-miss sixth surface.** `getDebateExchange` resolves usernames from
  `profiles`; anon had `select` revoked, so the anon read path 500s with `permission denied for table
profiles` until a `profiles_select_anon` policy (gated on `is_public_debate_participant`) plus a
  `grant select … to anon` are added. Exposes only published-debate participants' usernames.
- **Showcase pages must pre-load `initialMarks` server-side.** The debate page skips the marks fetch
  when `viewer === null` (`[id].astro:43`); the showcase must supply marks explicitly or the frozen
  board renders no marks. The turn-state poll never starts without a `viewer`/`exchangeId`
  (`MapEditor.tsx:405`).
- **`mark_stance` enum.** `classify.ts:97` switches on `"accept"` (renamed from `'agree'` in
  `20260612000001_rename_agree_to_accept.sql`). Confirm that migration is applied in the target env
  before trusting summary output (verification only — not a design decision).

---

## Phase 1: Data layer & anon RLS (security boundary)

### Overview

Add the `public`/`published_at` columns, the `is_public_debate` helper, and anon `SELECT` policies
across all five graph tables; regenerate types; and prove the leak-free invariant (Risk #1) with
DB-level integration tests before any page can expose the anon path.

### Changes Required:

#### 1. Migration — columns, helper, anon policies

**File**: `supabase/migrations/<timestamp>_publishable_showcase.sql` (new)

**Intent**: Make a debate publishable and anon-readable when published, with a single shared predicate
across child tables so the gate can't drift (a drift is the IDOR).

**Contract**:

- `alter table public.debates add column public boolean not null default false, add column published_at timestamptz null;`
- `create function public.is_public_debate(p_debate_id uuid) returns boolean` — `language sql stable
security definer set search_path = public`, body `select exists (select 1 from public.debates d where
d.id = p_debate_id and d.public = true)`. `revoke execute … from public`; **`grant execute … to anon, authenticated`**.
- Five `create policy … for select to anon`:
  - `debates`: `using (public = true)`.
  - `nodes` / `relations` / `marks` / `exchanges`: `using (is_public_debate(debate_id))`.
- **`grant select … to anon`** on all five tables: the base migrations `revoke select … from anon`,
  and RLS needs **both** the table privilege **and** a policy — without the re-grant the `for select to
anon` policies are inert (permission denied).
- **Sixth anon surface — `profiles` (deviation, approved during impl).** `getDebateExchange` (used by
  `getDivergenceSummary` and the Phase 3 showcase page) resolves advocate/challenger usernames from
  `profiles`, which anon cannot read → hard `permission denied for table profiles`. Add a second
  SECURITY DEFINER helper `public.is_public_debate_participant(p_user_id uuid)` (joins `exchanges`→
  `debates` on `d.public = true`; `grant execute … to anon, authenticated`), `grant select on
public.profiles to anon`, and `create policy profiles_select_anon … using
(is_public_debate_participant(id))`. Scope: only the two participants of a **published** debate are
  anon-readable; all other usernames stay private. (Alternative considered: a profiles-free minimal
  exchange-status read — rejected so the showcase can show participant usernames.)
- Keep all existing `to authenticated` policies as-is.

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the two new `debates` columns so the repository/types compile.

**Contract**: Run `npm run db:types` (never hand-edit). `debates.Row` gains `public: boolean` and
`published_at: string | null`.

#### 3. DB-level anon leak tests (Risk #1)

**File**: test under `tests/integration/` (mirror the existing RLS/repository suites, e.g.
`summary.test.ts`, `marks.test.ts`). Seed with the service client; assert with a **no-session
anon-key** client.

**New helper required** — `tests/integration/helpers.ts` has **no** truly-anonymous client today: every
"anon-key" client goes through `getClientAsUser`, which calls `signInWithPassword` and therefore
authenticates to PostgREST as the **`authenticated`** role, not `anon`. Add an `anonClient()` helper:
`createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } })` with **no**
sign-in, so PostgREST runs the request as the `anon` Postgres role. ⚠️ Signing this client in (or
reusing `getClientAsUser`) silently tests the pre-existing `authenticated` policies and voids the
entire leak assertion.

**Intent**: Prove the security invariant: anon reads only `public = true` rows; an unpublished debate
leaks nothing on any of the five tables.

**Contract** — assertions, each via an anon-role client:

- Seed two debates with full graphs (nodes, relations, marks, exchange, completed round): one
  `public = true`, one `public = false`.
- For the **unpublished** debate: anon `select` returns **0 rows** on each of `debates`, `nodes`,
  `relations`, `marks`, `exchanges` (including direct-by-`debate_id` enumeration on the children — the
  IDOR path).
- For the **published** debate: anon `select` returns exactly its own rows on all five tables, and
  `getDivergenceSummary` via an anon client returns a non-null summary.
- **`profiles` (sixth surface):** anon reads the two participant usernames of the **published** debate,
  and an unrelated user's profile (member of no public debate) returns **0 rows**.
- Negative drift guards: confirm each child table's anon policy is gated (a `using (true)` or a missing
  `public = true` would surface as the unpublished debate leaking).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly: `npx supabase db reset` (or `db push`) succeeds
- [ ] Types regenerated and committed: `npm run db:types` produces no further diff
- [ ] Type checking passes: `npx astro check`
- [ ] Linting passes: `npm run lint`
- [ ] Anon leak integration tests pass (unpublished → 0 anon rows on all 5 tables; published → exactly
      its own graph + non-null summary)

#### Manual Verification:

- [ ] In Supabase Studio / `mcp__supabase-local__execute_sql` as the `anon` role, an unpublished debate
      returns no rows on any of the five tables
- [ ] As `anon`, a `public = true` debate returns its full graph and the computed summary is non-null

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding to Phase 2.

---

## Phase 2: Publish primitive (advocate-facing)

### Overview

Add the repository mutation + publishability check + published-debate listing, extend the PATCH
endpoint to toggle `public`, and add the advocate-facing publish/unpublish toggle that surfaces a View
link to the showcase page.

### Changes Required:

#### 1. Repository functions

**File**: `src/lib/debate/repository.ts`

**Intent**: One atomic mutation to set published state, a publishability check that can't drift from
summary-availability, and a listing for the showcase index.

**Contract** (new functions use object-destructuring args per CLAUDE.md, even though the file's older
functions are positional):

- `setDebatePublished({ supabase, debateId, ownerId, published }): Promise<Debate>` — writes `public`
  **and** `published_at` together (`published ? now() : null`); RLS already scopes the update to the
  owner. Never writes the two columns separately.
- `isPublishable({ supabase, debateId }): Promise<boolean>` — **(deviation, approved during impl,
  2026-06-24 — see note below)** checks `getDebateExchange({ supabase, debateId }).status ===
'completed'` directly, NOT `getDivergenceSummary(...) !== null`. The summary gate also returns
  available once `current_round >= 2` mid-exchange; that's too early to publish — a debate is
  publishable only once its exchange has fully closed.
- `listPublicDebates({ supabase }): Promise<PublicDebateListItem[]>` — selects published debates
  (`public = true`) for the index; minimal fields (id, title, published_at). Anon-reachable via the
  Phase 1 `debates` policy.

> **Deviation note (approved during impl, 2026-06-24):** the plan originally specified `isPublishable`
> as a pure delegate to `getDivergenceSummary(...) !== null` (Key Discoveries, above: "Publishable
> precondition already encoded by `getDivergenceSummary(...) !== null`") so publishability and
> summary-availability could never drift. In practice the summary gate is intentionally permissive — it
> opens at `current_round >= 2` so participants can see interim progress mid-exchange — and that's the
> wrong threshold for a public showcase. Publishing must wait until the exchange is `status ===
'completed'`. The two gates now intentionally diverge: the summary panel can be visible to
> participants before a debate is publishable.

#### 2. PATCH endpoint accepts `{ public }`

**File**: `src/pages/api/debates/[id]/index.ts` and `src/lib/debate/schemas.ts`

**Intent**: Toggle published state through the existing owner-authenticated endpoint; reject publishing
a debate that isn't round-complete.

**Contract**:

- Extend `updateDebateSchema` (`.strict()`) to allow an optional `public: boolean`.
- In `PATCH`: when `public === true`, call `isPublishable`; if false, throw `ConflictError` (409) —
  `withAuth` maps it. Then call `setDebatePublished`. When `public === false`, set unpublished with no
  precondition. Keep the existing `rootNodeId` branch.

#### 3. Publish/unpublish toggle UI

**File**: a new client component under `src/components/debate/` (e.g. `PublishControl.tsx`), embedded in
`src/pages/debates/[id].astro`, shown only to the owner.

**Intent**: Let the advocate publish/unpublish in-context and jump to the published showcase page.

**Contract**:

- Renders current state from the debate row's `public`. **(deviation, approved during impl,
  2026-06-24)** When the debate is not yet publishable AND not already public, the component renders
  **nothing** (`return null`) — not a disabled button. A not-yet-publishable debate's owner sees no
  publish affordance at all until the round closes.
- Publish/Unpublish calls `PATCH /api/debates/[id]` with `{ public: true|false }`. On 409, surface
  "round not complete." Unpublish is one-click, no confirm.
- When published, shows a **(deviation, approved during impl, 2026-06-24)** "View" link/button to
  `/showcase/[id]` — not a copyable URL input + Copy button. The advocate navigates straight to the
  live page instead of copy-pasting a link; sharing the URL is left to the browser's own address bar /
  share affordances.
- Pass owner-only visibility and the `isPublishable` result from the Astro frontmatter (page already
  derives the viewer), so the control doesn't need its own auth fetch.

> **Deviation note (approved during impl, 2026-06-24):** the plan originally specified a copyable
> `/showcase/[id]` URL input with a Copy button. Replaced with a plain "View" link to `/showcase/[id]`
> — simpler UI, and the advocate can copy the address bar URL themselves once there.
>
> **Deviation note (approved during impl, 2026-06-24):** the plan originally specified a disabled
> button with a "round not complete" reason tooltip. Changed to fully hiding the control when not
> publishable — a disabled-but-visible toggle implies the owner should wait/retry, when the real
> precondition (round completion) isn't something a button click can resolve.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx astro check`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build`
- [ ] Repository unit tests for `isPublishable` (publishable vs not) and `setDebatePublished` (writes
      both columns) pass

#### Manual Verification:

- [ ] As the owner of a debate with a `completed` exchange, the Publish toggle is visible and enabled;
      publishing reveals a "View" link to `/showcase/[id]`
- [ ] As the owner of an in-progress debate (no completed exchange, including mid-exchange at
      `current_round >= 2`), the toggle is not rendered at all; `PATCH { public: true }` still returns
      409 if attempted directly against the API
- [ ] Unpublish immediately flips state back to private with one click
- [ ] A non-owner cannot publish another user's debate (RLS/owner scoping holds)

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Public showcase read path (anon-facing)

### Overview

Add the two public Astro routes (index list + per-debate frozen map & summary) kept out of
`PROTECTED_ROUTES`, the small `DivergenceSummary` prop change, and the landing-page CTA.

### Changes Required:

#### 1. Showcase index page

**File**: `src/pages/showcase/index.astro` (new)

**Intent**: A public landing list of every published debate, the entry point linked from `/`.

**Contract**: Server-loads `listPublicDebates({ supabase })` via the anon client (no `withAuth`, no
inline `supabase.from()`), renders a list of links to `/showcase/[id]` with title + published date.
Must NOT be added to `PROTECTED_ROUTES`.

#### 2. Showcase detail page

**File**: `src/pages/showcase/[id].astro` (new)

**Intent**: Render a published debate's real map, frozen and read-only, plus its divergence summary,
for anyone.

**Contract**: Server-loads, via anon-reachable repository functions, `getDebateGraph` (graph),
`getDebateMarks` (marks — must be loaded explicitly), `getDebateExchange` (status/round) and
`getDivergenceSummary` (summary). 404 if the graph is null (unpublished/unknown → RLS returns null).
Renders `<MapEditor client:only="react" canEdit={false} viewer={null} userId={null}
initialGraph={…} initialMarks={…} />` and
`<DivergenceSummary debateId={id} ownerId={debate.owner_id} initialSummary={…} isCompleted={…} />`.
Must NOT be in `PROTECTED_ROUTES`.

**Note** — `DivergenceSummary` requires `debateId` and `ownerId` (not optional) and renders nothing
until its round gate is met (`DivergenceSummary.tsx:172`). On the anon page there is **no** live
`wvmap:turn-gate` event, so the gate must be satisfied via the server props (`isCompleted={true}` or
`currentRound>=2`) — derive them from the already-loaded exchange. With `viewer={null}`/no `viewerId`
the summary falls into the "Counterpart statements" group (no "My statements" split) — acceptable for
anon.

#### 3. `DivergenceSummary` accepts `initialSummary`

**File**: `src/components/debate/DivergenceSummary.tsx`

**Intent**: Let the showcase pass the server-fetched summary and skip the client-side authed fetch
(keeps the anon read surface to the page only — Risk #1).

**Contract**: Add an optional `initialSummary` prop. When present:

- **Seed** the `summary` state from it (e.g. `useState(initialSummary ?? null)`) and treat the panel as
  available without a network call — the trigger button must **never** call `apiGetSummary`/`load()`
  (that path hits `/api/debates/[id]/summary`, which is `withAuth` → 401 for anon). Default the panel
  to **open** for the showcase (anon visitors see the summary without a click); the button still toggles
  visibility but only flips `open`, never fetches.
- The round-gate guard (`gateMet`, returns `null` otherwise) still applies — it is satisfied by the
  `isCompleted`/`currentRound` server props the showcase page passes (no live turn-gate event exists for
  anon).

Existing authed-page behavior (no `initialSummary` prop → button calls `load()`/`apiGetSummary` as
today) is unchanged.

#### 4. Landing-page CTA

**File**: `src/pages/index.astro` (and/or the relevant landing component, e.g. `HeroSection.astro` /
`CtaSection.astro`)

**Intent**: Give strangers the "see a live debate" hook.

**Contract**: Add a link/button to `/showcase`. No data loading on the landing page itself.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx astro check`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build`
- [ ] `/showcase` and `/showcase/[id]` are reachable without auth (anon `curl` returns 200 for a
      published id, 404 for an unpublished/unknown id)

#### Manual Verification:

- [ ] Logged-out, `/showcase` lists published debates and each links to a working `/showcase/[id]`
- [ ] Logged-out, `/showcase/[id]` for a published debate shows the frozen map (pan/zoom work; no
      add/drag/connect/edit/delete affordances), marks rendered read-only, and the divergence summary
- [ ] Logged-out, `/showcase/[id]` for an unpublished/unknown id returns 404 (no content leak)
- [ ] The landing page CTA navigates to `/showcase`
- [ ] End-to-end content authoring: two team accounts run a real climate debate to completion, publish
      it, and it appears on `/showcase`

---

## Testing Strategy

### Unit Tests:

- `isPublishable` returns true only when `getDivergenceSummary` is non-null (in-progress vs completed).
- `setDebatePublished` writes `public` and `published_at` together (and clears `published_at` on
  unpublish).
- PATCH endpoint: `{ public: true }` on a non-publishable debate → 409; on a publishable one → success.

### Integration Tests (Risk #1 — the IDOR boundary):

- Anon-role client: unpublished debate → 0 rows on `debates`/`nodes`/`relations`/`marks`/`exchanges`,
  including direct-by-`debate_id` child enumeration.
- Anon-role client: published debate → exactly its own rows on all five tables + non-null summary.
- Anon-role client: `profiles` → the two participant usernames of a published debate readable; an
  unrelated user (in no public debate) → 0 rows.

### Manual Testing Steps:

1. As owner of a completed debate: publish → copy URL → open it in a private/incognito window → map +
   summary render frozen.
2. As owner of an in-progress debate: confirm the toggle is disabled and PATCH returns 409.
3. Logged-out: open an unpublished debate's `/showcase/[id]` → 404, and confirm no child rows are
   reachable via the API/anon client.
4. Unpublish → the showcase URL 404s.

## Performance Considerations

`is_public_debate` is a `stable` single-row lookup on `debates.id` (primary key) — negligible. Consider
an index on `debates.public` only if the `/showcase` index list grows large (not needed at launch with
one debate). The showcase page server-loads the full graph once (same shape as the existing debate
page) — no new hot path.

## Migration Notes

Additive migration: new nullable/defaulted columns and additive anon policies; no data backfill, no
change to existing authenticated policies. Reversible by dropping the anon policies (including
`profiles_select_anon`), the two helpers (`is_public_debate`, `is_public_debate_participant`), the
anon `select` grants, and the two columns. Existing debates default to `public = false` (private), so
nothing becomes public implicitly.

> **Deviation note (approved during impl, 2026-06-24):** `supabase/seed.sql`'s fixture exchange
> (`00000000-0000-4000-8000-000000000020`, on the seeded "Climate Change Debate") was not part of the
> original Phase 1/2 contracts but was changed from `round_count=3, status='accepted'` to
> `round_count=1, status='completed'` so the seeded debate satisfies the tightened `isPublishable` gate
> (exchange `status === 'completed'`) immediately after `npx supabase db reset` — local dev/demo can
> exercise Publish without first driving the turn machine by hand.

> **Addendum (approved during impl, 2026-06-24):** a **second migration**
> `20260624000002_showcase_authenticated_visibility.sql` was added beyond the single Phase 1 migration
> in the original contract. The existing `debates_select` (`to authenticated`) only matches owner/
> challenger rows, so `listPublicDebates` silently returned nothing for a logged-in **non-participant**
> viewing the showcase. The migration adds a second permissive `debates_select_authenticated_public`
> policy (`to authenticated using (public = true)`), mirroring `debates_select_anon` — additive and
> OR'd, existing policies untouched. Covered by the unplanned companion test
> `tests/integration/showcaseVisibility.test.ts` (authenticated non-participant sees published / not
> unpublished; `isPublishedGraph` rejects an owner's own unpublished graph at the page gate).

## References

- Research: `context/changes/publishable-debate-showcase/research.md` (Net design, all 5 decisions)
- Change identity: `context/changes/publishable-debate-showcase/change.md`
- Frozen-map precedent (S-05): `context/archive/2026-06-12-s05/plan.md:274-307`
- Recursion-helper precedent: `supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql:18-29`
- Publish gate: `src/lib/summary/repository.ts:31-38`
- Canvas freeze props: `src/components/debate/MapEditor.tsx:701-743`, `src/components/debate/store.ts:806-822`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data layer & anon RLS (security boundary)

#### Automated

- [x] 1.1 Migration applies cleanly (`npx supabase db reset`/`db push`) — 5d7a8cd
- [x] 1.2 Types regenerated, no further diff (`npm run db:types`) — 5d7a8cd
- [x] 1.3 Type checking passes (`npx astro check`) — 5d7a8cd
- [x] 1.4 Linting passes (`npm run lint`) — 5d7a8cd
- [x] 1.5 Anon leak integration tests pass (unpublished → 0 rows / published → own graph + summary) — 5d7a8cd

#### Manual

- [x] 1.6 As `anon`, unpublished debate returns no rows on any of the five tables — 5d7a8cd
- [x] 1.7 As `anon`, a `public = true` debate returns full graph + non-null summary — 5d7a8cd

### Phase 2: Publish primitive (advocate-facing)

#### Automated

- [x] 2.1 Type checking passes (`npx astro check`) — 462d6f5
- [x] 2.2 Linting passes (`npm run lint`) — 462d6f5
- [x] 2.3 Build passes (`npm run build`) — 462d6f5
- [x] 2.4 Repository unit tests (`isPublishable`, `setDebatePublished`) pass — 462d6f5

#### Manual

- [x] 2.5 Owner of completed debate: publish reveals a "View" link to `/showcase/[id]` (deviation: was
      "copyable URL", see Phase 2 deviation notes) — 462d6f5
- [x] 2.6 Owner of in-progress debate: toggle not rendered at all (deviation: was "disabled"), `PATCH
{ public: true }` → 409 — 462d6f5
- [x] 2.7 Unpublish flips back to private in one click — 462d6f5
- [x] 2.8 Non-owner cannot publish another user's debate — 462d6f5

### Phase 3: Public showcase read path (anon-facing)

#### Automated

- [x] 3.1 Type checking passes (`npx astro check`) — 0532413
- [x] 3.2 Linting passes (`npm run lint`) — 0532413
- [x] 3.3 Build passes (`npm run build`) — 0532413
- [x] 3.4 `/showcase` & `/showcase/[id]` reachable without auth (200 published / 404 unpublished) — 0532413

#### Manual

- [x] 3.5 Logged-out: `/showcase` lists published debates with working links — 0532413
- [x] 3.6 Logged-out: `/showcase/[id]` shows frozen map + read-only marks + summary — 0532413
- [x] 3.7 Logged-out: unpublished/unknown id → 404 (no leak) — 0532413
- [x] 3.8 Landing CTA navigates to `/showcase` — 0532413
- [x] 3.9 Two team accounts author + publish a real climate debate; it appears on `/showcase` — a5a8e4c
