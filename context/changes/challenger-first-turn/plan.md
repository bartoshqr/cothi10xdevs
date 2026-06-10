# Challenger Marks Statements and Submits the First Turn — Implementation Plan

## Overview

Roadmap slice S-03. Build the net-new three-state **mark** model (Agree / Challenge / Abstain) and the
challenger's first-turn flow end-to-end: an accepted challenger marks every advocate Statement, adds their
own Statements / Sources / connectives with directed relations, and submits their turn — which flips the
exchange's `current_turn` from `'challenger'` to `'advocate'`. This is the input that feeds the divergence
summary (S-04), so correctness of the mark model and the submit gate outweighs UI polish.

## Current State Analysis

What exists today (from `research.md`):

- **No marks anything.** No table, enum, column, RLS, repository, schema, API, store, or UI. 100% net-new.
- **Authorship exists; role does not.** `nodes` and `relations` already carry `author_id` (set from `user.id`).
  No `author_role` column.
- **Turn machine is structural but unwritable.** `exchanges` has `current_round`, `current_turn`
  (enum `turn_actor`), `status`. A fresh accepted exchange sits at `current_round=1, current_turn='challenger'`.
  But a column-level grant locks writes to `(status, responded_at)` only
  (`supabase/migrations/20260609000001_create_exchanges.sql:75-76`) — `current_turn`/`current_round` are
  **physically not writable** by any authenticated client. There is no "submit turn" endpoint.
- **Write policies are owner-gated.** `nodes_insert` / `relations_insert` require debate ownership **and**
  `author_id = auth.uid()`. UPDATE/DELETE require owner + author. An accepted challenger passes the author
  clause but fails the owner gate, so **only the advocate can write today**.
- **The canvas knows no identity.** `rowsToGraph` drops `author_id`; node `data` carries no author/role; the
  store/`MapEditor` have no "who am I"; `canEdit` is a single boolean computed server-side as
  `isOwner && existingExchange === null` (`src/pages/debates/[id].astro:64-67`), so a challenger is **fully
  read-only** today.

Two lessons apply directly (`context/foundation/lessons.md`): **RLS cross-table recursion (42P17 →
SECURITY DEFINER)** and **`RETURNS SETOF` for not-found**. Both will bite the new mark/turn write paths if
ignored.

## Desired End State

An accepted challenger, on their turn (`current_turn='challenger'`), can:

1. Mark every advocate **Statement** node Agree / Challenge / Abstain (connective AND/OR nodes carry **no**
   mark — `prd.md:190`). Marks persist incrementally as each is clicked.
2. Add their own Statements (any type), Source nodes, AND/OR connectives, and directed relations to any
   existing Statement — visually distinct (shaded) from advocate nodes.
3. **Not** edit or delete the advocate's nodes/relations (can only mark them).
4. Submit their turn only when **every advocate Statement is marked**; submission flips `current_turn` to
   `'advocate'` atomically.

Verify: integration suite asserts all four; manual curl + SQL confirm the gate rejects an incomplete mark
set and the turn flips on a complete one.

### Key Discoveries:

- Marks attach **only to Statement nodes**; AND/OR connectives carry no mark (`prd.md:190`).
- Round-1 gating = "every advocate Statement marked." Carry-over / invalidation is explicitly **S-05**
  (`change.md:36-37`, `prd.md:131`). Abstain counts as **unresolved**, not resolved.
- `is_debate_owner()` (`supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql:18-40`) is
  the canonical SECURITY DEFINER shape to mirror for `is_accepted_challenger()`.
- The column-level grant lock (`...create_exchanges.sql:75-76`) is why the turn flip must go through a
  definer RPC, not a client UPDATE.
- `patch_node` is SECURITY INVOKER (`...20260605000002:5`), so a relaxed `nodes_update` policy governs it
  automatically — no separate RPC change for edit permissions.
- Optimistic-UI + reconcile is the established frontend write pattern
  (`src/components/debate/store.ts:436-472`); marks follow it.

## What We're NOT Doing

