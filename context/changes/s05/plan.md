# S-05 Multi-round Edit/Delete with Mark Invalidation — Implementation Plan

## Overview

Across rounds 2+, each party may edit/delete only their own statements during their active turn. This slice adds the three genuinely-new pieces (the mini-turn and write-immutability already shipped in S-04, and all close/timeout work is split to S-08):

1. **Mark invalidation on edit** — when a statement's author changes its content, the counterpart's mark on it flips `valid = false`, forcing re-evaluation before the counterpart can submit.
2. **Orphan resolution** — a delete can sever a counterpart's statement from the root claim; at the start of their next turn that party sees their own orphaned statements highlighted and must delete or reconnect them before submitting. Orphans that survive into a closed exchange surface in the divergence summary.
3. **Mini-turn UI content-freeze** — the carried-over S-04 TODO: make the UI match the DB, which already freezes the challenger's content writes during the closing mini-turn while keeping marking live.

## Current State Analysis

- `marks.valid boolean not null default true` already exists (`20260610000001_create_marks_and_authorship.sql:24-39`); **nothing flips it.** The flip cannot be a normal `UPDATE` — `marks_update` RLS requires `marker_id = auth.uid()`, but it is the statement's **author** (the counterpart of the marker) who triggers the flip. So it must run inside a **SECURITY DEFINER** function (lessons §"Break cross-table RLS recursion", §"Enforce turn/phase as RLS predicate").
- Node edits are already wired end-to-end: repo `updateNode` (`src/lib/debate/repository.ts:103-142`) calls the **SECURITY INVOKER** `patch_node` RPC (`20260605000002_atomic_node_metadata_patch.sql`); RLS `nodes_update` (`20260611000002_round_close_and_mini_turn.sql:301-338`) governs it via `author_id = auth.uid() AND (pre-exchange-owner OR can_add_content_as_current_actor(debate_id))`.
- The DB **already half-enforces re-evaluation**: `submit_turn`'s completeness gate counts only `valid = true` marks (`20260611000002...:122-136`), so an invalidated mark already reads as unmarked and blocks submit server-side. S-05's work there is purely UI surfacing.
- The marks payload carries **no validity dimension** anywhere: `getDebateMarks` (`src/lib/mark/repository.ts:29-41`) returns `Record<string, MarkStance>`; threaded as that flat map through `apiGetMarks`, the SSR `[id].astro:42-45`, `store.marks` (`store.ts:88`), `computeTurnGate` (`MapEditor.tsx:59-77`), and `StatementNode`'s mark bar (`StatementNode.tsx:60,497-537`).
- **No orphan/connectivity concept exists** anywhere (DB, repo, store, canvas, summary). `classify.ts` filters `valid = true` and treats `!valid` as unresolved, but has no orphan dimension.
- The challenger's mini-turn is DB-frozen (`can_add_content_as_current_actor:46-66` returns false for the challenger when `in_mini_turn`), but the UI still offers add/move/edit/delete controls — rejected only at Postgres (`change.md:25-34`).
- Cross-island contract: the canvas (`MapEditor`, owns the store) talks to the header islands (`TurnBar`, `DivergenceSummary`, `InviteChallenger`) only via `window` CustomEvents (`wvmap:turn-gate`, `wvmap:request-turn-gate`, `wvmap:submit-turn`, `wvmap:set-can-edit`).

## Desired End State

- Editing a statement's content (not its position, not an identical re-save) flips every counterpart mark on it to `valid = false`. The counterpart, on their next turn, sees that mark rendered at lighter opacity with a "Needs re-evaluation" cue and cannot submit until they re-mark it.
- Deleting a node that severed a counterpart statement from root leaves that statement in place; at the start of the counterpart's next turn it is highlighted as orphaned on their canvas, and their "Submit turn" stays disabled (naming the dangling statements) until they delete or reconnect each one. Only your **own** dangling statements block your submit.
- The challenger's mini-turn UI offers **no** content controls (add/move/edit/delete) — only the mark bar — matching the existing DB freeze. Orphans are tolerated in the mini-turn (it is marking-only) and surface in the divergence summary, tagged "orphaned" while keeping their stance.

