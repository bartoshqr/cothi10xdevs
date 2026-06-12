---
date: 2026-06-12T08:31:34+0200
researcher: bartoshqr
git_commit: 1dfc9f68ffb5b3ec512192b3b670d6c0e1967aa0
branch: develop
repository: cothi10xdevs
topic: "S-05 multiround-edit-invalidation — current state, gaps, and seams"
tags: [research, codebase, s05, marks, invalidation, orphan, close, rls, turn-machine]
status: complete
last_updated: 2026-06-12
last_updated_by: bartoshqr
---

# Research: S-05 `multiround-edit-invalidation`

**Date**: 2026-06-12T08:31:34+0200
**Researcher**: bartoshqr
**Git Commit**: 1dfc9f68ffb5b3ec512192b3b670d6c0e1967aa0
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

What does the codebase already provide, and what is genuinely missing, for slice **S-05** — across rounds 2+, each party edits/deletes only their own statements during their active turn; edits/deletes invalidate the counterpart's marks (re-evaluation enforced for edits, auto-clear for deletes); orphaned statements are highlighted; the final-round mini turn runs; and the exchange closes (round exhaustion, explicit close, or 7-day challenger-inactivity) into immutability. (PRD US-04, FR-019, FR-026, FR-027.)

## Summary

**S-05's real surface is much narrower than the roadmap text implies.** The S-04 plan deliberately pulled two FR-019/FR-027 items forward into its Phase 1 (`context/changes/s05/change.md:14-19`, `context/changes/s04/plan.md` "Shifts during implementation"):

- **Final-round mini-turn** — built: `exchanges.in_mini_turn` column, the `can_add_content_as_current_actor` helper, and `submit_turn`'s mini-turn routing all exist.
- **Write-immutability on close** — built: `nodes`/`relations` INSERT/UPDATE/DELETE are turn-gated; the map locks on a `pending` invite and is fully immutable on `completed`.

So the **genuinely-new S-05 work** is five things, in rough dependency order:

1. **Mark invalidation** — the `marks.valid` column already exists (default `true`); nothing flips it to `false`. The flip is the data-integrity core. **Key constraint:** the *counterpart* (statement author) triggers the flip on *the other party's* mark, but the current `marks_update` RLS requires `marker_id = auth.uid()` — so the author **cannot** update the marker's row directly. The flip must run in a **SECURITY DEFINER** trigger/RPC fired on node edit/delete, not as a normal UPDATE.
2. **Mandatory re-evaluation gate** — `submit_turn`'s completeness gate already counts only `valid = true` marks, so an invalidated mark already reads as "unmarked" and blocks submit at the DB layer. The new work is mostly *surfacing* this in the UI (which marks need re-evaluation) rather than new server enforcement.
3. **Orphan detection** — nothing exists. Needs a connectivity-to-root computation after a delete, plus a highlight in the read model and canvas.
4. **Explicit close + 7-day inactivity close** — no close endpoint/RPC, no activity-clock column. Includes Abstain-defaulting of still-invalidated/unmarked statements at close.
5. **Frontend** — own-statement edit/delete already scopes correctly (`canEditNode` = own + my-turn); the gaps are the invalidated-mark visual + gate, orphan highlight, the carried-over **mini-turn UI freeze** TODO, the close button, and the 7-day countdown. The marks payload to the client currently carries no `valid` field and must be threaded through.

Five lessons in `context/foundation/lessons.md` bind this slice directly (invalidation-as-flag, repository-only Supabase, turn-as-RLS-predicate, design-for-extension, no `window.location.reload()`).

## Detailed Findings

### Area 1 — Data model & the invalidation column (DB)

Tables and the key column for S-05:

