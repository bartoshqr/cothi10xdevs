# S-06 — Debate List and Challenger Inbox Implementation Plan

## Overview

Build a single `/debates` page listing **every debate the signed-in user is involved in, in
either role**, fed by one RLS-scoped query. The list is partitioned into two visual groups by
the viewer's role — **As advocate** (debates they own, drafts included) and **As challenger**
(debates they're challenging) — and within each group sorted by state. This fulfils FR-024
(advocate debate list) and FR-025 (challenger inbox) on one surface, because role is
context-dependent: the same user is advocate on some debates and challenger on others. The
standalone `/invites` page is removed and absorbed here.

## Current State Analysis

- **One RLS query already returns both roles.** `debates_select`
  (`supabase/migrations/20260611000002_round_close_and_mini_turn.sql:213-222`) is
  `owner_id = auth.uid()` **OR** "I'm the challenger of an exchange in
  (pending, accepted, completed)". So a single `supabase.from("debates").select(...)` run
  under the viewer's RLS-scoped client returns every debate they participate in — owned
  (including drafts with no exchange) _and_ challenged. The database does the role-union for
  free; no two-query split is needed.
- **Role is a per-row derivation, not stored per user:** `owner_id === me ? "advocate" :
"challenger"`. A user can never be both on the same debate (self-invite is blocked), so
  each card has exactly one role.
- **The challenger inbox exists today** as `/invites` (`src/pages/invites.astro` +
  `listInvites` in `src/lib/exchange/repository.ts:202`), returning only pending/accepted
  exchanges via a challenger-scoped query. It is superseded by the unified query and removed.
- **No advocate "list my debates" function exists.** `src/lib/debate/repository.ts` has only
  `getDebateGraph` (single debate). There is no `/debates` index page —
  `src/pages/debates/` holds `[id].astro` and `new.astro` only.
- **Display state is a pure read-time derivation** from `exchanges.status`
  (`pending | accepted | declined | completed`) plus "no exchange row". No schema change.

### Key Discoveries:

- `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:213-222` — `debates_select`
  RLS is the union that makes a single query cover both roles.
- `supabase/migrations/20260609000001_create_exchanges.sql:49-53` — `exchanges_select` is
  `advocate_id = me OR challenger_id = me`, so one exchanges read returns both sides' rows.
- `supabase/migrations/20260609000001_create_exchanges.sql` — partial-unique index on
  `(debate_id) WHERE status IN ('pending','accepted')` → **at most one open exchange per
  debate**, so the "open-first" representative-exchange rule is deterministic.
- `src/lib/exchange/repository.ts:138` (`getDebateExchange`) and `:202` (`listInvites`) —
  the join + `profiles.in("id", [...])` username-resolution and `nodes.metadata` root-claim
  read patterns the new function mirrors.
- `src/pages/invites.astro:28-68` — card / yellow-green status-pill / empty-state markup to
  reuse; `RespondInvite client:load` on pending rows (`:65`).
- `src/pages/debates/[id].astro:111` — an existing `href="/invites"` link to repoint.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/debates", "/invites"]`;
  `/debates` already covers the new page, `/invites` is removed.
- `src/components/debate/DebateHeader.astro`, `src/components/landing/LandingHeader.astro` —
  the two post-login header surfaces that get the "My debates" nav link.

## Desired End State

A signed-in user visits `/debates` and sees one list partitioned into two groups:

1. **As advocate** — a card per owned debate: title, root-claim title, a state badge
   (Drafting / Awaiting response / In progress / Closed), and for active/closed exchanges the
   challenger's username + round progress (`current_round`/`round_count`). Links to
   `/debates/:id`. Empty state when the user owns nothing.
2. **As challenger** — a card per debate the user is challenging: title, root-claim title, a
   role-appropriate state badge (Invitation / In progress / Closed), Accept/Decline on
   pending invites, and a link into the debate. Empty state when the user challenges nothing.

Within each group, cards sort by state — **in-progress → awaiting/pending → drafting →
closed** — then most-recent first. A "My debates" link appears in both post-login headers.
`/invites` no longer exists (404); all in-app references point at `/debates`.

Verification: signed in as user01 (owner of the seeded debate), `/debates` shows it under
**As advocate** as **In progress** with challenger `user02` and an empty challenger group;
signed in as user02, the **As challenger** group shows that same exchange and the advocate
group is empty. `listMyDebates` returns the correct `role` + `state` per branch (integration
test).

## What We're NOT Doing

- No schema change, no migration, no new RLS policy.
- No write paths beyond what exists (Accept/Decline via the existing `RespondInvite` island
  and `/api/exchanges/:id/respond`).
- No advocate **revoke** control on this list (revoke stays on the debate detail page via
  `InviteChallenger`). The list is read-only navigation.
- No pagination / search / filter chips — out of scope for this low-risk slice.
- No change to the post-login redirect target (landing stays `/`; we only add a nav link).

## Implementation Approach

Two phases. **Phase 1** is the data layer: a single `listMyDebates` repository function that
runs the unified RLS query, derives each debate's `role` and `state`, resolves the other
party's username, and returns a flat `MyDebate[]`; covered by an integration test exercising
both roles and every state branch. The now-superseded `listInvites` / `ChallengerInvite` are
removed in Phase 2 alongside their only caller.

**Phase 2** builds the `/debates` page: it calls `listMyDebates`, partitions the result by
`role` into two groups, sorts each group by state rank, renders cards (reusing the
`invites.astro` markup), centralizes the `(state, role)`→label/color mapping and the sort
rank in one module, adds the nav link to both headers, and deletes `/invites`.

**Display-state derivation per debate** (from its representative exchange, or absence of one):

| Condition                                       | `state`       | Advocate label    | Challenger label                       |
| ----------------------------------------------- | ------------- | ----------------- | -------------------------------------- |
| No exchange row, OR only `declined` exchange(s) | `drafting`    | Drafting          | _(n/a — challenger never sees drafts)_ |
| Open exchange `status = 'pending'`              | `awaiting`    | Awaiting response | Invitation — respond                   |
| Open exchange `status = 'accepted'`             | `in_progress` | In progress       | In progress                            |
| No open exchange, most recent is `completed`    | `closed`      | Closed            | Closed                                 |

Representative exchange = "open (`pending`/`accepted`) first, else most-recent `completed`,
else none (drafting)". The open exchange is unique by the partial-unique constraint.

**Sort rank within each group:** `in_progress` (0) → `awaiting` (1) → `drafting` (2) →
`closed` (3); ties broken by `created_at` descending.

## Critical Implementation Details

- **State derivation runs in JS, not PostgREST.** A debate can carry multiple historical
  exchange rows (a `declined` one plus a re-invite, or a `completed` one plus a new invite).
  PostgREST cannot express "prefer the open row, else the newest completed" in one select, so
  `listMyDebates` reads the viewer's debates and all their exchanges in two batched
  `.in(...)` queries and reduces them per debate in TypeScript. Keep the reduction in the
  repository (lessons: all Supabase access + domain shaping lives in
  `src/lib/<domain>/repository.ts`).
- **The "other party" depends on role.** When the viewer is the advocate, resolve the
  challenger's username; when the challenger, resolve the advocate's. Collect both id sets,
  resolve in one `profiles.in("id", [...])` read (`profiles_select_authenticated` lets any
  authed user read usernames), then pick the right one per row.
- **Surface errors, never swallow them.** `if (error) throw error` on every query (no
  `const { data } = ...`), matching the existing repository functions.

### User experience spec

- **Accept/Decline updates the card in place — no page reload.** `RespondInvite` currently
  calls `window.location.reload()`, which violates the lessons rule "Never use
  `window.location.reload()`" (visible full-page blank + repaint). The challenger card must
  instead update via local React state: on **accept**, the badge flips from "Invitation" to
  "In progress" and the Accept/Decline buttons are replaced by an "Enter debate" link; on
  **decline**, the card is removed (declined exchanges are not shown on this page). No other
  card and no server round-trip is involved. This is why the challenger group's interactive
  cards are React islands, not server-rendered Astro like the advocate group.

## Phase 1: Repository layer — unified `listMyDebates`

### Overview

Add the single function that powers the whole page: every debate the viewer can see, with
derived role + state + the other party's username. Lock the derivation with an integration
test covering both roles and all state branches.

### Changes Required:

#### 1. Unified debate list

**File**: `src/lib/debate/repository.ts`

**Intent**: Add `listMyDebates` returning every debate visible to the viewer under RLS, each
tagged with the viewer's role, the derived display state, the other party's username, and
round progress + root-claim title for the card. Mirrors the join/username-resolution pattern
of `getDebateExchange` and the root-claim metadata read in `listInvites`.

**Contract**: New exported domain types and function:

```ts
export type DebateRole = "advocate" | "challenger";
export type DebateListState = "drafting" | "awaiting" | "in_progress" | "closed";

export interface MyDebate {
  id: string;
  title: string;
  root_node_id: string | null;
  root_claim_title: string | null;
  role: DebateRole; // owner_id === viewerId ? advocate : challenger
  state: DebateListState;
  exchange_id: string | null; // representative exchange, if any
  other_username: string | null; // challenger if advocate; advocate if challenger
  round_count: number | null;
  current_round: number | null;
  created_at: string; // debate created_at (sort tiebreak)
}

export async function listMyDebates(supabase: DB, viewerId: string): Promise<MyDebate[]>;
```

Implementation notes (non-obvious bits only): (1) `debates` select under RLS — **no
`owner_id` filter**; RLS already returns both roles. (2) one `exchanges.in("debate_id", ids)`
read (`id, debate_id, status, round_count, current_round, advocate_id, challenger_id,
created_at`) — RLS returns both advocate- and challenger-side rows. (3) reduce per debate:
`role` from `owner_id === viewerId`; representative exchange = open first, else newest
`completed`, else none; `state` per the table above. (4) resolve other-party usernames in one
`profiles.in(...)` read; (5) root-claim titles from `nodes.metadata` exactly as `listInvites`
does. Return unsorted (the page sorts); the function just shapes the domain rows.

#### 2. Integration test for role + state derivation

**File**: `tests/integration/debateList.test.ts` (new)

**Intent**: Prove `listMyDebates` returns the correct `role` and `state` for every branch,
run under real RLS-scoped clients (`getClientAsUser`) for both the advocate and the
challenger so the role-union and visibility are exercised, not bypassed.

**Contract**: Use `describeIntegration`. With the seeding user (advocate) and challenger user
(`requireSeedingUser` / `requireChallengerUser`), seed debates via `seedDebate` and drive
exchange state with the service client, then assert:

- **Advocate view** (`listMyDebates(advocateClient, advocateId)`): a no-exchange debate →
  `{ role: "advocate", state: "drafting" }`; a `pending` exchange → `awaiting`; an `accepted`
  exchange → `in_progress` with `other_username` = challenger's; a `completed` exchange →
  `closed`; a `declined`-only debate → `drafting`.
- **Challenger view** (`listMyDebates(challengerClient, challengerId)`): an `accepted`
  exchange appears as `{ role: "challenger", state: "in_progress" }` with `other_username` =
  advocate's; a `pending` invite → `awaiting`; a `completed` → `closed`; **a `declined`
  exchange does NOT appear** (RLS excludes it), and **the advocate's drafts do NOT appear**.

Clean up via `cleanupDebate` in `afterAll`. Follow `tests/integration/exchange.test.ts`.

### Success Criteria:

#### Automated Verification:

- [ ] Integration suite passes (requires `npx supabase start`): `npm run test:integration`

#### Manual Verification:

- [ ] `listMyDebates` returns the seeded debate as advocate/`in_progress` for user01 and
      challenger/`in_progress` for user02

### Phase 1 manual verification details live in the `## Progress` section.

---

## Phase 2: Unified `/debates` page, navigation, and `/invites` removal

### Overview

Build the two-group page from the single list, centralize the badge/sort logic, add the nav
link to both headers, and remove the absorbed `/invites` page and its now-dead repository fn.

### Changes Required:

#### 1. Badge + sort-rank module

**File**: `src/lib/debate/displayState.ts` (new)

**Intent**: Centralize the `(state, role)`→`{ label, classes }` mapping and the state sort
rank so the page markup doesn't re-declare literals (lessons: define shared display
vocabulary once). Reuse the exact colors from `invites.astro:40-48` (pending = yellow,
accepted = green) so existing rows look unchanged.

