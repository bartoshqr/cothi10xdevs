---
date: 2026-06-09T18:58:46+02:00
researcher: bartoshqr
git_commit: dba05d662a939659d831138d2b8dc3917597b223
branch: develop
repository: cothi10xdevs
topic: "S-03 — Challenger marks advocate statements and submits the first turn"
tags: [research, codebase, exchanges, marks, authorship, rls, react-flow, turn-state]
status: complete
last_updated: 2026-06-09
last_updated_by: bartoshqr
---

# Research: S-03 — Challenger marks advocate statements and submits the first turn

**Date**: 2026-06-09T18:58:46+02:00
**Researcher**: bartoshqr
**Git Commit**: dba05d662a939659d831138d2b8dc3917597b223
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

For roadmap slice S-03 (`challenger-first-turn`, PRD US-02 / FR-011–FR-014): what does the
codebase look like today, and where are the seams for adding (1) the three-state mark schema
+ gating, (2) authorship + per-party edit permissions, (3) the turn/round state-machine
transition that activates the advocate's turn, and (4) the canvas UI for marks and
challenger-node shading — reusing existing S-01/S-02 patterns rather than reinventing them?

## Summary

The S-03 surface decomposes into **one large net-new piece and three extensions of existing
machinery**:

1. **Marks are 100% net-new.** There is no marks table, column, or enum anywhere — not in any
   migration, not in `database.types.ts`, not in the exchange or debate modules. The
   Agree/Challenge/Abstain model (table + enum + RLS + write grants + repository + schema + API
   + store + node UI) must be built from scratch. This is the key risk flagged in `change.md`
   and the bulk of the work.

2. **Authorship already exists; role does not.** Both `nodes` and `relations` already carry an
   `author_id` column (since S-01), populated from `user.id`. "Edit only your own" is therefore
   achievable by keeping the existing `author_id = auth.uid()` clause on UPDATE/DELETE while
   **relaxing the `owner_id` gate** that currently blocks any non-owner from writing. A denormalized
   `author_role` ('advocate'|'challenger') column is optional — role is derivable from
   `debates.owner_id` vs `exchanges.challenger_id`.

3. **The turn machine exists structurally but has no write path.** `exchanges` already has
   `current_round`, `current_turn` (enum `turn_actor`), and `status`; a fresh accepted exchange
   sits at `current_round=1, current_turn='challenger'`. But there is **no "submit turn"
   endpoint**, and `current_turn`/`current_round` are **physically not writable** by the client
   (column-level `grant update` is restricted to `(status, responded_at)`). Activating the
   advocate's turn requires a new write path that either extends the grant or — more consistent
   with the codebase — goes through a `SECURITY DEFINER` function.

4. **The canvas is ready to extend but currently knows nothing about identity.** React Flow is
   wired with a `nodeTypes` map, a `canEdit` boolean read-only mode, and an optimistic Zustand
   store. But `author_id` is dropped in `rowsToGraph`, the node `data` carries no author/role,
   and the store/`MapEditor` has **no notion of "who am I."** S-03 must thread the viewer's
   identity + each node's author down into the store and `StatementNode`.

Two known lessons apply directly: **RLS cross-table recursion (42P17 → SECURITY DEFINER)** —
already hit and fixed in S-02 with `is_debate_owner()`; the same trap recurs if a new write
policy reads `exchanges`. And **RETURNS SETOF for not-found** — already followed by `patch_node`
/ `set_debate_root`; any new mark/turn RPC that must signal "no row" should too.

## Detailed Findings

### Area 1 — Mark schema & submit-gating (NET-NEW)

- **No marks anything exists.** `grep` for `mark|agree|challenge|abstain` across all 11
  migrations, `src/lib/exchange/`, and `database.types.ts` matches only the word "challenger".
  The S-02 migration header states this explicitly: *"Write policies … stay owner/author-scoped —
  challenger writes are S-03"* (`supabase/migrations/20260609000001_create_exchanges.sql:3-4`).
- **The oracle (FR-011)** is precise: the challenger must mark every advocate Statement that is
  *currently unmarked* (round 1 = all of them) as Agree / Challenge / Abstain before the turn can
  be submitted. Already-valid marks carry over (carry-over / invalidation is S-05 — round 1 only
  needs "mark all advocate statements"). **Abstain counts as unresolved** in the divergence
  summary (`prd.md:131`). Confirm with `change.md:36-37` unknown: round 1 simply requires marking
  all advocate statements; carry-over semantics deferred to S-05.