- **`marks`** (`supabase/migrations/20260610000001_create_marks_and_authorship.sql:24-39`): `id, debate_id, node_id, marker_id, stance ('agree'|'challenge'|'abstain'), created_at, updated_at, valid boolean not null default true`. UNIQUE `(node_id, marker_id)` — one mutable row per node/marker pair.
  - `marks_and_authorship.sql:34-35` comment: *"valid: true = current; false = counterpart's content changed, mark stale (S-05 flips it). The counterpart flips valid to false when the marked node changes — never deleted."*
  - `marks_and_authorship.sql:234` comment: *"S-05 wires up the valid=false flip trigger; no schema change needed there."*
  - `marks_and_authorship.sql:239`: `grant update (stance, valid, updated_at) on public.marks to authenticated;` — the column is already write-grantable.
- **`exchanges`** (`20260609000001_create_exchanges.sql:13-32` + `20260611000002_round_close_and_mini_turn.sql:36-37`): `status ('pending'|'accepted'|'declined'|'completed')`, `round_count (1..5)`, `current_round (1..round_count)`, `current_turn ('challenger'|'advocate')`, `responded_at`, `in_mini_turn boolean default false`. **No turn-opened-at / last-activity timestamp** — relevant to the 7-day clock (gap below).
- **`nodes`** (`20260528000001_create_debate_graph.sql:31-46`): `kind ('statement'|'connective')`, `author_id`, `metadata jsonb`. Authorship is **derived, never stored as a role** — challenger vs advocate is inferred from `author_id` vs `debates.owner_id` (`context/archive/2026-06-09-challenger-first-turn/plan.md:119-121`).
- **`relations`** (`20260528000001_create_debate_graph.sql:54-63`): `source_node_id`, `target_node_id` (both `ON DELETE CASCADE`), UNIQUE `(source_node_id, target_node_id)`, CHECK `source <> target`.

### Area 2 — Edit/delete operations already exist (RPC + repo + endpoint)

S-05's own-statement edit/delete writes are **already wired end-to-end**; the missing piece is the invalidation *side-effect*, not the mutation itself.

- **Edit:** `patch_node(p_node_id, p_metadata_patch, p_position_x, p_position_y) RETURNS SETOF public.nodes` (`20260605000002_atomic_node_metadata_patch.sql:10-28`), **SECURITY INVOKER** so `nodes_update` RLS governs it. Repo `updateNode` (`src/lib/debate/repository.ts:~130`, debounced patch in store). Endpoint `PATCH /api/debates/[id]/nodes/[nodeId]`.
- **Delete:** repo `deleteNode` (`src/lib/debate/repository.ts:~145`, maps root-delete FK 23503 → 409). Endpoint `DELETE /api/debates/[id]/nodes/[nodeId]`. Relations cascade via FK.
- **Write gating** (`20260611000002_round_close_and_mini_turn.sql:279-435`): `nodes`/`relations` INSERT/UPDATE/DELETE all use the two-branch pattern `author_id = auth.uid() AND ((pre-exchange owner) OR can_add_content_as_current_actor(debate_id))`. Because authorship + turn gating are already enforced, **round-2+ own-statement edit/delete "just works" at the write layer** — no new policy needed for the mutation itself.

### Area 3 — Mark invalidation: the central new mechanism

The flip is **not** a client/marker UPDATE. Trace:

- `marks_update` WITH CHECK (`marks_and_authorship.sql:220-231`) requires `marker_id = (select auth.uid())` **and** `can_write_as_current_actor(debate_id)` **and** the node's `author_id <> auth.uid()`. So only the *marker*, on *their* turn, can change their own row.
- Invalidation requires the **author** of the edited statement to flip the **counterpart's** mark. The author is not the marker → the author cannot satisfy `marker_id = auth.uid()`. **Therefore the flip must be a SECURITY DEFINER trigger/RPC** that fires when a node is edited (and clears on delete), bypassing `marks_update`. This is the same pattern `is_accepted_challenger` / `can_*_as_current_actor` already use to break RLS cycles (lessons.md:41-53).
- **Edit → invalidate:** on `patch_node` of a statement, flip every counterpart mark on that node to `valid = false` (preserve the stance row — lessons.md:55-60). Natural implementation: an `AFTER UPDATE` trigger on `nodes` (metadata change), or fold it into a dedicated edit RPC.
- **Delete → auto-clear:** PRD FR-026 (`prd.md:171`) distinguishes two cases — (a) the deleted statement's own marks vanish (FK `ON DELETE CASCADE`, `marks_and_authorship.sql:27`, already correct); (b) *preserved counterpart statements* that referenced the deleted node lose their relations to it and have their prior marks **auto-cleared without re-evaluation**, and become **orphaned** if they no longer connect to root. Case (b) is net-new logic.
- **Re-evaluation gate (mostly free):** `submit_turn`'s completeness gate (`20260611000002_round_close_and_mini_turn.sql:116-136`) counts counterpart statements with a `valid = true` mark; an invalidated mark already reads as unmarked and **blocks submit at the DB layer today**. S-05's work here is surfacing *which* marks need re-evaluation in the UI and enforcing "re-mark before adding new content" (FR-026: re-eval is the mandatory first action).

