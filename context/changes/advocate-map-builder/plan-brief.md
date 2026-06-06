# Advocate Map Builder (S-01) — Plan Brief

> Full plan: `context/changes/advocate-map-builder/plan.md`
> Reconciliation driver: `context/changes/advocate-map-builder/findings.md` (the spike is the reference)

## What & Why

Productionize the **map-visual-spike** into the advocate's Toulmin map editor: create a debate with a
root Claim, add typed statement nodes (Claim / Source / Data / Warrant / Backing / Rebuttal) plus
logical connective nodes (AND / OR), attach a `url` to source nodes, and draw directed relations
(supports / link / rephrases / rebuts). This is the schema-foundation slice — the debate / node /
relation model defined here is the substrate every later slice (invites, marks, divergence summary,
multi-round edit/invalidation, parent linking) builds on, so the data model is invested in deeply now.

## Starting Point

The visual language is **already built** in `src/components/spike/` (nodes, edges, legend, floating-
edge routing) and mounted as a static demo at `/spike/map`. Only `profiles` exists (F-01); no domain
tables. Supabase SSR auth, the typed `Database` client, the API-route pattern, and React-island
mounting are all in place. `@xyflow/react@12` is **already installed**; `zustand` and `zod` are not —
this slice adds both and replaces the spike's static `useNodesState`/`useEdgesState` with a store.

## Desired End State

A signed-in advocate creates a debate, lands on `/debates/[id]`, right-clicks to add typed nodes
(6 statement roles or AND/OR), clicks a node to edit its title/body (and `url` for source nodes) in a
side panel, drags to connect nodes with a chosen relation kind, and freely moves/edits/deletes their
own nodes. The `MapLegend` drawer explains the language. Every change autosaves (debounced) to
normalized tables under owner-only RLS; a reload restores the exact graph + layout.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Statement roles | **6** incl. `source` (enum `statement_type`) | Finding 1: a source is a contestable canvas node, not a sidebar sub-entity | findings.md |
| Connective nodes | **AND / OR** as a second node type (enum `connective_op`) | Finding 2: multi-premise arguments need logical aggregators | findings.md |
| Relation kinds | **supports / link / rephrases / rebuts** (drop `bridges`) | Finding 3: `link` feeds connectives, `rephrases` ties source→data; warrant node plays the old `bridges` role | findings.md |
| Sources | **`url` field on the statement node** — no `sources` table | Finding 4: once a source is a node, a separate table duplicates the row | findings.md |
| Root Claim | `debates.root_node_id` FK; `isRoot` derived in the client | DB truth + spike's derived display flag coexist; created atomically via RPC | findings.md / Plan |
| Node storage | **Single table + JSONB**: `nodes` table with `metadata jsonb not null` for kind-specific fields; `author_id` is a **real column** (not in JSONB) on both `nodes` and `relations` | Simpler reads (no join), one RLS policy set, single-row inserts; `author_id` as a column gives a proper FK to `auth.users`, enables `author_id = uid()` RLS, and avoids integrity issues that JSONB UUID strings can't enforce | Plan |
| Char limits | Node title ≤ 60 chars, node body ≤ 250 chars, debate title ≤ 120 chars | Enforces canvas readability for nodes; debate title lives in a wider page header; enforced at Zod `.max()` + DB `check` | Plan |
| Role badge | Shown at node creation (add menu) and **editable** in the detail panel via an inline role picker | Role is a key semantic property; correcting it post-creation avoids deleting and re-adding the node | Plan |
| Persistence | Normalized tables; positions as columns | Row-level RLS/FK/ownership that S-03–S-07 need; satisfies the data-integrity guardrail | Plan |
| Input validation | Add Zod (discriminated union on `nodeKind`) | Honors tech-stack.md; one shared schema set reused downstream | Plan |
| Save trigger | Debounced autosave per entity | Meets <200ms NFR via optimistic updates; row-scoped writes fit future turn model | Plan |
| Add UX | Right-click pane → role/connective menu | Type chosen at creation; `screenToFlowPosition` for cursor placement | Plan |
| RLS scope | Owner-only now | Correct pre-exchange; pair-visibility widens at S-02 | Plan |
| Body UX | Selection detail panel (view + edit) | Robust on a zoom/pan canvas; doubles as edit surface | Plan |
| Visual language | Reuse spike components verbatim | Already designed, built, reviewed; spike is the reference | findings.md |

