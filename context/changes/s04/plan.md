# S-04 `first-divergence-summary` Implementation Plan

## Overview

S-04 is the product's **north star**: the smallest end-to-end slice that proves the core hypothesis. The advocate marks every challenger statement, adds their own nodes/relations, submits to **complete round 1**, and either party triggers the **deterministic divergence summary** (common ground / open divergences / unresolved positions), private to the pair.

S-03 was built deliberately symmetric, so the advocate's turn is already wired at the data + RLS layer. The genuinely new surface is: one `submit_turn` behavior change (close the round), a new `completed` exchange status, un-stubbing the advocate frontend, and a greenfield summary feature (pure classifier → repository read → endpoint → read-only UI).

## Current State Analysis

- **Turn machine is actor-neutral and complete at the DB layer.** `submit_turn` (`supabase/migrations/20260610000002_submit_turn_rpc.sql`) resolves the caller, runs an actor-neutral mark-completeness gate, and flips `current_turn` — for both challenger (S-03) and advocate (S-04) with no change. RLS write helper `can_write_as_current_actor` already covers the advocate-on-advocate-turn insert path. `RETURNS SETOF` gives the 404 contract.
- **`submit_turn` does NOT advance the round** and there is no terminal status. The S-04 delta is marked inline at `submit_turn_rpc.sql:89-93`.
- **`exchange_status` is `('pending','accepted','declined')`** (`20260609000001_create_exchanges.sql:8`) — no `completed`. The check constraint `exchanges_current_round_coherent check (current_round between 1 and round_count)` (`:29`) means a blanket `current_round + 1` on advocate submit **would violate the constraint when `round_count = 1`** — the single-round advocate submit would error. This is why a `completed` status is required, not optional.
- **Marks are disjoint per node.** RLS (`20260610000001_create_marks_and_authorship.sql:206-216`) lets a node be marked only by its counterpart (`author_id <> uid`), never twice. So the store's `node_id → stance` map (`store.ts:78`) stays unambiguous with both parties marking — **no `marker_id` refactor needed** (the research flagged a concern that the disjointness invariant resolves).
- **Frontend is challenger-hardcoded in two spots:** `MapEditor.computeTurnGate` (`MapEditor.tsx:49-61`, early-returns a zero gate unless `viewerRole === "challenger"`; counts only advocate statements), and `TurnBar`'s advocate branch (`TurnBar.tsx:22,26,47-54`, a disabled placeholder). `ViewerContext` (`store.ts:33-38`) has `advocateId` but **no `challengerId`**. The advocate `TurnBar` is already mounted on the page (`[id].astro:62-71`).
- **No summary code exists.** `src/lib/` has `debate/`, `mark/`, `exchange/` — no `summary/`. Greenfield.
- **`deriveViewer` / `getDebateExchange` are keyed on `'accepted'`** (`viewer.ts:29`, `repository.ts:149,165`) and on the `"pending" | "accepted"` TS union — a `completed` exchange would not load a viewer context or pass the `.in("status", [...])` filter.

## Desired End State

- The advocate can mark every challenger statement, add nodes/relations, and submit a functional turn from `TurnBar`.
- On a non-final advocate submit, `current_round` increments and the turn flips to the challenger; on the **final** round's advocate submit, the exchange becomes `status='completed'`. Both behaviors land together (the sequencing pin).
- A `completed` exchange remains fully readable by both parties (content, marks, summary).
- Either party, after ≥1 complete round (`status='completed' OR current_round >= 2`), can open a read-only divergence summary on the debate page: common ground (counterpart Agreed), open divergences (counterpart Challenged, with factual/values gap labels), and unresolved positions (counterpart Abstained **or unmarked**).
- The summary is deterministic, pure, O(nodes+marks), private to the pair (inherits RLS via a repository read).

### Key Discoveries:

- `submit_turn_rpc.sql:89-93` — the exact, documented spot for the round-close logic.
- `marks_and_authorship.sql:206-216` — the disjoint-mark invariant that keeps `node_id → stance` sufficient.
- `store.ts:790-797` — `isMarkableNode` is already symmetric (`authorId !== viewerId`); `computeTurnGate` should count counterpart statements the same way rather than needing a `challengerId`.
- `is_accepted_challenger` (`marks_and_authorship.sql:54-67`, `status='accepted'`) gates the **challenger's read** of marks/nodes/relations — must widen to include `completed` or the challenger loses summary access after a 1-round completion.

## What We're NOT Doing

