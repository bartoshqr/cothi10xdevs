---
change_id: s05
title: Multi-round edit/delete with mark invalidation
status: planned
created: 2026-06-12
updated: 2026-06-12
archived_at: null
---

## Notes

From the @context/foundation/roadmap.md — S-05 slice: across rounds 2+, each party can edit/delete only their own statements during their active turn; edits/deletes invalidate the other party's marks, orphaned statements are highlighted, the final-round mini turn runs, and the exchange closes (round exhaustion, explicit close, or 7-day challenger-inactivity) into immutability.

## Scope already shipped in S-04 (do not re-plan)

Two FR-019/FR-027 items the roadmap assigns to S-05 were **pulled forward into S-04 Phase 1** (see `context/changes/s04/plan.md` §"Shifts during implementation" §1–2). When framing/planning S-05, trim its scope accordingly:

- **Final-round mini-turn (FR-019)** — already built. `exchanges.in_mini_turn` column, the `can_add_content_as_current_actor` helper, and `submit_turn`'s mini-turn routing exist (`supabase/migrations/20260611000002_round_close_and_mini_turn.sql`). The advocate's final-round submit opens the challenger's marking-only closing turn; the exchange completes on the challenger's mini-turn submit. Negative-path RLS coverage in `tests/integration/writeImmutability.test.ts`.
- **Write-immutability on close (FR-019/FR-027)** — already built. `nodes`/`relations` INSERT/UPDATE/DELETE are turn-gated; the map locks on a `pending` invite and is fully immutable on `completed`.

Still genuinely S-05: multi-round (rounds 2+) edit/delete with **mark invalidation** (`valid=false` carry-over on edit; **no** clear cascade on delete) and **orphaned-statement highlighting** (canvas + summary label). See the scope amendments in `context/changes/s05/ans.md` and `prd.md` §Shifts (2026-06-12).

**Moved out of S-05 → new slice S-08 (`advocate-close-and-timeout`):** explicit advocate close and the 7-day challenger-inactivity timeout. S-05 closes only via round-exhaustion / mini-turn (already shipped in S-04). See `roadmap.md` §S-08 and `prd.md` §Shifts #6.

## TODO carried over from S-04 — UI mini-turn freeze for the challenger

The mini-turn content-freeze is enforced **only at the DB layer** in S-04. The UI is out of lockstep: during the closing mini-turn the challenger is still offered add/move/edit/delete controls, and the write is only rejected once it reaches Postgres (`can_add_content_as_current_actor`), surfacing as an error banner instead of disabled controls.

To do in S-05 (clean UI):

- The challenger's **content-write** capability must be `false` during the mini-turn, while **marking stays allowed** (mirrors the DB: content uses `can_add_content_as_current_actor`, marks keep `can_write_as_current_actor`).
- Gates to update in `src/components/debate/store.ts`: `myTurnOrPreExchange()` and `canEditNode()` currently return on `viewer.isMyTurn` alone — both are `true` for the challenger in their mini-turn. Add the mini-turn exclusion (e.g. a shared `canWriteContentNow(viewer)` = `isMyTurn && !(viewerRole === "challenger" && inMiniTurn)`); leave `canMarkNode()` on `isMyTurn` so marking is still offered.
- Net effect in `MapEditor.tsx`: `canAdd`, `nodesDraggable`, `deleteKeyCode`, and per-node edit/delete all turn off for the challenger during the mini-turn; the mark bar stays interactive.
- `ViewerContext` already carries `inMiniTurn`, so no new state is needed.
