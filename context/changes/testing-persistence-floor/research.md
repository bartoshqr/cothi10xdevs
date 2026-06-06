---
date: 2026-06-06T13:50:55+02:00
researcher: bartoshqr
git_commit: 4060382d29dd7a69fa479b97fe3cb2cc91d055f0
branch: develop
repository: cothi10xdevs
topic: "Test Phase 1 oracle — persistence/shape floor (risks #3 graph-shape legality, #6 missing-id not-found)"
tags: [research, codebase, testing, debate-graph, validation, supabase, vitest, risk-3, risk-6]
status: complete
last_updated: 2026-06-06
last_updated_by: bartoshqr
last_updated_note: "Added follow-up: the root-Claim invariant is set only at creation and not maintained — delete (FK-blocked but 500), PATCH demotion, a non-persisted 'Set as Root' UI action, and an optimistic node-delete with no rollback all break it or its UX."
---

# Research: Test Phase 1 oracle — persistence/shape floor (risks #3, #6)

**Date**: 2026-06-06T13:50:55+02:00
**Researcher**: bartoshqr
**Git Commit**: 4060382d29dd7a69fa479b97fe3cb2cc91d055f0
**Branch**: develop
**Repository**: cothi10xdevs

## Research Question

For rollout Phase 1 of `context/foundation/test-plan.md` ("Bootstrap + persistence/shape floor"), produce the **oracle** — what the server *should* do, grounded in PRD + code + DB, not in the validator's own logic — for:

- **Risk #3**: the server accepts a *structurally illegal graph* — a connective with invalid operands, a relation kind on an illegal target, or an exchange initiated with no root Claim. Prove these are rejected **server-side**, not merely disabled in the UI; legal graphs accepted.
- **Risk #6**: a mutating endpoint on a *missing or RLS-hidden id* returns **200 with a garbage all-null record** instead of **404** (the lived `RETURNS SETOF` trap).

Also: inventory the test-runner state (no runner exists yet) so `/10x-plan` can stand up Vitest with exact config grounded later.

## Summary

The research surfaces **a hard divergence between the product oracle and the shipped implementation for Risk #3 — this is the central finding of this phase and a decision the plan must make explicitly.**

