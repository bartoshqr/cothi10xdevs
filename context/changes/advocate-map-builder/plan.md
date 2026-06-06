# Advocate Map Builder (S-01) Implementation Plan

## Overview

Productionize the map-visual-spike into the advocate's map-building experience: create a debate
with a designated root Claim, add typed Toulmin nodes (Claim / Source / Data / Warrant / Backing /
Rebuttal) plus logical **connective** nodes (AND / OR), and draw directed relations
(supports / link / rephrases / rebuts) between them — rendered as an interactive React Flow canvas
backed by a Zustand store and persisted to a new normalized Supabase schema with debounced,
per-entity autosave. This is the schema-foundation slice: the debate / node / relation model
defined here is the substrate every later slice (S-02 invites, S-03/S-04 marks + summary, S-05
multi-round edit/invalidation, S-07 parent linking) builds on.

The visual language is **already designed and built** in `src/components/spike/` (commits
`0572625`, `d07c7d6`, `9b99376`). The spike is the reference for what is correct (see
`findings.md`); this plan adapts it from a static demo (`useNodesState`/`useEdgesState` over
`exampleMap.ts`) into a persisted, editable, owner-scoped editor.

## Current State Analysis

- **Visual-language spike (the reference):** `src/components/spike/` contains the finished node /
  edge / legend components. Key facts the schema must mirror (per `findings.md`):
  - `StatementRole = "claim" | "source" | "data" | "warrant" | "backing" | "rebuttal"` — **6 roles**;
    `source` is a first-class node with an optional clickable `url`, not a sub-entity.
  - `ConnectiveOp = "and" | "or"` — a **second node type** (`type: "connective"`) for logical grouping.
  - `RelationKind = "supports" | "link" | "rephrases" | "rebuts"` — **4 kinds** (no `bridges`).
  - `StatementNodeData = { role?, title, body, url?, isRoot? }`; `isRoot` is a derived display flag.
  - Floating-edge routing (`floatingEdgeUtils.ts`): `link` edges find the nearest non-top entry on a
    connective; `rebuts` edges attack horizontally; `supports`/`rephrases` use plain bezier.
  - Canvas wiring (`MapSpikeCanvas.tsx`): module-level `nodeTypes`/`edgeTypes`, `defaultEdgeOptions`
    (`type: "relation"`, `MarkerType.ArrowClosed`), `ReactFlowProvider`, `import ".../style.css"`.
  - Mounted today at `src/pages/spike/map.astro` as a static demo.
- **Data layer:** only `public.profiles` exists (F-01). No domain tables. Migrations live in
  `supabase/migrations/`; the F-01 pair establishes the house style — RLS enabled, `anon` SELECT
  revoked, `(select auth.uid())` in policies, `lower()` unique indexes, SECURITY DEFINER triggers
  with `set search_path = ''`.
- **Supabase access:** `src/lib/supabase.ts` exposes `createClient(headers, cookies)` returning a
  typed `SupabaseClient<Database>` or `null` when env is unset. Used by middleware and every auth
  API route.
- **Types:** `src/db/database.types.ts` is generated from the live schema and lint-ignored
  (`eslint.config.js`). It currently types `profiles` + `username_available`.
- **API pattern:** routes under `src/pages/api/**` export `APIRoute` handlers, build a client, guard
  `null`, return `Response.json(...)`. Validation in F-01 is hand-rolled regex.
- **UI pattern:** `.astro` pages mount React islands via `client:load` (see
  `src/pages/auth/signup.astro` → `SignUpForm`). `Astro.locals.user` is populated in
  `src/middleware.ts`; `PROTECTED_ROUTES` (currently `["/dashboard"]`) gates auth-only paths.
- **Runtime:** Cloudflare Workers — no Node built-ins. React Flow is browser-only and must run only
  inside a `client:`-hydrated island, never SSR.
- **Deps:** `@xyflow/react@^12.10.2` is **already installed** (spike). `zustand` and `zod` are
  **absent** — this slice adds both.

## Desired End State

A signed-in advocate can: create a debate (title + root Claim text) from a create page; land on
`/debates/[id]` showing a React Flow canvas with the root Claim node; right-click the pane to add a
typed statement (one of the 6 roles) or a connective (AND / OR) at the cursor; click a node to open
a detail panel and edit its title, body, and — for source nodes — its `url`; drag to connect two
nodes and pick a relation kind (supports / link / rephrases / rebuts); move, edit, and delete their
own nodes/edges freely. The `MapLegend` "HOW IT WORKS?" drawer explains the visual language. Every
change persists (debounced) to normalized Supabase tables under owner-only RLS, and a reload
restores the exact graph including layout.

Verification: create a debate, rebuild a small version of `exampleMap.ts` (root Claim + Data +
Warrant + Source + an AND/OR connective + one relation of each kind), reload — graph and positions
restore identically; a second account cannot read the first account's debate.

### Key Discoveries:

- Spike-vs-PRD reconciliation: `context/changes/advocate-map-builder/findings.md` (the spike is the
  reference; the 5 findings drive every schema/contract change below).
- Visual language to keep verbatim: `src/components/spike/mapVisualLanguage.ts` (roles, ops, kinds,
  descriptors), `StatementNode.tsx`, `ConnectiveNode.tsx`, `RelationEdge.tsx`, `floatingEdgeUtils.ts`,
  `MapLegend.tsx`.
- Canvas wiring to keep: `src/components/spike/MapSpikeCanvas.tsx:18-30` (module-level
  `nodeTypes`/`edgeTypes`, `defaultEdgeOptions`, provider, CSS import).
- F-01 migration style to mirror: `supabase/migrations/20260525142850_create_profiles.sql:14-34`
  (RLS enable, `revoke select ... from anon`, `(select auth.uid())` policies).
- Typed server client + null-guard contract: `src/lib/supabase.ts:6-25`.
- Island mount pattern: `src/pages/auth/signup.astro` (`client:load`) and the controlled-form
  pattern in `src/components/auth/SignUpForm.tsx`.
- Route protection: `src/middleware.ts:4` (`PROTECTED_ROUTES`).
- React Flow + Zustand canonical wiring (skill `.claude/skills/react-flow/SKILL.md`; ctx7
  `/websites/reactflow_dev`, `/pmndrs/zustand`): store holds `nodes`/`edges` and exposes
  `onNodesChange`/`onEdgesChange`/`onConnect` built on `applyNodeChanges`/`applyEdgeChanges`/`addEdge`;
  components subscribe through a `useShallow` selector; `nodeTypes`/`edgeTypes` are module-level
  constants; `useReactFlow()` callers must be inside `ReactFlowProvider`; CSS import runs in the island.

## What We're NOT Doing

- **No challenger invites / exchange / round config** (S-02+).
- **No marks (Agree/Challenge/Abstain)** schema or UI (S-03/S-04). `author_id` is a proper column on both `nodes` and `relations` so S-03+ needs no migration.
- **No turn model / edit-locking / mark invalidation / orphaning** — the advocate edits and deletes
  their own nodes freely in this slice (S-05).
- **No debate list/index page** (S-06) and **no parent debate linking** (S-07). This slice ships only
  a minimal create-and-open entry point so a debate is reachable.
- **No global UI restyle.** The editor reuses the spike's self-contained palette (CSS variables:
  `--chart-*`, `--primary`, `--destructive`, `--muted-foreground`, etc.); a global theme pass is a
  separate change.
