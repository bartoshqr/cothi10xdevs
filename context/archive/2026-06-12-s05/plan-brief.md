# S-05 Multi-round Edit/Delete with Mark Invalidation — Plan Brief

> Full plan: `context/changes/s05/plan.md`
> Research: `context/changes/s05/research.md`

## What & Why

Across rounds 2+, a party can edit/delete only their own statements on their turn. When they do, the counterpart's marks about that content go stale and must be re-evaluated, and a delete can strand a counterpart statement from the root claim. This slice makes both safe: edits invalidate the counterpart's marks (forcing re-evaluation before submit), and orphaned statements are surfaced and must be resolved. A correctness bug here silently corrupts a user's reasoning map, so the invalidation flip is the highest-risk surface.

## Starting Point

The mini-turn and write-immutability already shipped in S-04. `marks.valid` exists (default `true`) but nothing flips it; the marks payload carries no validity dimension anywhere; no orphan/connectivity concept exists in DB, store, canvas, or summary. The challenger's mini-turn is DB-frozen but the UI still offers content controls (rejected only at Postgres).

## Desired End State

Editing a statement's content flips the counterpart's mark to `valid=false`; the counterpart sees it dimmed with "Needs re-evaluation" and can't submit until they re-mark. A delete that strands a counterpart statement leaves it in place; at the start of that party's next turn it's highlighted orphaned and their submit is blocked until they delete or reconnect it (only your own dangling blocks you). The mini-turn UI offers only the mark bar. Orphans surviving into a closed exchange appear in the summary, tagged "orphaned" but keeping their stance.

## Key Decisions Made

| Decision               | Choice                                                                             | Why (1 sentence)                                                                                                | Source   |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| Invalidation mechanism | One SECURITY DEFINER edit-RPC, re-checks write-gate inside                         | The flip can't be a normal UPDATE (marker-only RLS); folding it into the edit RPC keeps one round-trip          | Research |
| Flip trigger           | Only when a content value actually changed                                         | Position drags and identical re-saves must not nag the counterpart                                              | Plan     |
| Orphan detection       | Compute-at-read reachability traversal                                             | Schema-free, one pure util powers canvas + gate + summary                                                       | Research |
| Orphan resolution      | Submit-gate blocks own dangling statements; counterpart fixes theirs on their turn | You're only gated on what you can actually delete/reconnect                                                     | Plan     |
| Canvas highlight       | Own orphaned statements, at turn start (not freshly-added mid-build)               | Matches "not flagged during edition"; surfaces the damage from the counterpart's turn                           | Plan     |
| Mini-turn              | Stays full content-freeze (UI-only fix, no DB change); orphans tolerated           | Allowing delete/reattach there needs a risky RLS relaxation — defer it                                          | Plan     |
| Summary `isOrphaned`   | Restored (kept), orphan ≠ invalid                                                  | Orphans can survive a frozen mini-turn into a closed exchange; the summary is where parties "come back" to them | Plan     |
| Close / 7-day timeout  | Out of scope → S-08                                                                | Split into `advocate-close-and-timeout`                                                                         | Research |

## Scope

**In scope:** edit→mark-invalidation RPC; thread `valid` through the marks payload; turn-gate + mark-bar surfacing; compute-at-read orphan util; canvas orphan highlight; submit-gate + advocate pre-invite guard; summary `isOrphaned` tag; mini-turn UI content-freeze.

**Out of scope:** all close/timeout work (S-08); any mark-clearing on delete; re-eval ordering enforcement; any mini-turn DB change; persistent always-on orphan highlighting.

## Architecture / Approach

DB core first: a SECURITY DEFINER `patch_node_and_invalidate` RPC (+ a `can_write_node_content` auth helper mirroring `nodes_update`) does the node patch and conditionally flips counterpart marks. Then `valid` is threaded `nodeId → {stance, valid}` through repo → API → SSR → Zustand store → canvas. A pure `connectivity.ts` reachability util feeds three consumers via the existing `window` CustomEvent island bus (plus a new `wvmap:connectivity` event for the pre-invite guard). The mini-turn freeze is a single shared store gate that cascades to all MapEditor controls.

## Phases at a Glance

| Phase                    | What it delivers                                                                | Key risk                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Invalidation RPC (DB) | SECURITY DEFINER edit-RPC flips counterpart marks on real content change        | DEFINER bypasses RLS — auth predicate must be re-checked and not drift from `nodes_update` |
| 2. Thread `valid` + UI   | `MarkState` payload end-to-end; turn-gate + mark-bar surface stale marks        | Wide type change touching SSR, store, canvas — easy to miss a boundary                     |
| 3. Orphan resolution     | Reachability util; canvas highlight; submit-gate; pre-invite guard; summary tag | False-positive flags on freshly-added nodes; pre-invite island has no store access         |
| 4. Mini-turn UI freeze   | Shared content-write gate; controls match the DB freeze                         | Must not also freeze the mark bar                                                          |

**Prerequisites:** local Supabase running (`npx supabase start`); S-04 migrations applied; a round-2+ exchange with marks for manual checks.
**Estimated effort:** ~3-4 sessions across 4 phases; Phase 1 (DB/RLS) and Phase 3 (orphan) are the heaviest.

## Open Risks & Assumptions

- The DEFINER auth helper duplicates the `nodes_update` predicate — integration tests of the off-turn/wrong-author branches are the guard against drift.
- The canvas highlight excludes `pending` nodes to avoid flagging mid-build creations; the submit-gate is the hard enforcement, so a truly-unconnected new node still blocks submit.
- The pre-invite guard is UI-only (not server-enforced), consistent with Decision 6.

## Success Criteria (Summary)

- Editing own content invalidates the counterpart's mark and blocks their submit until re-marked; position/identical edits do not.
- A delete that strands a counterpart statement highlights it on their turn and blocks their submit until resolved; survivors show tagged in the summary.
- The challenger's mini-turn offers only marking — no content controls, no error banner.
