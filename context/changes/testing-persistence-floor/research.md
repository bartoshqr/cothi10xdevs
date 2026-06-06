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
last_updated_note: "PR-review decisions (2026-06-06): corrected the relation oracle (only link→connective is enforced; all other kinds any→any), dropped connective operand cardinality from Phase 1, made root-Claim identity (3a/3b/3c) a Phase-1 TDD feature, kept 3d in the optimistic-rollback change, and deferred two-user RLS fixtures to Phase 2. See the Decisions section."
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

> **Scope settled by PR review (2026-06-06).** The "the plan must choose" framing below is now resolved — see the **Decisions** section. In short: only `link`→connective is a real relation rule (and Phase 1 implements + TDDs it); connective operand cardinality is dropped from Phase 1; root-Claim identity (3a/3b/3c) is a Phase-1 TDD feature; 3d stays in the `optimistic-rollback` change; two-user RLS fixtures move to Phase 2.

The research surfaces **a divergence between the product oracle and the shipped implementation for Risk #3** — the original central finding of this phase. Phase 1 now closes the parts of that gap the team chose to enforce, test-first.

- **Risk #3 (graph-shape legality).** Of the three "illegal graph" cases originally posed:
  - **Case 1 — connective operand cardinality**: enforced **nowhere** today — and **deliberately not enforced at the S-01 persistence layer** (instant per-node save means a connective exists before its operands are linked). **Dropped from Phase 1**; any cardinality rule belongs to exchange-initiation / round-boundary validation (test Phase 4). See Decision **D2**.
  - **Case 2 — relation legality**: the only real structural rule is **`link` must target a connective** (source = any node; `supports`/`rephrases`/`rebuts` = any node → any node — the FR-006 parentheticals are descriptive, not constraints, per FR-014/FR-016). Today this is enforced **only in the client UI** (`ConnectKindPicker.tsx`); the API accepts any `relation_kind` against any UUID target. **Phase 1 implements + TDDs a server-side `link`→connective guard.** See Decision **D1**.
  - **Case 3 — root Claim (FR-007)**: enforced **only at creation** (the `create_debate_with_root` RPC + deferred FK make a rootless debate unreachable *at insert time*), **not maintained across edits**. Four post-creation faces:
    - **3a (delete root)**: FK (`ON DELETE NO ACTION`) blocks it → no dangling reference, but it surfaces as an unmapped **500**. **Decision: the UI must block root deletion** (with a message), server FK as backstop. (D3)
    - **3b (demote root via PATCH)**: `patch_node` lets a `PATCH …/nodes/:rootId` change the root's `statement_type` away from `claim` → `root_node_id` points at a non-Claim. **Red today. Decision: guard it.** (D3)
    - **3c ("Set as Root" not persisted)**: the UI action only flips a client `isRoot` flag; it never moves `debates.root_node_id` (no debate-PATCH endpoint exists), so the choice is lost on reload. **Decision: make re-designation a real persisted action** (and the new root drops its outgoing edges). (D3)
    - **3d (optimistic delete, no rollback)**: a server-rejected delete vanishes from the canvas then reappears on refresh. **Decision: handled in the separate `optimistic-rollback` change** (re-fetch-on-failure); 3a's UI block removes its acute trigger. (D4)

- **Risk #6 (missing-id 404).** Good news: the lived S-01 trap is **already fixed** and all four mutating endpoints currently return 404 on an unknown id. The one RPC in any mutating path (`patch_node`) is correctly declared `RETURNS SETOF public.nodes` (with a comment documenting exactly why bare-composite would 200-with-nulls). The regression a test must **pin** is `patch_node` reverting to a bare composite return — an integration test hitting `PATCH /api/debates/:id/nodes/:nodeId` with a non-existent id and asserting **404** would turn red if that happens. The same unknown-id→404 assertion is worth pinning on all four endpoints; only the PATCH-node case exercises the SETOF-specific failure mode.

- **Runner state.** No test runner, config, `test` script, or test files exist. Vitest/Vite-native is the §4 candidate; the stack is already Vite-based (`vite ^7.3.2`, Astro 6, React 19, TS 5.9, Zod 4). Supabase local is ready (config.toml, 5 migrations, seed.sql). CI runs lint+build; a test step slots between `npm run lint` and `npm run build` in `.github/workflows/ci.yml`.

## Decisions (2026-06-06, from PR review)

