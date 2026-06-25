---
date: 2026-06-24T14:31:56+0200
researcher: bartoshqr
git_commit: 46e774b4d40efbdb80984e8c986b92f966854cf1
branch: develop
repository: cothi10xdevs
topic: "Publishable debate showcase — anon read path, frozen map reuse, route protection, publish precondition"
tags: [research, codebase, rls, react-flow, middleware, supabase, showcase, anon-read]
status: complete
last_updated: 2026-06-24
last_updated_by: bartoshqr
last_updated_note: "Resolved all 5 open questions into Decisions + Net design"
---

# Research: Publishable Debate Showcase (S-09)

**Date**: 2026-06-24T14:31:56+0200
**Researcher**: bartoshqr
**Git Commit**: 46e774b4d40efbdb80984e8c986b92f966854cf1
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

For the `publishable-debate-showcase` change (roadmap S-09): research the four areas needed to add
(1) a publish primitive on debates and (2) a public, anonymous, read-only `/showcase/[id]` route:

1. RLS & graph-table policies for the anonymous read path (and the IDOR/leak surface, test-plan Risk #1).
2. The map/canvas component and how to reuse it in a frozen read-only mode (S-05 precedent).
3. Middleware & route protection — keeping `/showcase/[id]` deliberately public.
4. The "round complete / summary exists" publish precondition and the repository layer.

## Summary

The feature is **greenfield** — no publish/showcase/`public`/`published` code exists yet anywhere in
`src/` or `supabase/`. The good news from the research: **the map canvas is already reuse-ready** and
**no new client/store flag is needed** to render a frozen board. The real work is concentrated in the
**data-access layer** (a `public` column on `debates`, anon `SELECT` RLS across five tables, and a
public summary read path) — exactly the "meaty part" the change.md predicted.

Four load-bearing facts shape the whole design:

- **The debate graph is a flat star.** Every child table (`nodes`, `relations`, `exchanges`, `marks`)
  FKs **directly** to `debates` via its own `debate_id` column. No multi-hop chains — every anon policy
  is a single `EXISTS (... debates where id = debate_id and public = true)`.
- **There is no `statements` table and no `summary` table.** "Statements" are `nodes` rows with
  `kind = 'statement'`. The divergence summary is **computed at read time** from `nodes` + `marks` +
  `relations` by `classifyDivergence` — so the anon read needs those same tables plus `exchanges`
  (for the gate), not a separate summary table.
- **The canvas already freezes via existing props.** Passing `canEdit={false}` + `viewer={null}` to
  `MapEditor` collapses every content gate to off while leaving pan/zoom on and marks rendered
  read-only. This is the `canEdit` flag (S-02) reinforced by the S-05 `canWriteContentNow` cascade.
- **The publishable precondition already exists as code.** `getDivergenceSummary(...) !== null`
  encodes exactly "a divergence summary exists" (`status === 'completed' || currentRound >= 2`).
  Reuse it so publishability and summary-availability can never drift.

## Detailed Findings

### Area 1 — RLS & graph-table policies for the anon read path

**Schema (flat star around `debates`).** All graph tables are in schema `public`:

| Table       | Defined at                                                         | FK to debates                | Sensitive content it holds                                                |
| ----------- | ------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `debates`   | `supabase/migrations/20260528000001_create_debate_graph.sql:21-29` | is the root (`id`)           | `owner_id`, `title`, `root_node_id`                                       |
| `nodes`     | `20260528000001_create_debate_graph.sql:31-46`                     | `debate_id` not null (`:33`) | `metadata` jsonb (statement title/body/url), `author_id`, `kind`          |
| `relations` | `20260528000001_create_debate_graph.sql:54-63`                     | `debate_id` not null (`:56`) | graph structure (supports/rebuts/link/rephrases)                          |
| `exchanges` | `20260609000001_create_exchanges.sql:13-32`                        | `debate_id` not null (`:15`) | `advocate_id`, `challenger_id`, `status`, `current_round`, `current_turn` |
| `marks`     | `20260610000001_create_marks_and_authorship.sql:24-39`             | `debate_id` not null (`:26`) | `stance` (accept/challenge/abstain), `valid`                              |

**No `public`/`published_at` column on `debates`** — confirmed against the migration
(`20260528000001_create_debate_graph.sql:21-29`) and the generated types
(`src/db/database.types.ts`, `debates.Row` = `created_at, id, owner_id, root_node_id, title`). The
`public: boolean` at `database.types.ts:443` belongs to `storage.buckets`, not `debates`. A migration
must `alter table public.debates add column public boolean not null default false` (plus optional
`published_at timestamptz`), then `npm run db:types`.

**Current RLS — everything is `to authenticated`; anon sees nothing.** `20260528000001:79-81` does
`revoke select on public.{debates,nodes,relations} from anon`. Live SELECT policies:

- `debates` — `20260611000002_round_close_and_mini_turn.sql:213-222`: `owner_id = auth.uid()` OR
  challenger-of-exchange EXISTS. References `owner_id` directly to avoid self-recursion (note at
  `20260609000001:111-112`).
- `nodes` — `20260611000002:227-239`; `relations` — `20260611000002:244-256`: owner-of-debate OR
  challenger EXISTS.
- `exchanges` — `20260609000001:49-53`: membership only (`advocate_id`/`challenger_id = auth.uid()`).
- `marks` — `20260610000001:190-197`: owner-of-debate EXISTS OR `is_accepted_challenger(debate_id)`.

**SECURITY DEFINER helpers already in use** (pattern to mirror): `is_debate_owner(uuid)`
(`20260609000002:18-29`), `is_accepted_challenger(uuid)` (`20260610000001:54-67`, widened
`20260611000002:192-205`). All are `stable`, `set search_path`, `execute` revoked from `public, anon`,
granted to `authenticated`.

**What the anon read requires.** Add a **separate** `for select to anon` policy on each of the five
tables (RLS policies are OR'd per role, so existing `authenticated` policies are untouched):

- `debates`: `using (public = true)` — plain column predicate, no subquery.
- `nodes` / `relations` / `marks`: `EXISTS (select 1 from public.debates d where d.id = <tbl>.debate_id and d.public = true)`.
- `exchanges`: **must also get an anon policy** gated the same way — the summary path calls
  `getDebateExchange` to read `status`/`current_round` for the gate
  (`src/lib/summary/repository.ts:35-38`). Without it, the summary silently 404s for anon even on a
  published debate.

**Recursion (42P17) assessment.** The `debates` anon policy is a plain column predicate with no
back-reference to the child tables, so the cross-table cycle never closes — strictly, no SECURITY
DEFINER helper is required. **But** to match the repo's existing convention (centralizing such checks
in definer helpers) and to keep the predicate identical across four tables, a
`public.is_public_debate(uuid)` SECURITY DEFINER helper (reads `debates` as owner, granted to `anon`)
is the lowest-risk, recursion-proof choice. See lesson "Break cross-table RLS recursion (42P17) with a
SECURITY DEFINER helper."

**Leak/IDOR surface (test-plan Risk #1).** Every table must be gated on the **same** `public = true`
predicate; a mismatch is the IDOR. Specific failure modes the integration suite must prove against:
(a) an anon policy omitting `public = true` (or `using (true)`) on any one table → full table leak;
(b) gating only `debates` but not its children → anon enumerates `nodes`/`relations`/`marks` directly
by `debate_id` (classic IDOR, since children carry their own `debate_id`); (c) the `EXISTS` subquery
referencing the wrong `debate_id`; (d) forgetting `exchanges` → no leak but summary 404s. The anon
happy-path must return exactly one published debate's full graph + summary and **zero rows** for any
`public = false` debate across all five tables.

### Area 2 — Map/canvas component & frozen read-only reuse

**The component: `MapEditor`** (`src/components/debate/MapEditor.tsx:720-743`, default export). React Flow
(`@xyflow/react`). Wrapper hydrates a Zustand store synchronously, then renders
`<ReactFlowProvider><MapEditorInner/></ReactFlowProvider>`. Custom types: `StatementNode` +
`ConnectiveNode` (`MapEditor.tsx:229-232`), `RelationEdge` (`:234-236`).

**Props** (`MapEditorProps`, `MapEditor.tsx:701-718`): `debateId?`, `initialGraph?: DebateGraph`,
`canEdit?: boolean` (default `true`), `viewer?: ViewerContext | null`, `exchangeId?: string | null`,
`initialMarks?`, `userId?: string | null`.

**Embedding**: `src/pages/debates/[id].astro:96-105` renders `<MapEditor client:only="react" .../>`.
`client:only="react"` = the island renders only in the browser (no server-side HTML), so **all data
must be passed as props** from the Astro frontmatter.

**Editing is centralized in store gates** (`src/components/debate/store.ts`):

- `myTurnOrPreExchange()` (`store.ts:806-810`) → returns `canEdit` when `viewer === null`.
- `canEditNode(id)` (`store.ts:812-818`) → returns `canEdit` when `viewer === null`.
- `canWriteContentNow(viewer)` (`store.ts:58-60`) = `isMyTurn && !(challenger && inMiniTurn)`.

Every UI affordance (add node, drag, connect, edit fields, role/root menu, delete, edge edit, marks,
submit) reads these gates — see the per-affordance table in the transcript. **Pan/zoom are never
gated** (React Flow `Controls`/`Background` always on) — exactly what a frozen showcase needs.

**S-05 "content controls frozen" precedent** (`context/archive/2026-06-12-s05/plan.md:274-307`,
`change.md:25-34`): a single shared store gate. Because `myTurnOrPreExchange()`/`canEditNode()` route
through `canWriteContentNow`, one false cascades to every content control. The fully-frozen-board
precedent is the `completed` status path (`src/lib/debate/viewer.ts:28-29,40-53`): on completion
`isMyTurn` is forced false → all content gates off, mark bar shown read-only; "the map is fully
immutable on `completed`" (`s05/change.md:19`). Note that path still needs a non-null `viewer`.

**Reuse verdict — no new canvas flag needed.** Pass `canEdit={false}` + `viewer={null}`: both gates
collapse to `canEdit` (false), disabling add/drag/connect/delete/edit/role/root/kind-picker. Marks are
inert (`canMarkNode`/`isMarkableNode` false when `viewer===null`, `store.ts:820,827`) but still
**display** read-only as long as `currentMark !== undefined` (`StatementNode.tsx:78`). Pan/zoom stay
on. So pass `canEdit={false}`, `viewer={null}`, `userId={null}`, and **pre-load `initialMarks`
server-side** (the debate page skips the marks fetch when `viewer===null`, `[id].astro:43`, so the
showcase must supply them explicitly to show frozen marks). The turn-state poll never starts
(`MapEditor.tsx:405` early-returns when no `viewer`/`exchangeId`).

Note: there is a separate static spike (`src/components/spike/MapSpikeCanvas.tsx`,
`src/pages/spike/map.astro`) — a non-store-backed example, **not** the reuse target.

### Area 3 — Middleware & route protection

`src/middleware.ts` (full file, 25 lines):

- `const PROTECTED_ROUTES = ["/dashboard", "/debates"];`
- Matching is **prefix** via `PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))`.
- Unauthenticated request to a protected route → `context.redirect("/auth/signin")` (302). Authenticated
  → `next()`. Unprotected routes always proceed; `context.locals.user` is set to the user or `null`.
- The Supabase client is created **before** the auth check (`createClient(context.request.headers,
context.cookies)`), so even anonymous requests get a client.

`src/lib/supabase.ts:1-29`: `createClient` uses `createServerClient` from `@supabase/ssr` with
`SUPABASE_KEY` (the **anon-capable** public key — not service role). Reads session from cookies or a
`Bearer` header. Returns `null` if env unconfigured. An anonymous request gets a usable, RLS-scoped
client.

**Precedent public pages**: `/` (`index.astro` — queries only when `user` is set), `/coming-soon`,
`/auth/signin|signup|confirm-email`, `/spike/map`. Public APIs with **no** `withAuth`:
`/api/auth/username-available|signup|signin|signout` — they create a client directly and return error
JSON, never 401.

**To keep `/showcase/[id]` public**: do NOT add `/showcase` to `PROTECTED_ROUTES`; do NOT wrap any
companion API in `withAuth` (`src/lib/api.ts:10`, which 401s anon). The page gets an anon client and
relies on the new `public = true` RLS for visibility.

> ⚠️ **Correction to one sub-agent suggestion**: the middleware agent's example showed the showcase page
> calling `supabase.from(...)` inline. That violates the repo's hard lesson _"Keep all Supabase calls in
> a repository — pages and endpoints never query directly."_ The showcase page must call a typed
> repository function (e.g. an anon-capable `getPublicDebateGraph` / `getDivergenceSummary`), not query
> Supabase inline. (The existing `index.astro` profiles query is itself a pre-existing violation, not a
> pattern to copy.)

### Area 4 — Publish precondition & repository layer

**Divergence summary is computed, not stored.** No summary table. Producer:
`getDivergenceSummary({ supabase, debateId })` (`src/lib/summary/repository.ts:31`) → loads exchange,
checks the gate, reads nodes/marks/relations/root, calls `classifyDivergence({ nodes, marks })`
(`src/lib/summary/classify.ts:77`, result shape `:44-51`). Endpoint:
`src/pages/api/debates/[id]/summary.ts:5` (GET, `null` → 404, `withAuth`). UI:
`src/components/debate/DivergenceSummary.tsx` (`client:only`, fetches `/api/debates/[id]/summary`).

**The gate / publishable precondition** (`src/lib/summary/repository.ts:38`):

```ts
const gateMet = exchange.status === "completed" || exchange.currentRound >= 2;
if (!gateMet) return null;
```

`'completed'` is set on the challenger's closing mini-turn submit in the `submit_turn` RPC
(`20260611000002_round_close_and_mini_turn.sql:161-167`; mini-turn entered at `:148-156`; enum value
added in `20260611000001_add_completed_status.sql:7`). **Recommended precondition:** reuse
`getDivergenceSummary(...) !== null` so publishability and summary-availability cannot drift.

**Repository layer** (hard rule: all Supabase access in `src/lib/<domain>/repository.ts`):

- `src/lib/debate/repository.ts` (positional args — predates the destructuring convention):
  `getDebateGraph(supabase, debateId): Promise<DebateGraph | null>` (`:197`, returns
  `{ debate, nodes, relations }`, interface `:172`), `listMyDebates` (`:32`), `getDebateDeletability`
  (`:149`), plus `createDebate`/`deleteDebate`/`setDebateRoot`/node+relation CRUD (`:178-410`).
- `src/lib/exchange/repository.ts` (positional): `getDebateExchange(supabase, debateId)` (`:138`).
- `src/lib/mark/repository.ts` (object-destructuring): `getDebateMarks({ supabase, debateId })` (`:30`).
- `src/lib/summary/repository.ts` (object-destructuring): `getDivergenceSummary({ supabase, debateId })`
  (`:31`).

**How `debates/[id].astro` loads the full graph** (`[id].astro:15-50`): `getDebateGraph` →
`profiles.username` (viewer header) → `getDebateExchange` → `deriveViewer(...)`
(`src/lib/debate/viewer.ts:24-54`) → `getDebateMarks` (only when `viewer` non-null, `:43`). The summary
is **not** fetched server-side — the React component fetches it client-side.

**Data the showcase needs to render map + summary**: `debate` row + `nodes[]` + `relations[]`
(`getDebateGraph`), `marks[]` (`getDebateMarks`), exchange status/round (`getDebateExchange`), and the
computed `DivergenceSummary` (`getDivergenceSummary`).

**Where the publish primitive belongs** (debate domain): a `publishDebate({ supabase, debateId,
ownerId })` mutation and an `isPublishable({ supabase, debateId })` check in
`src/lib/debate/repository.ts` (new functions → object-destructuring per CLAUDE.md). Endpoint: extend
`src/pages/api/debates/[id]/index.ts` (already has GET/DELETE/PATCH via `withAuth`); a "round not
complete" rejection should throw `ValidationError` (422) or `ConflictError` (409) — `withAuth`
(`src/lib/api.ts:10`) already maps those. The public summary read for anon needs either a new
anon-capable endpoint gated on `public = true` or a server-side fetch in the showcase Astro page.

## Code References

- `supabase/migrations/20260528000001_create_debate_graph.sql:21-63` — `debates`/`nodes`/`relations` schema; `:79-81` revoke select from anon
- `supabase/migrations/20260609000001_create_exchanges.sql:13-53` — exchanges schema + SELECT policy; `:111-112` self-recursion-avoidance note
- `supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql:18-29` — `is_debate_owner` definer helper
- `supabase/migrations/20260610000001_create_marks_and_authorship.sql:24-39,54-67,190-197` — marks schema, `is_accepted_challenger`, marks SELECT
- `supabase/migrations/20260611000001_add_completed_status.sql:7` — `'completed'` enum value
- `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:148-167,213-256` — completion in `submit_turn`; live debates/nodes/relations SELECT policies
- `src/lib/summary/repository.ts:31-77` — `getDivergenceSummary`; `:38` the gate
- `src/lib/summary/classify.ts:77` — `classifyDivergence`
- `src/lib/debate/repository.ts:197-214` — `getDebateGraph`
- `src/lib/exchange/repository.ts:138` — `getDebateExchange`
- `src/lib/mark/repository.ts:30` — `getDebateMarks`
- `src/lib/debate/viewer.ts:24-54` — `deriveViewer`, completed read-only path
- `src/components/debate/MapEditor.tsx:701-743` — props + default export
- `src/components/debate/store.ts:58-60,806-822` — `canWriteContentNow`, gate functions
- `src/components/debate/nodes/StatementNode.tsx:78` — marks render when `currentMark !== undefined`
- `src/pages/debates/[id].astro:15-105` — full-graph load + `MapEditor` embed
- `src/middleware.ts:1-25` — `PROTECTED_ROUTES`, prefix match, redirect
- `src/lib/supabase.ts:1-29` — anon-capable `createClient`
- `src/pages/api/debates/[id]/index.ts` / `summary.ts` — endpoints; `src/lib/api.ts:10` — `withAuth` error mapping
- `src/db/database.types.ts` — `debates.Row` (no `public` column)

## Architecture Insights

- **Flat star schema** makes the anon read path uniform: one `EXISTS ... debates.public = true`
  predicate per child table, no join chains.
- **Single-gate UI freeze**: the entire editing surface is driven by two store predicates that both
  collapse to `canEdit` when `viewer === null`. Read-only is a configuration of existing props, not new
  code — a direct payoff of the S-02 `canEdit` + S-05 `canWriteContentNow` design.
- **Summary as a pure read-time computation** means there is no extra table to gate, but it _does_ pull
  in `exchanges` (for the completion gate), which is easy to forget in the anon RLS set.
- **Repository boundary** is a hard rule with a recorded lesson; the showcase page and any companion
  endpoint must go through typed repository functions, not inline `supabase.from()`.
- **`client:only="react"` islands** receive all data as props from Astro frontmatter — so the showcase
  page must server-load graph + marks + summary and pass them down (no client-side auth'd fetch).

## Relevant Lessons (context/foundation/lessons.md)

- _Break cross-table RLS recursion (42P17) with a SECURITY DEFINER helper_ — directly informs the
  optional `is_public_debate` helper.
- _Enforce turn/phase as an RLS predicate, not just a UI lock_ — the analogue here: enforce
  `public = true` at the RLS layer, not just by routing; an anon API call must not bypass it.
- _Keep all Supabase calls in a repository_ — the showcase page/endpoint must not query inline
  (corrects one sub-agent's example).
- _Use `RETURNS SETOF` (not a bare composite) when a Postgres function must signal "no row"_ — applies
  if a publish RPC or anon-read RPC is introduced; smoke-test the not-found/unpublished branch.
- _Centralize shared validation limits_ — if a publishable-precondition constant is introduced, define
  it once.

## Historical Context (from prior changes)

- `context/archive/2026-06-12-s05/plan.md:274-307` & `change.md:19,25-34` — S-05 "content controls
  frozen" / mini-turn UI freeze and the "map fully immutable on `completed`" behavior — the precedent
  for the frozen showcase board.
- `supabase/migrations/20260609000002_fix_exchanges_insert_rls_recursion.sql` — prior 42P17 recursion
  fix that established the definer-helper pattern.

## Related Research

- None yet under `context/changes/**/research.md`. This is the first research artifact for S-09.

## Decisions (resolved 2026-06-24)

These were the open questions; all are now decided. Rationale and trade-offs recorded inline.

1. **Column shape — DECIDED: `public boolean not null default false` + `published_at timestamptz null`.**
   RLS predicates read the cheap, indexable `public` boolean; `published_at` is the audit trail and
   enables a "recently published" sort on the landing page later. `publishDebate` sets both atomically
   and they are never written separately.
   - _Why over `public` only_: the showcase is exactly the surface where "published when" is useful, and
     adding it later means re-migrating. Cost is one nullable column.
   - _Risk_: two columns must stay consistent → mitigated by always writing them together in the
     repository mutation.

2. **Summary delivery — DECIDED: server-fetch-as-prop.** `/showcase/[id].astro` loads the summary in
   frontmatter via `getDivergenceSummary` and passes it to the React component as `initialSummary`.
   `DivergenceSummary.tsx` gets a small change to accept that prop and skip its client-side fetch.
   - _Why over a new anon `/api/showcase/[id]/summary` endpoint_: every anon read path is something the
     integration suite must prove can't leak (Risk #1). Server-fetch keeps the anon surface to **one**
     path (the page), avoids a second endpoint to gate/test, and matches how the `client:only` island
     already receives graph + marks as props.
   - _Cost_: minor prop change to `DivergenceSummary.tsx`.

3. **Recursion gate — DECIDED: adopt a `public.is_public_debate(uuid)` SECURITY DEFINER helper, granted
   to `anon`.** Used identically in the anon SELECT policies of `nodes`, `relations`, `marks`, and
   `exchanges`; the `debates` anon policy stays a plain `public = true` column predicate.
   - _Why over inline `EXISTS`_: one predicate in one place across four tables → no copy-paste drift (a
     drift _is_ the IDOR); matches the existing `is_debate_owner` / `is_accepted_challenger` convention;
     recursion-proof even if the `debates` policy later grows a subquery.
   - _Watch_: this helper is the **exception** — it must `grant execute … to anon` (the existing helpers
     revoke from anon). Easy to get backwards.

4. **Publish lifecycle — DECIDED: a toggle (publish + unpublish), exposed as `PATCH` on the existing
   `[id]` endpoint setting `public`.** Unpublish clears `public` and `published_at`.
   - _Why over one-way publish_: publishing also exposes the **challenger's** statements with no consent
     in MVP (per change.md), so being able to pull a debate back is the safer default. Implementation
     cost over one-way is ~zero (same column write).
   - _UI cost_: the button reflects current published state.

5. **`mark_stance` rename — VERIFY (not a design decision).** `classify.ts:97` switches on `"accept"`;
   the enum was renamed from `'agree'` in `20260612000001_rename_agree_to_accept.sql`. Confirm the
   migration is applied in the target env before trusting summary output. Does not affect the publish
   gate.

### Net design (all decisions applied)

- **Migration**: add `public boolean not null default false` + `published_at timestamptz null` to
  `public.debates`; add `public.is_public_debate(uuid)` SECURITY DEFINER (`stable`, `set search_path`,
  `grant execute to anon`); add `for select to anon` policies — `debates` on `public = true`,
  `nodes`/`relations`/`marks`/`exchanges` on `is_public_debate(debate_id)`. Then `npm run db:types`.
- **Repository** (`src/lib/debate/repository.ts`, object-destructuring args): `setDebatePublished({
supabase, debateId, ownerId, published })` writing both columns atomically; `isPublishable({
supabase, debateId })` delegating to `getDivergenceSummary(...) !== null`. Anon read goes through the
  existing `getDebateGraph` / `getDebateMarks` / `getDivergenceSummary` (now reachable for anon via the
  new RLS) — **never** inline `supabase.from()` in the page.
- **Endpoint**: `PATCH /api/debates/[id]` (existing, `withAuth`) accepts `{ public: boolean }`; rejects
  publishing a non-publishable debate with `ConflictError` (409) / `ValidationError` (422).
- **Public page**: `src/pages/showcase/[id].astro` — kept OUT of `PROTECTED_ROUTES`; server-loads graph
  - marks + summary; renders `MapEditor` with `canEdit={false}`, `viewer={null}`, `userId={null}`,
    `initialMarks`, and `DivergenceSummary` with `initialSummary`.
- **Tests (Risk #1)**: prove an unpublished debate returns zero rows for anon across all five tables,
  and a published one returns exactly its own graph + summary.
