---
date: 2026-06-10T18:05:27+02:00
researcher: bartoshqr
git_commit: e1498a090f999bcaf1dbf8ba58ec6c398d5047f5
branch: develop
repository: cothi10xdevs
topic: "S-04 first-divergence-summary — advocate response, round-1 completion, deterministic divergence summary"
tags: [research, codebase, exchange, marks, turn-machine, divergence-summary, north-star]
status: complete
last_updated: 2026-06-10
last_updated_by: bartoshqr
---

# Research: S-04 `first-divergence-summary` (the north star)

**Date**: 2026-06-10T18:05:27+02:00
**Researcher**: bartoshqr
**Git Commit**: e1498a090f999bcaf1dbf8ba58ec6c398d5047f5
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

Ground the implementation of roadmap slice **S-04** (`first-divergence-summary`):
the advocate marks every challenger statement, adds their own nodes/relations,
submits to **complete round 1**, and either party triggers the **deterministic
divergence summary** (common ground / open divergences / unresolved), private to
the pair. PRD refs: US-03, FR-015, FR-016, FR-017, FR-018, FR-020, FR-021.

Focus (per scoping): (1) the advocate-side turn/mark machine as a **mirror** of
the just-shipped S-03; (2) the **round-completion** gate that unlocks the summary;
(3) the **divergence summary algorithm** oracle.

## Summary

**S-03 (`challenger-first-turn`) was built deliberately symmetric, so the
advocate turn is mostly already wired at the data + RLS layer.** The genuinely
new surface for S-04 is small and concentrated:

1. **One DB delta**: `submit_turn` must increment `current_round` when the
   advocate submits (an explicit `TODO (S-04)` already marks the exact spot).
   Everything else in the turn machine — actor resolution, the mark-completeness
   gate, the write RLS (`can_write_as_current_actor`), the repository
   `submitTurn`, both API endpoints — is **actor-neutral and reused free**.
2. **Frontend un-stubbing**: three challenger-hardcoded spots (`TurnBar` advocate
   branch, `MapEditor.computeTurnGate`, and the single-marker `marks` store map)
   must be generalized to the advocate / two-marker case.
3. **A net-new summary feature** (greenfield — no scaffolding exists): a
   gate keyed on `current_round >= 2` ("≥1 complete round", FR-018), a pure
   classification function over `(statement_type, counterpart stance)`, an
   endpoint, and a read-only UI.

Two **oracle ambiguities** must be resolved with the user before tests assert
behaviour: the meaning of "**mutually** Agreed" (FR-020), and the missing
**Rebuttal** gap sub-type (FR-020/§factual-vs-values). Neither blocks the bucket
classification — only the labels.

> ⚠️ **Sequencing pin**: the summary gate (`current_round >= 2`) is only correct
> *after* the `submit_turn` round-increment ships. Today `current_round` never
> leaves 1, so the gate would always be false. **The increment and the gate must
> land together in S-04.**

## Detailed Findings

### Area 1 — Advocate turn machine (mirror of S-03)

The whole data + authorization layer is already symmetric. **Role is never a
column** — it is derived by comparing `author_id` / `auth.uid()` to
`exchange.advocate_id` / `challenger_id`. That single design pivot is what makes
the mirror cheap.

**Schema** (`supabase/migrations/20260609000001_create_exchanges.sql:13-32`):
- `current_turn public.turn_actor` (enum `('challenger','advocate')`, line 9),
  default `'challenger'` (line 22).
- `current_round int default 1` (line 21), `round_count int` (line 20, range
  `[1,5]` check line 27), `current_round between 1 and round_count` (line 29).
- `status public.exchange_status` = `('pending','accepted','declined')` (line 8).
  **No `completed`/`closed`/`expired` value, no per-turn submission ledger.**
- Mirrored in `src/db/database.types.ts:96-102`.

**`marks`** (`supabase/migrations/20260610000001_create_marks_and_authorship.sql:24-39`;
types `src/db/database.types.ts:137-167`): columns `node_id`, `marker_id` (mark
author), `stance public.mark_stance` = `('agree','challenge','abstain')` (line
20), `valid boolean default true` (line 36), `debate_id`. Unique key
`(node_id, marker_id)` (`marks_node_marker_unique`, line 38). **No `kind` column,
no per-round stamp.** `nodes.author_id` / `relations.author_id` are the sole
write-ownership columns.