These resolve the Open Questions below and **correct the oracle**; they are authoritative for `/10x-plan`. Guiding principle the reviewer set: *the PRD is not set in stone — implementation may surface shifts.* The **two features** Phase 1 implements + tests TDD are **(A) the `link`→connective server guard (D1)** and **(B) root-Claim identity (D3)**.

- **D1 — Relation legality (corrects Case 2 oracle).** The FR-006 parentheticals ("`supports` backs a Claim", "`rebuts` a Rebuttal attacks a Claim/Warrant", …) are *descriptive of intent, not enforced constraints* — confirmed against **FR-014 / FR-016**, which let either party relate their Statements to **any existing Statement**. The **only** structural relation rule in MVP: **a `link` relation must target a connective node** (source may be **any** node, including a connective); `supports` / `rephrases` / `rebuts` may connect **any node → any node**. Phase 1 **implements + TDDs** a server-side guard for the `link`→connective rule (today it is UI-only in `ConnectKindPicker.tsx`). First red test, e.g.: *"a `link` relation whose target is a statement node is rejected (422); a `link` targeting a connective is accepted."* PRD FR-006 annotated.

- **D2 — Connective operand cardinality dropped from Phase 1 (and from S-01).** "AND requires all operands / OR requires any one" (FR-004a) is an **aggregation/evaluation** semantic, not a creation-time structural rule. With instant per-node save, a connective is created seconds/minutes before its operands are linked, so "≥1 operand" cannot be enforced at node creation. Any cardinality check belongs at **exchange-initiation / round-boundary** validation (turn mechanic, roadmap S-03/S-05 → test **Phase 4**), **not** the S-01 persistence layer. **No Phase 1 test.** PRD FR-004a annotated. (Resolves the connective half of OQ#1 and all of OQ#5.)

- **D3 — Root-Claim identity is a Phase 1 feature, TDD'd.** Implement and TDD all of:
  - **3a — block root deletion.** The UI must prevent deleting the root Claim, with the message *"You cannot delete the root claim, but you can set a different claim as the root."* The DB FK remains the server backstop. (Optionally also map the FK violation to a clean 4xx instead of a 500 — nice-to-have, the UI guard is the primary fix.)
  - **3c — persisted re-designation.** "Set as Root Claim" must **persist** the new `root_node_id` — which requires a **server path that does not exist today** (no debate-PATCH endpoint). On (re-)designation, the newly-designated root Claim **loses its outgoing (source) relations**: the root is the map's apex — it only *receives* support, it does not act as a source. This supersedes 3c's "drift" framing — the action becomes real, not discarded on reload.
  - **3b — no demotion.** The designated root's `statement_type` cannot be changed away from `claim` (guard the PATCH path against `debates.root_node_id`). Changing the root is done **only** via 3c re-designation.
  - **Planning note:** the new root-(re)designation endpoint is itself a Risk #6 not-found surface — fold "re-designate on an unknown/RLS-hidden id → 404" into the #6 tests. (Resolves the root half of OQ#1 and all of OQ#2.)

- **D4 — 3d stays in the separate `optimistic-rollback` change.** With 3a blocking root deletion in the UI, 3d's acute trigger is gone; the general "a rejected mutation leaves the canvas diverged until refresh" gap remains and is handled by the re-fetch-on-failure strategy in `context/changes/optimistic-rollback/`. **Not** a Phase 1 test target here.

- **D5 — Two-user / RLS-hidden fixtures → test Phase 2.** Phase 1 covers only the **non-existent id → 404** path for Risk #6. The RLS-hidden-id path needs a two-user fixture and moves to **test Phase 2** (Risk #1). Logged in `test-plan.md` (Phase 2 row) so it is not lost. (Resolves OQ#3.)

**Still open for `/10x-plan`:** **OQ#4** — test-DB strategy (service-role vs two-user client; `seed.sql` reuse vs per-test seeding via the RPC).

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

- **FR-004a** (prd.md:110-111): "logical-connective nodes (AND / OR) that aggregate multiple supporting Statements before they support a Claim — **AND requires all operands, OR requires any one**." → per **D2**, this is an *aggregation* semantic evaluated at exchange-init / round boundaries, **not** a creation-time cardinality constraint. Not a Phase-1 rule.
- **FR-006** (prd.md:114-115): directed relations — `supports`, `link`, `rephrases`, `rebuts`. ⚠️ The role parentheticals in FR-006 are **descriptive of intent, not enforced constraints** (**D1**), corroborated by FR-014 / FR-016 ("relations between their Statements and **any existing Statements**").
- **FR-007** (prd.md:116-117): "Advocate can initiate an exchange **once at least one root Claim Statement exists** in the map. A root Claim Statement is one explicitly designated as the root by the advocate **at the time of debate creation**."

**Corrected oracle (D1)** — relation legality the server should enforce:

| Relation | Legal source | Legal target |
|----------|--------------|--------------|
| `link` | **any node** (incl. connective) | **connective only** |
| `supports` | any node | any node |
| `rephrases` | any node | any node |
| `rebuts` | any node | any node |

Illegal (per the corrected oracle): **a `link` relation whose target is not a connective**; a missing root Claim at initiation; a `statement_type` outside the six; (self-loops — `source = target` — already DB-blocked). Everything else about source/target pairing is legal in MVP.

> Note: the PRD does **not** mandate full transitive connectivity to the root during map-building (orphan handling is an exchange-close concern, FR-019/FR-004), sets **no maximum** operand cap, and (per D2) no creation-time **minimum** either. Do not invent those rules into the oracle.

### Risk #3 — what the code actually enforces (the gap)

**Case 1 — connective invalid operands: NOT enforced anywhere.**
- Zod `createNodeSchema` connective branch (`src/lib/debate/schemas.ts:28-34`) validates only `connectiveOp ∈ {and,or}` + position; operands are separate `relations` created independently.
- `createConnectiveNode` (`src/lib/debate/repository.ts:81-100`) inserts `metadata:{op}` with no operand check.
- `nodes` table CHECKs (migration L31-46) cover only statement title/body length — no operand-count constraint, no trigger.
- The only "rule" artifact is a display string in the legend: `src/components/debate/MapLegend.tsx:45` `{ op:"and", description:"All operands required" }` — documentation, not validation.
- **Boundary drawn by code: none.** A connective with 0/1 operands, or operands of any node type, is fully accepted server-side.
- **Decision (D2): not a Phase-1 concern.** Creation-time cardinality is incompatible with instant per-node save; defer any operand rule to exchange-init / round-boundary validation (Phase 4). No test here.

**Case 2 — relation legality: client-only guard; Phase 1 adds the `link`→connective server rule.**
- The rule lives entirely in `src/components/debate/ConnectKindPicker.tsx:6,26-28`: base kinds `["supports","rephrases","rebuts"]` for any target; `"link"` appended **only when** `targetNode?.type === "connective"`.
- Server: `createRelationSchema` (`src/lib/debate/schemas.ts:48-53`) validates only `kind ∈ relation_kind` + three UUIDs. It does **not** load the target node or check its kind.
- `createRelation` (`src/lib/debate/repository.ts:133-147`) inserts directly. `relations` table (migration L54-63) enforces only `source_node_id <> target_node_id` (no self-loops, L62) + FKs that the nodes exist. No kind/target-type constraint.
- POST handler `src/pages/api/debates/[id]/relations/index.ts` does no target-type validation.
- **A `link` relation pointing at a statement is accepted by the API today.** Per **D1**, this is the one relation rule worth enforcing — Phase 1 adds a server guard (a `createRelationSchema` superRefine that loads the target node, or a check in `createRelation`/the POST handler) so `link` requires a connective target. `supports`/`rephrases`/`rebuts` remain unconstrained on source/target — **do not** add guards for those (they are legal any→any per FR-014/016).

**Case 3 — no root Claim (FR-007): enforced server-side, atomic.**
- `createDebateSchema` (`src/lib/debate/schemas.ts:11-15`) **requires** `rootTitle: z.string().min(1)`.
- Endpoint `src/pages/api/debates/index.ts:14-20` parses, then calls `createDebate`.
- `createDebate` (`src/lib/debate/repository.ts:23-34`) calls only RPC `create_debate_with_root`.
- RPC (migration L156-200) atomically inserts the debate (L177-179), a root statement node with `statement_type='claim'` (L182-193), and sets `root_node_id` (L196). `debates.root_node_id` FK is `deferrable initially deferred` (L49-52) — null only mid-transaction, must point at a node by commit.
- **Latent gap (not via the app):** `root_node_id` column is nullable (migration L27) with no standalone `NOT NULL`/CHECK; the guarantee rests on the deferred FK + the RPC being the only write path. A raw `INSERT INTO debates` bypassing the RPC could commit a null root. App code never does this; tests should assert the **API/RPC contract**, not hand-craft raw inserts.

#### Case 3 (post-creation) — the root-Claim invariant is established at creation but NOT maintained

FR-007 wants the debate's designated root to be a **Claim** for the life of the debate. The code guarantees that only at the moment of creation. Three reachable post-creation paths break the invariant or its UX. **This is a material expansion of Case 3 surfaced during review — it straddles Risk #3 (graph-shape legality) and Risk #5 (edit corrupts the graph, Phase 4).**

**3a — Deleting the root node: FK-blocked (safe), but a 500.** `deleteNode` runs `DELETE FROM nodes WHERE id = nodeId` (`src/lib/debate/repository.ts:128`). The `debates_root_node_id_fkey` is declared with **no `ON DELETE` clause** (migration L49-52) → default `ON DELETE NO ACTION`, `deferrable initially deferred`. Deleting the root → at commit the `debates` row still references it → **FK violation → the delete errors**. So a dangling `root_node_id` is *not* reachable via the API. But `deleteNode` only maps the zero-rows case to `NotFoundError`/404 (`repository.ts:130`); a raw FK-violation error is rethrown unmapped (`repository.ts:129`) and surfaces as a **500**, not a clean `409 "cannot delete the root node"`. *(FK-block behaviour verified live by the reviewer 2026-06-06.)* Deleting the whole debate is fine: `nodes.debate_id` cascades (migration L33), so nothing dangles. **Decision (D3-3a):** the **UI must block** deleting the root with the message *"You cannot delete the root claim, but you can set a different claim as the root"*; the FK stays as backstop.

**3b — Demoting the root via PATCH: a real invariant hole (red today).** The root's claim-ness is hardcoded only at creation (`create_debate_with_root` sets `statement_type='claim'`, migration L188). Nothing preserves it afterward: `updateNodeSchema` allows `statementType: statementTypeEnum.optional()` with no refinement (`src/lib/debate/schemas.ts:42`); `updateNode` forwards it into the metadata patch (`repository.ts:109`); `patch_node` blindly merges `metadata || p_metadata_patch` (`supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:20-21`) with no root-awareness. So `PATCH /api/debates/:id/nodes/:rootNodeId` with `{ "statementType": "rebuttal" }` is **accepted (200)** and `root_node_id` now points at a non-Claim node. (`kind` can't change this way — `patch_node` touches only metadata + position — so the corruption is specifically the `statement_type` demotion, not statement↔connective.) Candidate Phase-1 assertion: *"a PATCH that would change the designated root's `statement_type` away from `claim` is rejected."*