**Verification:** the integration suite proves the invalidation flip, the off-turn/not-found branches, and the orphan-tagged summary against real RLS; manual UI checks confirm the visuals and gates.

### Key Discoveries:

- The flip must be SECURITY DEFINER (`marks_and_authorship.sql:220-231` marker-only `marks_update`). This is the single riskiest correctness surface (roadmap S-05 risk: "a correctness bug here silently corrupts a user's reasoning map").
- `submit_turn` already counts `valid = true` only — re-evaluation enforcement is free at the DB layer (`20260611000002...:122-136`).
- `patch_node` returns `SETOF` for the not-found → 404 contract (lessons §"Use `RETURNS SETOF`"); any replacement must preserve it.
- The orphan reachability traversal is **compute-at-read** and powers three consumers: the canvas highlight, the submit-gate, and the summary `isOrphaned` tag — write it once in a pure util.

## What We're NOT Doing

- **No close/timeout work** — explicit advocate close, the 7-day challenger-inactivity path, the activity-clock column, the countdown UI, Abstain-defaulting at close. All of that is **S-08** (`advocate-close-and-timeout`).
- **No mark side-effect on delete** — the deleted node's own marks FK-cascade (already correct); preserved counterpart statements **keep** their marks. Only orphan status is recomputed. No relation-delete clear cascade.
- **No "re-evaluate before adding new content" ordering rule** — dropped; the submit-gate is the only enforcement, any order within a turn.
- **No DB change to the mini-turn freeze** — the S-04 RLS stays as-is; the mini-turn remains a full content-freeze (no delete/reattach there). Phase 4 is UI-only.
- **No persistent "always-on" orphan highlight** — freshly-added, not-yet-connected nodes mid-build are not flagged as orphaned; the highlight targets the viewer's own statements during their turn, and the submit-gate is the hard enforcement.

## Implementation Approach

Four phases in dependency order. Phase 1 lands the DB invalidation core. Phase 2 threads `valid` through every read model and surfaces it in the UI (turn-gate + mark bar). Phase 3 adds the compute-at-read connectivity util and its three consumers (canvas highlight, submit-gate, summary tag) plus the advocate's pre-invite guard. Phase 4 closes the carried-over mini-turn UI-freeze TODO.

## Critical Implementation Details