### Area 4 — Orphan detection (greenfield)

No orphan concept exists anywhere (DB, repo, store, or canvas). PRD FR-026/US-04 (`prd.md:87,92,171`): after a delete, counterpart statements that no longer connect to the root claim *in any way (even indirectly)* are preserved, their marks auto-cleared, and they are **explicitly highlighted as orphaned**. Two design routes (decision deferred to `/10x-plan`):

- **Compute at read time** — a statement is orphaned if no directed path reaches `debates.root_node_id`. No schema change; cost is a graph traversal per read (graph is small, O(nodes+relations)). Fits the repository-read pattern the summary already uses.
- **Persist an `orphan boolean` + trigger** on relation delete — faster reads, but adds a column, a recursive trigger, and backfill risk.

The connectivity check must follow relations *transitively* to root, not just direct incoming edges.

### Area 5 — Close paths (greenfield)

The only path to `completed` today is the challenger's mini-turn submit inside `submit_turn` (`20260611000002_round_close_and_mini_turn.sql:161-167`). Missing:

- **Explicit advocate close** — no `closeExchange` repo fn, no `POST /api/exchanges/[id]/close`. FR-019 (`prd.md:151`) **close precondition**: the advocate must first satisfy FR-015 (every challenger statement marked / re-evaluated). At close, still-invalidated marks AND still-unmarked advocate statements **default to Abstain** (counted as unresolved).
- **7-day challenger-inactivity close** — no activity-clock column on `exchanges`; clock starts when the challenger's turn opens, only a turn *submission* stops it (`prd.md:221`, roadmap Open Question 3 `roadmap.md:241`). The advocate may close once the window elapses. **Infra question:** Cloudflare Workers has no built-in cron in this setup (`README` runtime note; lessons: no Node built-ins). Options: lazy check-and-close on read (simplest, no scheduler), an external scheduled trigger, or surfacing a countdown the advocate acts on manually. The UI must show the countdown once the window is available.
- Summary remains available after close, but **never** before ≥1 complete round even on the inactivity path (`prd.md:81,149-150`).

### Area 6 — Frontend (store / canvas / header islands)

Architecture: the debate page (`src/pages/debates/[id].astro`) mounts **three independent React islands** — `MapEditor` (owns the Zustand store), `TurnBar`, `DivergenceSummary` — that share no React state and communicate via **`window` CustomEvents** (`wvmap:turn-gate`, `wvmap:request-turn-gate`, `wvmap:submit-turn`, `wvmap:set-can-edit`). Any new header control (close button, countdown) must use this event bus, not props.