**3c — "Set as Root Claim" is not persisted: store↔persistence drift.** `setRootNode` (`src/components/debate/store.ts:506-514`) is a pure client-state mutation — it flips the `isRoot` flag on store nodes and makes **no API call**; there is no debate-PATCH endpoint to move `root_node_id`. The UI "Set as Root Claim" button (`src/components/debate/nodes/StatementNode.tsx:217-228`) calls `updateNodeFields(id, { statementType: "claim" })` (which *does* persist via `patch_node`) and `setRootNode(id)` (which does **not**). On reload the store recomputes `isRoot: row.id === debate.root_node_id` from the **debate table** (`store.ts:98`), so the *original* creation-time root re-asserts itself and the user's choice is silently discarded — and you can be left with two `claim`-typed nodes, only one of which is the persisted root. The author flagged this inline: `// controversial, let's check with users` (`StatementNode.tsx:222`). **Decision (D3-3c):** re-designation becomes a **real, persisted action** — add a server path to move `debates.root_node_id` (none exists today), and on (re-)designation the newly-designated root Claim **loses its outgoing (source) relations** (the root is the apex — receives support only). The `// controversial` question is hereby answered: persist it.

**3d — Optimistic node-delete has no rollback: canvas diverges until reload.** `deleteNodes` (`src/components/debate/store.ts:447-471`) optimistically strips the node and its incident edges from the store (L456-460), then fires `apiDeleteNode` and on failure calls only `reportError` (L466-468) — it never restores the node. This is an asymmetry: optimistic *creates* roll back via `rollbackNode` (`store.ts:210`, called at L380/410) and `rollbackEdge` (`store.ts:227`, called at L320), but the delete path has no equivalent. So any server-rejected delete leaves the canvas inconsistent with the DB; the **root delete (3a)** is the concrete reproducible trigger — the node disappears, the 500 fires a toast, and the node reappears only after a refresh re-runs `getDebateGraph`. (`deleteEdge`, L473-487, shares the no-rollback shape.) Suggested fix: on `apiDeleteNode` rejection, re-insert the node + incident edges, mirroring the create-rollback helpers. This is primarily Risk #2 (store↔canvas/persistence fidelity, Phase 3), but it is the client face of the same root-delete gap.

