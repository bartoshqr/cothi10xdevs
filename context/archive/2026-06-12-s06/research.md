---
date: 2026-06-12T12:27:16+02:00
researcher: bartoshqr
git_commit: ea7e854571d85904d052f05ac8b7575563f72c02
branch: develop
repository: cothi10xdevs
topic: "S-06 — Debate list and challenger inbox (unified page)"
tags: [research, codebase, debates, exchanges, inbox, rls, repository]
status: complete
last_updated: 2026-06-12
last_updated_by: bartoshqr
---

# Research: S-06 — Debate list and challenger inbox (unified page)

**Date**: 2026-06-12T12:27:16+02:00
**Researcher**: bartoshqr
**Git Commit**: ea7e854571d85904d052f05ac8b7575563f72c02
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

How should S-06 (`debate-list-and-inbox`, FR-024 + FR-025) be built on the existing
codebase? The user clarified the scope: a **single page** with two sections —
(1) all debates where the user is the **advocate**, with state (drafting / in progress /
closed), drafts included; and (2) the **challenger** view (pending invites + active
exchanges), with drafts NOT visible. One user can be both advocate and challenger across
different exchanges, so both sections live on the same page.

## Summary

- The **challenger section already exists** as a standalone page: `/invites` renders
  `listInvites(supabase, userId)` (pending + accepted exchanges). S-06 should **fold
  this into the unified page** rather than keep two surfaces.
- The **advocate section does not exist** — there is no "list all my debates" repository
  function or page. The only debate read is `getDebateGraph` (single debate). S-06 needs
  a **new repo function** (e.g. `listAdvocateDebates`) that selects `debates` where
  `owner_id = me` and left-joins the debate's exchange to derive display state.
- Display state is derivable entirely from `exchanges.status` (enum:
  `pending | accepted | declined | completed`) plus "no exchange row". No schema change
  is needed.
- RLS already enforces the visibility split for free: drafts (`debates` with no exchange)
  are owner-only; the challenger can only read a debate once an exchange exists. So the
  two sections are naturally scoped by the same query running under the viewer's RLS.
- The page follows an established pattern: `.astro` page fetches in frontmatter via a
  repository fn under the viewer's RLS-scoped Supabase client, renders server-side cards,
  and drops in React islands only for interactive bits (`RespondInvite`). The card +
  status-badge + empty-state markup in `invites.astro` is directly reusable.

This is a **low-risk navigation slice** (matches the roadmap risk note). No migration is
strictly required; the bulk of the work is one new repo function, one new page, a small
status→label/colour map, and a nav link. Two product decisions are open (below).

## Detailed Findings

### Data model (no change needed)

**`debates`** — `supabase/migrations/20260528000001_create_debate_graph.sql:21-29`

- `id`, `owner_id` (FK auth.users — the advocate), `title` (≤120), `root_node_id`
  (nullable FK nodes), `created_at`.

**`exchanges`** — `supabase/migrations/20260609000001_create_exchanges.sql:13-32`

- `id`, `debate_id` (FK debates, ON DELETE CASCADE), `advocate_id`, `challenger_id`,
  `status` (`exchange_status` enum), `round_count` (1–5), `current_round`,
  `current_turn` (`turn_actor` = `challenger | advocate`), `in_mini_turn` (bool),
  `created_at`, `responded_at` (nullable).
