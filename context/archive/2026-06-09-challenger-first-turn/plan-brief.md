# Challenger Marks Statements and Submits the First Turn — Plan Brief

> Full plan: `context/changes/challenger-first-turn/plan.md`
> Research: `context/changes/challenger-first-turn/research.md`

## What & Why

Roadmap slice S-03. Let an accepted challenger audit the advocate's argument map: mark every advocate
Statement Accept / Challenge / Abstain, add their own Statements / Sources / connectives with directed
relations, then submit their turn — which activates the advocate's turn. The three-state mark is the input
that generates the divergence summary (S-04), so the mark model's correctness is the load-bearing concern.

## Starting Point

The exchange machinery from S-02 exists: an accepted exchange sits at `current_round=1,
current_turn='challenger'`, `nodes`/`relations` already carry `author_id`, and the canvas renders read-only
for the challenger. But there is **no mark anything**, no way to write `current_turn` (a column grant locks
it), write policies are owner-only (challenger can't contribute), and the canvas has no notion of viewer
identity.

## Desired End State

On their turn, the challenger marks each advocate Statement (marks persist as clicked), adds their own
visually-distinct nodes/relations, and cannot touch the advocate's content. A "Submit turn" action — gated
server-side on every advocate Statement being marked — flips `current_turn` to `'advocate'` and locks the
board for the challenger.

## Key Decisions Made

| Decision                         | Choice                                             | Why (1 sentence)                                                                 | Source   |
| -------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Mark grain                       | One mutable row per `(node, marker)`, no round col | Simplest gate; S-05 adds `valid boolean` flipped by the **counterpart** — column-add, no delete/overwrite | Plan |
| Turn-submit mechanism            | `SECURITY DEFINER submit_turn()` RPC, `RETURNS SETOF` | Atomic gate + flip server-side; matches RPC + SETOF lessons; sidesteps grant lock | Plan     |
| Mark persistence timing          | Incremental, optimistic per-click                  | Marks survive refresh mid-audit; reuses store's apply→API→reconcile pattern        | Plan     |
| `author_role`                    | **Inferred** (`author_id === debate.owner_id`)     | No column, no backfill, no insert obligation; join in `submit_turn` is trivial     | Plan     |
| Frontend permission model        | Capability flags from a viewer context             | Encodes the real per-node rules; one source of truth; extends to S-04             | Plan     |
| Challenger write RLS recursion   | `is_accepted_challenger()` SECURITY DEFINER helper | Pre-empts the 42P17 loop that bit S-02; read predicates stay inline EXISTS         | Plan     |
| Turn enforcement                 | `can_write_as_challenger()` (membership + `current_turn='challenger'`) gates writes | Turn is an RLS boundary, not just a UI lock — blocks out-of-turn writes after submit (F1) | Plan |
| Connective marking               | `kind='statement'` enforced in marks RLS           | Connectives carry no mark per PRD; RLS rejects it, not just the hidden UI control (F3) | Plan |
| Scope edge                       | Stop at advocate's turn activated                  | Smallest coherent vertical; advocate marking/summary = S-04, carry-over = S-05    | Plan     |
| Primary test layer               | Integration against real RLS/DB                    | Only real RLS catches 42P17 + the grant lock; the gate is a DB-shaped rule         | Plan     |

## Scope

**In scope:** mark schema + enum + RLS + grant; `is_accepted_challenger` (read) + `can_write_as_challenger`
(turn-gated write) helpers; widened node/relation INSERT (keep `author_id` on UPDATE/DELETE); statement-only
marks RLS; `submit_turn` RPC; mark + submit-turn endpoints; frontend
identity/capability model, mark UI (inline below node body), challenger shading, submit action; integration
tests.

**Out of scope:** advocate marking (FR-015, S-04); divergence summary (S-04); carry-over / invalidation /
mini-turn / orphaning (S-05); 7-day close path; Source URL validation.

## Architecture / Approach

Bottom-up vertical. **DB first** (the authorization layer): `marks` table + `mark_stance` enum, the definer
helpers (`is_accepted_challenger` for read scope, `can_write_as_challenger` for turn-gated writes), widened
insert / narrowed update-delete policies, statement-only mark RLS. Then the atomic
**`submit_turn()` RPC** that validates "all advocate statements marked" (identified via a join to `debates`,
not a stored column) and flips the turn. Then a thin **`src/lib/mark/`** module + two `withAuth` endpoints
(mark upsert, submit-turn). Finally the **frontend**: thread `viewerId`, `viewerRole`, `advocateId`, and
`isMyTurn` into the Zustand store; replace the single `canEdit` boolean with derived per-node capabilities;
add an inline Accept/Challenge/Abstain bar **below the node body** to `StatementNode`; shade challenger nodes;
wire optimistic mark persistence + the submit button.

## Phases at a Glance

| Phase                                    | What it delivers                                     | Key risk                                          |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| 1. Mark schema & write RLS               | marks table/enum, helper, widened RLS                | 42P17 recursion on the widened insert check       |
| 2. `submit_turn()` RPC                   | Atomic gate + turn flip                              | SETOF not-found; correct statement-count gate     |
| 3. Backend module + endpoints            | mark/submit-turn API via `withAuth`                  | Error→status mapping (409/422/404) for the gate   |
| 4. Frontend identity, capability, mark UI | viewer context, per-node caps, mark control, shading | Replacing `canEdit` without breaking advocate edit |
| 5. Integration tests + cookbook          | Real-RLS suite; invert S-02 assertions               | Fixture needs an accepted exchange + both users   |

**Prerequisites:** S-02 merged (exchanges + two-user fixture); local Supabase stack up for integration +
manual verification.
**Estimated effort:** ~4–5 sessions across the 5 phases (Phase 1 + 4 are the largest).

## Open Risks & Assumptions

- The client-side submit gate is a mirror; the server RPC remains the source of truth (avoid a vibe mirror
  test — assert the gate against the oracle "5 advocate statements," not against the implementation count).
- Manual app-layer steps need the local anon key (`npx supabase status`) and an accepted exchange seeded
  between user01 (advocate) and user02 (challenger).
- Turn enforcement lives in `can_write_as_challenger`; the integration suite must assert an off-turn
  challenger write is RLS-rejected (not just that the UI locks).

## Success Criteria (Summary)

- Challenger can mark every advocate Statement and add their own nodes, but cannot edit/delete advocate content.
- Submit is impossible until every advocate Statement is marked; on submit, `current_turn` flips to `'advocate'`.
- Real-RLS integration suite proves all of the above (no 42P17, no all-NULL not-found row).