- **The DEFINER RPC re-checks authorization, because DEFINER bypasses RLS on the node write.** It must replicate the `nodes_update` predicate exactly (`author_id = caller AND (pre-exchange-owner OR can_add_content_as_current_actor)`). To avoid drift, factor that predicate into one new `can_write_node_content(p_node_id)` SECURITY DEFINER helper the RPC calls; an unauthorized call returns the empty set (→ `maybeSingle` null → 404, matching today's RLS-blocked behavior). The shipped policies are left untouched to limit blast radius.
- **Position-only and identical re-saves must NOT invalidate.** Flip only when `p_metadata_patch is not null` **and** the merged metadata is actually different from the stored metadata (`(metadata || p_metadata_patch) is distinct from metadata`).
- **The dangling submit-block is suppressed during the mini-turn.** The challenger cannot edit/delete/reattach in the mini-turn (frozen), so blocking submit on orphans there would trap them — orphans are tolerated in the mini-turn and surface in the summary instead.

---

## Phase 1: Mark Invalidation RPC (DB core)

### Overview

Add the SECURITY DEFINER edit-RPC that performs the node patch and, when content actually changed, flips the counterpart's marks to `valid = false`. Switch the repository to call it.

### Changes Required:

#### 1. New migration — invalidation RPC + auth helper

**File**: `supabase/migrations/20260612000002_invalidate_marks_on_edit.sql`

**Intent**: Create the function that owns the invalidation side-effect, plus a shared authorization helper so the DEFINER function enforces the same write-gate the `nodes_update` RLS does.

**Contract**: Two new functions, both `security definer`, `set search_path = public`, execute revoked from `public, anon` and granted to `authenticated`.

- `can_write_node_content(p_node_id uuid) returns boolean` — mirrors the `nodes_update` predicate: the node's `author_id = auth.uid()` AND (caller owns the debate and no `pending/accepted/completed` exchange exists, OR `can_add_content_as_current_actor(debate_id)`).
- `patch_node_and_invalidate(p_node_id uuid, p_metadata_patch jsonb default null, p_position_x double precision default null, p_position_y double precision default null) returns setof public.nodes` — replaces `patch_node` as the edit path. Returns the empty set when `can_write_node_content` is false or the node is unknown (preserves the SETOF→404 contract). Performs the same `metadata || p_metadata_patch` + coalesced-position UPDATE. Flips counterpart marks only on a real content change:

```sql
-- inside patch_node_and_invalidate, after resolving v_node and confirming auth:
if p_metadata_patch is not null
   and (v_node.metadata || p_metadata_patch) is distinct from v_node.metadata then
  update public.marks
     set valid = false, updated_at = now()
   where node_id = p_node_id and valid = true;  -- all marks on this node are the counterpart's
end if;
```

#### 2. Repository switches to the new RPC

**File**: `src/lib/debate/repository.ts` (`updateNode`, lines 129-141)

**Intent**: Route edits through the invalidation RPC instead of `patch_node`; everything else (root-demote 422 guard, the `maybeSingle` → `NotFoundError` 404 mapping) is unchanged.

**Contract**: `.rpc("patch_node", {...})` → `.rpc("patch_node_and_invalidate", {...})` with the identical argument object. `patch_node` may remain defined (no other callers) — do not delete it in this slice.

#### 3. Regenerate types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new RPC's signature so the repo call type-checks.

**Contract**: Run `npm run db:types` (never hand-edit), then `npx astro check`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Types regenerated and committed: `npm run db:types` produces no further diff
- Type checking passes: `npx astro check`
- Lint passes: `npm run lint`
- Integration tests pass: `npm run test:integration` (new `tests/integration/markInvalidation.test.ts`)

#### Manual Verification:

- Editing own statement content invalidates the counterpart's mark; position drag and identical re-save do not.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Thread `valid` Through the Marks Payload + UI Surfacing

### Overview

Widen the marks model from `nodeId → stance` to `nodeId → { stance, valid }` across every layer, make the turn-gate treat an invalid mark as needing action, and render invalid marks in the mark bar at lighter opacity with a "Needs re-evaluation" cue.

### Changes Required:

#### 1. Shared mark-state type

**File**: `src/components/debate/mapVisualLanguage.ts` (where `MarkStance` lives) — or a sibling type module

**Intent**: One type for a node's mark-with-validity, imported everywhere the flat stance map was used.

**Contract**: `export interface MarkState { stance: MarkStance; valid: boolean }`. The payload shape becomes `Partial<Record<string, MarkState>>`.

#### 2. Repository read includes `valid`

**File**: `src/lib/mark/repository.ts` (`getDebateMarks`, lines 29-41)

**Intent**: Select and return the validity dimension.

**Contract**: `.select("node_id, stance, valid")`; return `Partial<Record<string, MarkState>>` with `{ stance: row.stance, valid: row.valid }`.

#### 3. Thread the new shape through the client payload

**Files**: `src/components/debate/persistence.ts` (`apiGetMarks` return type), `src/pages/debates/[id].astro` (`initialMarks` type, line 42), `src/components/debate/MapEditor.tsx` (`initialMarks` prop + `marks` selector typing)

**Intent**: Carry `MarkState` instead of `MarkStance` end-to-end. The `/api/debates/[id]/marks` GET endpoint needs no change (it forwards the repo result).

**Contract**: Replace `Partial<Record<string, MarkStance>>` with `Partial<Record<string, MarkState>>` at each boundary.

#### 4. Store: marks field, hydrate, reconcile, setMark

**File**: `src/components/debate/store.ts` (`marks` field line 88; `hydrate` 488-514; `reconcileFromServer` 334-353; `setMark` 810-823)

**Intent**: Hold `MarkState`. A viewer re-marking their own node makes it valid again. Optimistic rollback restores the prior `MarkState` (or drops it).

**Contract**: `marks: Partial<Record<string, MarkState>>`. `setMark` optimistic write is `{ stance, valid: true }`; `prevState` captured/restored as `MarkState | undefined`. `reconcileFromServer`'s `apiGetMarks` result already carries `valid`.

#### 5. Turn-gate counts invalid as unmarked

**File**: `src/components/debate/MapEditor.tsx` (`computeTurnGate`, lines 67-68)

**Intent**: A counterpart statement counts as "marked" only when its mark is present AND valid, so an invalidated mark re-blocks "Submit turn" (mirroring the DB gate).

**Contract**: `markedCount = counterpartStatements.filter((n) => marks[n.id]?.valid === true).length`.

#### 6. Mark bar shows the invalid state

**File**: `src/components/debate/nodes/StatementNode.tsx` (mark derivation line 60; mark bar 497-537)

**Intent**: Keep showing the prior stance but dimmed, with a "Needs re-evaluation" indicator, until the counterpart re-marks (which restores full opacity via `setMark`).

**Contract**: `currentMark = marks[id]?.stance`; `isStale = marks[id] !== undefined && marks[id]?.valid === false`. When `isStale`, lower the active-stance opacity and render a small "Needs re-evaluation" label in the bar. The bar stays interactive per existing `canMarkThisNode`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Lint passes: `npm run lint`
- Unit test: `computeTurnGate` counts an invalid mark as unmarked: `npm run test:unit`
- Integration: `getDebateMarks` returns the `valid` field: `npm run test:integration`

#### Manual Verification:

- After the author edits, the counterpart's mark renders dimmed with "Needs re-evaluation" and "Submit turn" is disabled until re-marked.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Orphan Resolution + Summary `isOrphaned`

### Overview

Add a pure compute-at-read reachability util and wire its three consumers: the canvas highlight of the viewer's own orphaned statements, the submit-gate that blocks dangling-own-statement submits and the advocate's pre-invite, and the divergence summary's "orphaned" tag.

### Changes Required:

#### 1. Reachability util

**File**: `src/lib/debate/connectivity.ts` (new)

**Intent**: One pure function used by the store, the summary repository, and tests. A statement reaches root when a directed path of relations leads from it to the root claim (the root is a sink).

**Contract**: `reachableFromRoot({ relations, rootNodeId }): Set<string>` — BFS from `rootNodeId` over **reversed** edges (`target → source`); the returned set is every node that can reach root. A statement node is orphaned when it is not the root and not in that set. Pure, no Supabase, O(nodes + relations). Provide a thin `orphanStatementIds({ nodes, relations, rootNodeId, authorId? })` helper that filters to statement kind (and optionally one author).

#### 2. Store selector for own orphans + connectivity broadcast

**Files**: `src/components/debate/store.ts` (new selector), `src/components/debate/MapEditor.tsx` (broadcast)

**Intent**: Expose the viewer's own orphaned statement ids for the canvas highlight, and broadcast dangling-own-node info to the header islands (works both pre-exchange for the advocate and during a turn).

**Contract**: Store selector `orphanedOwnNodeIds(): string[]` — own statement nodes (`data.authorId === viewer.viewerId`, or all nodes pre-exchange) that are not root and not reachable to root; exclude `pending` (not-yet-saved) nodes so a node mid-creation isn't flagged. MapEditor broadcasts a new `wvmap:connectivity` CustomEvent `{ danglingIds: string[]; danglingTitles: string[] }` on every nodes/edges change, regardless of viewer state.

#### 3. Canvas highlight

**File**: `src/components/debate/nodes/StatementNode.tsx`

**Intent**: Visually flag the viewer's own orphaned statements while it is their turn so they know what to delete or reconnect.

**Contract**: The node reads `orphanedOwnNodeIds()` (or a per-node selector) and, when its id is included and it is the viewer's turn, renders an orphan style (e.g. amber/dashed warning border). Connectives and counterpart nodes are never flagged.

#### 4. Submit-gate blocks dangling own statements (normal turns only)

**Files**: `src/components/debate/MapEditor.tsx` (`TurnGateDetail` + `computeTurnGate`), `src/components/debate/TurnBar.tsx`

**Intent**: Disable "Submit turn" while the viewer has dangling own statements, naming them — except during the mini-turn, where content is frozen and orphans are tolerated.

**Contract**: Extend `TurnGateDetail` with `danglingCount: number` and `danglingTitles: string[]`. `computeTurnGate` computes them from nodes/edges/root for the viewer's own statements; set `danglingCount = 0` when `viewer.inMiniTurn`. TurnBar's `canSubmit` becomes `myTurn && marked === total && danglingCount === 0`; when `danglingCount > 0` show a reason listing the titles.

#### 5. Advocate pre-invite guard

**File**: `src/components/debate/InviteChallenger.tsx`

**Intent**: Before the advocate opens the exchange, disable "Send invite" while any of their statements don't reach root (Decision 6, UI-only).

**Contract**: InviteChallenger listens to `wvmap:connectivity` and disables its invite action with a message naming the dangling statements while `danglingIds.length > 0`. Server-side enforcement is out of scope.

#### 6. Summary `isOrphaned` tag

**Files**: `src/lib/summary/classify.ts`, `src/lib/summary/repository.ts`, `src/components/debate/DivergenceSummary.tsx`

**Intent**: Restore the orphan dimension in the summary (orphan ≠ invalid): an orphaned statement keeps its stance bucket but is tagged so the reader sees it needs attention.

**Contract**:
- `classify.ts`: `ClassifyNode` and `SummaryItem` gain `isOrphaned: boolean`; bucketing is unchanged (an orphaned-but-validly-marked statement still lands in its stance bucket), the flag is just carried through.
- `repository.ts` (`getDivergenceSummary`): also select `relations` (+ `debates.root_node_id`), compute `reachableFromRoot`, and set `isOrphaned` per `ClassifyNode`.
- `DivergenceSummary.tsx`: `Row` renders an "orphaned" badge/sub-label when `item.isOrphaned`.

### Success Criteria:

#### Automated Verification:

- Unit tests for `reachableFromRoot` (reaches root / severed path / never-connected): `npm run test:unit`
- Unit test: `computeTurnGate` sets `danglingCount` and suppresses it in the mini-turn: `npm run test:unit`
- Integration: summary tags an orphaned statement while keeping its stance: `npm run test:integration`
- Type + lint: `npx astro check` && `npm run lint`

#### Manual Verification:

- After A's delete severs B's statement, B sees it highlighted at turn start and cannot submit until they delete/reconnect it.
- An orphaned statement that reaches a closed exchange appears in the summary tagged "orphaned" under its stance bucket.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Mini-turn UI Content-Freeze (carried-over TODO)

### Overview

Make the UI match the DB's existing mini-turn freeze: during the challenger's closing mini-turn, content controls (add/move/edit/delete) turn off while the mark bar stays interactive. No DB change.

### Changes Required:

#### 1. Shared content-write gate in the store

**File**: `src/components/debate/store.ts` (`myTurnOrPreExchange` 782-786, `canEditNode` 788-794, `canMarkNode` 796-799)

**Intent**: Introduce one predicate for "may write content now" that excludes the challenger during the mini-turn, and route the content gates through it; marking stays on `isMyTurn`.

**Contract**: Add `canWriteContentNow(viewer) = isMyTurn && !(viewerRole === "challenger" && inMiniTurn)`. `myTurnOrPreExchange` returns `canWriteContentNow` for the exchange case (still `canEdit` pre-exchange). `canEditNode` becomes `canWriteContentNow(viewer) && node.authorId === viewer.viewerId`. `canMarkNode` is unchanged (`isMarkableNode && isMyTurn`).

#### 2. MapEditor controls follow the gate

**File**: `src/components/debate/MapEditor.tsx`

**Intent**: With the store gates corrected, the derived `canAdd = myTurnOrPreExchange()` already turns off `nodesDraggable`, `nodesConnectable`, `deleteKeyCode`, and the add menus for the challenger in the mini-turn; per-node edit/delete follow `canEditNode`. Verify each affordance flips and the mark bar stays.

**Contract**: No new props — confirm `canAdd`, `nodesDraggable`, `deleteKeyCode`, `handleNodeContextMenu`/`handleEdgeContextMenu`, and `handlePaneContextMenu` all gate off for the challenger-in-mini-turn while `canMarkNode` keeps the mark bar live.

### Success Criteria:

#### Automated Verification:

- Unit test for the store gates: content gates are false but `canMarkNode` true for the challenger in the mini-turn: `npm run test:unit`
- Type + lint: `npx astro check` && `npm run lint`

#### Manual Verification:

- In the challenger's mini-turn, add/drag/edit/delete are all unavailable; only the mark bar is interactive; no error banner fires because the UI no longer offers a write the DB rejects.

**Implementation Note**: Final phase — confirm the full flow end-to-end after manual verification.

---

## Testing Strategy

### Unit Tests:

- `reachableFromRoot` / `orphanStatementIds`: reaches root, severed path, never-connected, connective-only path.
- `computeTurnGate`: invalid mark counts as unmarked; `danglingCount` computed; `danglingCount` suppressed in mini-turn.
- Store gates: `canWriteContentNow` / `canEditNode` false but `canMarkNode` true for challenger-in-mini-turn.

### Integration Tests (against real RLS):

- `markInvalidation.test.ts`: author edit flips counterpart mark `valid=false`; position-only and identical re-save do not; off-turn / wrong-author edit rejected; unknown node id → 404 (SETOF empty).
- `getDebateMarks` returns `valid`.
- Summary tags an orphaned statement while preserving its stance bucket.

### Manual Testing Steps:

1. As advocate (round 2+), edit a statement the challenger marked → challenger's mark shows dimmed + "Needs re-evaluation"; challenger's "Submit turn" disabled until re-mark.
2. As A, delete a connective that was B's only path to root → on B's turn, B's statement is highlighted orphaned and B's submit is blocked until delete/reconnect.
3. Drive an exchange to the challenger's mini-turn → confirm no content controls, mark bar live, no error banner; complete and open the summary → any orphan is tagged.

## Performance Considerations

The reachability traversal is O(nodes + relations) on a small per-debate graph, run at read time (canvas selector, summary read). No persisted column, no trigger — negligible cost and no migration churn.

## Migration Notes

One additive migration (`20260612000002_invalidate_marks_on_edit.sql`): two new SECURITY DEFINER functions, no schema/column changes, no backfill. `marks.valid` already defaults `true`, so existing rows stay valid. Regenerate `database.types.ts` after applying.

## References

- Research: `context/changes/s05/research.md`
- Scope decisions: `context/changes/s05/ans.md`, `prd.md` §Shifts (2026-06-12), `roadmap.md` §S-05/§S-08
- Invalidation pattern: `supabase/migrations/20260610000001_create_marks_and_authorship.sql:24-39,220-239`
- SETOF→404 + DEFINER lessons: `context/foundation/lessons.md:34-53,55-60`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Mark Invalidation RPC (DB core)

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 338facc
- [x] 1.2 Types regenerated, no further diff: `npm run db:types` — 338facc
- [x] 1.3 Type checking passes: `npx astro check` — 338facc
- [x] 1.4 Lint passes: `npm run lint` — 338facc
- [x] 1.5 Integration tests pass: `npm run test:integration` (`markInvalidation.test.ts`) — 338facc

#### Manual

- [x] 1.6 Editing own statement content invalidates the counterpart's mark; position drag and identical re-save do not — 338facc

  > **Agent-automatable**: Yes — bearer-token curl to PATCH the node, then SQL on `marks`.

  ```bash
  # Get an advocate bearer token (seed credentials — replace if your seed differs)
  TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
    -H "apikey: $(npx supabase status -o env | grep ANON_KEY | cut -d= -f2)" \
    -H "Content-Type: application/json" \
    -d '{"email":"advocate@example.com","password":"password123"}' | jq -r .access_token)
  # PATCH a statement the challenger has marked (use a real node id from the seed/round-2 debate)
  curl -s -X PATCH "http://localhost:4321/api/debates/<debateId>/nodes/<nodeId>" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"title":"Edited title"}' | jq .
  ```

  ```sql
  -- Expected: the counterpart's mark on <nodeId> is now valid = false
  select node_id, marker_id, stance, valid from public.marks where node_id = '<nodeId>';
  -- Then PATCH only position and an identical title; expect valid stays false only from the content edit,
  -- and re-running an identical-content PATCH does NOT re-flip an already-revalidated mark.
  ```

### Phase 2: Thread `valid` Through the Marks Payload + UI Surfacing

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Unit: `computeTurnGate` counts an invalid mark as unmarked: `npm run test:unit`
- [x] 2.4 Integration: `getDebateMarks` returns `valid`: `npm run test:integration`

#### Manual

- [ ] 2.5 Invalid mark renders dimmed + "Needs re-evaluation"; "Submit turn" disabled until re-mark

  > **Agent-automatable**: No — visual opacity/label state and the disabled submit button require a browser session.

### Phase 3: Orphan Resolution + Summary `isOrphaned`

#### Automated

- [ ] 3.1 Unit: `reachableFromRoot` reaches root / severed / never-connected: `npm run test:unit`
- [ ] 3.2 Unit: `computeTurnGate` sets `danglingCount` and suppresses it in mini-turn: `npm run test:unit`
- [ ] 3.3 Integration: summary tags an orphaned statement, keeps its stance: `npm run test:integration`
- [ ] 3.4 Type + lint: `npx astro check` && `npm run lint`

#### Manual

- [ ] 3.5 After A's delete severs B's statement, B sees it highlighted at turn start and cannot submit until delete/reconnect

  > **Agent-automatable**: Partial — the submit-block (gate) and the orphan row in the summary are checkable via SQL/HTTP, but the canvas highlight is visual and needs a browser.

  ```sql
  -- After A deletes the severing node, confirm B's statement exists but no longer reaches root.
  -- (Run the reachability check in app code; at the DB layer, confirm the relation that linked it is gone.)
  select id, source_node_id, target_node_id from public.relations where debate_id = '<debateId>';
  select id, kind, author_id from public.nodes where debate_id = '<debateId>' and kind = 'statement';
  ```

- [ ] 3.6 Orphaned statement that reaches a closed exchange appears in the summary tagged "orphaned" under its stance bucket

  > **Agent-automatable**: Partial — `/api/debates/[id]/summary` JSON carries `isOrphaned`; the badge rendering is visual.

  ```bash
  TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
    -H "apikey: $(npx supabase status -o env | grep ANON_KEY | cut -d= -f2)" \
    -H "Content-Type: application/json" \
    -d '{"email":"challenger@example.com","password":"password123"}' | jq -r .access_token)
  curl -s "http://localhost:4321/api/debates/<debateId>/summary" \
    -H "Authorization: Bearer $TOKEN" | jq '.. | objects | select(.isOrphaned == true)'
  ```

### Phase 4: Mini-turn UI Content-Freeze

#### Automated

- [ ] 4.1 Unit: content gates false but `canMarkNode` true for challenger-in-mini-turn: `npm run test:unit`
- [ ] 4.2 Type + lint: `npx astro check` && `npm run lint`

#### Manual

- [ ] 4.3 In the mini-turn, add/drag/edit/delete unavailable, mark bar interactive, no error banner

  > **Agent-automatable**: No — requires driving an exchange to the mini-turn and visually confirming the controls and absence of the error banner in a browser.