- ~~**No source URL validation / canonical citation format** (PRD Open Question #2; `url` is free text).~~
  **REVERSED during Phase 3 refinement (D11).** Source `url` became **required and http/https
  format-validated** in the UI + store (`isInEditBlocked` + shared `isValidUrl`), and the Phase 2 node
  schema was tightened `z.string()`→`z.url()`. Canonical citation format is still out of scope.
- **No statement/graph size caps** (PRD Open Question #5).
- **No auto-layout / connective-arity enforcement.** Operand counts on AND/OR are not validated; the
  advocate arranges and links manually as in the spike.

## Implementation Approach

Bottom-up: schema first (it is the load-bearing contract), then the typed persistence API with Zod
validation at the boundary, then the editor island (store + canvas + the spike's nodes/edges +
detail panel) wired against that API with optimistic store updates and debounced autosave, then the
Astro pages and routing that make the whole thing reachable and protected.

The spike components are **copied/promoted from `src/components/spike/` into
`src/components/debate/`** and adapted: the static `useNodesState`/`useEdgesState` over
`exampleMap.ts` is replaced by a Zustand store, and add/connect/edit interactions are added. The
Zustand store is the single client-side source of truth for the canvas; the normalized DB rows are
the durable source of truth. A thin mapping layer converts rows ↔ React Flow `nodes`/`edges` on load
and translates store mutations into scoped API calls.

Node storage uses a **single `nodes` table** with `author_id uuid not null references auth.users` as a proper column and `metadata jsonb not null` for kind-specific fields. Statement nodes carry `{ statement_type, title, body?, url? }` in `metadata`; connective nodes carry `{ op }`. `author_id` is also a proper column on `relations`. This eliminates a join on every read, collapses RLS to one policy set, and makes node inserts single-row — no atomic two-row RPC needed beyond the root-claim creation. `author_id` as a real column gives FK enforcement to `auth.users` and clean `author_id = auth.uid()` RLS for insert/update/delete. Kind-specific shape is validated at the Zod boundary; DB `check` constraints back up the char limits. The trade-off: marks (S-03) FK to `nodes.id` with an application-level `kind = 'statement'` check rather than a DB FK to a dedicated child table — accepted as sufficient.

## Critical Implementation Details

### React Flow tooling (use these specific APIs)

- **State plumbing:** store actions built on `applyNodeChanges` / `applyEdgeChanges` / `addEdge`;
  expose `onNodesChange` / `onEdgesChange` / `onConnect` (`OnConnect`) to `<ReactFlow>`. Subscribe in
  components via `useShallow` (`zustand/react/shallow`).
- **Add at cursor:** `onPaneContextMenu` → render the type/connective menu → `useReactFlow()
  .screenToFlowPosition({ x, y })` to convert the click to flow coords before inserting the node.
- **Connect + kind pick:** `onConnect` stages the connection, a small picker chooses the kind, then
  the edge commits with `data.kind`. Use `isValidConnection` to block self-loops and invalid pairings
  (e.g. `link` must target a connective).
- **Edit node data:** `useReactFlow().updateNodeData(id, patch)` (or the store action) from the
  detail panel; inputs carry `className="nodrag"` so typing doesn't drag the node.
- **Delete:** wire `onNodesDelete` / `onEdgesDelete` to store actions; `deleteElements` for
  programmatic removal. Deleting a node cascades its relations (DB `on delete cascade` + store prune).
- **Edges:** keep the spike's `RelationEdge` (`BaseEdge`, `getBezierPath`, `EdgeText`,
  `useInternalNode`, floating utils) and `defaultEdgeOptions` (`type: "relation"`,
  `MarkerType.ArrowClosed`); keep `nodeTypes`/`edgeTypes` at module scope.
- **Chrome:** `Background`, `Controls`, and the spike's `Panel`-based `MapLegend`; `fitView` /
  `fitViewOptions={{ padding: 0.2 }}` on hydration. `MiniMap` optional, out of scope.
- **Provider + SSR:** canvas and any `useReactFlow()` consumer inside `ReactFlowProvider`; the editor
  is a `client:only="react"` island — React Flow touches `window` and must not SSR on Workers.

### Schema & data

- **Stable `nodeTypes` / `edgeTypes`:** define at module scope. A fresh object literal each render
  causes remount flicker and runaway updates — the most common React Flow footgun.
- **Single table + JSONB:** `nodes(id, debate_id, author_id, kind, position_x, position_y, metadata jsonb not null)` is
  the only node table. `author_id uuid not null references auth.users` is a proper column — not in JSONB.
  Statement metadata shape: `{ statement_type, title, body?, url? }`; connective metadata shape: `{ op }`.
  `relations` also carries `author_id uuid not null references auth.users` as a proper column.
  Kind-specific shape is validated by Zod at the API boundary; DB `check` constraints enforce char limits:
  `check (kind <> 'statement' or char_length(metadata->>'title') <= 60)`,
  `check (kind <> 'statement' or metadata->>'body' is null or char_length(metadata->>'body') <= 250)`.
  Single-row inserts — no atomicity concern for node creation.
- **Root-claim creation ordering:** `debates.root_node_id` references `nodes.id`, but a node
  references its debate — a chicken/egg. Create the debate row, then the root node (single insert),
  then set `root_node_id`, inside one Postgres function (RPC) so a partial failure can't leave a
  debate without a root. The FK is declared `deferrable initially deferred` as a backstop.
- **Char limits:** debate title ≤ 120 chars (page header, more room); node title ≤ 60 chars (lives
  inside a canvas box); node body ≤ 250 chars. Enforced at both Zod (`.max()`) and DB (`check`).
- **Autosave races:** position drags fire many `onNodesChange` events — debounce position persistence
  (~400ms, mirroring the F-01 availability-check debounce) and send the latest position only.
  Structural ops (add/delete/connect/field-edit) persist immediately. Use optimistic store updates; on
  API failure, surface a non-blocking error and reconcile.

## Phase 1: Data Model & Types

### Overview

Create the enums, the `debates` + `nodes` (with JSONB metadata) + `relations` tables, RLS, and the
root-creation RPC; regenerate the typed `Database`.

### Changes Required:

#### 1. Schema migration

**File**: `supabase/migrations/<timestamp>_create_debate_graph.sql`

**Intent**: Establish the full normalized graph schema this product is built on, matching the spike's
visual language, with owner-only RLS for the pre-exchange building phase.

**Contract**:
- Enum `node_kind` = `('statement','connective')`.
- Enum `statement_type` = `('claim','source','data','warrant','backing','rebuttal')` — **6 values**
  (Finding 1: `source` is a statement role, not a sub-entity).
- Enum `connective_op` = `('and','or')` (Finding 2).
- Enum `relation_kind` = `('supports','link','rephrases','rebuts')` — **`bridges` dropped**, `link` +
  `rephrases` added (Finding 3).
- `debates(id uuid pk default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade, title text not null check (char_length(title) <= 120), root_node_id uuid null references nodes(id) deferrable initially deferred, created_at timestamptz not null default now())`.
- `nodes(id uuid pk default gen_random_uuid(), debate_id uuid not null references debates on delete cascade, author_id uuid not null references auth.users on delete cascade, kind node_kind not null, position_x double precision not null default 0, position_y double precision not null default 0, metadata jsonb not null, created_at timestamptz not null default now(), check (kind <> 'statement' or char_length(metadata->>'title') <= 60), check (kind <> 'statement' or metadata->>'body' is null or char_length(metadata->>'body') <= 250))`.
  `author_id` is a **proper column with a FK to `auth.users`** — not stored in JSONB.
  Statement metadata shape: `{ "statement_type": statement_type, "title": text, "body": text|null, "url": text|null }`. Connective metadata shape: `{ "op": connective_op }`. (`url` in metadata per Finding 4 — no `sources` table. Marks in S-03/04 FK to `nodes.id` with application-level `kind = 'statement'` check.)
- `relations(id uuid pk default gen_random_uuid(), debate_id uuid not null references debates on delete cascade, author_id uuid not null references auth.users on delete cascade, source_node_id uuid not null references nodes on delete cascade, target_node_id uuid not null references nodes on delete cascade, kind relation_kind not null, created_at timestamptz not null default now(), check (source_node_id <> target_node_id))`.
- **No `sources`, `statements`, or `connectives` child tables** (JSONB metadata on `nodes`).
- RLS enabled on all three (`debates`, `nodes`, `relations`); `revoke select ... from anon`; owner-only policies — `debates` scoped by `owner_id = (select auth.uid())`; `nodes`/`relations` **SELECT** scoped via debate ownership subquery; **INSERT** checks `author_id = (select auth.uid())` AND debate ownership; **UPDATE/DELETE** scoped by `author_id = (select auth.uid())` only. Separate `select`/`insert`/`update`/`delete` policies.
- Indexes: `nodes(debate_id)`, `relations(debate_id)`, `relations(source_node_id)`, `relations(target_node_id)`.

#### 2. Root-claim creation RPC

**File**: same migration

**Intent**: Atomically write the debate row + root node row (single insert — no child table), then
set `root_node_id`, so no partial failure can leave a debate without a root.

**Contract**, `language plpgsql security definer set search_path = ''`, execute revoked from
`public, anon` and granted to `authenticated`, asserting `auth.uid()` is not null:
- `create_debate_with_root(p_title text, p_root_title text, p_root_body text) returns uuid` — inserts
  the debate; inserts a `nodes` row (`author_id = auth.uid()`, `kind='statement'`, `metadata = jsonb_build_object('statement_type','claim','title',p_root_title,'body',p_root_body)`); sets `root_node_id`; returns the debate id. `author_id` is passed as a column, not inside the JSONB.
- `create_statement_node` and `create_connective_node` are **not needed as RPCs** — node creation is
  a single-row insert with no atomicity concern; API routes do a direct `supabase.from('nodes').insert(...)` under the authenticated client (RLS enforces ownership).

#### 3. Regenerate types

**File**: `src/db/database.types.ts`

**Intent**: Refresh generated types so the new tables, enums, and RPC are available to the typed client.

**Contract**: Run type-generation against the local schema; the file gains
`debates`/`nodes`/`relations` Row/Insert/Update, the four enums under `Enums`, and
`create_debate_with_root` under `Functions`. The `metadata` column types as `Json` — callers cast
it to the appropriate kind-specific shape. File is lint-ignored already.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to a fresh local stack: `npx supabase db reset`
- Types regenerate without error and include the new tables/enums/RPC.
- Type checking passes: `npx astro sync && npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In Studio, `create_debate_with_root` produces a debate row with a non-null `root_node_id` pointing
  at a `kind='statement'` node whose `metadata->>'statement_type'` is `'claim'`.
- A direct `insert` into `nodes` for statement and connective kinds succeeds under auth and leaves a
  single row with the correct `metadata` shape; inserting a node with `title` > 60 chars is rejected
  by the DB `check` constraint.
- A second user cannot `select` the first user's debate/nodes (RLS) — verified via two sessions in
  Studio or SQL with differing `auth.uid()`.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Persistence API & Validation

### Overview

Add Zod; define request schemas and CRUD API routes plus `src/lib` data primitives that wrap the
typed Supabase client.

### Changes Required:

#### 1. Add Zod + payload schemas

**File**: `package.json`, `src/lib/debate/schemas.ts`

**Intent**: Honor the documented stack and validate every payload at the API boundary with a single
shared schema set reused by S-02–S-07.

**Contract**: `zod` added to dependencies. Schemas:
- `createDebateSchema` — `{ title: z.string().min(1).max(120), rootTitle: z.string().min(1).max(60), rootBody?: z.string().max(250) }`.
- `createNodeSchema` — a **discriminated union on `nodeKind`**:
  - `statement`: `{ nodeKind: 'statement', debateId, statementType ∈ statement_type, title: z.string().min(1).max(60), body?: z.string().max(250), url?, positionX, positionY }`.
  - `connective`: `{ nodeKind: 'connective', debateId, connectiveOp ∈ connective_op, positionX, positionY }`.
- `updateNodeSchema` — partial: `{ title?: z.string().min(1).max(60), body?: z.string().max(250), url?, statementType?, connectiveOp?, positionX?, positionY? }`
  (`statementType ∈ statement_type`, valid for statement nodes — **role is editable post-creation**;
  `connectiveOp ∈ connective_op`, valid for connective nodes — AND/OR toggle).
- `createRelationSchema` — `{ debateId, sourceNodeId, targetNodeId, kind ∈ relation_kind }`.
- `updateRelationSchema` — `{ kind: z.enum(relation_kind) }` — allows changing the kind of an existing relation post-creation (e.g. flipping `supports` → `rebuts` from the detail panel).
- id params (`debateId`, `nodeId`, `relationId`).
- Enum members reuse the generated `Enums<'statement_type'>` / `Enums<'connective_op'>` /
  `Enums<'relation_kind'>` unions as the source of truth.

#### 2. Data primitives

**File**: `src/lib/debate/repository.ts`

**Intent**: Centralize debate/node/relation reads and writes so routes stay thin and the rows↔graph
mapping has one home (mirrors `src/lib/users.ts`).

**Contract**: Functions taking `SupabaseClient<Database>` + validated input: `createDebate` (calls the
`create_debate_with_root` RPC), `getDebateGraph(debateId)` (returns debate + nodes + relations in a
single read — no join needed, `metadata` is inline on each `nodes` row), `createStatementNode` /
`createConnectiveNode` (direct `supabase.from('nodes').insert(...)` with the appropriate `metadata`
shape — no RPC needed), `updateNode` (patches `nodes.position_*` and/or merges into `nodes.metadata`
via a `jsonb_build_object` partial update — fields in the payload overwrite matching metadata keys),
`deleteNode` (deletes the `nodes` row; relations cascade via `on delete cascade`), `createRelation`,
`updateRelation` (patches `relations.kind` — allows changing the kind of an existing relation without
losing its stable `id`; relations RLS has an `update` policy for this), `deleteRelation`. RLS is the
authorization boundary — primitives do not re-check ownership.

#### 3. API routes

**File**: `src/pages/api/debates/index.ts`, `src/pages/api/debates/[id]/nodes/index.ts`,
`src/pages/api/debates/[id]/nodes/[nodeId].ts`, `src/pages/api/debates/[id]/relations/index.ts`,
`src/pages/api/debates/[id]/relations/[relationId].ts`

**Intent**: Expose scoped CRUD the editor calls for per-entity autosave.

**Contract**: Each handler builds the client (null-guard → 503), parses the body/params with the
matching Zod schema (→ 400 on failure), calls the repository, returns `Response.json`. Methods:
`POST /api/debates` (create), `GET/POST` nodes collection, `PATCH/DELETE` single node, `POST`
relations / `PATCH/DELETE` single relation (`PATCH` changes the relation `kind` via `updateRelationSchema`).
No new GET list of debates (S-06). No sources routes (sources are statement nodes).

**Auth header requirement**: Every handler must use `getAuthUser(supabase, context.request.headers)`
from `src/lib/supabase.ts` — **not** bare `supabase.auth.getUser()`. The difference: bare
`getUser()` reads only the cookie-based SSR session (browser); `getAuthUser` checks for an
`Authorization: Bearer <token>` header first and falls back to the cookie session if absent. This
matters because the Phase 2 smoke checks (and any programmatic/API caller) authenticate via Bearer
token, not cookies — bare `getUser()` returns `null` for them and produces a spurious 401.
`POST /api/debates/index.ts` currently uses the bare call — this is a bug that must be fixed before
2.4 smoke checks are run.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Build passes: `npm run build`
- Invalid payloads (bad enum, missing title, statement node without `statementType`) return 400 —
  verified via a curl/HTTP smoke check against `npm run dev`.

#### Manual Verification:

- `POST /api/debates` with a title + root title creates a debate and returns its id; row visible in
  Studio with a root node.
- Statement-node, connective-node, and relation create + delete round-trip through the API mutate the
  DB as expected.
- A request without a session is rejected by RLS (no rows written/read).

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Editor Island (Store, Canvas, Nodes, Detail Panel)

### Overview

Add `zustand`; promote the spike components into `src/components/debate/`; build the Zustand store,
add right-click add (statement + connective), drag-to-connect with kind picking, and a selection
detail panel. Wire local/optimistic state first; persistence is layered in Phase 4.

### As-built reconciliation (post-implementation, 27 refinement commits)

> Phase 3 shipped and then diverged from the contracts below over 27 refinement commits. This block
> records those reversals so the plan reflects reality; full per-commit evidence is in the companion
> docs (`phase3-plan-vs-implementation.md` D1–D16, `phase3-commit-reasons.md`). **Where a contract
> below conflicts with this list, the as-built behavior governs**; the original contracts are kept as
> intent history.

- **D1 — DetailPanel deleted; editing is inline in the node.** The single detail panel (§4) was removed
  (`6b98b44`); title/body/url, the role-badge dropdown, and "Set as Root Claim" now live inside
  `StatementNode` in an edit mode.
- **D2 — No selection model.** Edit mode is entered by **double-click** or **right-click → Edit**; a
  single click *exits* it. The store carries `inEditNodeId`/`inEditEdgeId`, not
  `selectedNodeId`/`selectedEdgeId`; `selectNode`/`selectEdge` do not exist.
- **D3/D4 — Connection is a staged workflow.** `onConnect` was split into `stagePendingConnection` +
  `commitConnection` + `cancelConnection` + `addPendingPreview`, with a live `FloatingConnectionLine`
  and a `"__pending__"` preview edge. New store members: `setRootNode`, `deleteEdge`, `isInEditBlocked`,
  `tryExitNodeEdit`, `setInEditNode`, `setInEditEdgeId`, `getTargetNode`.
- **D5/D6 — Connection-kind is picker-driven, not declarative.** `isValidConnection` blocks only
  self-loops; the picker opens on every connection and offers `link` **only when the target is a
  connective**. Role-pair auto-inference (rephrases source→data, rebuts from rebuttal) was **not built**
  (parked as a future idea). Edge kind is re-edited via right-click → Edit or by **re-dragging the same
  source→target pair** — not by clicking the edge label.
- **D7 — Connective nodes have two target handles** (`for-operands` for `link`, `outer` for the rest);
  the chosen kind routes the edge via the store's `targetHandleFor` helper, applied in both
  `commitConnection` and `updateRelationKind`. The source handle is top-center and always visible; the
  root claim has **no** source handle.
- **D11 — Source `url` is now REQUIRED and FORMAT-validated** (reverses the "url is free text" decision;
  see the NOT-doing list and Phase 2). An `isInEditBlocked` edit-lock prevents leaving a node with an
  empty title or an empty/malformed source url, and gates menus/connections while invalid.
- **Other as-built additions not in the plan:** UI-only `"pending"` relation kind (D16), `RelationEdge`
  extended rather than reused verbatim (D15), shared `nodeConstraints.ts` with `warnAt` counters (D10),
  viewport-aware menu flipping (D9), full keyboard model + Escape-revert (D12), local-state caret mirror
  (D13), active-target hover highlight (D14), new nodes opening straight into edit mode (D8).

### Changes Required:

#### 1. Add library

**File**: `package.json`

**Intent**: Install the store. (`@xyflow/react` is already present from the spike.)

**Contract**: `zustand` added to dependencies.

#### 2. Promote spike visual language

**File**: `src/components/debate/mapVisualLanguage.ts`, `nodes/StatementNode.tsx`,
`nodes/ConnectiveNode.tsx`, `edges/RelationEdge.tsx`, `edges/floatingEdgeUtils.ts`, `MapLegend.tsx`
(copied/adapted from `src/components/spike/`)

**Intent**: Reuse the finished, reviewed visual language verbatim; the spike is the reference.

**Contract**: Move the six spike files into the `debate/` tree unchanged except import paths and the
data-shape note below. Keep `roleDescriptors` / `connectiveDescriptors` / `relationDescriptors`,
the floating-edge utils, and `MapLegend` as-is. `StatementNodeData` stays `{ role?, title, body, url?,
isRoot? }`; `isRoot` is hydrated from `debate.root_node_id` (derived display flag, not a DB column on
the node — Finding 4). Note: the spike's `role` maps 1:1 to the DB `statement_type`.

#### 3. Zustand store

**File**: `src/components/debate/store.ts`

**Intent**: Single client-side source of truth for the canvas, exposing React Flow handlers and
graph-mutation actions; the seam Phase 4 hooks persistence into.

**Contract** (original): `useStore` (typed `RFState`) with `nodes`, `edges`, `selectedNodeId: string | null`,
`selectedEdgeId: string | null`; actions `onNodesChange`, `onEdgesChange`, `onConnect` (built on
`applyNodeChanges`/`applyEdgeChanges`/`addEdge`), `setGraph(debate, nodes, relations)` (hydrate
rows→nodes/edges, set `isRoot` from `root_node_id`), `createStatementNode(type, position)`,
`createConnectiveNode(op, position)`, `updateNodeFields(id, patch)`, `deleteNodes(ids)`,
`selectNode(id)`, `selectEdge(id)`, `updateRelationKind(id, kind)` (patches `data.kind` on the edge
in the store). Components subscribe via a `useShallow` selector. Persistence side-effects are
injected in Phase 4, not hardcoded here.

**As-built (D2/D3/D5):** the **selection model was replaced by an in-edit model**. `selectedNodeId`/
`selectedEdgeId` → `inEditNodeId`/`inEditEdgeId`; `selectNode`/`selectEdge` → `setInEditNode`/
`setInEditEdgeId`. `onConnect` was **split** into `stagePendingConnection` + `commitConnection(kind)` +
`cancelConnection` + `addPendingPreview` (staged connection with a live preview edge); `addEdgeDirect`
existed briefly for auto-`link` and was later deleted. Added: `setRootNode`, `deleteEdge`,
`isInEditBlocked`, `tryExitNodeEdit`, and `getTargetNode` (resolves the target node of the in-flight
connection so the picker can branch on node type). `updateRelationKind(id, kind)` also re-routes the
edge's `targetHandle` for connective targets (D7). Kept as planned: `onNodesChange`, `onEdgesChange`,
`setGraph`, `createStatementNode`, `createConnectiveNode`, `updateNodeFields`, `deleteNodes`.

#### 4. Canvas + add menu + context menus + detail panel

**File**: `src/components/debate/MapEditor.tsx`, `src/components/debate/AddNodeMenu.tsx`,
`src/components/debate/NodeContextMenu.tsx`, `src/components/debate/EdgeContextMenu.tsx`,
`src/components/debate/ConnectKindPicker.tsx`, `src/components/debate/DetailPanel.tsx`,
`src/components/debate/nodes/StatementNode.tsx`, `src/components/debate/nodes/ConnectiveNode.tsx`

**Intent**: Assemble the interactive editor: pannable canvas, right-click-to-add (pane context menu),
right-click node/edge for edit/delete (element context menus), visible source handles for edge
creation, drag-to-connect with kind selection, and a single-panel detail view for editing.
**As-built (D1):** the detail panel became **inline in-node editing** — see the reconciliation block.

**Contract**:
- `MapEditor` wraps `ReactFlow` in `ReactFlowProvider`, imports the React Flow CSS, wires store
  handlers (`onNodesChange`/`onEdgesChange`/`onConnect`/`onNodesDelete`/`onNodeClick`/`onEdgeClick`),
  registers module-level `nodeTypes` (`statement`, `connective`) / `edgeTypes` (`relation`), sets
  `defaultEdgeOptions` + `fitView`, and renders `Background`/`Controls`/`MapLegend` (carried from the
  spike). Tracks `nodeContextMenu` and `edgeContextMenu` state for positioning element context menus.
- `AddNodeMenu` (on `onPaneContextMenu` only — not on element right-click) lists the 6 statement roles
  + AND/OR, each shown with its **role badge** (accent color + label from `roleDescriptors` /
  `connectiveDescriptors`), and calls `createStatementNode` / `createConnectiveNode` with
  `screenToFlowPosition(...)`. Positioned top-left at click point. The badge chosen becomes the
  node's initial `statement_type` / `op`.
- `NodeContextMenu` and `EdgeContextMenu` (on `onNodeContextMenu` / `onEdgeContextMenu`) render
  **Edit** and **Delete** options. Positioned top-left at click point. **Edit** opens/switches the
  `DetailPanel` to that node/edge. **Delete** calls `deleteNodes([id])` / `deleteRelation(id)` on the
  store. Close on selection or pane click.
- **Source handles visibility**: Statement and Connective nodes expose source handles (top-right
  corner) **visible on hover**. Target handles are invisible (React Flow still accepts edge targets
  on the node itself via `isValidConnection`). Handles use accent color matching the node's role or
  op.
  **As-built (D7):** source handle is at **top-center, always visible** (not top-right/on-hover); the
  **root claim has no source handle**. Statement target handle covers the whole node body (invisible).
  **Connective nodes expose two target handles** — `for-operands` (full-body, for `link`) and `outer`
  (bottom point, for the rest) — and the chosen kind routes the edge to the right one via the store's
  `targetHandleFor` helper (`CONNECTIVE_OPERAND_HANDLE`/`CONNECTIVE_OUTER_HANDLE` constants).
- `ConnectKindPicker` opens on `onConnect`, offers the valid kinds (filtered by `isValidConnection`:
  `link` only into a connective, `rephrases` source→data, `rebuts` from a rebuttal, else `supports`)
  before committing the edge with `data.kind`. Also surfaces when a relation edge is selected —
  clicking the edge label/badge opens the picker to change its kind in-place (calls
  `updateRelationKind(id, kind)` on the store).
  **As-built (D5/D6):** `isValidConnection` blocks **only self-loops**; the picker opens on **every**
  connection (no per-pair filtering) and offers `link` **only when the target is a connective**, derived
  via `getTargetNode`. Role-pair auto-inference (`rephrases` source→data, `rebuts` from rebuttal) was
  **not built**. Edge kind is re-edited via **right-click → Edit** or by **re-dragging the same
  source→target pair** — not by clicking the edge label.
- `DetailPanel` renders for `selectedNodeId` (single panel, replaces on node switch):
  - **Statement nodes:** a **role badge selector** in the panel header — displays the current role as
    a styled badge (same accent as the node itself); clicking opens an inline picker with all 6 role
    options (each shown as its badge) to change the role. Below that: editable `title` (max 60, with
    char count) and `body` (max 250, with char count); a `url` field when `role === 'source'`. A
    **"Set as Root Claim" button** appears between the header and title field (only when `isRoot === false`)
    — clicking sets this node as the debate's root claim, updating its badge to display "ROOT" instead
    of the role badge, and updating its `isRoot` flag in the store.
  - **Connective nodes:** a small AND/OR toggle (replaces the badge selector).
  - All inputs carry `className="nodrag"`. Role changes call `updateNodeFields(id, { statementType })`
    — they persist immediately (structural op, not debounced).
  - **As-built (D1/D8/D11/D12/D13):** `DetailPanel.tsx` was **deleted**; all of the above moved
    **inline into `StatementNode`'s edit mode** (entered by double-click / right-click → Edit; new nodes
    open straight into it). The role-badge dropdown is portalled off the node badge; "Set as Root Claim"
    sits at the bottom of that dropdown; the AND/OR toggle moved to `NodeContextMenu` ("Switch to
    OR/AND"). Edit mode adds: a required-title + required/format-validated source-`url` lock
    (`isInEditBlocked`), a keyboard model (Enter advances, Ctrl/Cmd+Enter commits, Escape reverts to an
    entry snapshot), and a `localTitle`/`localBody`/`localUrl` write-through mirror to keep the caret
    stable.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Build passes: `npm run build`
- No `react-compiler` / react-hooks lint errors in the new components.

#### Manual Verification:

> **As-built note:** these criteria were written against the original DetailPanel/selection design. The
> shipped editor uses **inline in-node editing** (no panel) and an **in-edit model** (no selection) — read
> "open the detail panel for a node" as "enter the node's inline edit mode (double-click / right-click →
> Edit)". See the Phase 3 reconciliation block and `phase3-plan-vs-implementation.md` D1–D16.

- Canvas renders with React Flow CSS and the `MapLegend` drawer; nodes draggable.
- **Pane right-click** → add menu appears (top-left at click point) with 6 roles + AND/OR; each shows
  its role badge; selecting one creates a node at cursor with correct accent + badge (and, as-built,
  opens it straight into edit mode — D8).
- **Node right-click** → small context menu appears (top-left at click point) with Edit and Delete
  options. Edit enters the node's inline edit mode. Delete removes the node + cascades its relations.
  (Connective nodes also show "Switch to OR/AND" — D1.)
- **Edge right-click** → context menu with Edit and Delete. Edit opens the `ConnectKindPicker` to
  change the relation kind. Delete removes the edge. (As-built, re-dragging the same source→target pair
  also reopens the picker on the existing edge — D6.)
- **Root claim button**: a "Set as Root Claim" action (only when `isRoot === false`) — as-built it lives
  at the bottom of the inline role-badge dropdown. Clicking it updates the node's badge from role →
  "ROOT", sets `isRoot = true`, and displays the claim as the debate's designated root.
- Double-click a node (or right-click → Edit) → inline edit mode; role badge visible; clicking it opens
  the role picker and changing the role updates the node's accent + badge immediately.
- Editing title/body respects the char limit (counter shown, goes red near the cap — D10); setting a
  source `url` makes the node title a link. **As-built (D11):** a source node cannot leave edit mode
  with an empty or malformed `url`, and no node can leave with an empty title.
- Keyboard (as-built, D12): Enter advances fields, Ctrl/Cmd+Enter commits, Escape reverts to the
  entry snapshot; caret stays stable while typing (D13).
- No remount flicker or "maximum update depth" warnings when entering edit mode / panning / zooming.

**Note**: Handle geometry shipped as **top-center always-visible source** (no source handle on the root
claim) and **two invisible target handles on connective nodes** for kind-based routing — see D7. The
original "source visible on hover / single invisible target" wording is superseded.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Wire-up, Persistence Round-Trip & Entry Point

### Overview

Connect the store to the API with optimistic updates + debounced autosave, add the create-debate flow
and the `/debates/[id]` editor page, and protect the routes.

### As-built reconciliation (post-implementation)

> Phase 4 shipped against the as-built Phase 3 store API. The deviations and additions below diverge
> from the contracts in this phase (and one Phase 2 contract). **Where a contract below conflicts with
> this list, the as-built behavior governs**; the original contracts are kept as intent history.

- **P4-D1 — Not-owner handling is a 404 _page_, not `Astro.redirect`** (§3). The contract said
  "404/redirect if not found or not owned." As-built, `[id].astro` sets `Astro.response.status = 404`
  and renders an inline "Debate not found" page. Reason: a top-level `return Astro.redirect(...)` in
  Astro frontmatter **crashes** the `@typescript-eslint/no-misused-promises` rule (a parser-level
  traversal crash that an inline disable-comment cannot suppress); no existing page in the repo uses a
  frontmatter `return`. Behaviorally still satisfies 4.3/4.8 — unauth is redirected by middleware, a
  non-owner gets a 404.
- **P4-D2 — `updateNodeSchema.url` widened to `z.url().nullable().optional()`** (reaches back into the
  Phase 2 schema contract, which had `url?`). A `null` clears the url server-side when a node switches
  off the `source` role, so the Phase 3 as-built "store clears url on role change" can persist and a
  stale link cannot survive a reload. `createNodeSchema.url` is unchanged (still `z.url().optional()`).
- **P4-D3 — Debate-title cap centralized into `DEBATE_CONSTRAINTS`** (§Phase 2 / §Critical-Details had
  `.max(120)` inline). The literal `120` now lives once in `src/lib/debate/nodeConstraints.ts`
  (`DEBATE_CONSTRAINTS.title = { max: 120, warnAt: 110 }`) and is imported by `schemas.ts` and
  `CreateDebateForm.tsx`. Same value, no behavior change; the DB `check (char_length(title) <= 120)` is
  mirrored by a comment on the constant. (Captured as a lessons.md rule.)
- **P4-D4 — Editor page is header + canvas, not "full viewport height"** (§3). `[id].astro` renders a
  new `DebateHeader.astro` (logo/Home link, debate title, username, Sign out) above a `flex-1 min-h-0`
  canvas wrapper inside a `flex h-screen flex-col`. The header needs `min-h-0` on the canvas wrapper so
  React Flow's parent-measured viewport can shrink below the header.
- **Other as-built additions not in the plan:** landing CTAs ("Start a Map" / "Start Building Your Map")
  now route to `/debates/new` (`LandingHeader.astro`, `HeroSection.astro`); "Back to dashboard" links in
  `new.astro` and the `[id].astro` 404 branch became "Back to home" (`/`). The editor hydrates the store
  via a new `hydrate(debateId, graph)` action rather than calling `setGraph` directly (§3 wording).

### Changes Required:

#### 1. Persistence wiring

**File**: `src/components/debate/persistence.ts` (or store enhancer), `src/components/debate/store.ts`

**Intent**: Translate store mutations into scoped API calls — immediate for structural ops, debounced
for position drags — keeping optimistic UI under the <200ms NFR.

**Contract**: Structural actions call the matching Phase 2 endpoint after the optimistic store update;
failures surface a non-blocking error and reconcile. **Wire against the Phase 3 as-built store API:**
the structural actions are `createStatementNode`, `createConnectiveNode`, `deleteNodes`, `deleteEdge`,
`commitConnection(kind)` (relation create — **not** `onConnect`), `updateRelationKind(id, kind)`, and
`updateNodeFields(id, patch)` (field/role edits). Note `commitConnection` and `updateRelationKind` also
set the edge's `targetHandle` (D7) — persist nodes/relations only; **the `"pending"` relation kind and
the `"__pending__"` preview edge are client-only transients and must never be sent to the API** (D16).
Position changes from `onNodesChange` are persisted via `PATCH node` debounced ~400ms, sending the
final position. Created entities reconcile the client temp id with the server-returned id. **In-flight
id gating:** while a node's create POST is unresolved (still carrying a client temp id), gate any op
that depends on its server id — disable its connection handles and inline edit-mode inputs and mark it
pending — so a relation create or node PATCH can never fire against an id the server has not yet issued.
The handles/inputs re-enable when the real id lands. (Chosen over a per-node mutation queue: simpler,
and the <200ms create makes the disabled state barely perceptible.)

#### 2. Create-debate flow

**File**: `src/pages/debates/new.astro`, `src/components/debate/CreateDebateForm.tsx`
(reuses `POST /api/debates`)

**Intent**: Minimal entry point to create a debate (title + root Claim) and redirect into its editor.

**Contract**: A `client:load` controlled form (title, root Claim title, optional root body) posting to
`POST /api/debates`; on success redirect to `/debates/[id]`. Mirrors the `SignUpForm` controlled pattern.

#### 3. Editor page

**File**: `src/pages/debates/[id].astro`

**Intent**: Server-load the debate graph for the owner and mount the editor island hydrated with it.

**Contract**: Astro page reads `id`, builds the server client, loads the graph via the repository
(404/redirect if not found or not owned — RLS returns no rows), and mounts `MapEditor`
(`client:only="react"`) passing the initial graph for `setGraph`. Layout gives the canvas a full
viewport height.

**Missing endpoint note**: There is no `GET /api/debates/:id` HTTP endpoint that returns the full
`DebateGraph` (debate + nodes + relations). The initial load works because the Astro page calls the
repository directly on the server. However, if the editor ever needs to **re-fetch** the graph
client-side (e.g. after a network reconnect, a hard refresh triggered by the island, or a future
multi-user sync), there is no endpoint to call. **This endpoint is added as Phase 4 step 5 below.**

#### 4. Route protection

**File**: `src/middleware.ts`

**Intent**: Require auth for the new routes (CLAUDE.md hard rule).

**Contract**: Add `/debates` to `PROTECTED_ROUTES`.

#### 5. GET debate graph endpoint

**File**: `src/pages/api/debates/[id]/index.ts`

**Intent**: Close the re-fetch gap noted in §3 — expose the full `DebateGraph` (debate + nodes +
relations) as a JSON endpoint so client-side code can reload the graph without a full page navigation.

**Contract**: `GET /api/debates/[id]` — builds the server client (null-guard → 503), asserts auth via
`getAuthUser` (→ 401), calls `getDebateGraph(supabase, id)` from the repository, returns 404 if the
debate is not found or RLS returns no rows, otherwise `Response.json(graph)`. No new repository
function needed — reuses the existing `getDebateGraph`.

#### 6. Wire spike route to use `debate/` components

**File**: `src/components/spike/MapSpikeCanvas.tsx`

**Intent**: Make `/spike/map` a live regression canvas for the real visual language. If a refactor
breaks `StatementNode`, `ConnectiveNode`, `RelationEdge`, or the floating edge utils, the spike route
breaks too — giving instant visual feedback without touching the debate editor.

**Contract**: Update `MapSpikeCanvas.tsx` to import `StatementNode`, `ConnectiveNode`, `RelationEdge`,
`floatingEdgeUtils`, and `mapVisualLanguage` from `src/components/debate/` instead of local spike
copies. Keep `exampleMap.ts` and `demoData.ts` in `src/components/spike/` — they are demo fixtures,
not production code, and their type imports already point at the spike-local node/edge types which
now resolve transitively through `debate/`. The spike route stays live as a static read-only demo
(no store, no persistence) driven by the promoted components. Not load-bearing for the debate editor
— do after the editor is verified.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Build passes: `npm run build`
- Unauthenticated GET of `/debates/new` and `/debates/<id>` redirects to `/auth/signin`.

#### Manual Verification:

- Create a debate → redirected into `/debates/[id]` with the root Claim node present.
- Rebuild a small map (root Claim + Data + Warrant + Source + one AND/OR connective, one relation of
  each kind), move nodes, edit body/url in the panel.
- Reload the page → graph and node positions restore identically.
- Node add/edit/connect feel instant (<200ms perceived); position drags persist after settling.
- A second account navigating to the first account's `/debates/[id]` is redirected/404 (RLS).
- No regression on existing auth/dashboard routes.

**Implementation Note**: Final phase — confirm the full manual round-trip before closing.

---

## Testing Strategy

> **Deferred to Module 3.** This slice ships no test runner (no vitest/jest in the stack, no `test`
> script) and no phase installs one — actual verification here is manual + `lint`/`build`/`curl` per
> each phase's Success Criteria. The cases below are the test surface to wire up once the Module 3
> testing gate lands; they are intent, not a deliverable of S-01.

### Unit Tests:

- Zod schemas: valid payloads pass; bad enum / missing required fields / statement node without
  `statementType` / connective node with a `title` fail.
- Rows↔graph mapping: a debate graph round-trips parent+child rows → nodes/edges → rows without loss
  (positions, roles, ops, kinds, url, isRoot derivation).

### Integration Tests:

- API CRUD happy paths create/mutate/delete the expected rows; unauthenticated requests write nothing
  (RLS).
- `create_debate_with_root` RPC leaves no debate without a non-null `root_node_id`.
- Direct `nodes` inserts (statement and connective kinds) produce a single row with the correct JSONB
  metadata shape; the DB `check` constraints reject title > 60 chars and body > 250 chars.

### Manual Testing Steps:

1. Create a debate; confirm redirect into the editor with the root Claim node.
2. Add each statement role + AND/OR via right-click; confirm accent + badge per role.
3. Connect nodes with each relation kind; confirm edge style/label and floating routing for link/rebuts.
4. Edit title/body and set a source url in the detail panel.
5. Move nodes, reload — confirm exact graph + layout restore.
6. From a second account, attempt to open the first account's debate — confirm denied.

## Performance Considerations

- Optimistic store updates keep node add/edit/connect under the 200ms perceived-response NFR.
- Debounce position autosave (~400ms) so drags don't flood the API.
- `useShallow` selectors + module-level `nodeTypes`/`edgeTypes` prevent re-render storms.
- Small MVP graphs — no virtualization or graph-size cap (PRD Open Question #5).

## Migration Notes

- First domain migration after F-01's `profiles`. Forward-only; `npx supabase db reset` locally and
  `npx supabase db push` after merge (README). No data backfill — new tables only.

## References

- Findings (spike-vs-PRD reconciliation, the driver for this rewrite):
  `context/changes/advocate-map-builder/findings.md`
- Spike components (visual-language reference): `src/components/spike/*`
- Roadmap slice S-01: `context/foundation/roadmap.md` (Slices → S-01)
- PRD: US-01, FR-003–FR-006 (Map Building); guardrails (Map data integrity) — note FR-004/005/006 are
  superseded by `findings.md` on statement types, sources, and relation kinds.
- F-01 migration pattern: `supabase/migrations/20260525142850_create_profiles.sql`
- Server client: `src/lib/supabase.ts`; lib primitive: `src/lib/users.ts`
- Island/form pattern: `src/pages/auth/signup.astro`, `src/components/auth/SignUpForm.tsx`
- React Flow skill: `.claude/skills/react-flow/SKILL.md`; ctx7 `/websites/reactflow_dev`, `/pmndrs/zustand`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data Model & Types

#### Automated

- [x] 1.1 Migration applies cleanly to a fresh local stack (`npx supabase db reset`)
- [x] 1.2 Types regenerate and include new tables/enums/RPC
- [x] 1.3 Type checking passes (`npx astro sync && npm run lint`)
- [x] 1.4 Build passes (`npm run build`)

#### Manual

- [x] 1.5 create_debate_with_root produces a debate with non-null root_node_id → statement/claim node

  ```sql
  -- Run in Studio SQL editor (or via MCP execute_sql) after db reset + seed
  -- Verify RPC output: debate row has non-null root_node_id pointing at a claim node
  select
    d.id            as debate_id,
    d.title,
    d.root_node_id,
    n.kind,
    n.metadata->>'statement_type' as statement_type,
    n.metadata->>'title'          as root_title
  from public.debates d
  join public.nodes n on n.id = d.root_node_id
  where d.title = 'Seed: Climate Change Debate';
  -- Expected: 1 row, kind='statement', statement_type='claim', root_node_id NOT NULL
  ```

- [x] 1.6 Direct node inserts (statement + connective) produce a single row with correct JSONB metadata shape; check constraints reject over-length title; delete cascades relations

  ```sql
  -- Check all nodes in the seed debate and their kinds/metadata shapes
  select
    n.id,
    n.author_id,
    n.kind,
    n.metadata->>'statement_type' as stmt_type,
    n.metadata->>'op'             as connective_op,
    n.metadata->>'title'          as title,
    n.position_x,
    n.position_y
  from public.nodes n
  join public.debates d on d.id = n.debate_id
  where d.title = 'Seed: Climate Change Debate'
  order by n.created_at;
  -- Expected: 6 rows (claim, data, warrant, source, rebuttal, connective); author_id non-null on all

  -- Check cascade: delete one node and confirm its relations disappear
  -- (run in a transaction so you can rollback)
  begin;
    delete from public.nodes
    where id = (
      select n.id from public.nodes n
      join public.debates d on d.id = n.debate_id
      where d.title = 'Seed: Climate Change Debate'
        and n.metadata->>'statement_type' = 'data'
      limit 1
    );
    -- Should see 0 rows for any relation that had the deleted node as source or target
    select count(*) as dangling_relations
    from public.relations r
    join public.nodes n on n.id = r.source_node_id or n.id = r.target_node_id
    where n.metadata->>'statement_type' = 'data';
  rollback;

  -- Check check constraint: title > 60 chars must be rejected
  insert into public.nodes (debate_id, author_id, kind, position_x, position_y, metadata)
  select d.id, d.owner_id, 'statement', 0, 0,
    jsonb_build_object(
      'statement_type','claim',
      'title', repeat('x', 61)
    )
  from public.debates d where d.title = 'Seed: Climate Change Debate'
  limit 1;
  -- Expected: ERROR: new row violates check constraint
  ```

- [x] 1.7 Second user cannot select the first user's debate/nodes/statements/connectives (RLS)

  ```sql
  -- In Studio: open a new SQL tab, set auth context to the SECOND seed user,
  -- then attempt to read the FIRST user's debate.
  -- The second user's id is '00000000-0000-0000-0000-000000000002'.
  -- Simulating in SQL (works via set_config in a transaction):
  begin;
    select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
    select set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
    -- These selects go through RLS (role = authenticated, not superuser)
    set local role authenticated;
    select count(*) as visible_debates from public.debates;
    -- Expected: 0 (second user owns no debates)
    select count(*) as visible_nodes   from public.nodes;
    -- Expected: 0
    select count(*) as visible_relations from public.relations;
    -- Expected: 0
  rollback;
  -- Note: if Studio SQL runs as superuser it bypasses RLS — use the "Use RLS" toggle
  -- in Studio or verify by signing in as seed2@example.com via the app.
  ```

### Phase 2: Persistence API & Validation

#### Automated

- [x] 2.1 Type checking passes (`npx astro sync && npm run lint`)
- [x] 2.2 Build passes (`npm run build`)
- [x] 2.3 Invalid payloads return 400 (HTTP smoke check)

#### Manual

- [x] 2.4 POST /api/debates creates a debate + root node

  > **Agent-automatable**: Yes — obtain a bearer token via Supabase password auth, call the endpoint, verify via MCP SQL. No browser required.

  ```bash
  # 1. Get access token for seed user 1 (s@e.pl / pwd123!)
  TOKEN=$(curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
    -H "apikey: $(grep SUPABASE_KEY .dev.vars | cut -d= -f2)" \
    -H "Content-Type: application/json" \
    -d '{"email":"s@e.pl","password":"pwd123!"}' | jq -r '.access_token')

  echo "TOKEN: $TOKEN"   # Should be a long JWT string, not "null"

  # 2. Create a debate via the API
  DEBATE=$(curl -s -X POST http://localhost:4321/api/debates \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"Verify Debate","rootTitle":"Root Claim","rootBody":"Body text"}')

  echo $DEBATE   # Expected: {"id":"<uuid>"}
  DEBATE_ID=$(echo $DEBATE | jq -r '.id')
  echo "DEBATE_ID: $DEBATE_ID"
  ```

  Then verify the row in the DB via MCP `execute_sql`:
  ```sql
  select d.id, d.title, d.root_node_id, n.kind, n.metadata->>'statement_type' as stmt_type
  from public.debates d
  join public.nodes n on n.id = d.root_node_id
  where d.title = 'Verify Debate';
  -- Expected: 1 row, kind='statement', stmt_type='claim', root_node_id NOT NULL
  ```

- [x] 2.5 Statement/connective/relation create+delete round-trip mutate the DB

  > **Agent-automatable**: Yes — chain the bearer token from 2.4 through create/delete calls, verify cascade via MCP SQL.

  ```bash
  # (TOKEN and DEBATE_ID captured from step 2.4)

  # Create a statement node (data role) — expects 201 with full NodeRow body
  DATA_NODE=$(curl -s -X POST "http://localhost:4321/api/debates/$DEBATE_ID/nodes" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"nodeKind\":\"statement\",\"debateId\":\"$DEBATE_ID\",\"statementType\":\"data\",\"title\":\"Supporting Data\",\"positionX\":200,\"positionY\":100}")
  DATA_ID=$(echo $DATA_NODE | jq -r '.id')
  echo "DATA_ID: $DATA_ID"

  # Create a connective node (AND) — expects 201 with full NodeRow body
  AND_NODE=$(curl -s -X POST "http://localhost:4321/api/debates/$DEBATE_ID/nodes" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"nodeKind\":\"connective\",\"debateId\":\"$DEBATE_ID\",\"connectiveOp\":\"and\",\"positionX\":400,\"positionY\":100}")
  AND_ID=$(echo $AND_NODE | jq -r '.id')
  echo "AND_ID: $AND_ID"

  # Get root node id via GET /nodes (returns NodeRow[]; metadata is an inline JSON object)
  ROOT_ID=$(curl -s "http://localhost:4321/api/debates/$DEBATE_ID/nodes" \
    -H "Authorization: Bearer $TOKEN" | jq -r '[.[] | select(.metadata.statement_type=="claim")][0].id')
  echo "ROOT_ID: $ROOT_ID"

  # Create a relation: data → root (supports) — expects 201 with full RelationRow body
  REL=$(curl -s -X POST "http://localhost:4321/api/debates/$DEBATE_ID/relations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"debateId\":\"$DEBATE_ID\",\"sourceNodeId\":\"$DATA_ID\",\"targetNodeId\":\"$ROOT_ID\",\"kind\":\"supports\"}")
  REL_ID=$(echo $REL | jq -r '.id')
  echo "REL_ID: $REL_ID"

  # Patch the relation kind (supports → rephrases) — expects 200 with updated RelationRow
  curl -s -X PATCH "http://localhost:4321/api/debates/$DEBATE_ID/relations/$REL_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"kind":"rephrases"}' | jq '.kind'
  # Expected: "rephrases"

  # Delete the data node — expects 204 No Content; relation must cascade
  curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE "http://localhost:4321/api/debates/$DEBATE_ID/nodes/$DATA_ID" \
    -H "Authorization: Bearer $TOKEN"
  # Expected: 204
  ```

  Then verify cascade via MCP `execute_sql`:
  ```sql
  -- Replace the placeholders with the echoed IDs above
  select count(*) as dangling from public.relations where id = '<REL_ID>';
  -- Expected: 0 (cascaded on node delete)

  select count(*) as nodes_remaining from public.nodes where debate_id = '<DEBATE_ID>';
  -- Expected: 2 (root claim + AND connective)
  ```

- [x] 2.6 Unauthenticated request writes/reads nothing (RLS)

  > **Agent-automatable**: Yes — trivially. No session needed; absence of auth is the test condition.

  ```bash
  # POST without auth — expect 401 (getAuthUser returns null → handler returns 401)
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4321/api/debates \
    -H "Content-Type: application/json" \
    -d '{"title":"Hack","rootTitle":"Claim"}'
  # Expected: 401

  # GET nodes without auth
  curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:4321/api/debates/00000000-0000-0000-0000-000000000000/nodes"
  # Expected: 401
  ```

  Also verify the DB layer directly via MCP `execute_sql` (confirms RLS, not just app layer):
  ```sql
  begin;
    select set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    select count(*) as visible_debates from public.debates;
    -- Expected: 0 (anon SELECT revoked)
  rollback;
  ```

### Phase 3: Editor Island (Store, Canvas, Nodes, Detail Panel)

#### Automated

- [x] 3.1 Type checking passes (`npx astro sync && npm run lint`)
- [x] 3.2 Build passes (`npm run build`)
- [x] 3.3 No react-compiler / react-hooks lint errors in new components

#### Manual

- [x] 3.4 Canvas renders with React Flow CSS + MapLegend; nodes draggable
- [x] 3.5 Pane right-click → add menu at cursor with 6 roles + AND/OR (each with badge); creates node correctly
- [x] 3.6 Node right-click → context menu (Edit/Delete); Edge right-click → context menu (Edit/Delete, opens ConnectKindPicker)
- [x] 3.7 Source handles visible on node hover (accent-colored); target handles invisible but accepting
- [x] 3.8 Drag-connect → pick kind → styled, labeled edge; link/rebuts route via floating utils
- [x] 3.9 Detail panel opens on select (single panel, replaces); title/body edit + source url work
- [x] 3.10 No remount flicker / max-update-depth on select/pan/zoom

### Phase 4: Wire-up, Persistence Round-Trip & Entry Point

#### Automated

- [x] 4.1 Type checking passes (`npx astro sync && npm run lint`) — 1f79ab6
- [x] 4.2 Build passes (`npm run build`) — 1f79ab6
- [x] 4.3 Unauthenticated /debates/new and /debates/[id] redirect to /auth/signin — 1f79ab6

#### Manual

- [x] 4.4 Create debate → redirected into editor with root Claim node — 1f79ab6
- [x] 4.5 Build small map (root + Data + Warrant + Source + AND/OR connective, each relation kind), edit body/url — 1f79ab6
- [x] 4.6 Reload restores graph + positions identically — 1f79ab6
- [x] 4.7 Add/edit/connect feel instant (<200ms); position drags persist after settling — 1f79ab6
- [x] 4.8 Second account cannot open the first account's debate (RLS) — 1f79ab6
- [x] 4.9 No regression on existing auth/dashboard routes — 1f79ab6
- [x] 4.10 GET /api/debates/[id] returns the full debate graph for the owner; 404 for unknown/unowned id; 401 without auth — 1f79ab6
- [x] 4.11 MapSpikeCanvas.tsx imports from debate/ components; /spike/map renders correctly as a static demo — 1f79ab6
