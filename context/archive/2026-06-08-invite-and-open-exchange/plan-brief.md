# S-02 — Advocate invites a challenger and opens the exchange — Plan Brief

> Full plan: `context/changes/invite-and-open-exchange/plan.md`
> Research: `context/changes/invite-and-open-exchange/research.md`

## What & Why

S-02 brings the **second participant** into a data model that is single-owner today. The advocate opens an *exchange* on an existing debate (gated on a root Claim existing **and** a well-formed map — every and/or connective has ≥2 operands), picks a challenger and a round count (1–5, default 3, fixed at initiation) **in one slide-over panel**, and sends an in-app invite the challenger can accept or decline. The invite grants the challenger **read** access while still `pending` (they can see the map but not edit it). Covers FR-007/008/009/010.

## Starting Point

The debate/node/relation schema exists and rows are already two-author-ready (`author_id` FKs). But RLS is **owner-only** across `debates`/`nodes`/`relations`, so an invited challenger has zero read access. There is no exchange, invite, round-config, or second-participant state anywhere. The **exact-match** username primitive (`findUserByUsername`) ships, but this slice needs a **new substring-list** search (`searchUsersByUsername`, self-excluded); the API conventions (`withAuth`, typed errors, per-domain repository) already ship.

## Desired End State

An advocate opens a slide-over panel from the debate header, sees a short alphabetical user list (self excluded), narrows it by substring, picks a user **and** a round count in that one box, and sends the invite. The invited user sees it on a minimal `/invites` page and accepts or declines. **From the moment the invite is sent (`pending`)** the challenger can read the debate graph but not edit it; accept confirms participation, decline revokes read access and lets the advocate re-invite. A non-participant third user can never read the debate. The two-part FR-007 gate, self-invite block, and one-open-exchange rule are all enforced server-side.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Lifecycle representation | New `exchanges` table | Round count, turn state, status all hang off one row; keeps `debates` clean and extensible for S-03–S-06. | Plan |
| Invite/participant model | `challenger_id` + `status` on the exchange | MVP is strictly two-party (FR-021); accept just flips status — simplest correct model. | Plan |
| RLS predicate form | Inline `EXISTS` + `(select auth.uid())` in each `*_select` policy | Planner runs one semi-join per scan (vs. a per-row `security definer` helper); writes stay owner/author-scoped. A `get_debate_graph` RPC is the deferred scale lever. | ans.md/Plan |
| Read access timing | Opens at invite (`pending`), not accept | Developer instruction: a pending challenger reads the map but can't edit; decline closes access. | ans.md |
| Invite semantics | Block self-invite; one open exchange/debate; allow re-invite after decline | Sensible integrity rules sources didn't specify; partial-unique index makes decline non-terminal. | Plan |
| Username search | Substring → short alphabetical list, caller excluded | Dropdown UX: empty = all (capped), typing narrows, no-match = nothing to click; advocate never sees self. | ans.md |
| FR-007 gate | Two-part, server-authoritative + UI reflects | Root must exist **and** no connective with <2 operands; server is the integrity boundary ("thin maps reach challengers"). | ans.md/Plan |
| Turn state | Store both `current_round` and `current_turn` | FR-008 tracks round and party; S-02 initializes (round 1, challenger), S-03 advances. | ans.md |
| Inbox scope | Minimal `/invites` accept/decline page | Makes the slice acceptable end-to-end; full inbox is the parallel S-06. | Plan |
| Test depth | Smoke the integrity boundaries now | Proves the dangerous RLS rewrite immediately; introduces the two-user fixture Phase 2 reuses. | Plan |

## Scope

**In scope:** `exchanges` table (+ `current_round`/`current_turn`) + enums + constraints; widened participant RLS (read, pending-onward) on debates/nodes/relations via inline `EXISTS` in the three `*_select` policies; exchange domain module (constants/schemas/repository) with the two-part gate; substring `searchUsersByUsername`; search + open + respond endpoints; advocate slide-over invite UI + minimal challenger inbox; focused integration smoke suite.

**Out of scope:** turn-submission machinery (S-03/S-04); full debate-list/inbox (S-06); exhaustive Phase-2 RLS matrix; `debate_participants` table; advocate cancel/withdraw; exchange close/complete state; email search.

## Architecture / Approach

A new `exchanges` row carries `challenger_id`, `status` (pending→accepted/declined), `round_count`, `current_round`, and a challenger-first `current_turn` marker. The three `*_select` RLS policies are rewritten to an inline `EXISTS` predicate — "owner OR pending/accepted challenger" — with `(select auth.uid())` so the planner runs one semi-join per scan (a `security definer` helper was rejected as a per-row call); write policies stay owner/author-scoped. DB constraints (round-count CHECK, current-round CHECK, self-invite CHECK, partial-unique one-open-per-debate) are backstops; the repository pre-checks app-side to raise clean typed errors (mirroring `createRelation`), including the two-part gate (root exists + every connective has ≥2 inbound `link` operands). Endpoints use `withAuth`; search returns a 200 substring list (self excluded); the gate is enforced server-side and reflected in the slide-over UI. A `get_debate_graph` security-definer RPC is the documented, deferred scale lever for graph reads.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + RLS | `exchanges` table (+ round/turn state), widened pending-onward RLS (inline `EXISTS` ×3), type regen | The RLS rewrite — leak vs lock-out; the load-bearing risk |
| 2. Domain module | constants, Zod schemas, substring search, repository + unit tests | Two-part gate / self-invite / dup pre-checks matching DB backstops |
| 3. API + middleware | substring search, open, respond endpoints; protect `/invites` | Correct status-code mapping (422/409/404/200-list) |
| 4. UI | advocate slide-over invite panel + minimal inbox | Gate reflected; existing-exchange state handled; dropdown search UX |
| 5. Integration tests | two-user fixture + RLS/gate/semantics smoke suite | Building the as-user (anon) client fixture correctly |

**Prerequisites:** S-01 (advocate-map-builder, done), F-01 (username-profiles, done); local Supabase + integration env for Phase 5.
**Estimated effort:** ~3–4 sessions across 5 phases (Phase 1 + Phase 5 carry most of the risk and effort).

## Open Risks & Assumptions

- The widened RLS predicate is **duplicated** across all three `*_select` policies (inline `EXISTS`, chosen for planner performance) — an inconsistency leaks or locks out. A shared comment block + the Phase 5 RLS matrix guard against drift; this is the deliberate cost of not using an opaque helper.
- Well-formedness gate operand semantics **confirmed** against the map builder: operands of a connective = inbound `link` relations (`isLegalRelationTarget`, `relationRules.ts:11-14`; `link` must target a connective). The gate rejects any connective with `count(inbound link) < 2`.
- `current_round`/`current_turn` are stored now but their machinery (turn submission, lock, round advance) is S-03 — assuming initialized values (round 1, `challenger`) are enough for S-02.
- Assumes the partial-unique index (`where status in ('pending','accepted')`) is the right form for re-invite-after-decline — verified in Phase 5.

## Success Criteria (Summary)

- An invited challenger can **read** the debate graph from `pending` onward but cannot edit it; declining revokes read; a non-participant never can (proven at the DB, not just the UI).
- The exchange cannot be opened without a root Claim, with a malformed map (a connective with <2 operands), against oneself, or twice on one debate; a declined invite can be re-sent.
- The slide-over search (substring, alphabetical, self-excluded) → invite → accept flow works end-to-end across two sessions.