Store: `src/components/debate/store.ts`.
- **Already correct for S-05 edit/delete:** `canEditNode(nodeId)` (`store.ts:788-794`) = pre-exchange `canEdit`, else `isMyTurn && node.authorId === viewerId` — own-statement + my-turn scoping is in place. `isMarkableNode` (`store.ts:801-808`) = `authorId !== viewerId` (turn-agnostic, keeps the mark bar visible read-only). `canMarkNode` = `isMarkableNode && isMyTurn`.
- **Mutations** are optimistic with rollback and a single-flight `reconcileFromServer()` (`store.ts:325-363`) — the model to follow; never `window.location.reload()` (lessons.md:76-81).
- **Marks state** (`store.ts:88`) is a flat `nodeId → stance` map with **no validity dimension**. `apiGetMarks` and SSR `getDebateMarks` return a plain map — S-05 must thread `valid` through the payload, `hydrate`, `reconcileFromServer`, and `store.marks`.
- **Turn gate** `computeTurnGate` (`MapEditor.tsx:59-77`) counts counterpart statements marked vs total — has **no notion of invalidated marks**; extend so invalidated-but-still-existing marks count toward "needs action," and `setMark` clears the flag. `TurnBar`'s `canSubmit = myTurn && marked === total` then blocks naturally.
- **Freshness poll** (`MapEditor.tsx:274-349`, 1 s interval, visibility-gated, stops on `isCompleted`) is where a timeout-driven `completed` transition arrives for the counterpart — reuse it for the close flow.

Visual gaps (all greenfield): invalidated-mark state in the mark bar (`StatementNode.tsx:493-537`), orphan card style, the **mini-turn UI freeze** (carried-over TODO, `change.md:23-32` — challenger is still offered content controls during the mini-turn; fix via a shared `canWriteContentNow(viewer) = isMyTurn && !(viewerRole === "challenger" && inMiniTurn)`), the explicit-close button, and the 7-day countdown (`ViewerContext` `store.ts:34-48` carries no deadline field).

## Code References

- `supabase/migrations/20260610000001_create_marks_and_authorship.sql:24-39` — `marks` schema incl. `valid` column; `:220-231` `marks_update` policy (marker-only); `:234,239` S-05 flip note + UPDATE grant.
- `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:36-37` — `in_mini_turn`; `:46-69` `can_add_content_as_current_actor`; `:116-136` `submit_turn` mark-completeness gate (valid=true); `:138-175` round-close/mini-turn routing; `:279-435` two-branch write gating on nodes/relations.
- `supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:10-28` — `patch_node` (SECURITY INVOKER, SETOF).
- `supabase/migrations/20260609000001_create_exchanges.sql:13-32` — exchange schema (no activity timestamp); `:49-53` membership-only select; `:69-71` challenger respond.
- `src/lib/debate/repository.ts` — `updateNode` (~130, patch_node + 404), `deleteNode` (~145), `getDebateGraph`.
- `src/lib/mark/repository.ts` — `getDebateMarks` (flat map, no `valid`), `upsertMark`.
- `src/lib/exchange/repository.ts` — `submitTurn` (~270), `getDebateExchange`, `getExchangeStatus` (carries `inMiniTurn`); **no `closeExchange`**.
- `src/lib/summary/repository.ts:~42` & `src/lib/summary/classify.ts:16-20,83` — summary already filters `valid = true` and treats `!valid` as unresolved (forward-compat).
- `src/lib/debate/viewer.ts:26-57` — `deriveViewer`; admits `accepted`/`completed`; no deadline field.
- `src/lib/api.ts:22-44` — `withAuth` error→HTTP mapping (404/409/422/500); `src/lib/errors.ts`.
- `src/components/debate/store.ts:88,325-363,788-808` — marks map, reconcile, edit/mark gates.
- `src/components/debate/MapEditor.tsx:42-77,274-349` — `TurnGateDetail`, `computeTurnGate`, freshness poll + CustomEvent bus.
- `src/components/debate/StatementNode.tsx:299-308,493-537` — authorship tint, mark bar.
- `tests/integration/writeImmutability.test.ts` — S-04 RLS negative-path coverage (mini-turn freeze, completed immutability, pending lock-out).

## Architecture Insights