- **Risk #3 (graph-shape legality).** The PRD defines a precise legal/illegal boundary (node taxonomy, relation source/target rules, connective operand cardinality, root-claim initiation). The codebase enforces **only one of the three** illegal cases server-side:
  - **Case 1 — connective invalid operands**: enforced **nowhere** (not Zod, not API, not DB). Any operand count (incl. 0/1) and any operand node type is accepted.
  - **Case 2 — relation kind on illegal target**: enforced **only in the client UI** (`ConnectKindPicker.tsx`). The API accepts any `relation_kind` against any UUID target (only `source ≠ target` is checked at the DB).
  - **Case 3 — no root Claim (FR-007)**: the root Claim is **enforced only at creation** (the `create_debate_with_root` RPC + deferred FK make a rootless debate unreachable *at insert time*). It is **NOT maintained across edits** — see the dedicated finding below. Three post-creation faces break the invariant or its UX:
    - **3a (delete root)**: blocked by the FK (`ON DELETE NO ACTION`), so no dangling reference is possible — but it surfaces as an unmapped **500**, not a clean 409.
    - **3b (demote root via PATCH)**: `patch_node` lets a `PATCH …/nodes/:rootId` change the root's `statement_type` away from `claim`; `root_node_id` then points at a node that is no longer a Claim — a real FR-007 violation reachable by mutation. **Red today.**
    - **3c ("Set as Root" not persisted)**: the UI "Set as Root Claim" action only flips a client `isRoot` flag (and persists the node's type to `claim`); it never moves `debates.root_node_id` (no debate-PATCH endpoint exists). On reload the original root re-asserts itself and the user's choice is silently lost — a store↔persistence drift.
    - **3d (optimistic delete, no rollback)**: `deleteNodes` removes the node from the canvas *before* the server confirms and has **no rollback** on failure (unlike `rollbackNode`/`rollbackEdge` for creates). So a server-rejected delete — the root delete in 3a is the concrete trigger — makes the node vanish from the UI, then reappear on refresh. The canvas silently diverges from the DB until reload.

  → Tests that drive the **API directly** (bypassing React Flow) will expose Cases 1 and 2 as *accepted illegal graphs*. So the plan must choose: **(A)** write red tests that codify the PRD oracle (failing today, demanding server-side validation be implemented first), or **(B)** scope Phase 1's positive assertions to what is enforceable today (root-claim gate + the legal-graph happy path + the structural CHECKs that *do* exist) and record Cases 1/2 as a documented gap / pending risk. This is the kind of "two faces of a risk" the research step exists to surface. **See Open Questions.**

- **Risk #6 (missing-id 404).** Good news: the lived S-01 trap is **already fixed** and all four mutating endpoints currently return 404 on an unknown id. The one RPC in any mutating path (`patch_node`) is correctly declared `RETURNS SETOF public.nodes` (with a comment documenting exactly why bare-composite would 200-with-nulls). The regression a test must **pin** is `patch_node` reverting to a bare composite return — an integration test hitting `PATCH /api/debates/:id/nodes/:nodeId` with a non-existent id and asserting **404** would turn red if that happens. The same unknown-id→404 assertion is worth pinning on all four endpoints; only the PATCH-node case exercises the SETOF-specific failure mode.

- **Runner state.** No test runner, config, `test` script, or test files exist. Vitest/Vite-native is the §4 candidate; the stack is already Vite-based (`vite ^7.3.2`, Astro 6, React 19, TS 5.9, Zod 4). Supabase local is ready (config.toml, 5 migrations, seed.sql). CI runs lint+build; a test step slots between `npm run lint` and `npm run build` in `.github/workflows/ci.yml`.

## Detailed Findings

### Type taxonomy — the shared vocabulary (DB is canonical)

Enums are defined in `supabase/migrations/20260528000001_create_debate_graph.sql` and mirrored in `src/db/database.types.ts` + the client visual layer:

- **`node_kind`**: `statement`, `connective` — migration L7; `src/db/database.types.ts:240`.
- **`statement_type`** (6): `claim`, `source`, `data`, `warrant`, `backing`, `rebuttal` — migration L10-12; `database.types.ts:242`; client mirror `src/components/debate/mapVisualLanguage.ts:3`.
- **`connective_op`** (2): `and`, `or` — migration L14; `database.types.ts:239`.
- **`relation_kind`** (4): `supports`, `link`, `rephrases`, `rebuts` — migration L17; `database.types.ts:241`. Client adds a non-DB synthetic `"pending"` for in-flight UI edges only (`mapVisualLanguage.ts:7`).

This taxonomy matches the PRD's intended model exactly (see Oracle below), so the enums themselves are not the gap — the *relationships between* nodes are.

### Risk #3 — Oracle: what a legal graph is (from the PRD)

The product's authoritative rules (`context/foundation/prd.md`):

- **FR-004a** (prd.md:110-111): "logical-connective nodes (AND / OR) that aggregate multiple supporting Statements before they support a Claim — **AND requires all operands, OR requires any one**. Connectives are a second node category, not a statement type." → connective operand cardinality is **≥1**; operands feed via `link`; the connective's single output `supports` the Claim.
- **FR-006** (prd.md:114-115): directed relations — `supports` (a Statement **or connective** backs **a Claim**), `link` (an operand feeds **a connective** node), `rephrases` (a Statement restates another — e.g. a Source rephrasing the Data it grounds), `rebuts` (a **Rebuttal** attacks **a Claim/Warrant**).
- **FR-007** (prd.md:116-117): "Advocate can initiate an exchange **once at least one root Claim Statement exists** in the map. A root Claim Statement is one explicitly designated as the root by the advocate **at the time of debate creation**."

Derived oracle (legal source→target per relation kind):

| Relation | Legal source | Legal target |
|----------|--------------|--------------|
| `supports` | Statement or Connective | Claim |
| `link` | Statement (operand) | Connective (AND/OR) |
| `rephrases` | Source (Statement) | Data/Warrant/Backing/Claim Statement |
| `rebuts` | Rebuttal (Statement) | Claim or Warrant Statement |

Illegal (per the oracle): missing root Claim at initiation; `supports` not targeting a Claim; `link` not feeding a connective; `rebuts` not sourced by a Rebuttal or not targeting Claim/Warrant; a connective with **zero** operands; a `statement_type` outside the six.

> Note: the PRD does **not** mandate full transitive connectivity to the root during map-building (orphan handling is an exchange-close concern, FR-019/FR-004), and sets **no maximum** operand cap. Do not invent those rules into the oracle.

### Risk #3 — what the code actually enforces (the gap)

**Case 1 — connective invalid operands: NOT enforced anywhere.**
- Zod `createNodeSchema` connective branch (`src/lib/debate/schemas.ts:28-34`) validates only `connectiveOp ∈ {and,or}` + position; operands are separate `relations` created independently.
- `createConnectiveNode` (`src/lib/debate/repository.ts:81-100`) inserts `metadata:{op}` with no operand check.
- `nodes` table CHECKs (migration L31-46) cover only statement title/body length — no operand-count constraint, no trigger.
- The only "rule" artifact is a display string in the legend: `src/components/debate/MapLegend.tsx:45` `{ op:"and", description:"All operands required" }` — documentation, not validation.
- **Boundary drawn by code: none.** A connective with 0/1 operands, or operands of any node type, is fully accepted server-side.

**Case 2 — relation kind on illegal target: client-only guard.**
- The rule lives entirely in `src/components/debate/ConnectKindPicker.tsx:6,26-28`: base kinds `["supports","rephrases","rebuts"]` for any target; `"link"` appended **only when** `targetNode?.type === "connective"`.
- Server: `createRelationSchema` (`src/lib/debate/schemas.ts:48-53`) validates only `kind ∈ relation_kind` + three UUIDs. It does **not** load the target node or check its kind.
- `createRelation` (`src/lib/debate/repository.ts:133-147`) inserts directly. `relations` table (migration L54-63) enforces only `source_node_id <> target_node_id` (no self-loops, L62) + FKs that the nodes exist. No kind/target-type constraint.
- POST handler `src/pages/api/debates/[id]/relations/index.ts` does no target-type validation.
- **A `link` relation pointing at a statement (or any illegal target) is accepted by the API.**

**Case 3 — no root Claim (FR-007): enforced server-side, atomic.**
- `createDebateSchema` (`src/lib/debate/schemas.ts:11-15`) **requires** `rootTitle: z.string().min(1)`.
- Endpoint `src/pages/api/debates/index.ts:14-20` parses, then calls `createDebate`.
- `createDebate` (`src/lib/debate/repository.ts:23-34`) calls only RPC `create_debate_with_root`.
- RPC (migration L156-200) atomically inserts the debate (L177-179), a root statement node with `statement_type='claim'` (L182-193), and sets `root_node_id` (L196). `debates.root_node_id` FK is `deferrable initially deferred` (L49-52) — null only mid-transaction, must point at a node by commit.
- **Latent gap (not via the app):** `root_node_id` column is nullable (migration L27) with no standalone `NOT NULL`/CHECK; the guarantee rests on the deferred FK + the RPC being the only write path. A raw `INSERT INTO debates` bypassing the RPC could commit a null root. App code never does this; tests should assert the **API/RPC contract**, not hand-craft raw inserts.

#### Case 3 (post-creation) — the root-Claim invariant is established at creation but NOT maintained

FR-007 wants the debate's designated root to be a **Claim** for the life of the debate. The code guarantees that only at the moment of creation. Three reachable post-creation paths break the invariant or its UX. **This is a material expansion of Case 3 surfaced during review — it straddles Risk #3 (graph-shape legality) and Risk #5 (edit corrupts the graph, Phase 4).**

**3a — Deleting the root node: FK-blocked (safe), but a 500.** `deleteNode` runs `DELETE FROM nodes WHERE id = nodeId` (`src/lib/debate/repository.ts:128`). The `debates_root_node_id_fkey` is declared with **no `ON DELETE` clause** (migration L49-52) → default `ON DELETE NO ACTION`, `deferrable initially deferred`. Deleting the root → at commit the `debates` row still references it → **FK violation → the delete errors**. So a dangling `root_node_id` is *not* reachable via the API. But `deleteNode` only maps the zero-rows case to `NotFoundError`/404 (`repository.ts:130`); a raw FK-violation error is rethrown unmapped (`repository.ts:129`) and surfaces as a **500**, not a clean `409 "cannot delete the root node"`. *(Inferred from standard Postgres FK-NO-ACTION semantics + the schema; not yet verified against a live DB — Supabase MCP not connected this session.)* Deleting the whole debate is fine: `nodes.debate_id` cascades (migration L33), so nothing dangles.

**3b — Demoting the root via PATCH: a real invariant hole (red today).** The root's claim-ness is hardcoded only at creation (`create_debate_with_root` sets `statement_type='claim'`, migration L188). Nothing preserves it afterward: `updateNodeSchema` allows `statementType: statementTypeEnum.optional()` with no refinement (`src/lib/debate/schemas.ts:42`); `updateNode` forwards it into the metadata patch (`repository.ts:109`); `patch_node` blindly merges `metadata || p_metadata_patch` (`supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:20-21`) with no root-awareness. So `PATCH /api/debates/:id/nodes/:rootNodeId` with `{ "statementType": "rebuttal" }` is **accepted (200)** and `root_node_id` now points at a non-Claim node. (`kind` can't change this way — `patch_node` touches only metadata + position — so the corruption is specifically the `statement_type` demotion, not statement↔connective.) Candidate Phase-1 assertion: *"a PATCH that would change the designated root's `statement_type` away from `claim` is rejected."*