**Contract**: Export `stateBadge(state: DebateListState, role: DebateRole): { label: string;
classes: string }` and `stateRank(state: DebateListState): number` (in_progress 0, awaiting 1,
drafting 2, closed 3). Labels per the Implementation Approach table; colors: in_progress/
accepted = green, awaiting/pending = yellow, drafting/closed = gray. Pure data — unit-testable,
no component imports.

#### 2. Unit test for the badge + rank module

**File**: `tests/unit/displayState.test.ts` (new)

**Intent**: Lock the label/class/rank so a future edit can't silently drop a state or reorder
the sort.

**Contract**: Assert every `(state, role)` pair resolves to a non-empty label + class string
(including the advocate-only `drafting`), and that `stateRank` yields the strict order
in_progress < awaiting < drafting < closed. Pure unit test under the `unit` project.

#### 3. `RespondInvite` — remove the page reload

**File**: `src/components/debate/RespondInvite.tsx`

**Intent**: Eliminate the `window.location.reload()` (lessons: "Never use
`window.location.reload()`") and let the parent card drive the in-place update instead.

**Contract**: Replace the `window.location.reload()` at `:26` with a call to a new
`onResolved(accepted: boolean)` prop, invoked on a successful response. Add `onResolved` to
`Props`. The component otherwise unchanged (still a dumb Accept/Decline button pair with its
own loading/error state).

#### 4. Challenger card island

**File**: `src/components/debate/ChallengerInviteCard.tsx` (new)

**Intent**: A React island that owns the post-response state of a challenger card so
Accept/Decline update it in place — no reload, no stale badge (see User experience spec).

**Contract**: Props carry the server-rendered row data (`exchangeId`, `debateId`,
`debateTitle`, `rootClaimTitle`, `advocateUsername`, `roundCount`, `currentRound`, and the
initial `status`). Holds a local `status` (`"pending" | "accepted"`) and a `dismissed` flag.
Renders the card shell (reusing the same Tailwind classes as the `invites.astro` markup), the
badge via `stateBadge(deriveState(status), "challenger")`, and the debate link. When
`status === "pending"`, renders `<RespondInvite onResolved={...} />`; `onResolved(true)` →
`setStatus("accepted")` (badge → "In progress", buttons gone, link reads "Enter debate"),
`onResolved(false)` → `setDismissed(true)` → render `null` (card removed). Imports
`stateBadge` from `@/lib/debate/displayState`.

#### 5. Unified page

**File**: `src/pages/debates/index.astro` (new)

**Intent**: Server-render the page. Frontmatter fetches `listMyDebates` under the RLS-scoped
client (same `createClient(Astro.request.headers, Astro.cookies)` + `Astro.locals.user`
pattern as `invites.astro`). Partition the result into `advocate` and `challenger` arrays;
sort each by `stateRank` then `created_at` desc. Render two labelled groups ("As advocate" /
"As challenger"), each with its own empty state. **Advocate** cards are server-rendered Astro
(title, root-claim title, `stateBadge(state,"advocate")`, round progress + `other_username`).
**Challenger** cards render `<ChallengerInviteCard client:load … />` per row (it owns the
interactive state). Cards link to `/debates/:id`. Wrap in `Layout`, `mx-auto max-w-2xl`.

**Contract**: New route `/debates` (already in `PROTECTED_ROUTES`). No new API endpoint
(reuses `/api/exchanges/:id/respond`).

#### 6. "My debates" navigation link

**File**: `src/components/debate/DebateHeader.astro`, `src/components/landing/LandingHeader.astro`

**Intent**: Give signed-in users a visible entry point to `/debates` from both post-login
header surfaces.

**Contract**: Add a "My debates" link to `/debates` in each header, shown when `user` is
present, styled to match the existing header link classes (the "Home" link in
`DebateHeader.astro:27-32`; the nav links in `LandingHeader.astro`).

#### 7. Remove `/invites` and its dead repository fn

**File**: delete `src/pages/invites.astro`; edit `src/lib/exchange/repository.ts`,
`src/pages/debates/[id].astro`, `src/middleware.ts`

**Intent**: The list now lives on `/debates`; remove the absorbed page, its now-unused
repository function, and fix inbound references — so no second debate-list query lingers to
diverge.

**Contract**: Delete `src/pages/invites.astro`. Remove `listInvites` + the `ChallengerInvite`
interface from `src/lib/exchange/repository.ts` (their only caller is the deleted page; keep
`getDebateExchange`, `respondToInvite`, etc.). Repoint `src/pages/debates/[id].astro:111`
(`href="/invites"`) to `/debates`. Remove `"/invites"` from `PROTECTED_ROUTES` in
`src/middleware.ts:4`. Grep to confirm no `/invites` or `listInvites` references remain.

### Success Criteria:

#### Automated Verification:

- [ ] Unit suite passes: `npm run test:unit`
- [ ] No remaining references to `/invites` or `listInvites`: `grep -rn "/invites\|listInvites" src/` returns nothing

#### Manual Verification:

- [ ] `/debates` renders both role groups, correctly sorted, for advocate and challenger
- [ ] Accept/Decline updates the challenger card in place — no page reload, no stale badge
- [ ] "My debates" nav link works from both headers
- [ ] `/invites` returns 404 and no in-app link points to it

### Phase 2 manual verification details live in the `## Progress` section.

---

## Testing Strategy

### Unit Tests:

- `displayState`: every `(state, role)` pair → non-empty label + classes; `stateRank` strict
  ordering (`tests/unit/displayState.test.ts`).

### Integration Tests:

- `listMyDebates` role + state derivation for both roles across every branch, incl. the
  negative cases (declined excluded, advocate drafts invisible to challenger) — under real
  RLS-scoped clients (`tests/integration/debateList.test.ts`).

### Manual Testing Steps:

See the `## Progress` section for copy-pasteable, agent-runnable verification (curl + SQL +
browser checks) grounded in the seed fixtures.

## Performance Considerations

The page issues a small fixed number of batched queries (debates, their exchanges, other-party
profiles, root-claim nodes — each one `.in(...)` read). No N+1; acceptable for MVP per-user
debate counts. Sorting/partitioning is in-memory over a small list.

## Migration Notes

None — no schema change. The only "migration" is the route move `/invites` → `/debates`,
handled by repointing the single inbound link and removing the page + its dead repo fn.

## References

- Research: `context/changes/s06/research.md`
- RLS role-union: `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:213-222`
- Join/username pattern to mirror: `src/lib/exchange/repository.ts:138` (`getDebateExchange`)
- Card markup to reuse: `src/pages/invites.astro:28-68`
- Page + island pattern: `src/pages/debates/[id].astro`
- Integration test pattern: `tests/integration/exchange.test.ts`, `tests/integration/helpers.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repository layer — unified `listMyDebates`

#### Automated

- [x] 1.1 Integration suite passes (requires `npx supabase start`): `npm run test:integration`

#### Manual

- [x] 1.2 `listMyDebates` derivation matches the seed for both roles

  > **Agent-automatable**: Partial — the DB state the derivation reads from is fully assertable via SQL with the service role; the function itself runs in the integration suite (step 1.1). This step is a direct DB sanity check that the seeded exchange yields advocate/`in_progress` for user01 and challenger/`in_progress` for user02.

  ```sql
  -- Run against local Postgres (mcp__supabase-local__execute_sql or `npx supabase db`).
  -- Seeded debate …010 has exactly one open ('accepted') exchange: advocate user01,
  -- challenger user02 → listMyDebates yields role-relative state 'in_progress' for both,
  -- with the OTHER party's username on each side.
  select d.id            as debate_id,
         d.owner_id,
         e.status,
         e.current_round,
         e.round_count,
         pa.username      as advocate_username,
         pc.username      as challenger_username
  from public.debates d
  left join public.exchanges e
    on e.debate_id = d.id and e.status in ('pending','accepted')
  left join public.profiles pa on pa.id = e.advocate_id
  left join public.profiles pc on pc.id = e.challenger_id
  where d.id = '00000000-0000-4000-8000-000000000010';
  -- Expected: one row, owner_id = …0001 (user01), status 'accepted',
  --   advocate_username 'user01', challenger_username 'user02'.
  --   → user01 sees role 'advocate', state 'in_progress', other_username 'user02';
  --   → user02 sees role 'challenger', state 'in_progress', other_username 'user01'.
  ```

### Phase 2: Unified `/debates` page, navigation, and `/invites` removal

#### Automated

- [x] 2.1 Unit suite passes: `npm run test:unit`
- [x] 2.2 No remaining references to `/invites` or `listInvites`: `grep -rn "/invites\|listInvites" src/` returns nothing

#### Manual

- [ ] 2.3 `/debates` renders both role groups, correctly sorted, for advocate and challenger

  > **Agent-automatable**: Partial — the data behind both groups is fully assertable via SQL (below) and `listMyDebates` is covered by the integration suite; the HTML render, group partition, sort order, and card layout need a cookie-based browser session, so visual confirmation is manual.

  Browser steps:
  1. Sign in as `user01@e.pl` / `pwd123!`, visit `http://localhost:4321/debates`.
     Expect **As advocate** to list **Seed: Climate Change Debate** with an **In progress**
     (green) badge and challenger `user02`; **As challenger** shows its empty state.
  2. Sign out, sign in as `user02@e.pl` / `pwd123!`, visit `/debates`. Expect **As advocate**
     empty (user02 owns nothing) and **As challenger** showing the seeded exchange as
     **In progress** with advocate `user01`. None of user01's drafts are visible.

  ```sql
  -- DB oracle (service role). Everything user01 can see, with role + open-exchange status:
  select d.title,
         case when d.owner_id = '00000000-0000-4000-8000-000000000001' then 'advocate' else 'challenger' end as role,
         e.status
  from public.debates d
  left join public.exchanges e on e.debate_id = d.id and e.status in ('pending','accepted','completed')
  where d.owner_id = '00000000-0000-4000-8000-000000000001'
     or exists (select 1 from public.exchanges x
                where x.debate_id = d.id
                  and x.challenger_id = '00000000-0000-4000-8000-000000000001'
                  and x.status in ('pending','accepted','completed'));
  -- Expected for user01: 'Seed: Climate Change Debate', role 'advocate', status 'accepted'.

  -- Everything user02 can see (challenger side):
  select d.title,
         case when d.owner_id = '00000000-0000-4000-8000-000000000002' then 'advocate' else 'challenger' end as role,
         e.status
  from public.debates d
  left join public.exchanges e on e.debate_id = d.id and e.status in ('pending','accepted','completed')
  where d.owner_id = '00000000-0000-4000-8000-000000000002'
     or exists (select 1 from public.exchanges x
                where x.debate_id = d.id
                  and x.challenger_id = '00000000-0000-4000-8000-000000000002'
                  and x.status in ('pending','accepted','completed'));
  -- Expected for user02: 'Seed: Climate Change Debate', role 'challenger', status 'accepted'.
  ```

- [ ] 2.4 Accept/Decline updates the challenger card in place — no reload, no stale badge

  > **Agent-automatable**: No — verifying the absence of a full-page reload and an in-place badge swap is a visual/interaction check in a logged-in browser session; the underlying API response is already covered by the integration suite.

  Steps: to get a fresh **pending** invite to act on, sign in as `user01@e.pl` / `pwd123!`,
  open the seeded debate `/debates/00000000-0000-4000-8000-000000000010`, and invite a third
  seeded user (e.g. `user03`) as challenger via the InviteChallenger control. Then sign in as
  that challenger (`user03@e.pl` / `pwd123!`) and visit `/debates`:
  1. **Accept** the invite. Confirm the card's badge changes from "Invitation" to "In
     progress" and the buttons are replaced by an "Enter debate" link **without the page
     blanking/reloading** (watch for no white flash; the URL stays `/debates`).
  2. Re-create another pending invite, **Decline** it. Confirm the card disappears in place,
     again with no full-page reload.

- [ ] 2.5 "My debates" nav link works from both headers

  > **Agent-automatable**: No — requires a logged-in browser session to see the link render conditionally on `user` and click through; the target can be read from the HTML but the post-login conditional display is a visual check.

  Steps: while signed in, confirm a "My debates" link is visible (a) in the in-debate header
  (open `/debates/00000000-0000-4000-8000-000000000010`) and (b) on the landing header at
  `/`. Clicking either lands on `/debates`.

- [ ] 2.6 `/invites` returns 404 and no in-app link points to it

  > **Agent-automatable**: Yes — the 404 is a plain GET (the route no longer exists) and the absence of references is a grep.

  ```bash
  # /invites no longer exists → Astro serves a 404.
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/invites
  # Expected: 404

  # No source references remain.
  grep -rn "/invites\|listInvites" src/ || echo "OK: no /invites or listInvites references"
  # Expected: OK line, no matches.
  ```