**`submit_turn` RPC** (`supabase/migrations/20260610000002_submit_turn_rpc.sql:18-104`,
`SECURITY DEFINER`, **`RETURNS SETOF`** — the 404 contract):
- Caller resolution is symmetric (lines 34-42): `(challenger_id AND
  turn=challenger) OR (advocate_id AND turn=advocate)`.
- Next turn is **derived, not hardcoded** (lines 50-58): challenger→advocate,
  else advocate→challenger; other-party id derived from the row.
- Completeness gate (FR-011/FR-015) is **actor-neutral** (lines 60-84): counts
  `statement` nodes authored by the *other* party as `v_total`, counts the
  caller's distinct **valid** marks on them as `v_marked`, raises
  `INCOMPLETE_MARKS` (`errcode = 'P0001'`) if `v_marked < v_total`.
- **The UPDATE flips `current_turn` only (lines 94-97) — it does NOT advance the
  round and sets no terminal status.** The one S-04 delta is documented inline at
  **lines 89-93**: add `current_round = current_round + 1` guarded by
  `when v_next_turn = 'challenger'` (i.e. when the advocate's submit closes the
  round), in a new migration that drops + recreates the function.

**RLS helpers & write policies** (`...create_marks_and_authorship.sql`):
- `can_write_as_current_actor(p_debate_id)` (lines 76-93, `SECURITY DEFINER
  STABLE`) — **the generic turn gate, already covers both actors**:
  `(challenger_id = uid AND current_turn='challenger') OR (advocate_id = uid AND
  current_turn='advocate')`. No separate advocate helper exists by design.
- `is_accepted_challenger(p_debate_id)` (lines 54-67) — challenger-specific
  **read** scope for `marks_select` (line 196); the advocate reads via the owner
  branch (lines 192-195). No advocate equivalent is needed unless a new
  advocate-only read path appears.
- `nodes_insert` (lines 110-128) / `relations_insert` (lines 151-169): branch 1
  = pre-exchange owner free-build; branch 2 = `can_write_as_current_actor(...)`.
  **The advocate-on-advocate-turn insert path already exists.**
- `nodes_update/delete`, `relations_update/delete` (lines 136-182):
  `author_id = auth.uid()` only — each party edits only their own content.
- `marks_insert` (lines 206-216) / `marks_update` (lines 220-231):
  `marker_id = uid` AND `can_write_as_current_actor(...)` AND target is a
  `kind='statement'` node authored by `author_id <> uid`. Works for the advocate
  marking challenger statements with **no change**.

**Verdict — nothing blocks the advocate at the DB layer.** When
`current_turn='advocate'`, the advocate can already INSERT nodes/relations and
mark challenger statements through existing RLS. The advocate is blocked only by
the **frontend** (static UI) and the missing round increment.

**Repository / API (actor-agnostic, reuse free):**
- `submitTurn(supabase, exchangeId)` — `src/lib/exchange/repository.ts:207`;
  maps `P0001`→`ConflictError` (409) line 213, null→404 line 216.
- `upsertMark({supabase,debateId,nodeId,markerId,stance})` —
  `src/lib/mark/repository.ts:43`; upserts on `(node_id,marker_id)` line 48.
- `getDebateExchange(...)` — `src/lib/exchange/repository.ts:144`; already
  surfaces `currentTurn` / `currentRound` for both sides.
- `POST /api/debates/[id]/marks` (`src/pages/api/debates/[id]/marks.ts:7`,
  `markerId: user.id`) and `POST /api/exchanges/[id]/submit-turn`
  (`src/pages/api/exchanges/[id]/submit-turn.ts:5`) — both `withAuth`, no role
  hardcoded. Node/relation CRUD likewise.