- **At most one _open_ exchange per debate**: partial-unique index on `(debate_id)`
  WHERE `status IN ('pending','accepted')`. A `declined` or `completed` exchange does
  NOT occupy that slot, so a debate can carry historical declined/completed rows
  alongside a re-invite. (See Open Questions #2 — picking "the" exchange per debate.)

**`exchange_status` enum** — `20260609000001_create_exchanges.sql:8`,
generated at `src/db/database.types.ts:389` and `:1080`:
`'pending' | 'accepted' | 'declined' | 'completed'`.

### Display-state derivation (advocate section)

Per debate, from its exchange (or absence of one):

| Condition                                       | Display state                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| No exchange row, OR only `declined` exchange(s) | **Drafting** (advocate-only, map-building)                       |
| `status = 'pending'`                            | **Awaiting response** (invite sent)                              |
| `status = 'accepted'`                           | **In progress** (turns live; show `current_round`/`round_count`) |
| `status = 'completed'`                          | **Closed**                                                       |

This maps cleanly onto the roadmap's "drafting / in progress / closed" with one extra
"awaiting response" sub-state that already has UI vocabulary (see InviteChallenger below).

### RLS already splits the two sections

- **`debates_select`** — `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:213-222`:
  `owner_id = auth.uid()` OR challenger of an exchange in `('pending','accepted','completed')`.
  → Drafts (no exchange) and declined-only debates are **owner-only**; the challenger
  never sees them. This is exactly the user's requirement, enforced server-side.
- **`exchanges_select`** — `20260609000001_create_exchanges.sql:49-53`:
  `advocate_id = auth.uid()` OR `challenger_id = auth.uid()`. Both parties read the row.
- **`nodes_select` / `relations_select`** widened symmetrically —
  `20260611000002_...sql:227-256`.
- SECURITY DEFINER helpers (`is_accepted_challenger`, `can_write_as_current_actor`,
  `can_add_content_as_current_actor`) live in
  `20260610000001_create_marks_and_authorship.sql:54-96` and
  `20260611000002_...sql:46-66`. These are about _writes_/recursion-breaking and are not
  needed for the read-only list page, but confirm the read predicates above are inline
  EXISTS and safe to reuse as-is.

### Repository layer

**Exists** — `src/lib/exchange/repository.ts`:

- `listInvites(supabase, userId)` — `:216-267`. Returns `ChallengerInvite[]` (`:201-212`):
  `{ id, debate_id, debate_title, debate_root_node_id, debate_root_claim_title,
debate_root_claim_body, advocate_id, round_count, status: 'pending'|'accepted',
created_at }`. Filters `challenger_id = userId` AND `status IN ('pending','accepted')`,
  ordered newest-first; denormalizes debate title + root-claim metadata. **This is the
  challenger section, ready to reuse.** Note: it does **not** include `completed`.
- `respondToInvite(supabase, exchangeId, accept)` — `:80-93`. UPDATE to
  `accepted`/`declined` + `responded_at`; RLS enforces challenger identity & `pending`.
  **Decline keeps the row** (status → `declined`), it is NOT deleted.
- `revokeInvite(supabase, exchangeId, advocateId)` — `:189-199`. **DELETEs** a still-pending
  invite (advocate only). (This is the only path that removes an exchange row — resolves
  the earlier "declined rows deleted?" ambiguity: they are not.)
- `getDebateExchange(supabase, debateId)` — `:152-183`. Single debate's open/completed
  exchange with both usernames. Useful reference for the join + username-resolution
  pattern the advocate list will mirror.
- `getExchangeStatus`, `openExchange`, `submitTurn` — supporting fns, not needed here.

**Does NOT exist** — there is no advocate-side "list my debates" function. `src/lib/debate/repository.ts`
only has `getDebateGraph` (single debate) plus create/edit fns. **S-06 must add** something like:

```
listAdvocateDebates(supabase, advocateId) -> AdvocateDebate[]
```

selecting `debates` where `owner_id = advocateId`, left-joining each debate's exchange to
read `status`, `current_round`, `round_count`, `challenger_id` (+ challenger username),
and computing the display state above. Follow the repo conventions: object-destructured
args if 3+ params, `if (error) throw error` (never the silent `const { data } = ...`),
and keep the query inside the repository (lessons: "Keep all Supabase calls in a repository").

### Routing, auth, and page pattern

- **Protected routes** — `src/middleware.ts:4`: `PROTECTED_ROUTES = ["/dashboard",
"/debates", "/invites"]`. A new `/debates` (index) or `/dashboard` list page is
  **already covered** — no middleware edit needed (lessons/Hard-rule on PROTECTED_ROUTES
  is already satisfied for these prefixes).
- **User in frontmatter** — `const { user } = Astro.locals;` (set in middleware via
  `supabase.auth.getUser()`, `middleware.ts:10-13`). RLS-scoped client via
  `createClient(Astro.request.headers, Astro.cookies)`.
- **Page template to copy** — `src/pages/invites.astro` (full file): `Layout` wrapper,
  `mx-auto max-w-2xl`, card list (`border-border bg-card rounded-xl border p-5`),
  status pill (`:40-48`), empty state (`:22-25`), link `href={`/debates/${id}`}`
  (`:58-63`), and the `RespondInvite client:load` island for pending rows (`:65`).
- **Server-render + islands** — `src/pages/debates/[id].astro` shows the broader pattern:
  fetch in frontmatter, pass serialized props to React islands (`client:only="react"` /
  `client:load`). The list page is mostly static Astro with `RespondInvite` (and possibly
  a revoke control) as the only islands.
- **Existing routes** — `src/pages/`: `index.astro` (landing), `dashboard.astro`
  (placeholder, unused), `invites.astro` (challenger inbox), `debates/[id].astro`
  (detail), `debates/new.astro` (create). **No `/debates` index exists** — the natural
  home for the unified page.
- **Navigation** — `src/components/landing/LandingHeader.astro` (logo, auth, "Start a
  Map" → `/debates/new`) and `src/components/debate/DebateHeader.astro` (Home + Sign
  out). A link to the new page should be added to the post-login header surface.

### Status display vocabulary already in the codebase

Reuse these so the list matches the detail page:

- `invites.astro:40-48` — pending = yellow pill "Pending"; accepted = green pill "Accepted".
- `src/components/debate/InviteChallenger.tsx:213-233` — advocate status line:
  pending → "Invite sent … awaiting response" + Revoke; otherwise "Challenger {who}
  {currentRound}/{roundCount} round".
- `src/components/debate/TurnBar.tsx:62-71` — completed → "Exchange complete".
- `src/lib/debate/viewer.ts:26-57` — `isCompleted = status === 'completed'`,
  `isMyTurn = !isCompleted && currentTurn === viewerRole`.

A small shared label/colour map (e.g. drafting=gray, awaiting=yellow, in-progress=green,
closed=gray) centralizes this for the new section.

## Code References

- `supabase/migrations/20260528000001_create_debate_graph.sql:21-29` — `debates` table
- `supabase/migrations/20260609000001_create_exchanges.sql:8` — `exchange_status` enum
- `supabase/migrations/20260609000001_create_exchanges.sql:13-32` — `exchanges` columns
- `supabase/migrations/20260609000001_create_exchanges.sql:49-53` — `exchanges_select` RLS
- `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:213-222` — `debates_select` RLS (the visibility split)
- `src/lib/exchange/repository.ts:201-267` — `ChallengerInvite` + `listInvites` (challenger section, reusable)
- `src/lib/exchange/repository.ts:152-183` — `getDebateExchange` (join/username pattern to mirror)
- `src/lib/debate/repository.ts` — no list fn; `listAdvocateDebates` to be added here
- `src/middleware.ts:4` — `/debates` & `/invites` already protected
- `src/pages/invites.astro` — page + card/badge/empty-state markup to reuse
- `src/pages/debates/[id].astro` — server-render + React-island pattern
- `src/db/database.types.ts:389,1080` — `exchange_status` type + Constants

## Architecture Insights

- **RLS does the authorization; the query expresses intent.** Both sections are the same
  shape of query run under the viewer's RLS-scoped client — the advocate query filters
  `owner_id = me`, the challenger query filters `challenger_id = me`. No bespoke
  permission code in the page.
- **Repository boundary is a hard rule here** (lessons: "Keep all Supabase calls in a
  repository"; "3+ params → object-destructuring"). The new advocate-list query must live
  in `src/lib/debate/repository.ts`, surface errors with `if (error) throw error`, and
  return a domain type — never inline in the `.astro` frontmatter.
- **No new table/migration.** "Drafting/in progress/closed" is a pure read-time
  derivation from `exchanges.status` + absence-of-row.
- **Two pages collapse to one.** `/invites` becomes the challenger section of `/debates`;
  decide whether to redirect `/invites` → `/debates#inbox` or leave it as a thin alias.

## Historical Context (from prior changes)

- `context/changes/s05/research.md` — current multi-round/edit-invalidation research; S-06
  is parallel and read-only, so it does not depend on S-05 landing. S-06's prerequisite is
  only S-02 (exchanges exist).
- `context/archive/2026-06-08-invite-and-open-exchange/` (S-02) — introduced the
  `exchanges` table, invite lifecycle, and the partial-unique "one open exchange" rule the
  list state derivation relies on.
- `context/archive/2026-06-09-challenger-first-turn/` (S-03) — `listInvites` /
  `invites.astro` were built here as the challenger inbox; S-06 inherits and absorbs them.
- `context/archive/2026-06-10-first-divergence-summary/` (S-04) — added `completed` status
  - mini-turn; the "closed" display state for the advocate list comes from this.

## Related Research

- `context/changes/s05/research.md` — adjacent slice (mark invalidation / orphan highlight).

## Open Questions

1. **Does the challenger section show `completed` exchanges?** FR-025 says "pending invites
   and active exchanges" — `listInvites` currently returns only `pending|accepted`. FR-024
   (advocate) explicitly includes closed. For symmetry the challenger may also want a
   read-only "closed" list. Decision needed before planning: extend `listInvites` to
   include `completed`, or keep the challenger section to active-only and rely on the
   advocate section for closed (advocate-owned debates only). Owner: user. Block: no
   (affects one `.in(...)` filter).
2. **Which exchange represents a debate in the advocate list** when a debate has multiple
   historical rows (e.g. a `declined` then a re-invite, or a `completed` plus a later
   invite)? Proposed rule: prefer the open one (`pending`/`accepted`) if present, else the
   most recent `completed`, else treat as drafting (declined-only). Confirm during plan.
3. **Fate of `/invites`** once folded into `/debates`: redirect, alias, or remove? Low
   stakes; pick during plan.