## Scope

**In scope:** debate + root Claim creation; 6 typed statement nodes with title/body/url; AND/OR
connective nodes; directed typed relations (4 kinds) with floating-edge routing; React Flow canvas +
Zustand store + MapLegend; detail panel; per-entity autosave; minimal create-and-open entry point;
owner-only RLS.

**Out of scope:** invites/exchange (S-02), marks (S-03/04), turn model/invalidation (S-05), debate
list (S-06), parent linking (S-07), global UI restyle, url validation, graph-size caps, connective-
arity enforcement, auto-layout.

## Architecture / Approach

Bottom-up. Single `nodes` table with `author_id uuid not null references auth.users` column and `metadata jsonb not null` for kind-specific fields, alongside `debates` and `relations` (also with `author_id`), is the durable source of truth; a Zustand store is the client-side source of truth for the canvas. Node inserts are single-row (no atomicity concern); only root-claim creation goes through an RPC. The spike's components are promoted from `src/components/spike/` into
`src/components/debate/`, swapping static state for the store and adding add/connect/edit
interactions. A mapping layer converts rows ↔ React Flow nodes/edges. The editor is a browser-only
island (`ReactFlowProvider`, no SSR on Workers). Store mutations call scoped Zod-validated API routes
— immediate for structural ops, debounced for position drags — with optimistic UI.

**React Flow tools used:** `applyNodeChanges`/`applyEdgeChanges`/`addEdge` in the store;
`screenToFlowPosition` for add-at-cursor; `updateNodeData` for panel edits; `isValidConnection` to
gate relation kinds; `onPaneContextMenu`/`onNodeClick`/`onNodesDelete` events; `BaseEdge` +
`getBezierPath` + `EdgeText` + `useInternalNode` (spike `RelationEdge`); `Background`/`Controls`/
`Panel`; module-level `nodeTypes`/`edgeTypes`; `ReactFlowProvider` + CSS import.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model & types | 4 enums, 3 tables (`debates`/`nodes` with `author_id` column + JSONB metadata/`relations` with `author_id` column), owner-only RLS, root-creation RPC, regenerated types | Schema is load-bearing for 6 slices; root FK chicken/egg |
| 2. Persistence API & validation | Zod schemas (discriminated union), CRUD routes, `src/lib` primitives | Schema/route contract must match the store's needs |
| 3. Editor island | Promote spike components, Zustand store, add menu (roles + AND/OR), connect kind picker, detail panel | React Flow footguns (stable nodeTypes, provider, CSS, SSR); kind-validity on connect |
| 4. Wire-up & entry point | Autosave round-trip, create-debate flow, `/debates/[id]`, route protection, retire spike demo | Autosave races on position drags; optimistic id reconciliation |

**Prerequisites:** F-01 (done); spike merged (done); local Supabase stack running.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Root-claim creation relies on an atomic RPC to avoid debates without a root (chicken/egg FK).
- React Flow must never SSR on Cloudflare Workers — editor is a client-only island.
- Source `url` is free text (no validation) per PRD Open Question #2.
- Single-table JSONB trades DB-level column constraints and a dedicated `statements` FK for S-03
  marks for simpler reads (no join), single-row inserts, and one RLS policy set. Kind-specific shape
  is validated at Zod boundary; marks (S-03) will FK to `nodes.id` with an application-level
  `kind = 'statement'` check.
- Visual palette is the spike's existing CSS-variable scheme; a global theme pass is a separate change.

## Success Criteria (Summary)

- Advocate builds a small typed map (statements + a connective + sources + each relation kind), and it
  persists across reloads including node positions.
- A second account cannot read or open another user's debate (owner-only RLS).
- Node add/edit/connect feel instant (<200ms perceived).