**Frontend — where the challenger-hardcoding lives (MUST extend):**
- `src/components/debate/store.ts`: `ViewerContext` (lines 33-38) is
  parameterized; `deriveViewer` computes `isMyTurn = currentTurn === viewerRole`
  (`src/lib/debate/viewer.ts:47`) — symmetric. `canEditNode` / `isMarkableNode`
  / `canMarkNode` / `submitTurn` are actor-neutral (lines 771-824;
  `isMarkableNode` comment line 795 literally says "symmetric for challenger
  (S-03) and advocate (S-04)").
- **`marks` store map** (`store.ts:78`, `Partial<Record<string, MarkStance>>`)
  and **`getDebateMarks`** (`src/lib/mark/repository.ts:29`, returns
  `node_id → stance`) are **single-marker**. Round 1 had one marker so
  `node_id` alone was unambiguous; with both parties marking, S-04 must key/filter
  by `marker_id` (or `node_id → {markerId: stance}`).
- **`MapEditor.computeTurnGate`** (`src/components/debate/MapEditor.tsx:49-61`)
  is **hardcoded to challenger** (line 55 early-returns unless
  `viewerRole === "challenger"`; line 58 counts only advocate statements). S-04
  must generalize it to count the *counterpart's* statements for either actor.
  Note: `ViewerContext` has `advocateId` but **no `challengerId`** — add the
  counterpart id, or compute "not mine" the way `isMarkableNode` does.
- **`TurnBar`** (`src/components/debate/TurnBar.tsx`): the advocate button is a
  disabled placeholder (`isChallenger` gate line 22; `useEffect` early-returns
  for non-challenger line 26; "comes in S-04" labels lines 47-54). S-04 makes the
  advocate submit functional + gate-subscribed.
- `src/pages/debates/[id].astro:62-91` **already mounts** an advocate `TurnBar`
  (`viewerRole="advocate"`, `isMyTurn={currentTurn==="advocate"}`); only
  TurnBar's internal advocate branch is inert.

### Area 2 — Round-completion + summary-trigger gate

**There is no "round complete" flag and no submission ledger.** Completion is
implicit in the `(current_round, current_turn)` pair advancing.

- `openExchange()` (`src/lib/exchange/repository.ts:24-78`) plain-inserts the
  exchange (no create RPC) with `round_count: input.roundCount` (lines 62-72) and
  relies on DB defaults: `current_round=1`, `current_turn='challenger'`,
  `status='pending'`. `roundCount` validated against `ROUND_COUNT = {min:1, max:5,
  default:3}` (`src/lib/exchange/constants.ts:3`), mirrored by DB check
  `exchanges_round_count_range`.
- After the challenger submits round 1, the exchange sits at
  `current_round=1, current_turn='advocate'`. After **S-04 adds the increment**,
  the advocate's submit flips to `current_turn='challenger'` **and** bumps
  `current_round` to 2.
- **The only persistent "≥1 complete round" signal is therefore
  `current_round >= 2`** (equivalently `> 1`). No status value can express it —
  a mid-debate and a rounds-exhausted exchange are both just `'accepted'`.
- This predicate satisfies FR-018 "after close" **for free** (the counter is
  monotonic, survives any future close) and correctly stays false on the
  early-close-before-round-1 path (`current_round` only advances on a real
  advocate submission). **The gate must key on `current_round`, never on
  `status`.**

**Close / immutability machinery does not exist** (no `closed`/`expired` status,
no `closed_at`, no 7-day timer — confirmed by grep across migrations + exchange
lib/API). That is S-05. The S-04 gate must not assume any of it.

### Area 3 — Divergence summary algorithm (oracle)

**No summary code exists** — grep for `summary|divergence|crux|common ground`
hits only landing-page marketing copy
(`src/components/landing/HowItWorksSection.astro:128-130`,
`HeroSection.astro:18`). `src/lib/` has `debate/`, `mark/`, `exchange/` — no
`summary/`. Genuinely greenfield.

**Classification (the buckets) — FR-020 (`prd.md:153`), US-03 (`prd.md:75`):**
each statement gets exactly one bucket from its **single counterpart mark** (the
author never marks their own node; RLS forbids it —
`...create_marks_and_authorship.sql:206-216`):

| Counterpart's stance | Bucket |
|----------------------|--------|
| `agree` | common ground |
| `challenge` | open divergence |
| `abstain` | unresolved positions |

- Advocate statements are classified by the **challenger's** mark (FR-011);
  challenger statements by the **advocate's** mark (FR-015, new in S-04). The two
  marked sets are disjoint — a node is never marked twice.
- Because the summary is gated on a **complete round** and `submit_turn` enforces
  the completeness gate, **every counterpart statement is marked** at summary
  time — no unmarked statement can reach the S-04 summary. (FR-019's "default
  unmarked to Abstain" is close-time / S-05, not relevant here.)
- For S-04 round 1 **every mark is `valid = true`** (the S-05 invalidation
  trigger is not wired — `...create_marks_and_authorship.sql:234`). The summary
  should still filter `valid = true` for forward-compatibility (mirrors
  `submit_turn`'s `m.valid = true`), but it is a no-op in round 1.

**Factual vs values sub-classification — applies only to the `challenge`
(open-divergence) bucket (`prd.md:190`):**

| statement_type | gap label |
|----------------|-----------|
| `source`, `data`, `backing` | factual gap |
| `warrant`, `claim` | logical / premise (values) gap |
| `rebuttal` | **undefined in PRD — Open Question 2** |

- AND/OR **connectives carry no mark** and are excluded from classification
  entirely (`prd.md:190`; mark RLS forbids non-statement nodes; `submit_turn`
  counts only `kind='statement'`).
- common-ground (agree) and unresolved (abstain) buckets get **no** gap label.

**Privacy (FR-021, `prd.md:155`):** "Statements, relations, marks, **summary**"
visible only to the pair. Existing SELECT RLS already scopes marks
(`...create_marks_and_authorship.sql:190-197`), nodes, relations, debates to the
pair. **Placement decides whether the summary inherits this**: a TS repository fn
using the RLS-on (anon-key) client inherits pair-scoping automatically (like
`getDebateMarks`); a `SECURITY DEFINER` RPC bypasses RLS and must re-check
membership itself (as `submit_turn` does, lines 34-42); a `SECURITY INVOKER` RPC
inherits RLS.

**Determinism + NFR:** pure function of `(statement_type, counterpart stance,
valid)`, O(nodes + marks) — a single linear pass, trivially within the 10s NFR
(`prd.md:179`; `roadmap.md:180`). No AI (FR-020 `prd.md:153-154`).

## Architecture Insights

- **Derive role, don't store it.** The whole turn machine works because role is
  computed from `author_id` vs `advocate_id`/`challenger_id`. Any S-04 code
  (gate, summary) should follow suit — parameterize by id, never branch on a
  hardcoded `"challenger"`/`"advocate"` literal. (`lessons.md` "design for
  extension".)
- **Suggested summary split** (satisfies both the repository-only lesson and
  unit-testability): a thin **pair-scoped repository fn** fetches nodes + valid
  marks under RLS, and a **pure `classifyDivergence(...)` TS function** in
  `src/lib/summary/` applies the §Area-3 oracle. Pure classification is
  unit-testable against the oracle; data access stays RLS-scoped. (Trade-off
  surfaced, not decided — see Open Questions / hand-off to `/10x-plan`.)
- **SETOF for any new RPC.** If S-04 adds a summary RPC, declare it
  `RETURNS SETOF` so an unknown exchange id yields `[]` → real `null` → 404
  (`lessons.md` §RETURNS SETOF; the lived `patch_node`/`submit_turn` precedent).
- **The round increment is the linchpin.** It is the only thing that moves
  `current_round` off 1, and the summary gate depends on it. Ship them together.

## Code References

- `supabase/migrations/20260609000001_create_exchanges.sql:8-32` — exchange enums
  + round/turn columns; status has no terminal value.
- `supabase/migrations/20260610000001_create_marks_and_authorship.sql:20-39` —
  mark stance/valid, `(node_id,marker_id)` unique key.
- `supabase/migrations/20260610000001_create_marks_and_authorship.sql:54-93` —
  `is_accepted_challenger` + `can_write_as_current_actor` (generic turn gate).
- `supabase/migrations/20260610000001_create_marks_and_authorship.sql:206-231` —
  marks INSERT/UPDATE WITH CHECK (statement-only, other-party, turn-gated).
- `supabase/migrations/20260610000002_submit_turn_rpc.sql:18-104` — `submit_turn`;
  **`:89-93` the S-04 round-increment TODO**; `:94-97` the turn-flip-only UPDATE.
- `src/lib/exchange/repository.ts:24-78` — `openExchange` (round defaults);
  `:144` `getDebateExchange`; `:207` `submitTurn`.
- `src/lib/mark/repository.ts:29-48` — `getDebateMarks` (single-marker) +
  `upsertMark`.
- `src/lib/debate/viewer.ts:47` — `isMyTurn = currentTurn === viewerRole`.
- `src/components/debate/store.ts:33-38, 78, 771-824` — ViewerContext, marks map,
  capability methods.
- `src/components/debate/MapEditor.tsx:49-61` — `computeTurnGate` (challenger-
  hardcoded).
- `src/components/debate/TurnBar.tsx:19-54` — advocate placeholder branch.
- `src/pages/debates/[id].astro:62-91` — advocate TurnBar already mounted.
- `src/db/database.types.ts:96-102, 137-167, 372-384` — generated enums/rows.
- `context/foundation/prd.md:131,141,147-155,179,190` — FR-011/015/017/018/020/
  021 + the type→gap paragraph.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-challenger-first-turn/plan.md:108-114` — "
  `can_write_as_current_actor` (generic turn gate — also covers S-04 advocate
  side, no policy change needed) … S-04 needs no policy change for any of these
  tables."
- `context/archive/2026-06-09-challenger-first-turn/plan.md:149-158` — mark grain
  is one mutable row per `(node_id, marker_id)`; "sound **only if** S-04's
  divergence summary reads **current** mark state, not per-round history — confirm
  when S-04's summary input contract is pinned." → S-04 confirms: current state
  only (round 1 ⇒ all valid).
- `context/archive/2026-06-09-challenger-first-turn/reviews/plan-review.md:47-51` —
  blind spot flagged: "Exact inputs S-04's divergence algorithm consumes …
  depends on S-04 summary contract, not yet pinned." → pinned in §Area 3 here.
- `context/archive/2026-06-09-challenger-first-turn/plan.md:449` — "Round-1-only —
  two stances per node (both parties marking) is S-04" (the store single-marker
  assumption to lift).
- `supabase/migrations/20260610000002_submit_turn_rpc.sql:10-13` — "Symmetric
  actor design … works for both challenger-submits (S-03) and advocate-submits
  (S-04) without modification."
- `context/archive/2026-06-08-invite-and-open-exchange/` — exchange has stable
  `advocate_id` / `challenger_id` FKs; no `author_role` column.

## Related Research

- `context/changes/testing-persistence-floor/research.md` — Phase 1 test floor;
  the integration fixture (`seedDebate`, two-user clients) S-04 tests extend.
- Test-plan §3 Phase 4 (`context/foundation/test-plan.md:86,92-97`) is **gated on
  S-04 + S-05 shipping**; Phase 5 e2e (build→invite→mark→summary) waits for S-04.

## Open Questions

1. **"Mutually Agreed" semantics (FR-020, `prd.md:153`/`:39`).** A literal
   per-node "both parties agreed" reading is **impossible** under the schema (a
   node is markable only by its counterpart, never twice). Strong evidence
   ("mutual" = graph-wide symmetry; each statement bucketed by its one
   counterpart mark) but the **whole algorithm pivots on this** — confirm with
   the user before a test asserts it. Recommended reading: classify each
   statement by its single counterpart mark.
2. **Rebuttal gap sub-type (`prd.md:190`).** The factual-vs-values map omits
   `rebuttal`. A contested Rebuttal is still unambiguously an **open divergence**
   (only the factual/values *label* is undefined). Do not guess — confirm whether
   Rebuttal is "logical/premise", "factual", or intentionally unlabeled.
3. **Summary placement** (pure TS fn + repository read vs. RPC) — trade-off
   surfaced in §Architecture Insights; decision belongs to `/10x-plan`.
4. **Round-completion detection** — recommended `current_round >= 2` (no new
   column). Confirm no future need for per-party submission timestamps before
   S-05 (the round increment makes the counter the single source of truth).

## Next step

Run `/10x-plan s04` to decompose into ordered phases. Suggested spine:
(1) `submit_turn` round-increment migration; (2) frontend advocate-turn
un-stubbing + two-marker store/repository; (3) summary gate + pure
`classifyDivergence` + repository read; (4) summary endpoint; (5) summary UI;
(6) integration tests (Test-plan Phase 4 unlocks here). Resolve Open Questions 1
& 2 with the user first — they shape the summary assertions.
