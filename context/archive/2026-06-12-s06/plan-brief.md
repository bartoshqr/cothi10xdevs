# S-06 — Debate List and Challenger Inbox — Plan Brief

> Full plan: `context/changes/s06/plan.md`
> Research: `context/changes/s06/research.md`

## What & Why

Build a single `/debates` page listing **every debate the user is involved in, in either
role**, fed by one RLS-scoped query and partitioned into two visual groups (As advocate / As
challenger). Without it the product has no entry point after the first session (FR-024 +
FR-025). Role is context-dependent — the same person is advocate here, challenger there — so
one query + per-row role derivation is the natural shape.

## Starting Point

The challenger inbox exists at `/invites` (`listInvites` + `invites.astro`), challenger-only.
There is no advocate "list my debates" function or `/debates` index page. Crucially, the
`debates_select` RLS policy already returns _both_ roles (`owner_id = me` OR "I'm a challenger
of a pending/accepted/completed exchange"), so a single query covers the whole page. Display
state is a pure derivation from `exchanges.status` — no schema change.

## Desired End State

`/debates` shows one list split into **As advocate** (owned debates, drafts included, badged
Drafting / Awaiting / In progress / Closed with challenger + round progress) and **As
challenger** (debates you're challenging, badged Invitation / In progress / Closed, with
Accept/Decline on pending invites). Each group sorts in-progress → awaiting → drafting →
closed. A "My debates" link sits in both post-login headers. `/invites` is gone, absorbed
here.

## Key Decisions Made

| Decision                | Choice                                                   | Why (1 sentence)                                                | Source   |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| Page route              | `/debates` index                                         | Natural home; already in `PROTECTED_ROUTES`.                    | Research |
| Data layer              | One `listMyDebates` query, both roles                    | `debates_select` RLS already unions owner + challenger rows.    | User     |
| Presentation            | Two visual groups by role from the one query             | Role is context-dependent; grouping keeps each side scannable.  | User     |
| Sort within group       | in-progress → awaiting → drafting → closed, then recency | Surfaces active/actionable first, done last.                    | User     |
| Inbox scope             | Includes closed (completed) exchanges                    | The RLS union returns completed automatically; full history.    | User     |
| Representative exchange | Open first, else newest `completed`, else drafting       | Open exchange is unique by the partial-unique constraint.       | Plan     |
| `/invites` fate         | Removed; `listInvites`/`ChallengerInvite` deleted too    | Superseded by the unified query; avoid a divergent second list. | User     |
| Navigation              | "My debates" link in both headers                        | Reuses existing post-login surfaces; no flow change.            | User     |
| Schema                  | No migration                                             | State is read-time derivation; RLS already splits visibility.   | Research |

## Scope

**In scope:** single `listMyDebates` repo fn (role + state derivation, other-party username);
new `/debates` page (two role groups, sorted); shared `(state,role)`→badge + sort-rank module;
a challenger-card React island that accepts/declines **in place (no page reload)** — folding
in the fix for `RespondInvite`'s `window.location.reload()`; nav link in both headers; remove
`/invites` + its dead repo fn + repoint its one inbound link; unit + integration tests.

**Out of scope:** schema/RLS changes; advocate revoke on the list; pagination/search/filter;
post-login redirect change.

## Architecture / Approach

`.astro` page calls one repository function (`listMyDebates`) under the viewer's RLS-scoped
client; RLS returns both owned and challenged debates. The function reads debates + their
exchanges in two batched `.in(...)` queries and reduces per debate in TypeScript (PostgREST
can't express "open-first-else-newest-completed"), tagging each row with `role`
(`owner_id === me`), derived `state`, and the other party's username. The page partitions by
role and sorts each group by state rank. Advocate cards are server-rendered Astro; challenger
cards are a small React island (`ChallengerInviteCard`) so Accept/Decline update in place with
no reload. All data access stays in the repository.

## Phases at a Glance

| Phase                 | What it delivers                                                                                                                                                | Key risk                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Repository layer   | `listMyDebates` (role + state derivation, both roles); integration test                                                                                         | Getting the multi-row state-reduction + role-relative username exactly right    |
| 2. Page, nav, cleanup | `/debates` page (two groups, sorted), badge/rank module + unit test, in-place challenger card (no-reload fix), header links, `/invites` + `listInvites` removal | Missing an inbound `/invites`/`listInvites` reference; header spacing on mobile |

**Prerequisites:** S-02 (exchanges exist) — shipped. Local Supabase running for the
integration test.
**Estimated effort:** ~1 session across 2 phases (low-risk, read-only navigation slice).

## Open Risks & Assumptions

- The challenger card moves to a React island so Accept/Decline can update in place without a
  reload (fixing `RespondInvite`'s `window.location.reload()`). Risk: the advocate group stays
  server-rendered Astro, so the two groups duplicate a little card-shell markup — acceptable,
  both share the `stateBadge` mapping.
- Assumes other-party username resolution via `profiles.in(...)` is readable by any authed
  user (`profiles_select_authenticated`) — confirmed in research.
- Removing `listInvites` is safe only because its sole caller (`invites.astro`) is deleted in
  the same phase — verified by grep. `RespondInvite` is retained (embedded in the new island).

## Success Criteria (Summary)

- Signed in as the advocate, `/debates` lists owned debates (incl. drafts) with correct state
  badges; as the challenger, the challenger group lists their exchanges incl. closed; each
  group sorted in-progress → awaiting → drafting → closed.
- `/invites` 404s and no in-app link points to it.
- `listMyDebates` derives the correct `role` + `state` for both roles across every branch,
  excluding declined exchanges and keeping advocate drafts invisible to challengers
  (integration test).