**3c — "Set as Root Claim" is not persisted: store↔persistence drift.** `setRootNode` (`src/components/debate/store.ts:506-514`) is a pure client-state mutation — it flips the `isRoot` flag on store nodes and makes **no API call**; there is no debate-PATCH endpoint to move `root_node_id`. The UI "Set as Root Claim" button (`src/components/debate/nodes/StatementNode.tsx:217-228`) calls `updateNodeFields(id, { statementType: "claim" })` (which *does* persist via `patch_node`) and `setRootNode(id)` (which does **not**). On reload the store recomputes `isRoot: row.id === debate.root_node_id` from the **debate table** (`store.ts:98`), so the *original* creation-time root re-asserts itself and the user's choice is silently discarded — and you can be left with two `claim`-typed nodes, only one of which is the persisted root. The author flagged this inline: `// controversial, let's check with users` (`StatementNode.tsx:222`). This is Risk #2 (round-trip fidelity, Phase 3) territory, but it is the *same* root-identity gap viewed from the client: **the API exposes no legitimate way to change which node is the root.**

**3d — Optimistic node-delete has no rollback: canvas diverges until reload.** `deleteNodes` (`src/components/debate/store.ts:447-471`) optimistically strips the node and its incident edges from the store (L456-460), then fires `apiDeleteNode` and on failure calls only `reportError` (L466-468) — it never restores the node. This is an asymmetry: optimistic *creates* roll back via `rollbackNode` (`store.ts:210`, called at L380/410) and `rollbackEdge` (`store.ts:227`, called at L320), but the delete path has no equivalent. So any server-rejected delete leaves the canvas inconsistent with the DB; the **root delete (3a)** is the concrete reproducible trigger — the node disappears, the 500 fires a toast, and the node reappears only after a refresh re-runs `getDebateGraph`. (`deleteEdge`, L473-487, shares the no-rollback shape.) Suggested fix: on `apiDeleteNode` rejection, re-insert the node + incident edges, mirroring the create-rollback helpers. This is primarily Risk #2 (store↔canvas/persistence fidelity, Phase 3), but it is the client face of the same root-delete gap.

Net: there is no server guard that (a) keeps the designated root a Claim, (b) lets the root be re-designated, or (c) refuses to delete it gracefully — and the client (d) does not reconcile the canvas when a delete is rejected. The creation-time guarantee is the *only* protection, ordinary edits route around it, and the UI does not surface the DB's refusal.

### Risk #6 — Oracle and current behaviour: missing-id → 404

Lesson (`context/foundation/lessons.md` §4 / S-01): a Postgres fn declared `RETURNS <table>`/composite returns a row of all-NULL columns when `UPDATE...RETURNING` matches zero rows; PostgREST serializes it as truthy `{"id":null,...}`, so `.maybeSingle()` + `if(!data)` never fires → 200 instead of 404. `RETURNS SETOF` fixes it (empty set → `[]` → real null).

Mutating endpoints under `src/pages/api/debates/` (the debate resource `[id]/index.ts` is **GET-only** — no debate-level mutate-by-id exists; `POST /api/debates` returns a scalar `uuid`, not mutate-by-id):

| Endpoint | Repo fn / call shape | Return type | 404 reachable? | Trap risk |
|----------|----------------------|-------------|----------------|-----------|
| PATCH node `src/pages/api/debates/[id]/nodes/[nodeId].ts:6` → `repository.ts:102` | `.rpc("patch_node",…).maybeSingle()` (`repository.ts:112-119`) | **SETOF** `public.nodes` (`supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:15`) | **Yes** — `if(!data) throw new NotFoundError()` `repository.ts:123` | **Test target**: guarded now; regresses to 200 if RPC reverts to bare composite |
| DELETE node `nodes/[nodeId].ts:28` → `repository.ts:127` | `.from("nodes").delete().eq("id",…).select("id")` (`repository.ts:128`) | n/a (PostgREST array) | **Yes** — `if(data.length===0) throw NotFoundError` `repository.ts:130` | None (array result) |
| PATCH relation `src/pages/api/debates/[id]/relations/[relationId].ts:6` → `repository.ts:149` | `.from("relations").update({kind}).eq("id",…).select().maybeSingle()` (`repository.ts:154-159`) | n/a (PostgREST) | **Yes** — `if(!data) throw NotFoundError` `repository.ts:161` | None (PostgREST update → real null) |
| DELETE relation `relations/[relationId].ts:28` → `repository.ts:165` | `.from("relations").delete().eq("id",…).select("id")` (`repository.ts:166`) | n/a (PostgREST array) | **Yes** — `if(data.length===0) throw NotFoundError` `repository.ts:168` | None (array result) |

`NotFoundError` is mapped to HTTP 404 by the shared wrapper `withAuth` in `src/lib/api.ts:26`.

**Conclusion:** No endpoint has the live trap today. The SETOF-specific failure mode lives only in the PATCH-node path (the only RPC). The behavioural oracle "unknown id → 404" is worth pinning on **all four** endpoints (cheap, catches future drift); the PATCH-node test additionally protects against the `patch_node` return-type regression.

> The "RLS-hidden id" half of Risk #6 (a row that exists but belongs to another pair) overlaps Phase 2 (RLS, Risk #1). For Phase 1, the cleanest hermetic-vs-integration signal is the **non-existent id** path. A row hidden by RLS should behave identically (empty result → 404) given the same code path, but proving that requires a two-user fixture — note it and defer the RLS-specific assertion to Phase 2.

### Runner inventory (on disk — no config authored)

- **`package.json`** scripts (`package.json:5-14`): `dev/build/preview/astro/lint/lint:fix/format/db:types`. **No `test` script.** No vitest/jest/playwright/@testing-library in deps.
- Relevant deps: `astro ^6.3.1`, `react ^19.2.6`, `@astrojs/react ^5.0.4`, `typescript ^5.9.3`, `zod ^4.4.3`, `@supabase/supabase-js ^2.99.1`, `supabase ^2.23.4`, and a `vite ^7.3.2` override (`package.json:62`) — Vite-native runner (Vitest) fits.
- **No** `vitest.config.*` / `playwright.config.*`. `astro.config.mjs` has only a Tailwind Vite plugin, `output:"server"`, Cloudflare adapter. `tsconfig.json` extends `astro/tsconfigs/strict`, sets `@/* → ./src/*`.
- **No existing test files** anywhere in `src/`.
- **Testable units** in `src/lib/debate/`: pure `isValidUrl()` (`nodeConstraints.ts:12-19`), the Zod schemas (`schemas.ts`), and 9 async repository fns (`repository.ts`) that take a `supabase` client as first arg — injectable for hermetic stubs, runnable against Supabase local for integration.
- **Supabase local ready**: `supabase/config.toml` (Postgres 17, API 54321, db 54322), migrations `20260525142850_create_profiles`, `20260525170303_add_username_available`, `20260528000001_create_debate_graph`, `20260605000001_tighten_graph_write_policies`, `20260605000002_atomic_node_metadata_patch`, plus `seed.sql`.
- **CI** `.github/workflows/ci.yml`: on push to `main` / PR to `main`; steps `npm ci → npx astro sync → npm run lint → npm run build` (+ migration push on push). A test step slots between `lint` and `build`.

## Code References

- `src/lib/debate/schemas.ts:11-15` — `createDebateSchema` requires `rootTitle` (root-claim gate, Case 3).
- `src/lib/debate/schemas.ts:28-34` — `createNodeSchema` connective branch (no operand validation, Case 1).
- `src/lib/debate/schemas.ts:48-53` — `createRelationSchema` (kind+UUIDs only, no target-type check, Case 2).
- `src/lib/debate/repository.ts:23-34` — `createDebate` → RPC `create_debate_with_root`.
- `src/lib/debate/repository.ts:81-100` — `createConnectiveNode` (no operand check).
- `src/lib/debate/repository.ts:102-125` — `updateNode` → `patch_node` RPC + `maybeSingle()` + NotFound guard.
- `src/lib/debate/repository.ts:127-170` — `deleteNode`/`createRelation`/`updateRelation`/`deleteRelation`. `deleteNode:128-130` only maps zero-rows → 404; an FK violation (deleting the root) is rethrown unmapped → 500 (Case 3a).
- `src/lib/debate/schemas.ts:42` — `updateNodeSchema.statementType` optional, unrefined → permits demoting the root away from `claim` (Case 3b).
- `supabase/migrations/20260528000001_create_debate_graph.sql:49-52` — `debates_root_node_id_fkey` with no `ON DELETE` (NO ACTION) — blocks root delete (Case 3a).
- `src/components/debate/store.ts:506-514` — `setRootNode`: client-only `isRoot` flip, no persistence (Case 3c). `store.ts:98` — `isRoot` recomputed from `debate.root_node_id` on hydration.
- `src/components/debate/nodes/StatementNode.tsx:217-228` — "Set as Root Claim" button; persists `statementType:'claim'` but not the root designation; inline `// controversial` note at L222 (Case 3c).
- `src/components/debate/store.ts:447-471` — `deleteNodes`: optimistic removal, `reportError` only, **no rollback** (Case 3d). Contrast the create-rollback helpers `rollbackNode` (`store.ts:210`) and `rollbackEdge` (`store.ts:227`).
- `src/lib/debate/nodeConstraints.ts:1-19` — shared limits + `isValidUrl` (pure unit target).
- `src/lib/api.ts:26` — `NotFoundError` → 404 mapping in `withAuth`.
- `src/pages/api/debates/index.ts:14-20` — debate create handler.
- `src/pages/api/debates/[id]/index.ts` — GET-only (no mutate-by-id).
- `src/pages/api/debates/[id]/nodes/[nodeId].ts:6,28` — PATCH/DELETE node.
- `src/pages/api/debates/[id]/relations/[relationId].ts:6,28` — PATCH/DELETE relation.
- `src/pages/api/debates/[id]/relations/index.ts` — relations POST (no target-type validation).
- `src/components/debate/ConnectKindPicker.tsx:6,26-28` — client-only relation-target legality.
- `src/components/debate/mapVisualLanguage.ts:3,7,14` — client type mirror + synthetic `pending`.
- `src/components/debate/MapLegend.tsx:45` — "All operands required" (display string, not a rule).
- `supabase/migrations/20260528000001_create_debate_graph.sql:7-17` (enums), `:27,:31-46` (nodes CHECKs), `:49-52` (deferred FK), `:54-63` (relations CHECKs), `:156-200` (`create_debate_with_root`).
- `supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:7-9,15` — `patch_node` SETOF + rationale comment.
- `context/foundation/prd.md:104-117` — node/relation taxonomy, FR-004a/006/007.

## Architecture Insights

- **Validation lives at three layers but is thin on graph *shape*:** Zod (param/body well-formedness) → API handler (`withAuth` preamble) → DB (FKs, length CHECKs, enums). The DB enforces *types and existence*, not *relational legality*. There is no server component that loads a target node and checks whether a given `relation_kind` may point at its kind — that knowledge exists only in the React-Flow client.
- **The RPC pattern is the safe write path.** Atomic, multi-row invariants (root-claim creation; SETOF not-found signalling) are correctly pushed into Postgres functions. Where a write goes through plain PostgREST (`relations` insert/update), the invariant simply isn't expressed. This is the structural reason Case 3 is safe and Cases 1/2 are not.
- **Repository functions are dependency-injected** (`supabase` client as first param) — they support both hermetic stub-client tests (partial-failure branches) and real-DB integration tests without refactoring.
- **`lint` + `build` are blind to both risks.** Risk #6 is a runtime-only contract; Risk #3 Cases 1/2 are *absent* validation, not type errors. Only a runtime test (unit on the rule + integration on the API) can see them — exactly why this phase exists.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` §4 — the `RETURNS SETOF` lesson, lived in slice **S-01** where `patch_node` 200'd on an unknown node id. Risk #6 is the regression guard for that fix.
- `context/foundation/lessons.md` §3 — "Centralize shared validation limits" (`nodeConstraints.ts`); relevant if Phase 1 adds operand-cardinality limits, they should live there, not be hard-coded.
- `context/foundation/lessons.md` §1 — the `withAuth`/`guardRequest` shared preamble; confirms why all four endpoints share one 404 mapping (`src/lib/api.ts:26`).
- Recent commits `0b2e1fb` (harden persistence API & graph RLS), `072957c` (valid v4 seed UUIDs) — the RLS tightening is Phase 2's territory; the seed-UUID fix matters for any integration fixture that reuses `supabase/seed.sql`.
- `context/changes/advocate-map-builder/` and `context/changes/bootstrap-verification/` exist as sibling changes — the map-builder slice (S-01) is the code under test here.

## Related Research

- None prior under `context/changes/**/research.md` for testing. This is the first research artifact in the test rollout (Phase 1).

## Open Questions

1. **Risk #3 decision — codify the oracle (red) vs. test what's enforced (green)?** The PRD says Cases 1 (connective operand cardinality ≥1) and 2 (relation-kind→target legality) are illegal, but **the server enforces neither** — only the client does. Options for `/10x-plan`:
   - **(A) Oracle-first / red tests:** write API-level tests asserting `link → statement` and `0-operand connective` are **rejected (400/422)**. These fail today and require server-side validation (likely a Zod superRefine or a new lib guard, with limits in `nodeConstraints.ts`) to be implemented before they go green. Largest signal, but expands Phase 1 scope from "lock shipped behaviour" into "add missing validation."
   - **(B) Scope-to-shipped:** Phase 1 asserts (i) the **root-claim gate** (Case 3, enforceable now), (ii) a **legal-graph happy path** round-trips/accepts, (iii) the structural CHECKs that *do* exist (self-loop rejection, enum/length limits). Record Cases 1/2 as a **documented validation gap** (a new `lessons.md` entry + a noted risk) deferred to a follow-up change. Honest to "lock the floor that exists."
   - This is a genuine WHAT-to-build question (server-side validation is arguably a feature, not a test). Recommend resolving with the user — possibly via `/10x-frame` — before `/10x-plan`, since it changes the phase's deliverable.
2. **Root-Claim invariant across edits (Case 3a/3b/3c) — in scope for Phase 1?** The creation-time root gate (Case 3) is the one rule the server enforces, but it is not maintained afterward. Three sub-decisions for `/10x-plan` (and possibly `/10x-frame`, since 3b/3c imply *features*, not just tests):
   - **3b (demotion):** add a server guard so a PATCH cannot change the designated root's `statement_type` away from `claim` (likely a check in `patch_node`/`updateNode` against `debates.root_node_id`)? A red test pins the intent.
   - **3c (re-designation):** the UI "Set as Root" promises something the API can't deliver. Either add a debate-PATCH path to move `root_node_id` (with validation that the target is a `claim`), or remove/disable the UI action. Round-trip fidelity here is formally Phase 3 (Risk #2) — decide whether to assert it now or cross-reference.
   - **3a (delete):** map the FK-violation to a clean `409` in `deleteNode` rather than a 500? Cheap, improves the contract; a test asserts "deleting the root → 409, debate still has its root."
   - **3d (no delete rollback):** add a rollback to `deleteNodes` (re-insert node + incident edges on `apiDeleteNode` failure), mirroring `rollbackNode`/`rollbackEdge`, so the canvas reconciles with the DB instead of waiting for a refresh. Primarily Risk #2 (Phase 3); pairs naturally with 3a's clean error so the client knows to roll back.
   - These compound Open Question #1's "oracle-first vs. scope-to-shipped" choice: 3b and the demotion guard are the same *add-missing-validation* decision as Cases 1 & 2.
3. **RLS-hidden vs. non-existent id for Risk #6.** Phase 1 can fully cover the *non-existent* id → 404 path. The *RLS-hidden* id → 404 path needs a two-user fixture that belongs to Phase 2 (Risk #1). Confirm Phase 1 asserts only the non-existent case and cross-references Phase 2 for the hidden case.
4. **Test-DB strategy for integration.** Run against Supabase local (real Postgres + migrations + RLS) per §4 — but as the **service-role** client (bypassing RLS) for shape/not-found tests, reserving the anon/two-user path for Phase 2? Decide in `/10x-plan`; affects fixture setup and whether `seed.sql` is reused or each test seeds its own debate via the RPC.
5. **Connective operand "type" rule.** The PRD says operands feed via `link` and a connective's output `supports` a Claim, but does not explicitly forbid a connective operand being another connective. Treat "operand node type" as **unspecified** unless the user clarifies; assert only cardinality (≥1) if option (A) is chosen.