- **Schema scope to design**: a marks table (e.g. one row per (exchange, node, marker-user) or
  per-turn), a stance enum (`agree|challenge|abstain`), FK to `nodes` and `exchanges`, RLS that
  lets a *member* mark rows they did **not** author, and a column-level write grant. The gating
  ("cannot submit until every advocate statement marked") is a **count check** — best enforced in
  the submit-turn write path (server-side), not only in the UI.

### Area 2 — Turn / round state machine (EXTEND)

- **`exchanges` table** (`...create_exchanges.sql:13-32`): `id, debate_id, advocate_id,
  challenger_id, status (exchange_status), round_count (1–5), current_round (default 1),
  current_turn (turn_actor, default 'challenger'), created_at, responded_at`.
  Enums (`:8-9`): `exchange_status = ('pending','accepted','declined')`,
  `turn_actor = ('challenger','advocate')`.
- **Two orthogonal dimensions**: `status` = invite lifecycle (pending→accepted/declined);
  `current_turn` + `current_round` = in-debate progression. There is **no** "active"/"in-progress"
  status value — progression is carried entirely by `current_turn`/`current_round`.
- **`respondToInvite`** (`src/lib/exchange/repository.ts:80-93`) only flips `status` and stamps
  `responded_at`; it never touches `current_turn`/`current_round`. `respond.ts`
  (`src/pages/api/exchanges/[id]/respond.ts`) is accept/decline-an-invite, **not** submit-a-turn.
- **Hard seam — column write lock** (`...create_exchanges.sql:75-76`): `revoke update … ; grant
  update (status, responded_at) …`. Authenticated clients **cannot write `current_turn` /
  `current_round` at all** today. Submitting a turn (flip `current_turn` to `'advocate'`) must
  extend this grant or go through a `SECURITY DEFINER` function. There is **no transactional/RPC
  helper** in the exchange repo to follow for an atomic "write marks + flip turn" — `is_debate_owner`
  is the only definer precedent and it is read-only.

### Area 3 — Authorship & edit-permission enforcement (EXTEND)

- **`author_id` already on both tables** — `nodes` (`...create_debate_graph.sql:31-46`),
  `relations` (`:54-63`); set from `user.id` in `createStatementNode`/`createConnectiveNode`/
  `createRelation` (`src/lib/debate/repository.ts:56-214`). **No `author_role` column; no marks.**
- **Authz lives in RLS, not app code.** Handlers enforce only auth + Zod validation and rely on
  RLS (RLS-hidden row → zero rows → `NotFoundError` → 404). The current write policies require
  `author_id = auth.uid()` **AND** debate ownership:
  - `nodes_insert` (`...create_debate_graph.sql:107-115`)
  - `nodes_update` / `nodes_delete` (`...20260605000001_tighten_graph_write_policies.sql:6-25`)
  - `relations_insert` (`...create_debate_graph.sql:134-142`) / `relations_update` /
    `relations_delete` (`...20260605000001:27-46`)
- **Consequence: only the advocate (owner) can write today.** An accepted challenger passes the
  `author_id` clause but fails `d.owner_id = auth.uid()`. To let the challenger add **their own**
  nodes/relations while staying blocked from editing the advocate's:
  - **INSERT**: widen the gate to "owner OR accepted challenger of this debate" (mirror the S-02
    read-policy widening, canonical snippet at `...create_exchanges.sql:89-103`).
  - **UPDATE/DELETE**: drop the owner gate but **keep `author_id = auth.uid()`** — that clause
    alone gives exactly "edit only your own." No new column strictly required.
- **`patch_node`** is `SECURITY INVOKER` (`...20260605000002_atomic_node_metadata_patch.sql:5`),
  so the widened/narrowed `nodes_update` policy governs it automatically — no separate RPC change.
- **The "mark, don't edit" rule has no existing hook** — see Area 1. This is the net-new surface
  that lets a *member* annotate a row they did not author.

### Area 4 — UI / canvas integration (EXTEND)

- **Canvas**: `src/components/debate/MapEditor.tsx`. `nodeTypes = { statement: StatementNode,
  connective: ConnectiveNode }` (`:73-80`); node `type` derived from DB `kind` in `rowsToGraph`
  (`src/components/debate/store.ts:104,116`). Interaction gated by `canEdit`
  (`MapEditor.tsx:302-328`).
- **Background hook for author shade**: `StatementNode.tsx:264-272` — the only background paint is
  `backgroundColor: "var(--card)"` (`:269`). A challenger-vs-advocate shade conditions this on a
  new author flag. Role accent/badge come from `roleDescriptors` in
  `src/components/debate/mapVisualLanguage.ts:36-43` (keyed by **role**, not author).