- **No advocate marking** (FR-015) — that is S-04 (symmetric advocate side).
- **No divergence summary** (FR-018/FR-020) — forbidden before one complete round; S-04.
- **No carry-over / invalidation / mini-turn / orphaning** (FR-019, FR-026, US-04) — S-05.
- **No multi-round progression** beyond flipping to the advocate's turn — the advocate acting on that turn is S-04.
- **No 7-day inactivity / close path** (FR-019) — later.
- **No URL validation** for Source nodes (Open Question #2, deferred).

## Implementation Approach

Bottom-up vertical: DB schema + RLS first (the authorization layer where the real rules live), then the
atomic `submit_turn` RPC, then the thin backend module, then the frontend. Marks are stored **one mutable
row per (node, marker)** — re-marking updates stance in place; the submit gate is a simple count check
(`distinct marked advocate-statement nodes = count of advocate statements`). The turn flip + gate live
**server-side** in a single `submit_turn()` SECURITY DEFINER RPC (`RETURNS SETOF exchanges`), matching the
codebase's "atomic multi-effect → RPC" and "SETOF for not-found" conventions and sidestepping the column
grant lock. Author role is **inferred** at runtime — `node.author_id === debate.owner_id → advocate, else challenger` — no extra column; the frontend receives `advocateId` from the page, and the DB gate uses a single join to `debates`. Challenger writes are unlocked by widening node/relation **INSERT** to "owner OR accepted challenger"
(via `is_accepted_challenger()` definer helper to avoid 42P17) while **keeping `author_id = auth.uid()`** on
UPDATE/DELETE — that clause alone yields "edit only your own."

## Critical Implementation Details

- **42P17 recursion**: the widened node/relation INSERT `with check` must test exchange membership, which
  reads `exchanges` from within `nodes`/`relations` RLS while `exchanges`/`debates` read back — the same
  loop that threw 42P17 in S-02. Wrap the membership test in a SECURITY DEFINER helper
  (`stable`, `set search_path = public`, EXECUTE revoked from public/anon, granted to authenticated):
  `is_accepted_challenger` for read scope, `can_write_as_current_actor` (generic turn gate — also covers S-04
  advocate side, no policy change needed) for the write checks. Keep the read predicates as inline EXISTS.
- **Server-side turn gate (F1)**: node/relation INSERT and mark INSERT/UPDATE all gate on
  `can_write_as_current_actor` (during-exchange branch). Neither party can write after their turn has
  passed. The advocate is also blocked from inserting nodes/relations during the challenger's turn (symmetric
  enforcement). Turn enforcement is an RLS boundary, not just a UI lock. S-04 needs no policy change for
  any of these tables.
- **Column grant lock**: do **not** add `current_turn`/`current_round` to the `grant update` — the flip goes
  through `submit_turn()` (definer), so the lock stays maximally tight.
- **SETOF**: `submit_turn()` must be `RETURNS SETOF public.exchanges` so an unknown/forbidden exchange id
  yields `[]` → real `null` → 404, per the lesson. A bare composite would return an all-NULL row and 200.
- **No `author_role` column**: role is inferred from `author_id` vs `debate.owner_id` — no backfill, no
  new enum, no extra insert param. The frontend page passes `advocateId` (= `debate.owner_id`) into the store;
  the DB gate in `submit_turn` uses `JOIN debates d ON d.id = n.debate_id AND d.owner_id = n.author_id`.

---

## Phase 1: Mark schema, authorship & write RLS (DB)

### Overview

Add the `marks` table + `mark_stance` enum, the `is_accepted_challenger()` helper, widen node/relation
INSERT to accepted challengers, and add mark RLS + column grant. Regenerate `database.types.ts`.

### Changes Required:

#### 1. Mark schema migration

**File**: `supabase/migrations/<timestamp>_create_marks_and_authorship.sql` (new)

**Intent**: Introduce the three-state mark model and denormalized authorship, plus the write-permission
changes that let an accepted challenger contribute without being able to edit the advocate's content.

**Contract**:

- Enum `public.mark_stance as enum ('agree', 'challenge', 'abstain')`.
- Table `public.marks`: `id uuid pk default gen_random_uuid()`, `debate_id uuid not null references
  debates on delete cascade`, `node_id uuid not null references nodes on delete cascade`,
  `marker_id uuid not null references auth.users on delete cascade`, `stance public.mark_stance not null`,
  `created_at`, `updated_at`. **Unique `(node_id, marker_id)`** — one mutable mark per node per marker.
  Index on `(debate_id)` for gate counts.
  - **Grain decision vs change.md "per turn" (F2)**: S-03 deliberately stores **one mutable row per
    `(node, marker)`** with no round/turn column. change.md's "persist … per turn" is satisfied for round 1
    (the only round S-03 covers) because there is no prior turn to preserve; the gate is a simple count.
    This is sound **only if** S-04's divergence summary reads current mark state, not per-round history —
    confirm when S-04's summary input contract is pinned.
  - **Invalidation column (included in S-03)**: the table includes `valid boolean not null default true`.
    When one party changes a statement, the **other party's** mark on it is flipped `valid = false` (the
    counterpart invalidates, never the author), leaving the stance row intact for history/audit. The submit
    gate (S-03) already filters on `valid = true` marks. S-05 wires up the flip trigger — no schema change needed.