- **Invalidation is a counterpart-driven flag flip, and it cannot be a normal UPDATE.** The marker-only `marks_update` policy means the flip must be SECURITY DEFINER (trigger on node edit, cascade/clear on delete). This is the single most important design constraint and the riskiest correctness surface (roadmap S-05 risk note: "a correctness bug here silently corrupts a user's reasoning map").
- **The DB already half-enforces re-evaluation.** Because the completeness gate counts `valid = true` only, an invalidated mark blocks submit without any new gate. S-05's re-eval work is largely UI surfacing + the "re-mark before new content" ordering rule.
- **Turn + authorship gating is reusable as-is.** S-03/S-04 made the turn machine actor-neutral (`current_turn` is data, not hardcoded) — round-2+ edits inherit this with no new policy (lessons: design-for-extension).
- **Three-island CustomEvent bus** is the only cross-island contract; close button and countdown live in header islands and must use it.
- **Repository-only Supabase** (lessons.md:69-74): close logic, invalidation triggers, orphan reads must route through `src/lib/<domain>/repository.ts`, surfacing failures with `if (error) throw error`.
- **SETOF 404 contract** (lessons.md:34-39): any new mutating RPC (close, edit-with-invalidation) must `RETURNS SETOF` and its not-found branch must be integration-tested — `lint`/`build` can't see the all-null-row trap.

## Historical Context (from prior changes)

- `context/changes/s05/change.md:14-21` — authoritative scope note: mini-turn + write-immutability shipped in S-04; still-S-05 = invalidation, orphan highlight, explicit close, 7-day timeout.
- `context/changes/s05/change.md:23-32` — carried-over **UI mini-turn freeze** TODO (DB-enforced only in S-04; challenger still offered content controls).
- `context/changes/s04/plan.md` "Shifts during implementation" §1–2 — why the mini-turn and write-immutability were pulled forward (shared `submit_turn` branch; cheaper to land once).
- `context/archive/2026-06-09-challenger-first-turn/plan.md:149-157` — the `valid` column was added in S-03 with the explicit decision that **S-05 wires the flip trigger, no schema change**; counterpart invalidates, never the author.
- `context/archive/2026-06-09-challenger-first-turn/research.md:309-315` — confirmation that marks are current-state (one mutable row), not per-round snapshots; summary reads current state.
- `context/foundation/lessons.md:55-60` (invalidation-as-flag), `:48-53` (turn-as-RLS), `:62-67` (design-for-extension), `:69-74` (repository-only), `:76-81` (no reload) — all directly applicable.
- `context/foundation/test-plan.md` §4 Phase 4 (risks #4 turn/lock, #5 delete→orphan/cascade/mark-invalidation) — the test phase that *gates on S-05 shipping*; integration tests against real RLS are the only layer that proves invalidation/orphaning.

## Related Research

- `context/changes/s04/research.md` — turn machine, marks disjointness, summary input contract (the immediate predecessor).

## Open Questions

1. **How is `valid=false` flipped?** A SECURITY DEFINER `AFTER UPDATE` trigger on `nodes` (fires for any author edit) vs. folding invalidation into a dedicated edit RPC the repo calls. Trigger is more robust (can't be bypassed by a direct `patch_node`); RPC is more explicit. — for `/10x-plan`.
2. **Orphan detection: compute-at-read vs persisted column + trigger?** Graph is small, so a read-time reachability check is likely simplest and schema-free. — for `/10x-plan`.
3. **7-day clock storage & actuation.** No activity timestamp exists on `exchanges`. Add a `turn_opened_at`/`challenger_deadline_at` column (set when the challenger's turn opens, cleared on submit) — then *who actuates the close*? Cloudflare Workers has no cron here; lazy check-and-close on read (advocate's next visit) avoids a scheduler but means close happens only when someone looks. Confirm the "silent = no submission in 7 days" definition (`prd.md:221`).
4. **Delete invalidation vs cascade.** The deleted node's own marks are FK-cascaded (correct), but preserved counterpart statements that *linked to* the deleted node need their marks auto-cleared and orphan status recomputed — confirm this is a trigger on relation-delete vs handled in the delete RPC.
5. **Does the existing `submit_turn` gate fully express FR-026's "re-evaluate before adding new content"?** It blocks *submit* on incomplete valid marks, but FR-026 also forbids *adding new statements* before re-evaluation — that ordering rule is currently unenforced server-side (only submit is gated). Decide whether to add an insert-time guard or enforce purely in the UI.