Net (current state): there is no server guard that (a) keeps the designated root a Claim, (b) lets the root be re-designated, or (c) refuses to delete it gracefully — and the client (d) does not reconcile the canvas when a delete is rejected. The creation-time guarantee is the *only* protection, ordinary edits route around it, and the UI does not surface the DB's refusal.

**Resolution:** D3 closes (a)/(b)/(c) in Phase 1 — guard demotion (3b), add persisted re-designation that strips the new root's source edges (3c), block root deletion in the UI (3a). (d) is the `optimistic-rollback` change (D4).

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
- `context/foundation/lessons.md` §3 — "Centralize shared validation limits" (`nodeConstraints.ts`); per D2 no operand-cardinality limit is added in Phase 1, but if the `link`-target rule (D1) needs any shared constant it should live there, not be hard-coded.
- `context/foundation/lessons.md` §1 — the `withAuth`/`guardRequest` shared preamble; confirms why all four endpoints share one 404 mapping (`src/lib/api.ts:26`).
- Recent commits `0b2e1fb` (harden persistence API & graph RLS), `072957c` (valid v4 seed UUIDs) — the RLS tightening is Phase 2's territory; the seed-UUID fix matters for any integration fixture that reuses `supabase/seed.sql`.
- `context/changes/advocate-map-builder/` and `context/changes/bootstrap-verification/` exist as sibling changes — the map-builder slice (S-01) is the code under test here.

