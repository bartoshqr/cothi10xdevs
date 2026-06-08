# S-02 — Advocate invites a challenger and opens the exchange — Plan Brief

> Full plan: `context/changes/invite-and-open-exchange/plan.md`
> Research: `context/changes/invite-and-open-exchange/research.md`

## What & Why

S-02 brings the **second participant** into a data model that is single-owner today. The advocate opens an *exchange* on an existing debate (gated on a root Claim existing), sets a round count (1–5, default 3, fixed at initiation), searches a registered user by username, and sends an in-app invite the challenger can accept or decline. Covers FR-007/008/009/010.

## Starting Point

The debate/node/relation schema exists and rows are already two-author-ready (`author_id` FKs). But RLS is **owner-only** across `debates`/`nodes`/`relations`, so an accepted challenger has zero read access. There is no exchange, invite, round-config, or second-participant state anywhere. The username-search primitive (`findUserByUsername`) and the API conventions (`withAuth`, typed errors, per-domain repository) already ship.

## Desired End State

An advocate searches a username, picks a round count, and sends an invite. The invited user sees it on a minimal `/invites` page and accepts or declines. On accept, the challenger can read the debate graph (RLS now permits it); on decline they cannot, and the advocate may re-invite. A non-participant third user can never read the debate. The FR-007 gate, self-invite block, and one-open-exchange rule are all enforced server-side.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Lifecycle representation | New `exchanges` table | Round count, turn state, status all hang off one row; keeps `debates` clean and extensible for S-03–S-06. | Plan |
| Invite/participant model | `challenger_id` + `status` on the exchange | MVP is strictly two-party (FR-021); accept just flips status — simplest correct model. | Plan |
| RLS predicate form | Denormalized via `is_debate_participant()` helper | One predicate (owner OR accepted challenger) reused across three tables; no extra table for a two-party MVP. | Plan |
| Invite semantics | Block self-invite; one open exchange/debate; allow re-invite after decline | Sensible integrity rules sources didn't specify; partial-unique index makes decline non-terminal. | Plan |
| Search no-match | 200 with `{ user: null }` | A search box wants a soft "not found", not an error toast. | Plan |
| FR-007 gate | Server-authoritative + UI reflects | Server is the integrity boundary ("thin maps reach challengers" risk); UI just prevents a dead click. | Research/Plan |
| Inbox scope | Minimal `/invites` accept/decline page | Makes the slice acceptable end-to-end; full inbox is the parallel S-06. | Plan |
| Test depth | Smoke the integrity boundaries now | Proves the dangerous RLS rewrite immediately; introduces the two-user fixture Phase 2 reuses. | Plan |

## Scope

**In scope:** `exchanges` table + enums + constraints; `is_debate_participant` helper; widened participant RLS (read) on debates/nodes/relations; exchange domain module (constants/schemas/repository); search + open + respond endpoints; advocate invite UI + minimal challenger inbox; focused integration smoke suite.

**Out of scope:** turn-submission machinery (S-03/S-04); full debate-list/inbox (S-06); exhaustive Phase-2 RLS matrix; `debate_participants` table; advocate cancel/withdraw; exchange close/complete state; email search.

## Architecture / Approach

A new `exchanges` row carries `challenger_id`, `status` (pending→accepted/declined), `round_count`, and a challenger-first `current_turn` marker. A `security definer` SQL helper `is_debate_participant(debate_id)` returns "owner OR accepted challenger", and the three `*_select` RLS policies are rewritten to call it. DB constraints (round-count CHECK, self-invite CHECK, partial-unique one-open-per-debate) are backstops; the repository pre-checks app-side to raise clean typed errors (mirroring `createRelation`). Endpoints use `withAuth`; search returns 200-with-null; the gate is enforced server-side and reflected in the UI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + RLS | `exchanges` table, helper, widened participant RLS, type regen | The RLS rewrite — leak vs lock-out; the load-bearing risk |
| 2. Domain module | constants, Zod schemas, repository + unit tests | Gate / self-invite / dup pre-checks matching DB backstops |
| 3. API + middleware | search, open, respond endpoints; protect `/invites` | Correct status-code mapping (422/409/404/200-null) |
| 4. UI | advocate invite affordance + minimal inbox | Gate reflected; existing-exchange state handled |
| 5. Integration tests | two-user fixture + RLS/gate/semantics smoke suite | Building the as-user (anon) client fixture correctly |

**Prerequisites:** S-01 (advocate-map-builder, done), F-01 (username-profiles, done); local Supabase + integration env for Phase 5.
**Estimated effort:** ~3–4 sessions across 5 phases (Phase 1 + Phase 5 carry most of the risk and effort).

## Open Risks & Assumptions

- The widened RLS predicate must be consistent across all three `*_select` policies — an inconsistency leaks or locks out. The `is_debate_participant` helper exists to make this one place.
- `current_turn` is stored now but its machinery (turn submission, lock, round advance) is S-03 — assuming a single default-`challenger` marker column is enough for S-02.
- Assumes the partial-unique index (`where status in ('pending','accepted')`) is the right form for re-invite-after-decline — verified in Phase 5.

## Success Criteria (Summary)

- An invited challenger can read the debate graph **only after** accepting; a non-participant never can (proven at the DB, not just the UI).
- The exchange cannot be opened without a root Claim, against oneself, or twice on one debate; a declined invite can be re-sent.
- The full search → invite → accept flow works end-to-end across two sessions.