- ~~**No write-immutability on close** (FR-019/FR-027) — `completed` is purely the summary-gate signal in S-04. `can_write_as_current_actor` still permits writes on a completed exchange until S-05 closes that gap.~~ **Superseded during implementation** — write-immutability landed in Phase 1. See [Shifts during implementation](#shifts-during-implementation).
- ~~**No final-round mini-turn** (FR-019) — S-05.~~ **Superseded during implementation** — the mini-turn was pulled forward into Phase 1. See [Shifts during implementation](#shifts-during-implementation).
- **No mark invalidation / `valid=false` flipping** (S-05). The summary filters `valid = true` for forward-compatibility, but every round-1 mark is `valid=true`.
- **No `marker_id` refactor** of the store map / `getDebateMarks` (disjointness makes it unnecessary).
- **No child-debate inclusion** in the summary (FR-020's optional toggle) — parent linking is S-07; not built.
- **No new `/summary` page / route** — the summary renders inline on the debate page, so no `PROTECTED_ROUTES` change.
- **No E2E / Playwright** — Test-plan Phase 5; out of scope.
- **No per-party submission timestamps / ledger** — the `(status, current_round)` pair is the single source of truth.

## Implementation Approach

Five phases, DB-first because the summary gate depends on the round-close behavior (the linchpin). Phase 1 ships the `submit_turn` change, the `completed` status, and the read-scope widening together. Phase 2 un-stubs the advocate frontend. Phases 3–5 build the greenfield summary bottom-up: pure classifier + repository read → endpoint → read-only UI. Tests follow your scope: exhaustive unit tests on the pure classifier (Phase 3), integration tests on the DB delta (Phase 1) and the summary endpoint + gate (Phase 4).

## Critical Implementation Details

- **Round-close logic is conditional on `round_count`, not a blanket increment.** In `submit_turn`, when the advocate submits (`v_next_turn = 'challenger'`): if `v_exchange.current_round < v_exchange.round_count` → set `current_round = current_round + 1`, `current_turn = 'challenger'`; else (final round) → set `status = 'completed'` and **do not** touch `current_round` (it would breach `exchanges_current_round_coherent`). The challenger-submit branch is unchanged (flip turn only). Implement the general final-round case now even though the S-04 demo only exercises round 1 (design-for-extension lesson).
- **Adding `completed` is a cross-cutting status audit.** Widen every **read** predicate keyed on `status = 'accepted'` (or `in ('pending','accepted')`) to also admit `'completed'`: `is_accepted_challenger`, the `nodes_select` / `relations_select` / `debates_select` / `exchanges_select` challenger-read branches, `getDebateExchange`'s `.in("status", [...])` filter + its TS union, and `deriveViewer`'s `=== "accepted"` check. Leave **write / turn-accept** predicates (`submit_turn` resolver `status='accepted'`, the write WITH CHECK helpers, the delete policy) on `'accepted'` only — a completed exchange takes no more turns and is not deletable.
- **Unmarked counterpart statements default to unresolved.** After round 1, the advocate's statements added during their own turn are unmarked by the challenger (no mini-turn until S-05). The classifier treats any counterpart statement lacking a `valid=true` mark as **unresolved** (Abstain-equivalent), forward-compatible with FR-019's close-time default. The summary never silently drops a statement.

## Phase 1: DB — round close + `completed` status

### Overview

Make `submit_turn` close rounds correctly and add the `completed` status, widening read-scope so a completed exchange stays visible to the pair. This is the linchpin the summary gate depends on.

### Changes Required:

#### 1. Add `completed` to the exchange-status enum + recreate `submit_turn`

**File**: `supabase/migrations/20260611000001_submit_turn_round_close.sql` (new)

**Intent**: Add the terminal `completed` status and replace `submit_turn` so the advocate's submit advances the round (non-final) or completes the exchange (final round). Keep the resolver, the actor-neutral mark gate, and `RETURNS SETOF` exactly as they are.

**Contract**: `alter type public.exchange_status add value 'completed';` (enum value-add must be its own statement, committed before use — keep it at the top of the migration, or split if the local runner complains about `ALTER TYPE ... ADD VALUE` inside a transaction with later usage). Then `drop function` + recreate `public.submit_turn(p_exchange_id uuid) returns setof public.exchanges`. The only changed block is the final UPDATE, which becomes branch-conditional:

```sql
-- advocate just submitted (v_next_turn = 'challenger'): close the round.
if v_next_turn = 'challenger' then
  if v_exchange.current_round < v_exchange.round_count then
    update public.exchanges
      set current_turn  = 'challenger',
          current_round = current_round + 1
      where id = p_exchange_id
      returning * into v_exchange;
  else
    -- final round done — no round to advance (would breach current_round<=round_count)
    update public.exchanges
      set status = 'completed'
      where id = p_exchange_id
      returning * into v_exchange;
  end if;
else
  -- challenger just submitted: flip to advocate, round unchanged.
  update public.exchanges
    set current_turn = 'advocate'
    where id = p_exchange_id
    returning * into v_exchange;
end if;
```

Re-apply the `revoke ... from public, anon` / `grant ... to authenticated` lines (recreating the function resets grants).

#### 2. Widen read-scope status predicates to include `completed`

**File**: `supabase/migrations/20260611000001_submit_turn_round_close.sql` (same migration) — `create or replace function public.is_accepted_challenger(...)`; `alter policy` / `drop+create policy` for the challenger-read branches of `nodes_select`, `relations_select`, `marks_select` (via the helper), `debates_select`, `exchanges_select`.

**Intent**: Ensure a `completed` exchange stays readable by both parties so the summary (and the underlying graph + marks) is visible after a 1-round completion.

**Contract**: Replace `status = 'accepted'` → `status in ('accepted','completed')` and `status in ('pending','accepted')` → `status in ('pending','accepted','completed')` in **read** predicates only. `is_accepted_challenger` keeps its name; update the predicate + the leading comment to note it now also admits completed. Do **not** alter `submit_turn`'s resolver, the write WITH CHECK helpers, or `exchanges_delete`.

#### 3. Regenerate the generated DB types

**File**: `src/db/database.types.ts`

**Intent**: Pick up `completed` in the `exchange_status` enum so the TS unions widen.

**Contract**: Regenerate via the Supabase types generator (MCP `generate_typescript_types` or `npx supabase gen types`). The `exchange_status` enum and the `submit_turn` function row type update.

#### 4. Widen the repository status unions

**File**: `src/lib/exchange/repository.ts`

**Intent**: Let `getDebateExchange` load a completed exchange and surface its status.

**Contract**: Add `"completed"` to the `.in("status", ["pending","accepted"])` filter (`:149`) and to the `DebateExchange.status` union + the `as` cast (`:129,165`). Leave `listInvites` / `getExchangeStatus` as-is unless a completed exchange must appear in the inbox (out of S-04 scope).

### Success Criteria:

#### Automated Verification:
- Migration applies cleanly on `npx supabase db reset`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Integration tests pass: `npm run test:integration`

#### Manual Verification:
- Advocate submit on a multi-round exchange flips turn to challenger and increments `current_round`
- Advocate submit on the final round sets `status='completed'` and leaves `current_round` within range
- A completed exchange remains readable (nodes, relations, marks) by both advocate and challenger via the RLS-on client

---

## Phase 2: Frontend — advocate turn

### Overview

Un-stub the advocate's turn UI: a working submit button driven by the live mark gate, generalized for either actor, with a completed-state display.

### Changes Required:

#### 1. Generalize `computeTurnGate`

**File**: `src/components/debate/MapEditor.tsx`

**Intent**: Drive the gate for the advocate as well as the challenger — count the counterpart's statements (not just the advocate's) and report the viewer's marked count.

**Contract**: Remove the `viewerRole !== "challenger"` early return. Count counterpart statements as `n.type === "statement" && n.data.authorId !== viewer.viewerId` (mirrors `isMarkableNode`, avoids needing a `challengerId` on `ViewerContext`). `markedCount` = those with `marks[n.id] !== undefined`. Return `{ isMyTurn: viewer.isMyTurn, markedCount, total }`. The existing `broadcastTurnGate` effect (`MapEditor.tsx:227-229`) already re-fires on `nodes`/`marks`/`viewer` changes.

#### 2. Activate the advocate branch of `TurnBar`

**File**: `src/components/debate/TurnBar.tsx`

**Intent**: Make the advocate's submit functional and gate-subscribed, and show a completed state when the round has been closed.

**Contract**: Drop the `isChallenger`-only gating: subscribe to `wvmap:turn-gate` for both roles (remove the `if (!isChallenger) return` at `:26`), and compute `canSubmit` / `buttonLabel` / `title` from the live gate for both. The `wvmap:submit-turn` → `store.submitTurn()` path already exists and is actor-neutral. When the exchange is `completed` (passed via a new `isCompleted` prop from the page, or inferred when `currentRound === roundCount` and it is no longer the viewer's turn), render a static "Exchange complete" state instead of a turn label/submit button.

#### 3. Pass completion state to `TurnBar`

**File**: `src/pages/debates/[id].astro`

**Intent**: Tell `TurnBar` (and keep mounting it) when the exchange is completed so it can show the completed state, and broaden the mount condition beyond `accepted`.

**Contract**: Broaden the `exchange?.status === "accepted"` mount guards (`:62,82`) to also mount for `"completed"`, and pass an `isCompleted={exchange.status === "completed"}` prop. `submitTurn` in the store already flips `viewer.isMyTurn` locally on success; the advocate's board locks via the existing turn lock.

### Success Criteria:

#### Automated Verification:
- Unit test: `computeTurnGate` returns the correct counterpart count + marked count for an advocate viewer
- Type check passes: `npx astro check`
- Lint/build pass: `npm run build`

#### Manual Verification:
- As the advocate, after marking every challenger statement, the `Submit turn` button enables and submits; the board locks
- The advocate's gate counter (`marked/total`) counts challenger statements, not advocate statements
- After the advocate submits the final round, the header shows a completed state (no live turn/submit)

---

## Phase 3: Summary algorithm — pure classifier + repository read

### Overview

The greenfield deterministic summary: a pure classification function plus a pair-scoped repository read that enforces the round gate.

### Changes Required:

#### 1. Pure `classifyDivergence`

**File**: `src/lib/summary/classify.ts` (new)

**Intent**: Map nodes + marks into the three buckets deterministically, with factual/values gap labels on the open-divergence bucket, treating unmarked counterpart statements as unresolved.

**Contract**: `classifyDivergence({ nodes, marks }): DivergenceSummary`. Input: statement nodes (each with `statementType` + `authorId`) and the counterpart marks (`node_id → { stance, valid }`, or the existing `node_id → stance` plus a parallel valid set). Connective nodes are excluded. For each statement, the bucket comes from its single counterpart mark: `agree`→`commonGround`, `challenge`→`openDivergence`, `abstain` **or no valid mark**→`unresolved`. Gap label (open-divergence only): `source|data|backing`→`"factual"`; `warrant|claim|rebuttal`→`"values"` (rebuttal decided as values/premise). Pure, O(nodes+marks), no Supabase import.

```ts
export interface DivergenceSummary {
  commonGround: SummaryItem[];                 // counterpart Agreed
  openDivergences: (SummaryItem & { gap: "factual" | "values" })[]; // counterpart Challenged
  unresolved: SummaryItem[];                   // counterpart Abstained OR unmarked
}
```

#### 2. Pair-scoped summary repository read with the gate

**File**: `src/lib/summary/repository.ts` (new)

**Intent**: Fetch the exchange (for the gate), nodes, and valid marks under RLS, then return the classification — or signal "not available" when the round gate is unmet.

**Contract**: `getDivergenceSummary({ supabase, debateId }): Promise<DivergenceSummary | null>`. Read the exchange via the existing repository; if **not** (`status === 'completed' || current_round >= 2`) return `null` (gate unmet). Otherwise read statement nodes + marks (`valid = true`) under the anon-key/RLS client (inherits pair-scoping like `getDebateMarks`), call `classifyDivergence`, return the result. Follow the "all Supabase calls in a repository, surface errors with `if (error) throw error`" lesson. No `SECURITY DEFINER` RPC (decision: pure-fn + repository).

### Success Criteria:

#### Automated Verification:
- Unit tests cover the full oracle: each `statement_type × {agree, challenge, abstain, unmarked}` → correct bucket + gap label; connectives excluded; `valid=false` ignored
- Type check passes: `npx astro check`
- `npm run test:unit` passes

#### Manual Verification:
- Spot-check the classifier output against a hand-built graph matches the PRD §Business-Logic mapping (contested Data → factual gap, contested Warrant → values gap)

---

## Phase 4: Summary endpoint

### Overview

Expose the summary read over HTTP with the standard `withAuth` preamble.

### Changes Required:

#### 1. `GET /api/debates/[id]/summary`

**File**: `src/pages/api/debates/[id]/summary.ts` (new)

**Intent**: Return the divergence summary for a debate to a member, or a clear status when the round gate is unmet.

**Contract**: `export const GET = withAuth(async (context, supabase) => { ... })`. Parse the debate id with `debateIdParamSchema` (400 on failure). Call `getDivergenceSummary({ supabase, debateId })`. `null` (gate unmet or RLS-scoped out) → 404 (or 409 "summary not available until a round completes" — pick 409 for gate-unmet vs 404 for unknown/forbidden if the repository can distinguish; otherwise 404 is acceptable and simpler). On success → `Response.json(summary)`. No `PROTECTED_ROUTES` change (API auth is handled by `withAuth`).

### Success Criteria:

#### Automated Verification:
- Integration test: gate-unmet exchange → 404/409; completed (round_count=1) and mid-exchange (current_round=2) → 200 with correct buckets
- Integration test: a non-member (RLS-scoped out) gets 404
- `npm run test:integration` passes; `npm run build` passes

#### Manual Verification:
- `curl` the endpoint as the advocate and as the challenger on a completed exchange → both get the same summary JSON

---

## Phase 5: Summary UI — read-only panel

### Overview

A "View divergence summary" affordance on the debate page that opens a read-only panel, available once the gate is met — including for a 1-round completed exchange.

### Changes Required:

#### 1. Summary panel + trigger

**File**: `src/components/debate/DivergenceSummary.tsx` (new) + mount in `src/pages/debates/[id].astro`

**Intent**: Let either party open a read-only panel rendering the three buckets (with gap labels on open divergences), fetched on demand from the endpoint.

**Contract**: A React island with a button enabled when the gate is met (`exchange.status === "completed" || exchange.currentRound >= 2`); on click it `GET`s `/api/debates/[id]/summary` and renders `commonGround` / `openDivergences` (with `factual`/`values` gap tag) / `unresolved` sections, read-only. Mount it on `[id].astro` for both advocate and challenger when an exchange exists. Reuse statement titles/types for display. No new route.

#### 2. Handle `completed` in `deriveViewer`

**File**: `src/lib/debate/viewer.ts`

**Intent**: A 1-round completed exchange must still resolve a viewer (read-only) so the page loads the board + summary affordance for both parties.

**Contract**: Treat `status in ('accepted','completed')` as a valid viewing state. For `completed`, the viewer is read-only — `viewer.isMyTurn` is `false` (no `current_turn === viewerRole` match needed; completion implies no active turn). Ensure `viewerRole` still resolves for the challenger on a completed exchange so the summary button knows who is viewing.

### Success Criteria:

#### Automated Verification:
- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:
- On a completed (round_count=1) exchange, both parties see the debate page (read-only) and the summary button
- The summary button is hidden/disabled before round 1 completes and appears once the gate is met
- The panel renders the three buckets with correct gap labels and no console errors

---

## Testing Strategy

### Unit Tests:
- `classifyDivergence` — exhaustive oracle: every `statement_type × {agree, challenge, abstain, unmarked}`; connectives excluded; `valid=false` marks ignored; rebuttal→values gap.
- `computeTurnGate` — advocate viewer counts challenger statements; marked count tracks `marks`.

### Integration Tests:
- Advocate `submit_turn`: multi-round → turn flip + `current_round` increment; final round → `status='completed'`, `current_round` unchanged.
- Read-after-complete: both parties read nodes/relations/marks on a completed exchange.
- Summary endpoint: gate-unmet → 404/409; mid-exchange (round 2) and completed (round 1) → 200 with correct buckets; non-member → 404.

### Manual Testing Steps:
1. Sign in as `user01@e.pl` (advocate), build a debate, invite `user02`, have `user02` accept and submit round 1.
2. As `user01`, mark all challenger statements, add a statement, submit — verify round close behavior matches `round_count`.
3. Trigger the summary as both parties; verify buckets + gap labels and read-only access.

## Performance Considerations

The summary is a single linear pass over nodes + marks (O(n)), trivially within the 10s NFR. No AI. The repository does a small number of indexed reads scoped by `debate_id`.

## Migration Notes

`ALTER TYPE ... ADD VALUE 'completed'` cannot run in the same transaction that then uses the new value in some Postgres setups; keep the enum add at the top of the migration (committed first) or split into two migration files if `supabase db reset` errors. Existing rows are unaffected (default stays `pending`). No backfill.

## References

- Research: `context/changes/s04/research.md`
- Linchpin spot: `supabase/migrations/20260610000002_submit_turn_rpc.sql:89-93`
- Symmetric turn machine + RLS: `supabase/migrations/20260610000001_create_marks_and_authorship.sql:54-93,206-231`
- Disjoint-mark invariant: `marks_and_authorship.sql:206-216`
- Integration fixture: `tests/integration/helpers.ts`, `tests/integration/marks.test.ts`
- Lessons: `context/foundation/lessons.md` (RETURNS SETOF; turn-as-RLS-boundary; repository-only Supabase; design-for-extension; centralize validation limits)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB — round close + `completed` status

#### Automated
- [x] 1.1 Migration applies cleanly on `npx supabase db reset`
- [x] 1.2 Type check passes: `npx astro check`
- [x] 1.3 Build passes: `npm run build`
- [x] 1.4 Integration tests pass: `npm run test:integration`

#### Manual
- [x] 1.5 Advocate submit on a multi-round exchange flips turn + increments `current_round`

  > **Agent-automatable**: Yes — bearer-token curl to submit-turn + SQL assertion on the exchange row.

  ```bash
  # Sign in as the advocate (user01) and as the challenger (user02). Local anon key is the
  # Supabase CLI default — if `npx supabase status` prints a different anon key, swap it in.
  ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
  ADV=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
    -H "Content-Type: application/json" -d '{"email":"user01@e.pl","password":"pwd123!"}' | jq -r .access_token)
  # Create a debate + invite + accept + challenger-submit via the app/UI or seed, note its exchange id,
  # then submit the advocate's turn (multi-round exchange, current_round=1, round_count>=2):
  curl -s -X POST "http://localhost:4321/api/exchanges/$EXCHANGE_ID/submit-turn" \
    -H "Authorization: Bearer $ADV" | jq '{current_turn, current_round, status}'
  # Expected: current_turn="challenger", current_round=2, status="accepted"  # replace $EXCHANGE_ID
  ```

  ```sql
  -- Service-role assertion (psql against local DB)
  select current_turn, current_round, status from public.exchanges where id = '<exchange id from above>';
  -- Expected: challenger | 2 | accepted
  ```

- [x] 1.6 Advocate submit on the final round sets `status='completed'`, `current_round` in range

  > **Agent-automatable**: Yes — same flow with a `round_count = 1` exchange.

  ```sql
  -- After the advocate submits the only round of a round_count=1 exchange:
  select current_round, round_count, status from public.exchanges where id = '<exchange id>';
  -- Expected: current_round <= round_count (1), status = 'completed'
  ```

- [x] 1.7 A completed exchange remains readable by both parties

  > **Agent-automatable**: Yes — RLS-on selects as advocate and as challenger.

  ```sql
  -- DB-layer RLS check (run each block in its own session):
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002"}'; -- challenger user02
  select count(*) from public.marks m
    join public.nodes n on n.id = m.node_id
    where n.debate_id = '<debate id>';
  -- Expected: > 0 (challenger can still read marks on a completed exchange)
  ```

### Phase 2: Frontend — advocate turn

#### Automated
- [x] 2.1 Unit test: `computeTurnGate` advocate counterpart count + marked count — dc7c67e
- [x] 2.2 Type check passes: `npx astro check` — dc7c67e
- [x] 2.3 Lint/build pass: `npm run build` — dc7c67e

#### Manual
- [x] 2.4 Advocate `Submit turn` enables after marking all challenger statements and locks the board

  > **Agent-automatable**: No — requires a browser session; the gate state lives in the React island and submit is wired through cross-island DOM events.

  Steps: sign in as `user01@e.pl` in the browser, open the debate where `user02` has submitted round 1, mark every challenger statement, confirm the button enables at `marked === total`, click it, confirm the canvas locks.

- [x] 2.5 Advocate gate counter counts challenger statements (not advocate statements)

  > **Agent-automatable**: No — visual check of the `marked/total` label in the header island.

- [x] 2.6 Advocate's final-round submit hands the turn to the challenger's mini-turn (advocate header flips to a muted "Submitted"; the challenger then sees "My Turn")

  > **Mini-turn (Phase 1 shift, FR-019)**: on a `round_count=1` exchange the advocate's submit does **not** complete the exchange directly. It flips `current_turn` back to the challenger with `in_mini_turn=true` — a final, marking-only closing turn. The challenger can still mark the advocate's just-added statements but cannot add new content (`can_add_content_as_current_actor` blocks the challenger while `in_mini_turn`). So after the advocate submits, the advocate's `TurnBar` shows the muted "Submitted" (off-turn) and the challenger's shows "My Turn". See [Shifts during implementation §1](#1-mini-turn-fr-019-pulled-forward-into-phase-1).

  > **Agent-automatable**: No — visual check across two browser sessions after a round_count=1 advocate submit.

- [x] 2.7 Exchange completes only after the challenger submits the closing mini-turn — both headers then show the static "Exchange complete" state (no live turn/submit)

  > **Agent-automatable**: No — visual check after the challenger submits the mini-turn; the exchange transitions to `status='completed'`, `in_mini_turn=false`.

### Phase 3: Summary algorithm — pure classifier + repository read

#### Automated
- [x] 3.1 Unit tests cover the full oracle (type × stance/unmarked → bucket + gap; connectives excluded; `valid=false` ignored) — c19e062
- [x] 3.2 Type check passes: `npx astro check` — c19e062
- [x] 3.3 `npm run test:unit` passes — c19e062

#### Manual
- [x] 3.4 Classifier spot-check matches the PRD §Business-Logic mapping — c19e062

  > **Agent-automatable**: Yes — a throwaway unit/REPL assertion on a hand-built graph; no browser needed.

### Phase 4: Summary endpoint

#### Automated
- [x] 4.1 Integration test: gate-unmet → 404/409; round-2 and completed → 200 with correct buckets
- [x] 4.2 Integration test: non-member → 404
- [x] 4.3 `npm run test:integration` passes
- [x] 4.4 Build passes: `npm run build`

#### Manual
- [x] 4.5 `curl` the summary as advocate and challenger on a completed exchange → identical JSON

  > **Agent-automatable**: Yes — bearer-token curl for both users.

  ```bash
  ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
  ADV=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
    -H "Content-Type: application/json" -d '{"email":"user01@e.pl","password":"pwd123!"}' | jq -r .access_token)
  CHA=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
    -H "Content-Type: application/json" -d '{"email":"user02@e.pl","password":"pwd123!"}' | jq -r .access_token)
  curl -s "http://localhost:4321/api/debates/$DEBATE_ID/summary" -H "Authorization: Bearer $ADV" | jq .  # replace $DEBATE_ID
  curl -s "http://localhost:4321/api/debates/$DEBATE_ID/summary" -H "Authorization: Bearer $CHA" | jq .
  # Expected: both 200 with identical commonGround / openDivergences / unresolved arrays
  ```

### Phase 5: Summary UI — read-only panel

#### Automated
- [ ] 5.1 Type check passes: `npx astro check`
- [ ] 5.2 Build passes: `npm run build`

#### Manual
- [ ] 5.3 Both parties see the page (read-only) + summary button on a completed round_count=1 exchange

  > **Agent-automatable**: No — browser visual check for both user sessions.

- [ ] 5.4 Summary button hidden/disabled before round 1 completes, appears once the gate is met

  > **Agent-automatable**: No — browser visual check across the gate boundary.

- [ ] 5.5 Panel renders three buckets with correct gap labels, no console errors

  > **Agent-automatable**: No — visual + devtools console inspection.

---

## Shifts during implementation

> Recorded 2026-06-11, during Phase 1. These deviate from the plan as written above; the originating bullets in "What We're NOT Doing" are struck through and point here.

### 1. Mini-turn (FR-019) pulled forward into Phase 1

The final-round mini-turn — planned for S-05 — was implemented now rather than deferred, because the round-close work touched the same `submit_turn` branch and it was cheaper to land the routing once than to recreate the function again in S-05.

- The mini-turn is **always enabled** — there is no opt-in flag. One new runtime column on `exchanges`: `in_mini_turn`. It is still required (rather than a derived formula) because `current_turn='challenger' AND current_round=round_count` cannot distinguish the *initial* challenger turn from the mini-turn on a `round_count=1` exchange.
- New SECURITY DEFINER helper `can_add_content_as_current_actor` — like `can_write_as_current_actor` but the challenger branch also requires `NOT in_mini_turn`. Marks keep `can_write_as_current_actor`, so the challenger can still mark during the mini-turn.
- `submit_turn` advocate-final-round branch always enters the mini-turn (flip to challenger + `in_mini_turn=true`); the exchange completes only on the challenger's closing mini-turn submit (`status='completed'`, `in_mini_turn=false`), never directly on the advocate's submit. The regular challenger branch flips to advocate.

### 2. Write-immutability on close (FR-019/FR-027) implemented now

Planned as a deferral (`completed` was to be "purely the summary-gate signal"). Instead, `nodes`/`relations` `INSERT`/`UPDATE`/`DELETE` were all turn-gated via the two-branch pattern (pre-exchange owner branch **or** `can_add_content_as_current_actor`). Net effect:

- **Pre-invite only**: the owner edits freely until an exchange exists.
- **`pending` invite locks the map** — the owner can no longer edit once a challenger is invited (the map is the basis the challenger is deciding on). A `declined` exchange does *not* lock (advocate may revise and re-invite).
- **During an accepted exchange**: only the current-turn actor may write their own content; no one writes on the other party's turn; the challenger is frozen during the mini-turn.
- **A `completed` exchange is fully immutable.**

This is a tightening beyond the original scope: `UPDATE`/`DELETE` were previously `author_id`-only and ungated by turn.

### 3. Migration consolidation

The three working June-11 migrations were consolidated to **two** before commit (all were untracked/local-only, so safe to rewrite):

- `20260611000001_add_completed_status.sql` — unchanged (enum value-add must be its own migration).
- `20260611000002_round_close_and_mini_turn.sql` — **new merged file** holding columns + helper + `submit_turn` (final mini-turn-aware form) + read-scope widening + write-scope tightening. Replaces the former `…_submit_turn_round_close.sql` and `…_mini_turn_extension.sql`, which were deleted. `submit_turn` is now defined exactly twice total (committed original `20260610000002` + this one), not three times.

### 5. Phase 2 implementation details (recorded during Phase 2)

#### ViewerContext widened to carry live exchange state

`ViewerContext` (`store.ts`) gained `inMiniTurn: boolean` and `isCompleted: boolean`. Both are populated by `deriveViewer` (server-initial) and kept live by `submitTurn` in the store, which now reads the authoritative row returned by `apiSubmitTurn` and patches all three turn fields (`isMyTurn`, `inMiniTurn`, `isCompleted`) in one `set(...)` call rather than the previous blanket `isMyTurn: false`. This lets the actor's own header update in place — mini-turn opening, or exchange completing — without a page reload.

#### TurnGateDetail mirrors ViewerContext's new flags

`TurnGateDetail` (`MapEditor.tsx`) gained matching `isMiniTurn` and `isCompleted` fields so `TurnBar` can react to them from the live event stream (not just from server-initial props). `computeTurnGate` passes both through from the viewer.

#### TurnBar subscribes for both parties; props are server-initial only

`TurnBar` now subscribes to `wvmap:turn-gate` for both `advocate` and `challenger` (no `isChallenger` gating removed — there was never a `viewerRole !== "challenger"` guard in `TurnBar`; that guard was in `MapEditor.computeTurnGate`). The `isCompleted` and `isMiniTurn` props from the page serve as server-initial fallbacks; the live gate values override them once the first broadcast arrives.

#### getExchangeStatus widened for the board poll

`getExchangeStatus` (`repository.ts`) now selects `current_turn` and `in_mini_turn` alongside `status` and exposes them on `ExchangeStatus`. The board's turn-flip poll (which calls `getExchangeStatus`) can now detect a flip and re-hydrate without a full `getDebateExchange` round-trip.

#### `currentRound` threaded through the gate so the header counter updates live

The header's `n/round_count` counter was previously a static server-rendered prop on `TurnBar` (`currentRound={exchange.currentRound}`) — it never moved after page load, so the counterpart kept seeing a stale round number after a submit advanced the round. `currentRound` now flows through the same live path the turn/mini-turn/completed flags use:

- `ExchangeStatus` (`repository.ts`) selects and returns `current_round`, so the board poll payload carries it.
- `ViewerContext` (`store.ts`) gained `currentRound`, populated by `deriveViewer` (server-initial) from `exchange.currentRound`.
- `TurnGateDetail` (`MapEditor.tsx`) gained `currentRound`; `computeTurnGate` passes it through from the viewer.
- The `MapEditor` counterpart-sync poll added `currentRound` to its response type and to the divergence check, so a round advance patches `viewer.currentRound` (alongside `isMyTurn`/`inMiniTurn`/`isCompleted`) and re-broadcasts the gate — no reload.
- `TurnBar` reads `gate?.currentRound ?? currentRound` (live gate value, falling back to the server-initial prop) in both the active and completed render paths.

The submitter's own seat updates via `submitTurn`'s response path; the counterpart updates via the 1s poll — the same split that already governed the turn flip. Unit coverage: a `currentRound` passthrough case added to `computeTurnGate.test.ts` (the no-viewer gate now also asserts `currentRound: 1`).

### 6. Turn-flip sync: reload replaced by state patch + reconcile (recorded during Phase 2)

The counterpart-sync poll in `MapEditor` previously called `window.location.reload()` when it detected a turn-state divergence from the server. This caused a full-page flicker. The approach was replaced with a two-step in-place update:

1. **Viewer state patched immediately** — `useStore.setState({ viewer: { ...v, isMyTurn, inMiniTurn, isCompleted } })` applies the authoritative turn flags the instant the poll detects a change. The `broadcastTurnGate` effect fires on the next render and pushes a fresh `TurnGateDetail` to `TurnBar`, so the header updates with no reload.
2. **`reconcileFromServer()` called after** — fetches the counterpart's new nodes, relations, and marks (added during their turn) and applies them atomically to the store. Without this the graph would be stale: the turn gate would show wrong counts and the counterpart's new nodes would be invisible.

`reconcileFromServer` was extended to fetch graph + marks in parallel (`Promise.all([apiGetGraph, apiGetMarks])`) and apply both in one `setState`. This made it a true "full debate resync" primitive — all existing callers (conflict recovery, mutation failure) now also refresh marks for free.

Supporting additions:
- `GET /api/debates/[id]/marks` — new endpoint alongside the existing `POST`; calls `getDebateMarks` under RLS, returns `nodeId → stance` map as JSON.
- `apiGetMarks(debateId)` in `persistence.ts` — thin fetch wrapper, same shape as `apiGetGraph`.
- Unit test mock factories for `@/components/debate/persistence` in `reconcileFromServer.store.test.ts`, `optimisticReconcile.store.test.ts`, `duplicateRelation.store.test.ts` updated to include `apiGetMarks`, `apiUpsertMark`, and `apiSubmitTurn` (all missing from the hermetic stubs, which would have caused the tests to blow up at runtime once `reconcileFromServer` called the new function).

### 7. Seed layout tweak (recorded during Phase 2)

Four challenger seed nodes in `supabase/seed.sql` were repositioned (x/y coordinates only, no content or schema change) so the challenger's counter-structure renders without overlapping the advocate's nodes on the climate-debate fixture. Cosmetic; unrelated to turn logic.

### 4. DB types regeneration command

`src/db/database.types.ts` must be regenerated with `npm run db:types` (pins the `graphql_public,pgbouncer,public,storage` schema set) — hand-editing or partial MCP output drops the `storage` schema and desyncs `Database` from `Constants`. A rule to this effect was added to `CLAUDE.md` (Code style).

### Verification at time of recording

`npx supabase db reset` clean · `npx astro check` 0 errors · `npm run test:integration` 37/37 pass. (Phase 1 automated items 1.1–1.4 hold for the consolidated migration; the new immutability/mini-turn behavior is not yet covered by dedicated tests — a gap to close when Phase 1 tests are revisited.)