- **Identity gap**: node `data` (`StatementNodeData`, `StatementNode.tsx:10-17`) carries only
  `role, title, body, url, isRoot, pending` — **no `authorId`/`authorRole`**. `rowsToGraph`
  (`store.ts:103-129`) drops the DB `author_id`. The store/`MapEditor` have **no current-user id**
  (`MapEditorProps` is just `debateId, initialGraph, canEdit`, `MapEditor.tsx:386-393`). The Astro
  page has it (`Astro.locals.user`, `src/pages/debates/[id].astro:10`) but doesn't pass it down.
  S-03 must thread viewer identity + per-node author into the store.
- **Mark-control affordance to mirror**: the clickable role **badge** + portal dropdown
  (`StatementNode.tsx:298-310`, `:167-237`) is the closest existing pattern; the inline delete `×`
  (`:278-289`) shows the edit-mode-only control idiom. Controls on nodes need `nodrag nopan`
  classes to avoid React Flow drag interception.
- **Read-only mode already exists**: `canEdit` boolean (`store.ts:48-56`), flipped via `setCanEdit`
  (`:658-665`) and a `wvmap:set-can-edit` window event (`MapEditor.tsx:177-186`). Computed
  server-side as `isOwner && existingExchange === null` (`[id].astro:64-67`) — so a challenger is
  **always fully read-only today**. S-03 needs finer-grained permission than one boolean
  (challenger may add nodes + marks, but only on their turn).
- **Store CRUD is optimistic**: apply locally → fire API → `reconcile` (temp id → server id) on
  success / `rollback` + `reportError` on failure (e.g. `createStatementNode` `store.ts:436-472`;
  field edits debounced via `schedulePatch`/`patchBuffers` `:166-206`). On failure,
  `reconcileFromServer()` (`:263-300`) refetches. **Every mutator early-returns on `!get().canEdit`**
  — the UX lock S-03 must selectively relax. API plumbing: `src/components/debate/persistence.ts`
  thin `fetch` wrappers → `/api/debates/${debateId}/...`.

## Reuse Points (mirror, don't reinvent)

- **`withAuth`** (`src/lib/api.ts:10-46`): `withAuth(handler)` where `handler = (context,
  supabase, user) => Response`. Builds request-scoped client, returns 503 if unconfigured / 401 if
  no user, and maps domain errors → `NotFoundError`→404, `ValidationError`→422,
  `ConflictError`→409, else 500. **New mark/turn endpoints reuse it verbatim** and throw the three
  `errors.ts` classes. (Per the lessons register, the shared preamble is already extracted — keep
  new routes thin: parse + validate + one repository call.)
- **Repository convention**: plain async fns, first arg `supabase: DB`, author-id passed
  explicitly; return DB `Row` types or throw `errors.ts` classes; map SQLSTATE `23505`/`23503` →
  `ConflictError`; `.maybeSingle()` null → `NotFoundError`; atomic multi-effect → RPC.
- **Schema convention** (`src/lib/*/schemas.ts`): Zod, enums derived from `Constants.public.Enums`
  so DB & validation never drift; `.strict()` inputs; discriminated unions; export inferred types.
  New module → `src/lib/<module>/{schemas.ts,repository.ts,constants.ts}`.
- **Constants (define-once-import-everywhere)**: `src/lib/exchange/constants.ts` (`ROUND_COUNT`,
  comment "DB CHECK constraints mirror these") and `src/lib/debate/nodeConstraints.ts`. Mark
  stances / per-turn limits belong in a new `constants.ts`, mirrored by a DB CHECK and imported by
  both Zod and the node UI. Frontend visual vocab → add a mark-stance descriptor record to
  `mapVisualLanguage.ts` (consumed by `StatementNode` and `MapLegend`).

## Code References