## Related Research

- None prior under `context/changes/**/research.md` for testing. This is the first research artifact in the test rollout (Phase 1).

## Open Questions

> Most of these were **resolved** by the 2026-06-06 PR review — see the **Decisions** section. Kept here with their resolutions for traceability.

1. ~~Risk #3 — codify the oracle (red) vs. test what's enforced?~~ **Resolved (D1 + D2 + D3):** oracle-first / implement-and-TDD, but with a corrected, narrowed oracle — only the `link`→connective rule (D1) and root-Claim identity (D3) are enforced; connective cardinality is dropped (D2).
2. ~~Root-Claim invariant across edits — in scope for Phase 1?~~ **Resolved (D3):** yes — 3a (UI block delete), 3b (guard demotion), 3c (persisted re-designation + strip new root's source edges) are Phase-1 TDD features. 3d → `optimistic-rollback` change (D4).
3. ~~RLS-hidden vs. non-existent id for Risk #6?~~ **Resolved (D5):** Phase 1 = non-existent id → 404 only; two-user RLS-hidden fixture → test Phase 2. Logged in `test-plan.md`.
4. **Test-DB strategy for integration — STILL OPEN for `/10x-plan`.** Run against Supabase local (real Postgres + migrations + RLS) per §4 — but as the **service-role** client (bypassing RLS) for shape/not-found tests, reserving the anon/two-user path for Phase 2? Affects fixture setup and whether `seed.sql` is reused or each test seeds its own debate via the RPC.
5. ~~Connective operand "type" rule?~~ **Resolved (D2):** moot — connective operand rules (type and cardinality) are out of Phase 1 entirely.

### New questions raised by the decisions (for `/10x-plan`)

- **Shape of the root re-designation endpoint (D3-3c).** No debate-level mutating endpoint exists today (`debates/[id]/index.ts` is GET-only). Options: a `PATCH /api/debates/:id` taking `{ rootNodeId }`, or a dedicated `POST …/root`. It must (i) verify the target node is a `claim` in this debate, (ii) update `debates.root_node_id`, and (iii) delete relations where the new root is the **source** — ideally atomically in an RPC (mirrors `create_debate_with_root`). This endpoint is also a Risk #6 not-found surface (unknown/RLS-hidden id → 404).
- **Where the `link`-target guard lives (D1).** A `createRelationSchema` superRefine can't see the DB; loading the target node needs the repository/handler or a DB trigger/constraint. Decide unit (pure rule) vs integration (API rejects) split — likely both, per the two-layer strategy.