- `is_accepted_challenger(p_debate_id uuid) returns boolean` — SECURITY DEFINER, `stable`,
  `set search_path = public`; body mirrors `is_debate_owner`: `exists (select 1 from exchanges e where
  e.debate_id = p_debate_id and e.challenger_id = (select auth.uid()) and e.status = 'accepted')`. Revoke
  EXECUTE from public/anon; grant to authenticated. **Membership predicate (read scope) — turn-agnostic.**
- `can_write_as_current_actor(p_debate_id uuid) returns boolean` — SECURITY DEFINER, `stable`,
  `set search_path = public`; checks `status = 'accepted'` AND `(challenger_id = uid AND current_turn =
  'challenger') OR (advocate_id = uid AND current_turn = 'advocate')`. **Generic turn-gated write predicate
  used for both nodes/relations INSERT (during-exchange branch) and marks INSERT/UPDATE.** Covers S-03 and
  S-04 without any policy change. Revoke EXECUTE from public/anon; grant to authenticated.
- **Widen `nodes_insert` / `relations_insert`**: two-branch gate — `(owner EXISTS AND NOT EXISTS accepted
  exchange) OR can_write_as_current_actor(debate_id)`. Branch 1 preserves the advocate's pre-exchange
  map-building flow. Branch 2 enforces the turn boundary symmetrically for both parties once an exchange is
  active: advocate is blocked during the challenger's turn; challenger is blocked during the advocate's turn.
  S-04 needs no policy change. (Drop & recreate the existing policies.)
- **`nodes_update`/`nodes_delete`, `relations_update`/`relations_delete`**: drop the debate-owner gate, keep
  `author_id = (select auth.uid())`. This yields "edit only your own" for both parties.
- **Marks RLS** (`alter table marks enable row level security; revoke select on marks from anon`):
  - `marks_select`: a debate **member** (owner OR accepted challenger) can read all marks in the debate.
  - `marks_insert` / `marks_update`: `marker_id = (select auth.uid())` AND `can_write_as_current_actor`
    (generic turn-gate, covers both S-03 and S-04 without a policy change) AND the marked node is a
    **`kind = 'statement'`** node with `author_id <> auth.uid()` (counterpart's content only — connectives
    and own-party nodes excluded, F3). The statement-only + other-party rule is enforced via
    `exists (select 1 from nodes n where n.id = marks.node_id and n.kind = 'statement' and n.author_id <> uid)`,
    not just by the frontend hiding the control.
  - Column grant: `grant insert, update (stance, updated_at) on marks to authenticated` as appropriate;
    `marker_id`/`node_id` immutable after insert.
- No `marks_delete` policy in S-03 (deletion is part of S-05 invalidation/cascade; FK cascade handles node
  deletion).

> Snippet — the recursion-safe widened insert check (the part that closes the cross-table loop):
> ```sql
> -- nodes_insert (drop existing, recreate)
> with check (
>   author_id = (select auth.uid())
>   and (
>     -- Pre-exchange: owner builds map freely
>     (exists (select 1 from public.debates d
>              where d.id = nodes.debate_id and d.owner_id = (select auth.uid()))
>      and not exists (select 1 from public.exchanges e
>                      where e.debate_id = nodes.debate_id and e.status = 'accepted'))
>     -- During exchange: current turn actor
>     or public.can_write_as_current_actor(nodes.debate_id)
>   )
> )
> ```

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Keep generated types in sync so Zod enums and repositories type-check against the new table/enum.

**Contract**: Run the project's type-generation (MCP `generate_typescript_types` or
`npx supabase gen types`). New `marks` row/insert/update types, `mark_stance` enum, and the
`is_accepted_challenger` / `submit_turn` function signatures appear. File is in the ESLint ignore list, so no
lint impact.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Types regenerate without diff drift: `npx supabase gen types typescript --local` matches committed file
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- `marks` table, `mark_stance` enum, `is_accepted_challenger`, and `can_write_as_current_actor` exist with correct RLS.
- An accepted challenger can INSERT a node but cannot UPDATE an advocate node (RLS).
- After `current_turn` is flipped off `'challenger'`, an accepted challenger can no longer INSERT a node or
  upsert a mark (RLS via `can_write_as_current_actor`).

---

## Phase 2: `submit_turn()` RPC

### Overview