- `supabase/migrations/20260609000001_create_exchanges.sql:13-37` — exchanges table, enums, one-open-per-debate index
- `supabase/migrations/20260609000001_create_exchanges.sql:75-76` — column-level update grant lock (status, responded_at only)
- `supabase/migrations/20260609000001_create_exchanges.sql:89-103` — canonical member (owner OR accepted challenger) EXISTS snippet
- `supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql:18-40` — `is_debate_owner` SECURITY DEFINER (42P17 fix)
- `supabase/migrations/20260528000001_create_debate_graph.sql:31-63` — nodes/relations tables (author_id present)
- `supabase/migrations/20260528000001_create_debate_graph.sql:107-115,134-142` — nodes_insert / relations_insert policies (owner-gated)
- `supabase/migrations/20260605000001_tighten_graph_write_policies.sql:6-46` — update/delete policies (owner+author gated)
- `supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:5,10-15` — patch_node SECURITY INVOKER, RETURNS SETOF
- `src/lib/exchange/repository.ts:80-93` — respondToInvite (status only, no turn flip)
- `src/lib/debate/repository.ts:56-219` — node/relation create/update/delete + SQLSTATE mapping
- `src/lib/api.ts:10-46` — withAuth wrapper + error→status mapping
- `src/lib/exchange/schemas.ts`, `src/lib/debate/schemas.ts` — Zod enums derived from DB Constants
- `src/lib/exchange/constants.ts:1-6`, `src/lib/debate/nodeConstraints.ts` — define-once constants
- `src/components/debate/MapEditor.tsx:73-80,302-328,386-393` — nodeTypes, canEdit gating, props
- `src/components/debate/store.ts:41-85,103-129,436-472,263-300,658-665` — state shape, rowsToGraph (drops author_id), optimistic CRUD, reconcileFromServer, setCanEdit
- `src/components/debate/nodes/StatementNode.tsx:10-17,264-272,298-310` — node data shape, background hook, badge/dropdown affordance
- `src/components/debate/mapVisualLanguage.ts:36-43` — roleDescriptors (role-keyed colors/badges)
- `src/pages/debates/[id].astro:10,22,64-67` — Astro has user identity; canEdit = isOwner && no exchange
- `tests/integration/helpers.ts` — two-user fixture (advocate/challenger/outsider, getClientAsUser, seedDebate)
- `tests/integration/exchange.test.ts:184-189,257-258` — S-02 suite; asserts "no challenger write yet (S-03)" + initial turn state

## Architecture Insights

- **Two-axis exchange state**: invite lifecycle (`status`) is deliberately separate from turn
  progression (`current_turn`/`current_round`). S-03's "submit turn" lives on the second axis,
  which currently has no client-writable path.
- **RLS is the authorization layer; the app layer is auth + validation only.** New permission
  rules belong primarily in policies, with the app mapping zero-rows → 404. `author_id` is already
  the discriminator for "your own."
- **Column-level grants are used as a second lock** beyond row policies (the `(status,
  responded_at)` grant). Any new writable column needs an explicit grant.
- **Optimistic-UI + reconcile** is the established frontend write pattern; marks/turn-submit should
  follow it (apply → API → reconcile/rollback → refetch on failure).
- **Definer functions are the sanctioned escape hatch** for cross-table checks that would
  otherwise recurse — reuse the `is_debate_owner` shape for any "is accepted challenger" predicate.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — RLS 42P17 → SECURITY DEFINER (from S-02); RETURNS SETOF for
  not-found (from S-01); centralize validation limits; extract shared auth preamble (`withAuth`
  already done). All four apply to S-03.
- `context/archive/2026-06-08-invite-and-open-exchange/` (S-02) — established exchanges table,
  widened read policies, `is_debate_owner`, and the two-user integration fixture. S-03 inverts
  S-02's "no challenger write yet" assertions.

## Related Research

- This is the first research artifact for `challenger-first-turn`. Prior slice research lives under
  `context/archive/2026-06-08-invite-and-open-exchange/`.

## Open Questions

1. **Mark grain**: one mark row per (exchange, node) by the marking party, or per-turn snapshots?
   FR-011 round-1 needs only "all advocate statements marked"; S-05 carry-over/invalidation will
   pressure this choice. Decide the grain now to avoid an S-05 migration. (Resolve in `/10x-plan`.)
2. **Turn-flip write path**: extend the `grant update` to include `current_turn`/`current_round`
   with a tightened UPDATE policy, **or** a `SECURITY DEFINER` `submit_turn(exchange_id)` RPC that
   atomically validates the mark-completeness gate + flips the turn? The latter matches the
   "atomic multi-effect → RPC" convention and centralizes the FR-011 gate server-side.
3. **`author_role` column — denormalize or derive?** Derivable from `owner_id`/`challenger_id`, but
   a stored role simplifies node shading and future symmetric advocate logic (S-04). Trade-off:
   one more column to keep correct vs. repeated joins.
4. **Member predicate & recursion**: will the widened node/relation INSERT policy read `exchanges`
   from within RLS? If so, pre-empt 42P17 with an `is_debate_member`/`is_accepted_challenger`
   SECURITY DEFINER helper mirroring `is_debate_owner`.
5. **Frontend permission model**: replace the single `canEdit` boolean with a richer mode
   (view / mark-only / add-and-mark on-your-turn), and thread viewer identity + per-node author
   into the store so shading and allowed actions are correct.