The atomic, server-side turn submission: validate the FR-011 completeness gate, flip `current_turn`, return
the updated exchange (or empty set → 404).

### Changes Required:

#### 1. `submit_turn` migration

**File**: `supabase/migrations/<timestamp>_submit_turn_rpc.sql` (new)

**Intent**: Provide the only write path to `current_turn`, gating it on mark-completeness so an incomplete
turn can never be submitted (closes the race the app layer can't).

**Contract**: `public.submit_turn(p_exchange_id uuid) returns setof public.exchanges` — SECURITY DEFINER,
`set search_path = public`. Logic:

- Resolve the exchange; if the caller is not its challenger, or `current_turn <> 'challenger'`, or
  `status <> 'accepted'` → return empty set (no row) so the handler maps to 404/409 appropriately.
- **Gate**: count advocate-authored **statement** nodes in the debate (identified by
  `JOIN debates d ON d.id = n.debate_id AND d.owner_id = n.author_id` — no `author_role` column needed);
  count distinct `(node_id)` marks by `auth.uid()` on those nodes. If marked < total → raise a typed error
  (SQLSTATE mapped to `ConflictError`/422) with message naming the unmarked count. (Connective nodes excluded —
  `kind = 'statement'`.)
- On pass: `update exchanges set current_turn = 'advocate' where id = p_exchange_id returning *`.
- Revoke EXECUTE from public/anon; grant to authenticated.

> The connective exclusion (`kind = 'statement'`) is load-bearing — marking is per Statement only.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Calling `submit_turn` with an incomplete mark set returns an error / no flip.
- Calling with all advocate statements marked flips `current_turn` to `'advocate'`.
- Calling with an unknown exchange id returns empty set (→ 404), not an all-NULL row.

---

## Phase 3: Backend module (marks repo/schema/constants + endpoints)

### Overview

Thin backend: a new `src/lib/mark/` module (constants, Zod schema, repository) plus two endpoints (mark
upsert, submit-turn), all via `withAuth`.

### Changes Required:

#### 1. Mark constants + schema

**File**: `src/lib/mark/constants.ts`, `src/lib/mark/schemas.ts` (new)

**Intent**: Define the stance vocabulary once (mirrored by DB enum) and validate mark inputs.

**Contract**: `constants.ts` exports `MARK_STANCES` (mirrors `mark_stance`, comment pointing at the DB enum,
per the centralize-limits lesson). `schemas.ts`: Zod enum derived from `Constants.public.Enums.mark_stance`;
`.strict()` body `{ nodeId: z.uuid(), stance: <enum> }`; exported inferred types.

#### 2. Mark repository

**File**: `src/lib/mark/repository.ts` (new)

**Intent**: Upsert a mark for the current user on a node, following the repository convention.

**Contract**: `upsertMark({ supabase, debateId, nodeId, markerId, stance })` → upsert on `(node_id, marker_id)`,
return the `marks` Row or throw `errors.ts` classes; map `23503` (FK, unknown node) → `NotFoundError`,
`23505` non-applicable (upsert), RLS-hidden → zero rows → `NotFoundError`.

#### 3. Mark upsert endpoint

**File**: `src/pages/api/debates/[id]/marks.ts` (new)

**Intent**: Let the challenger persist a single mark optimistically.

**Contract**: `POST` (or `PUT`) via `withAuth`: parse debate id + body (Zod), call `upsertMark`, return the
mark. Thin: parse + validate + one repository call. No new route needs adding to `PROTECTED_ROUTES` (API
routes are auth-gated via `withAuth`, not middleware redirect) — confirm against `src/middleware.ts`.

#### 4. Submit-turn endpoint

**File**: `src/pages/api/exchanges/[id]/submit-turn.ts` (new)

**Intent**: Activate the advocate's turn once the gate passes.

**Contract**: `POST` via `withAuth`: parse exchange id, call a `submitTurn({ supabase, exchangeId })`
repository fn that wraps the `submit_turn` RPC, `.maybeSingle()` null → `NotFoundError`, gate-failure
SQLSTATE → `ConflictError` (→ 409) or `ValidationError` (→ 422). Add `submitTurn` to
`src/lib/exchange/repository.ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `POST /api/debates/<id>/marks` upserts a mark (200) and is idempotent on re-mark (stance updates).
- `POST /api/exchanges/<id>/submit-turn` returns 409/422 when incomplete, 200 + flipped turn when complete.

---

## Phase 4: Frontend — identity, capability model, mark UI & shading

### Overview

Thread viewer identity + per-node author into the store, replace the single `canEdit` boolean with derived
per-node capabilities, add the mark control + challenger-node shading to `StatementNode`, and add the
submit-turn action.

### Changes Required:

#### 1. Thread viewer identity into the page → store

**File**: `src/pages/debates/[id].astro`, `src/components/debate/MapEditor.tsx`,
`src/components/debate/store.ts`

**Intent**: Give the canvas a notion of "who am I, what's my role, is it my turn" so capabilities and shading
are correct.

**Contract**: Page passes `viewerId` (`Astro.locals.user.id`), `viewerRole` ('advocate'|'challenger'|null),
`advocateId` (`debate.owner_id`), and `isMyTurn` (derived from the exchange's `current_turn` vs role) into
`MapEditor` props. Store holds a `viewer` context. `rowsToGraph` (`store.ts:103-129`) **keeps** `author_id`
on node `data`; author role is derived at render time as `node.data.author_id === advocateId ? 'advocate' : 'challenger'`.

#### 2. Capability model replaces `canEdit` boolean

**File**: `src/components/debate/store.ts`, `src/components/debate/MapEditor.tsx`

**Intent**: Encode the real per-node rules instead of one global flag.

**Contract**: Derive capabilities from `viewer` + node author: `canEditNode(node)` = node is mine && my turn;
`canMarkNode(node)` = node is a Statement authored by the other party && my turn; `canAddNodes` = my turn.
Mutators that currently early-return on `!canEdit` (`store.ts` CRUD) gate on the appropriate capability. The
old `canEdit`/`setCanEdit`/`wvmap:set-can-edit` path is generalized or replaced. Advocate-on-no-exchange path
must keep working (owner full edit when no exchange).

#### 3. Mark control + challenger shading on StatementNode

**File**: `src/components/debate/nodes/StatementNode.tsx`,
`src/components/debate/mapVisualLanguage.ts`, `src/components/debate/MapLegend.tsx`

**Intent**: Surface the three-state mark affordance (mirroring the existing role-badge dropdown pattern) and
shade challenger-authored nodes distinctly.

**Contract**: When `canMarkNode`, render an Agree/Challenge/Abstain control **inline inside the card,
below the body** — a slim bar with three buttons (`nodrag nopan`), no portal/dropdown. Current stance
highlighted; clicking calls `setMark`. Background paint (`StatementNode.tsx:269`) conditions on inferred
author role (`node.data.author_id === advocateId`) — challenger nodes get a distinct shade (light
gray/blue) instead of `var(--card)`. Add a `markStanceDescriptors` record to `mapVisualLanguage.ts`
(stance → label/color) consumed by node + legend. Connective nodes get **no** mark control.

#### 4. Optimistic persistence wrappers + submit button

**File**: `src/components/debate/persistence.ts`, `src/components/debate/store.ts`,
`src/components/debate/MapEditor.tsx`

**Intent**: Persist marks optimistically and add the turn-submit affordance with the gate surfaced in UI.

**Contract**: `persistence.ts` gets `upsertMark(debateId, nodeId, stance)` and `submitTurn(exchangeId)` thin
fetch wrappers. Store `setMark` action: apply locally → POST → reconcile / rollback + `reportError` on failure
(mirror `createStatementNode` `store.ts:436-472`). A "Submit turn" button (enabled only when all advocate
statements are marked — client mirror of the server gate; server remains source of truth) calls `submitTurn`;
on success the turn flips and the board becomes read-only for the challenger.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Challenger sees mark controls on advocate Statements (not connectives), can mark, marks persist on refresh.
- Challenger-authored nodes render with a distinct background shade.
- Challenger can add a node but the advocate's nodes show no edit/delete controls to them.
- Submit button is disabled until all advocate Statements are marked; after submit, the board locks.

---

## Phase 5: Integration tests + cookbook/plan sync

### Overview

Extend the two-user integration fixture to assert the mark model, write permissions, and turn flip against
**real RLS/DB** (the only layer that catches 42P17 and the column grant). Invert S-02's "no challenger write
yet" assertions. Update the test-plan cookbook.

### Changes Required:

#### 1. Mark + turn integration suite

**File**: `tests/integration/marks.test.ts` (new), update `tests/integration/exchange.test.ts`

**Intent**: Prove the FR-011 gate, edit-permission boundaries, and turn flip hold against real policies.

**Contract**: Using the two-user fixture (`getClientAsUser`, `seedDebate`, accepted-exchange helper), assert:
- Accepted challenger can INSERT a node/relation and `upsertMark` an advocate statement; **cannot** UPDATE or
  DELETE an advocate node/relation (RLS → zero rows / error).
- Challenger cannot mark a connective node (RLS rejects it via the `kind='statement'` check — F3) and
  cannot mark their own node.
- **Turn gate (F1)**: after `submit_turn` flips the turn to `'advocate'`, the challenger's node INSERT and
  mark upsert are rejected by RLS (`can_write_as_current_actor` returns false off-turn).
- `submit_turn` with an incomplete mark set fails (gate); with all advocate statements marked, flips
  `current_turn` → `'advocate'`.
- `submit_turn` on an unknown exchange id → empty set (not an all-NULL row).
- Update `exchange.test.ts:184-189,257-258` to reflect that challenger writes are now allowed.

#### 2. Cookbook + plan sync

**File**: `context/foundation/test-plan.md` (§6 cookbook)

**Intent**: Record the mark/turn testing recipe and the RLS pitfalls hit.

**Contract**: Add a §6 entry: integration-against-real-RLS recipe for marks + submit gate, noting the 42P17
helper and the SETOF not-found check as the two regressions guarded.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:integration` (or project equivalent) with local Supabase up.
- Unit/type/lint pass: `npx astro check && npm run lint`

#### Manual Verification:

- Cookbook entry reads clearly and names the two guarded regressions.

---

## Testing Strategy

### Unit Tests:

- Zod mark schema: rejects unknown stance, non-UUID nodeId (cheap, hermetic).

### Integration Tests (primary — real RLS/DB):

- Challenger write permissions (add allowed; edit/delete advocate content blocked).
- Mark upsert idempotency and member/other-party constraints.
- `submit_turn` gate (incomplete → fail; complete → flip) and SETOF not-found.

### Manual Testing Steps:

See per-phase Manual Verification in the Progress section below (curl + SQL, real seed values).

## Performance Considerations

The gate count is two indexed counts over one debate's nodes/marks — negligible. The `is_accepted_challenger`
definer is `stable` and hits the `exchanges(challenger_id)` / `(debate_id)` indexes.

## Migration Notes

- No `author_role` column — role is inferred from `author_id` vs `debate.owner_id`. No backfill needed.
- No round/turn column on `marks` (F2): one mutable row per `(node, marker)`. `valid boolean not null
  default true` is included in the S-03 schema; S-05 wires up the flip trigger — no further schema change needed.
- Two new migrations (Phase 1 schema, Phase 2 RPC); apply via `npx supabase db reset` locally and
  `npx supabase db push` for cloud.
- **S-04 must extend `submit_turn`**: the current RPC only flips `current_turn`. When the advocate
  submits, `current_round` must also increment (`current_round = current_round + 1`). Add this in a
  new S-04 migration that drops and recreates the function — the UPDATE needs
  `current_round = current_round + 1` guarded by `when v_next_turn = 'challenger'`. See the TODO
  comment in `20260610000002_submit_turn_rpc.sql`.

## References

- Research: `context/changes/challenger-first-turn/research.md`
- Change identity: `context/changes/challenger-first-turn/change.md`
- Lessons: `context/foundation/lessons.md` (42P17 → SECURITY DEFINER; RETURNS SETOF; centralize limits)
- Canonical helper: `supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql:18-40`
- Member predicate snippet: `supabase/migrations/20260609000001_create_exchanges.sql:89-103`
- Optimistic CRUD pattern: `src/components/debate/store.ts:436-472`
- Seed values: `supabase/seed.sql` (user01 advocate `…001`, debate `…010`, 5 statements `…011`–`…015`, AND `…016`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Mark schema, authorship & write RLS (DB)

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset`
- [x] 1.2 Types regenerate without drift: `npx supabase gen types typescript --local` matches committed file
- [x] 1.3 Type checking passes: `npx astro check`
- [x] 1.4 Linting passes: `npm run lint`

#### Manual

- [x] 1.5 `marks` table, `mark_stance` enum, and `is_accepted_challenger` exist with correct RLS

  > **Agent-automatable**: Yes — pure SQL via the local DB.

  ```sql
  -- Run against local Supabase (postgres superuser or service role).
  -- Expected: one row per object, RLS enabled on marks.
  select 'enum_stance' as obj, count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='mark_stance';
  select 'marks_rls'   as obj, relrowsecurity from pg_class where relname='marks';
  select 'fn_helper'   as obj, proname, prosecdef from pg_proc where proname in ('is_accepted_challenger','can_write_as_current_actor');
  ```

- [x] 1.6 Accepted challenger can INSERT a node but cannot UPDATE an advocate node (RLS, DB layer)

  > **Agent-automatable**: Yes — `set local role` + `request.jwt.claims` simulation, or via the integration fixture. The block below uses the seed users; user02 must be an accepted challenger of debate `…010` (create the exchange first via SQL).

  ```sql
  -- Setup: make user02 an accepted challenger of the seed debate (service role).
  insert into public.exchanges (debate_id, advocate_id, challenger_id, status, round_count, current_round, current_turn)
  values ('00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          'accepted', 1, 1, 'challenger')
  on conflict do nothing;

  -- As user02 (challenger): impersonate via JWT claims, then test RLS.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';

  -- Expected: SUCCEEDS (challenger inserts their own statement).
  insert into public.nodes (debate_id, author_id, kind, position_x, position_y, metadata)
  values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002',
          'statement', 100, 100, '{"statement_type":"data","title":"Challenger data"}');

  -- Expected: AFFECTS 0 ROWS (cannot edit advocate's root node …011).
  update public.nodes set metadata = metadata || '{"title":"hacked"}'
  where id = '00000000-0000-4000-8000-000000000011';
  reset role;
  ```

- [x] 1.7 Marks INSERT / SELECT / UPDATE respect RLS and column grant

  > **Agent-automatable**: Yes — JWT-claims impersonation. Assumes exchange from 1.6 setup exists (`current_turn='challenger'`). Run each block as a separate MCP/SQL call — (b) and (f) are expected to raise an error, which would abort any surrounding transaction.

  ```sql
  -- (a) INSERT mark on advocate statement …011 as challenger — Expected: 1 row inserted.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
  insert into public.marks (debate_id, node_id, marker_id, stance)
  values ('00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000011',
          '00000000-0000-4000-8000-000000000002', 'agree');
  reset role;
  ```

  ```sql
  -- (b) INSERT mark on connective node …016 — Expected: ERROR (RLS kind='statement' check rejects).
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
  insert into public.marks (debate_id, node_id, marker_id, stance)
  values ('00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000016',
          '00000000-0000-4000-8000-000000000002', 'agree');
  reset role;
  ```

  ```sql
  -- (c) SELECT as challenger — Expected: sees mark from (a), stance='agree'.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
  select node_id, marker_id, stance from public.marks
  where debate_id = '00000000-0000-4000-8000-000000000010';
  reset role;
  ```

  ```sql
  -- (d) SELECT as non-member (user03) — Expected: 0 rows.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
  select node_id, stance from public.marks
  where debate_id = '00000000-0000-4000-8000-000000000010';
  reset role;
  ```

  ```sql
  -- (e) UPDATE stance to 'challenge' (re-mark) — Expected: 1 row updated; verify stance flipped.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
  update public.marks set stance = 'challenge', updated_at = now()
  where node_id   = '00000000-0000-4000-8000-000000000011'
    and marker_id = '00000000-0000-4000-8000-000000000002';
  select node_id, stance from public.marks
  where node_id   = '00000000-0000-4000-8000-000000000011'
    and marker_id = '00000000-0000-4000-8000-000000000002';
  reset role;
  ```

  ```sql
  -- (f) UPDATE marker_id (not in column grant) — Expected: ERROR (RLS WITH CHECK marker_id = auth.uid() fires before column grant; same result).
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
  update public.marks set marker_id = '00000000-0000-4000-8000-000000000001'
  where node_id = '00000000-0000-4000-8000-000000000011';
  reset role;
  ```

### Phase 2: `submit_turn()` RPC

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — 72ce2c8
- [x] 2.2 Type checking passes: `npx astro check` — 72ce2c8
- [x] 2.3 Linting passes: `npm run lint` — 72ce2c8

#### Manual

- [x] 2.4 `submit_turn` rejects an incomplete mark set; flips turn on a complete one; SETOF on unknown id — 72ce2c8

  > **Agent-automatable**: Yes — SQL as the challenger (JWT-claims impersonation). Assumes the accepted exchange from 1.6 exists and no marks yet.

  ```sql
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';

  -- (a) No/partial marks → gate fails (raises error OR returns no flip — assert current_turn unchanged).
  select * from public.submit_turn('<exchange_id_from_1.6>');  -- replace with the exchange id created in 1.6

  -- (b) Mark all 5 advocate statements, then submit → flips to 'advocate'.
  -- Advocate statements = nodes where author_id matches debate.owner_id.
  insert into public.marks (debate_id, node_id, marker_id, stance)
  select '00000000-0000-4000-8000-000000000010', n.id,
         '00000000-0000-4000-8000-000000000002', 'agree'
  from public.nodes n
  join public.debates d on d.id = n.debate_id and d.owner_id = n.author_id
  where n.debate_id='00000000-0000-4000-8000-000000000010'
    and n.kind='statement'
  on conflict (node_id, marker_id) do update set stance=excluded.stance;

  select current_turn from public.submit_turn('<exchange_id_from_1.7>');  -- Expected: 'advocate'

  -- (c) Unknown id → empty set (no all-NULL row).
  select count(*) from public.submit_turn('00000000-0000-4000-8000-0000000000ff');  -- Expected: 0
  reset role;
  ```

### Phase 3: Backend module (marks repo/schema/constants + endpoints)

#### Automated

- [x] 3.1 Type checking passes: `npx astro check`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build passes: `npm run build`

#### Manual

- [x] 3.4 `POST /api/debates/<id>/marks` upserts a mark and is idempotent on re-mark

  > **Agent-automatable**: Yes — bearer token via the local auth endpoint + curl. Grab the local anon key once with `npx supabase status` (field `anon key`) and export it as `ANON`.

  ```bash
  ANON="<anon key from: npx supabase status>"   # replace once; stable per local stack
  TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d '{"email":"user02@e.pl","password":"pwd123!"}' | jq -r .access_token)

  # Upsert a mark on the advocate's data node (…012). Expected: 200 + mark row.
  curl -s -X POST "http://localhost:4321/api/debates/00000000-0000-4000-8000-000000000010/marks" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"nodeId":"00000000-0000-4000-8000-000000000012","stance":"challenge"}' | jq .

  # Re-mark same node 'agree' → idempotent update, still one row.
  curl -s -X POST "http://localhost:4321/api/debates/00000000-0000-4000-8000-000000000010/marks" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"nodeId":"00000000-0000-4000-8000-000000000012","stance":"agree"}' | jq .
  ```

  ```sql
  -- DB layer: exactly one mark row for (node …012, user02), stance='agree'.
  select node_id, stance from public.marks
  where node_id='00000000-0000-4000-8000-000000000012'
    and marker_id='00000000-0000-4000-8000-000000000002';
  ```

- [x] 3.5 `POST /api/exchanges/<id>/submit-turn` returns 409/422 incomplete, 200 + flip when complete

  > **Agent-automatable**: Yes — reuse `$TOKEN` from 3.4. Reset marks first to test the incomplete branch.

  ```bash
  # Incomplete (after clearing marks via SQL): expect 409 or 422.
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    "http://localhost:4321/api/exchanges/<exchange_id>/submit-turn" \
    -H "Authorization: Bearer $TOKEN"   # replace <exchange_id>

  # After marking all 5 advocate statements: expect 200 and current_turn='advocate'.
  curl -s -X POST "http://localhost:4321/api/exchanges/<exchange_id>/submit-turn" \
    -H "Authorization: Bearer $TOKEN" | jq .current_turn
  ```

### Phase 4: Frontend — identity, capability model, mark UI & shading

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 Challenger sees mark controls on advocate Statements (not connectives); marks persist on refresh

  > **Agent-automatable**: No — requires a browser session signed in as user02 viewing the debate, visual inspection of the mark control on Statement nodes (and its absence on the AND node …016), and a page reload to confirm persistence.

- [ ] 4.5 Challenger-authored nodes render with a distinct background shade

  > **Agent-automatable**: No — visual inspection: a challenger-added node renders in the distinct shade vs advocate white/`var(--card)`.

- [ ] 4.6 Challenger sees no edit/delete controls on advocate nodes; can add their own

  > **Agent-automatable**: No — visual/interaction check in the browser as user02 on their turn.

- [ ] 4.7 Submit button disabled until all advocate Statements marked; board locks after submit

  > **Agent-automatable**: No — interactive: mark 4/5, confirm button disabled; mark the 5th, confirm enabled; submit, confirm read-only.

### Phase 5: Integration tests + cookbook/plan sync

#### Automated

- [ ] 5.1 Integration tests pass with local Supabase up: `npm run test:integration` (or project equivalent)
- [ ] 5.2 Type/lint pass: `npx astro check && npm run lint`

#### Manual

- [ ] 5.3 Cookbook §6 entry names the two guarded regressions (42P17 helper; SETOF not-found)

  > **Agent-automatable**: Yes — read back `context/foundation/test-plan.md` §6 and confirm the entry exists.

  ```bash
  grep -n "is_accepted_challenger\|SETOF\|submit_turn" context/foundation/test-plan.md
  ```
