# Test Phase 1: Bootstrap + persistence/shape floor Implementation Plan

## Overview

Rollout **Phase 1** of `context/foundation/test-plan.md` ("Bootstrap + persistence/shape floor"). This change does three jobs:

1. **Stands up the test runner** (Vitest) — none exists today (no config, no `test` script, no test deps).
2. **Implements two small server features test-first** and pins them:
   - **D1** — a server-side `link`→connective relation guard (today the rule lives only in the React UI).
   - **D3** — root-Claim identity: block demoting the root (3b), add a persisted root re-designation path (3c), block deleting the root (3a).
3. **Pins Risk #6** — a mutating endpoint on an unknown id must return **404**, not a 200-with-nulls record (the lived `RETURNS SETOF` trap).

Risks covered: **#3** (server accepts a structurally illegal graph) and **#6** (missing-id → 404). Test types: **unit + integration**, run against **Supabase local** as the **service-role** client.

## Current State Analysis

The oracle and the code↔product gap are settled in `context/changes/testing-persistence-floor/research.md` (Decisions **D1–D5**). Confirmed against the code:

- **Risk #6 is already green.** All four mutating repository fns map zero-rows → `NotFoundError` → 404 (`src/lib/debate/repository.ts:123,130,161,168`); `patch_node` is correctly `RETURNS SETOF public.nodes` (`supabase/migrations/20260605000002_atomic_node_metadata_patch.sql:15`). `NotFoundError` → 404 mapping lives in `src/lib/api.ts:26`. The tests **pin** this against regression; only the PATCH-node path exercises the SETOF-specific failure mode.
- **Risk #3 / D1 — `link` guard is client-only.** The rule "`link` must target a connective" lives at `src/components/debate/ConnectKindPicker.tsx:28`. The API path (`createRelationSchema` `src/lib/debate/schemas.ts:48-53` → `createRelation` `src/lib/debate/repository.ts:133-147` → POST handler `src/pages/api/debates/[id]/relations/index.ts`) validates only `kind ∈ enum` + three UUIDs and inserts directly. `supports`/`rephrases`/`rebuts` are legal any→any (FR-014/016) and must stay unconstrained.
- **Risk #3 / D3 — root-Claim identity is not maintained after creation.** It is established atomically only at creation by `create_debate_with_root` (`supabase/migrations/20260528000001_create_debate_graph.sql:156-200`). Post-creation:
  - **3b** `PATCH …/nodes/:rootId` with `{statementType:"rebuttal"}` is accepted (200) — `updateNodeSchema.statementType` is unrefined (`schemas.ts:42`) and `patch_node` blindly merges metadata. The root then points at a non-Claim.
  - **3c** "Set as Root Claim" (`src/components/debate/nodes/StatementNode.tsx:217-228`) fires two client calls — `updateNodeFields(..., {statementType:"claim"})` (persists) and `setRootNode(...)` (client-only, `store.ts:506-514`). No debate-level mutating endpoint exists (`src/pages/api/debates/[id]/index.ts` is GET-only), so the new root is **never persisted** and is discarded on reload.
  - **3a** Deleting the root is blocked by the deferred FK (`migration …graph.sql:49-52`, `ON DELETE NO ACTION`) but `deleteNode` rethrows the FK violation unmapped → surfaces as a **500** (`repository.ts:127-131`).
- **Runner state.** Vite-native stack (`vite ^7.3.2`, Astro 6, React 19, TS 5.9, Zod 4); repository fns are dependency-injected (`supabase` as first arg) — directly usable in integration tests. Supabase local ready (5 migrations + `seed.sql`). CI runs `lint → build`.

## Desired End State

`npm test` runs a Vitest suite (unit + integration) green. The suite:

- proves a `link` relation to a non-connective target is rejected server-side (422) and `link`→connective is accepted, while the other three kinds remain any→any;
- proves the designated root cannot be demoted away from `claim` (422), can be re-designated through a new persisted, atomic path (role coerced to `claim`, `root_node_id` moved, the new root's outgoing edges stripped), and cannot be deleted (409 + UI block);
- pins unknown-id → 404 on all four existing mutating endpoints plus the new re-designation endpoint, and pins the `patch_node` SETOF contract;
- and the test-plan §6 cookbook documents how to add unit / integration tests in this project.

Verify: `npm test` green; `npm run lint` and `npx astro check` clean; `supabase/migrations/` has the new `set_debate_root` migration applying cleanly.

### Key Discoveries:

- `src/lib/debate/repository.ts` fns take `supabase` as the first arg → integration tests call them directly with a service-role client; no refactor needed.
- `create_debate_with_root` is `SECURITY DEFINER` and reads `auth.uid()` internally → a **pure service-role client cannot call it** (its `auth.uid()` is null → RPC raises). Seeding needs a real auth user; assertions stay service-role. See Critical Implementation Details.
- `patch_node` (`migration 20260605000002`) is the template for a `SECURITY INVOKER`, params-only RPC — `set_debate_root` follows the same shape so it is testable under service-role.
- `withAuth` (`src/lib/api.ts:10-36`) maps `NotFoundError`→404 and everything else→500. New semantic failures (link-target illegal → 422; root delete → 409) need their own error classes mapped here.

## What We're NOT Doing

- **No connective operand-cardinality check** (D2) — instant per-node save makes "≥1 operand" an exchange-init/round-boundary concern (test Phase 4), not persistence-layer.
- **No optimistic-rollback machinery** (D4) — the re-designation client reconciles **apply-on-success** (after 200), so no rollback is needed here. General rejected-mutation rollback is the separate `optimistic-rollback` change.
- **No two-user / RLS-hidden fixtures** (D5) — Risk #6's RLS-hidden-id half and Risk #1 move to test Phase 2. Phase 1 covers only the non-existent-id → 404 path.
- **No guards on `supports`/`rephrases`/`rebuts`** — they are legal any→any (FR-014/016).

## Implementation Approach

Seven phases, ordered so the test harness is proven on already-green behavior before any new feature is TDD'd:

1. Stand up Vitest (unit + integration projects) + the service-role test client and per-test RPC-seeding fixtures.
2. Pin Risk #6 on the four existing endpoints (plain — behavior is already correct; this also shakes out the integration harness).
3. TDD the `link`→connective guard (D1).
4. TDD root re-designation (D3-3c) — new RPC + `PATCH /api/debates/:id` + client wiring.
5. TDD root protection (D3-3b demotion guard, D3-3a delete→409 + UI block).
6. Wire the test step into CI (test-plan §5 — required after Phase 1).
7. Fill the test-plan cookbook (§6) and sync status (plain).

Feature phases (3–5) use `/10x-tdd` (each has a one-sentence red test); bootstrap, CI, and docs phases (1, 6, 7) use `/10x-implement`. Phase 2 is plain (no red achievable without breaking shipped code).

## Critical Implementation Details

- **Integration auth split (load-bearing).** `create_debate_with_root` needs `auth.uid()`, so seeding cannot use the service-role client. Global setup creates one dedicated test user via the service-role admin API (`supabase.auth.admin.createUser`) and signs it in (anon key, password grant) to obtain a token; a **user-scoped client** calls `create_debate_with_root` for per-test seeding (exercising the real creation path). A **service-role client** runs all assertions (RLS bypassed — fine, since unknown-id → 404 and shape rules hold regardless of RLS) and teardown (delete the debate; `nodes`/`relations` cascade). The dedicated user is removed in global teardown. This honors both decisions: service-role for the test client, real RPC for seeding.

- **Test env vars.** Integration tests need `SUPABASE_URL` (exists, `http://127.0.0.1:54321`), the existing anon `SUPABASE_KEY` (for the seeding sign-in), and a **new** `SUPABASE_SERVICE_ROLE_KEY` (from `supabase start` output) — uncommitted, added to local env. Tests must skip with a clear message if these are absent so unit-only runs stay green without Supabase up.

- **`set_debate_root` is `SECURITY INVOKER`, params-only.** Mirrors `patch_node`: takes `(p_debate_id uuid, p_node_id uuid)`, no `auth.uid()` dependency in its core logic, so it is directly callable under the service-role client. RLS still applies in production (invoker rights).

- **Error→status mapping.** Add a `ValidationError` (→422) and a `ConflictError` (→409) (or equivalent) and map them in `withAuth` alongside `NotFoundError`. Keep the existing rule: never leak Postgres internals to the client.

## Phase 1: Runner bootstrap

### Overview

Stand up Vitest with two projects (unit, integration), the test scripts, the service-role + seeding client helpers, the per-test fixture, and a smoke test proving the runner works.

### Changes Required:

#### 1. Vitest dependencies + scripts

**File**: `package.json`

**Intent**: Add Vitest (and a tsconfig-path resolver so the `@/*` alias resolves in tests) as dev deps; add `test`, `test:unit`, `test:integration` scripts.

**Contract**: New devDeps include `vitest` (version matched to Vite 7 at install — likely `^3.2` or `^4`; verify peer range against the installed `vite`) and `vite-tsconfig-paths` (or an equivalent manual alias in the config). Scripts: `"test": "vitest run"`, `"test:unit": "vitest run --project unit"`, `"test:integration": "vitest run --project integration"`.

#### 2. Vitest config

**File**: `vitest.config.ts` (new)

**Intent**: Define two projects — `unit` (node env, fast, no infra) and `integration` (node env, Supabase local, setup file for clients). Resolve the `@/*` alias to `./src`.

**Contract**: `test.projects` array per Vitest docs: project `unit` includes `tests/unit/**/*.{test,spec}.ts`, `environment: "node"`; project `integration` includes `tests/integration/**/*.{test,spec}.ts`, `environment: "node"`, `setupFiles: ["tests/integration/setup.ts"]`. `@` → `<root>/src` via `vite-tsconfig-paths` plugin or `resolve.alias`.

#### 3. Integration client + fixture helpers

**File**: `tests/integration/setup.ts` and `tests/integration/helpers.ts` (new)

**Intent**: Provide a service-role client (assertions/teardown), a seeding client (authenticated test user), a `seedDebate()` helper that calls `create_debate_with_root` and returns ids, and a cleanup helper. Skip integration tests with a clear message when env vars are missing.

**Contract**: Exports a `serviceClient` (service-role key), a `seedDebate(input?) → { debateId, rootNodeId }` (calls the RPC via the user-scoped client), and `cleanupDebate(debateId)` / global teardown that removes the test user. Env-var guard short-circuits to a skipped suite when `SUPABASE_SERVICE_ROLE_KEY` is unset.

#### 4. Smoke tests

**File**: `tests/unit/nodeConstraints.test.ts`, `tests/integration/smoke.test.ts` (new)

**Intent**: Prove both projects run. Unit: assert `isValidUrl` (`src/lib/debate/nodeConstraints.ts:12-19`) on a valid http(s) url and a non-url. Integration: seed a debate, read it back via the service client, assert the root node exists and is a `claim`, tear down.

**Contract**: Unit test imports `isValidUrl` from `@/lib/debate/nodeConstraints`. Integration smoke uses `seedDebate()` + `serviceClient` + `cleanupDebate()`.

### Success Criteria:

#### Automated Verification:

- Deps install and `npm run test:unit` passes the smoke unit test
- `npm run test:integration` passes the smoke integration test (Supabase local up)
- `npx astro check` passes with test files present
- `npm run lint` passes on new test files

#### Manual Verification:

- Service-role + seeding clients connect to Supabase local and round-trip a seeded debate

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Risk #6 floor — four existing endpoints

### Overview

Pin "unknown id → 404" on the four shipped mutating paths, and pin the `patch_node` SETOF contract. Behavior is already correct; these are regression guards.

### Changes Required:

#### 1. Not-found integration tests

**File**: `tests/integration/notFound.test.ts` (new)

**Intent**: For each mutating repository fn, a call with a non-existent id raises `NotFoundError` (→404). Use a random UUID that does not exist.

**Contract**: Covers `updateNode`, `deleteNode`, `updateRelation`, `deleteRelation` (`src/lib/debate/repository.ts`). Each asserts `NotFoundError` is thrown for an unknown id. The PATCH-node case additionally asserts the `patch_node` RPC yields `null` (empty set), not an all-null row — the SETOF-specific regression. Optionally also assert at the HTTP layer for at least the PATCH-node endpoint.

### Success Criteria:

#### Automated Verification:

- All four unknown-id → `NotFoundError` tests pass
- PATCH-node SETOF-contract test passes (empty set → null, not all-null row)
- `npm run lint` + `npx astro check` clean

#### Manual Verification:

- A real `PATCH` to an unknown node id over HTTP returns 404

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Phase 3: D1 — `link`→connective guard

### Overview

Implement (test-first) a server-side guard so a `link` relation must target a connective node; other kinds stay any→any.

### Changes Required:

#### 1. Pure relation-target rule

**File**: `src/lib/debate/relationRules.ts` (new) + `tests/unit/relationRules.test.ts` (new)

**Intent**: A pure predicate the server (and, optionally later, the client) can share: given a relation kind and the target node's kind, is the pairing legal? Encodes only the `link`→connective rule; everything else legal.

**Contract**: e.g. `isLegalRelationTarget(kind: RelationKind, targetKind: NodeKind): boolean` — returns `false` only when `kind === "link" && targetKind !== "connective"`. Unit test asserts: `link`→connective true; `link`→statement false; `supports`/`rephrases`/`rebuts` → both kinds true. (If a shared constant is needed, it lives in `nodeConstraints.ts` per lessons §3 — but a pure predicate likely needs none.)

#### 2. Server enforcement in the relation create path

**File**: `src/lib/debate/repository.ts` (`createRelation`) and/or `src/pages/api/debates/[id]/relations/index.ts`; `src/lib/errors.ts`; `src/lib/api.ts`

**Intent**: Before inserting, load the target node's `kind` and reject an illegal `link` with a 422. Add a `ValidationError` and map it in `withAuth`.

**Contract**: `createRelation` loads the target node (`select kind … where id = targetNodeId`) and throws `ValidationError` when `isLegalRelationTarget` is false. `withAuth` maps `ValidationError` → 422. Integration test: POST/`createRelation` with `link`→statement → 422; `link`→connective → 201/row; the three other kinds any→any → accepted.

### Success Criteria:

#### Automated Verification:

- Unit test of `isLegalRelationTarget` passes (red→green recorded)
- Integration: `link`→non-connective rejected (422); `link`→connective accepted; `supports`/`rephrases`/`rebuts` accepted any→any
- `npm run lint` + `npx astro check` clean

#### Manual Verification:

- In the UI, creating a `link` to a connective still works; the canvas behaves unchanged

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Phase 4: D3 — root re-designation

### Overview

Add a persisted, atomic "set as root" path: a new `set_debate_root` RPC, a `PATCH /api/debates/:id` endpoint, the repository fn, and apply-on-success client wiring.

### Changes Required:

#### 1. `set_debate_root` migration

**File**: `supabase/migrations/<timestamp>_set_debate_root.sql` (new)

**Intent**: One atomic Postgres function that re-designates a root: guard the target is a `statement` node in this debate, coerce its `statement_type` → `claim`, set `debates.root_node_id`, and delete the target's outgoing (source) relations.

**Contract**: `set_debate_root(p_debate_id uuid, p_node_id uuid) returns setof public.debates`, `SECURITY INVOKER`, `set search_path = ''`. Returns empty set when the debate/node is unknown or not in the pair's scope (→ caller maps to 404, mirroring `patch_node`). All four effects run in the function's single statement/transaction. Grants mirror `patch_node` (revoke from public/anon; grant to authenticated).

#### 2. Repository fn

**File**: `src/lib/debate/repository.ts`

**Intent**: Wrap the RPC; map empty result → `NotFoundError`; surface the "target is a connective" rejection as `ValidationError` (422).

**Contract**: `setDebateRoot(supabase, debateId, nodeId) → DebateRow`. `.rpc("set_debate_root", …).maybeSingle()`; `if (!data) throw new NotFoundError()`. Connective-target rejection: either the RPC raises a tagged error mapped to `ValidationError`, or the repository pre-checks the node kind and throws `ValidationError` before calling the RPC (pick one; keep it consistent with the Phase 3 link-guard placement — app-layer pre-check is the established pattern).

#### 3. `PATCH /api/debates/:id` endpoint

**File**: `src/pages/api/debates/[id]/index.ts`; `src/lib/debate/schemas.ts`

**Intent**: Add a `PATCH` handler (today GET-only) accepting a strictly-whitelisted patch; when `rootNodeId` is present, route to `setDebateRoot`. Leave room for future fields (e.g. title) without widening the surface unsafely.

**Contract**: New `updateDebateSchema` with `rootNodeId: z.uuid().optional()` (the only field this phase persists). Handler parses the id param + body, calls `setDebateRoot` when `rootNodeId` is set, returns the updated debate. Unknown debate/node id → 404 (the new endpoint is itself a Risk #6 surface — fold this assertion into the tests).

#### 4. Client wiring (apply-on-success)

**File**: `src/components/debate/persistence.ts`, `src/components/debate/store.ts`, `src/components/debate/nodes/StatementNode.tsx`

**Intent**: Add `apiSetDebateRoot`; make "Set as Root Claim" call it; on **200**, the store applies all effects together — flip `isRoot`, coerce role → `claim`, remove the (now server-deleted) outgoing edges of the new root. On failure, show the error banner and leave the canvas untouched. Remove the now-obsolete two-call pattern and the `// controversial` note.

**Contract**: `apiSetDebateRoot(debateId, nodeId) → DebateRow` in `persistence.ts`. A store action (replacing the client-only `setRootNode`) that awaits the API then applies: `isRoot` true on the new root / false elsewhere, `role: "claim"`, and `edges.filter(e => e.source !== newRootId)`. `StatementNode` "Set as Root Claim" calls this single action.

### Success Criteria:

#### Automated Verification:

- `set_debate_root` migration applies cleanly (`supabase db reset` / push)
- Integration: re-designation moves `root_node_id`, coerces the new root's role → `claim`, and strips its outgoing relations
- Integration: connective target rejected (422); unknown debate/node id → 404
- Integration: `PATCH /api/debates/:id` accepts only whitelisted fields
- Store unit test: apply-on-success updates `isRoot`/role/edges; failure leaves canvas unchanged
- `npm run lint` + `npx astro check` clean

#### Manual Verification:

- In the UI: "Set as Root Claim" → reload → the choice persists; the new root's outgoing edges are gone; only one root

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Phase 5: D3 — root protection

### Overview

Lock the root's identity: it cannot be demoted (3b) and cannot be deleted (3a — 409 + UI block). The only way to change the root is Phase-4 re-designation.

### Changes Required:

#### 1. Demotion guard (3b)

**File**: `src/lib/debate/repository.ts` (`updateNode`) and/or the `patch_node` migration / a new check; `src/lib/api.ts`

**Intent**: Reject a PATCH that would change the designated root's `statement_type` away from `claim`.

**Contract**: When the patched node is the debate's `root_node_id` and the patch sets `statement_type` to anything other than `claim`, throw `ValidationError` (→422). Placement options: an app-layer check in `updateNode` (load the debate's `root_node_id`), or a guard inside `patch_node`. Prefer the layer consistent with the link-guard (app-layer). Integration test: `PATCH …/nodes/:rootId {statementType:"rebuttal"}` → 422; a non-root node demotes fine; the root's other fields (title/body/position) still patch.

#### 2. Root delete → 409 + UI block (3a)

**File**: `src/lib/debate/repository.ts` (`deleteNode`); `src/lib/errors.ts`; `src/lib/api.ts`; `src/components/debate/store.ts` + `src/components/debate/nodes/StatementNode.tsx` (UI block)

**Intent**: Map the FK-violation on root delete to a clean 409 (server backstop); block the delete in the UI with the specified message (primary fix).

**Contract**: `deleteNode` catches the FK-violation error code and throws `ConflictError`; `withAuth` maps `ConflictError` → 409. UI: the delete affordance for the root is disabled/blocked, showing *"You cannot delete the root claim, but you can set a different claim as the root."* Integration test: `DELETE …/nodes/:rootId` → 409 (not 500, not 204); deleting a non-root node still 204.

### Success Criteria:

#### Automated Verification:

- Integration: demoting the root's `statement_type` → 422 (red→green recorded); non-root demotion still allowed; root title/body/position still patchable
- Integration: deleting the root → 409; deleting a non-root → 204
- Store/UI-logic test: root delete is blocked client-side
- `npm run lint` + `npx astro check` clean

#### Manual Verification:

- In the UI: the root node's delete is blocked with the specified message; "Set as Root" remains the way to change it

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Phase 6: CI wiring

### Overview

Wire the test step into the GitHub workflow so every PR runs the suite (test-plan §5: unit + integration required after Phase 1). Unit tests gate every run; integration runs against a Supabase started in the workflow, or is marked ad-hoc if infra cost makes it impractical (per CLAUDE.md / test-plan §4 guidance).

### Changes Required:

#### 1. Add the test step to CI

**File**: `.github/workflows/ci.yml`

**Intent**: Insert a test step between `npm run lint` and `npm run build`. Run `npm run test:unit` always (no infra). Run integration against Supabase local started in the workflow (`supabase` CLI is already a dev dep); if that proves too heavy, keep integration ad-hoc/local and run only unit in CI — mark the choice in test-plan §4.

**Contract**: New step(s) after the lint step: `npm run test:unit` (required). For integration: `npx supabase start` → `npm run test:integration` → `npx supabase stop`, with the service-role key sourced from the started stack (or repo secret). The integration job must not block on missing secrets in forks — gate it on availability. `build` still runs after.

### Success Criteria:

#### Automated Verification:

- The workflow runs `test:unit` and it passes on a pushed branch / PR
- If integration is wired in CI: the integration job starts Supabase, runs `test:integration` green, and stops it
- Lint + build steps still pass in the updated workflow

#### Manual Verification:

- A PR shows the test step running in GitHub Actions checks

  > **Agent-automatable**: Partial — workflow YAML is verifiable locally; the actual Actions run needs a push/PR and the GitHub UI (or `gh run watch`).

  ```bash
  # After pushing the branch:
  gh run list --branch "$(git branch --show-current)" --limit 1
  gh run watch    # confirm the test step appears and passes
  ```

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Phase 7: Cookbook + sync

### Overview

Document how to add tests in this project and sync the rollout state. No production code.

### Changes Required:

#### 1. Cookbook + status

**File**: `context/foundation/test-plan.md`

**Intent**: Fill §6.1 (adding a unit test) and §6.2 (adding an integration test, incl. the not-found branch) with the patterns this phase established; flip the §3 Phase-1 status row to `complete`; record in §6.6 the surprising bits (the service-role-vs-seeding auth split). Reflect the now-wired CI gate in §5 (and the integration-in-CI vs ad-hoc choice in §4). Note the Phase-2 carry-overs (RLS-hidden id, 3d) that are already logged.

**Contract**: §6.1/§6.2 reference real file paths from `tests/`. §3 Phase-1 row Status = `complete`. §5 reflects the wired test gate; §4 records the integration-in-CI decision. §6.6 gets a 2–3 line note.

### Success Criteria:

#### Automated Verification:

- Full `npm test` suite green
- `npm run lint` + `npm run build` pass

#### Manual Verification:

- Reviewer confirms the cookbook sections read correctly and match the shipped tests

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Testing Strategy

### Unit Tests:

- `isValidUrl` smoke (proves runner)
- `isLegalRelationTarget` rule: `link`→connective legal; `link`→statement illegal; others any→any
- Store apply-on-success logic for re-designation; client root-delete block

### Integration Tests (Supabase local, service-role assertions, RPC-seeded fixtures):

- Unknown id → 404 on the four existing mutating paths + the new `PATCH /api/debates/:id`; `patch_node` SETOF contract
- `link`→non-connective rejected (422); legal pairings accepted
- Root re-designation: `root_node_id` moves, role coerced to `claim`, outgoing edges stripped, connective target rejected
- Root demotion rejected (422); root delete → 409

### Manual Testing Steps:

1. "Set as Root Claim" in the UI → reload → choice persists, outgoing edges gone.
2. Attempt to delete the root → blocked with the specified message.
3. Create a `link` to a connective → still works.

## Performance Considerations

The link-guard adds one extra DB read per relation create (acceptable; relation creates are user-paced). The `set_debate_root` RPC does its work in one round-trip. No hot-path impact.

## Migration Notes

One new migration (`set_debate_root`). It is additive (new function + grants); no data backfill. `set_debate_root` is `SECURITY INVOKER` so RLS applies in production.

## References

- Research (oracle + Decisions D1–D5): `context/changes/testing-persistence-floor/research.md`
- Rollout strategy: `context/foundation/test-plan.md` (§3 Phase 1, §4 stack, §5 gates, §6 cookbook)
- SETOF lesson: `context/foundation/lessons.md` §4
- RPC template: `supabase/migrations/20260605000002_atomic_node_metadata_patch.sql`
- Root-creation RPC: `supabase/migrations/20260528000001_create_debate_graph.sql:156-200`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner bootstrap

#### Automated

- [x] 1.1 Deps install and `npm run test:unit` passes the smoke unit test — 52d8d2b
- [x] 1.2 `npm run test:integration` passes the smoke integration test — 52d8d2b
- [x] 1.3 `npx astro check` passes with test files present — 52d8d2b
- [x] 1.4 `npm run lint` passes on new test files — 52d8d2b

#### Manual

- [x] 1.5 Service-role + seeding clients connect and round-trip a seeded debate — 52d8d2b

  > **Agent-automatable**: Yes — scriptable via the Supabase service-role client + the RPC.

  ```bash
  # Ensure Supabase local is up and env is set
  npx supabase status   # expect API at http://127.0.0.1:54321
  # SUPABASE_URL, SUPABASE_KEY (anon), SUPABASE_SERVICE_ROLE_KEY must be set in the test env
  npm run test:integration -- smoke
  # Expected: smoke.test.ts passes (debate seeded via create_debate_with_root, read back, torn down)
  ```

  ```sql
  -- After the smoke test, confirm no leftover test debates (teardown worked):
  select count(*) from public.debates where title like 'test-%';
  -- Expected: 0
  ```

### Phase 2: Risk #6 floor — four existing endpoints

#### Automated

- [x] 2.1 Unknown-id → `NotFoundError` for `updateNode`, `deleteNode`, `updateRelation`, `deleteRelation` — 3720518
- [x] 2.2 `patch_node` SETOF-contract test (empty set → null, not all-null row) — 3720518
- [x] 2.3 `npm run lint` + `npx astro check` clean — 3720518

#### Manual

- [x] 2.4 Real `PATCH` to an unknown node id over HTTP returns 404 — 3720518

  > **Agent-automatable**: Partial — DB layer is scriptable; the HTTP layer needs a bearer token from a password sign-in.

  Uses the fixtures from `supabase/seed.sql` (present after `npx supabase db reset`): user
  `s@e.pl` / `pwd123!` owns the seed debate `00000000-0000-4000-8000-000000000010`, so the
  request reaches the not-found path (RLS allows it; only the node id is unknown). Requires the
  Astro dev server on `:4321` (`npm run dev`) and the anon key in `$SUPABASE_KEY` (export it from
  `npx supabase status` → Publishable key, or your `.env`).

  ```bash
  # Get a user token (avoids browser cookie extraction). `echo "$TOKEN"` to inspect it —
  # it's a short-lived access JWT, fine to print locally.
  TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" \
    -d '{"email":"s@e.pl","password":"pwd123!"}' | jq -r .access_token)
  # PATCH a non-existent node id under the seed debate
  curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
    "http://127.0.0.1:4321/api/debates/00000000-0000-4000-8000-000000000010/nodes/00000000-0000-0000-0000-000000000000" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"title":"x"}'
  # Expected: 404
  ```

### Phase 3: D1 — `link`→connective guard

#### Automated

- [x] 3.1 Unit `isLegalRelationTarget` passes (red→green recorded) — 9512faa
- [x] 3.2 Integration: `link`→non-connective rejected (422); `link`→connective accepted; other kinds any→any accepted — 9512faa
- [x] 3.3 `npm run lint` + `npx astro check` clean — 9512faa

#### Manual

- [x] 3.4 In the UI, creating a `link` to a connective still works — 9512faa

  > **Agent-automatable**: No — requires the React canvas and a drag-to-connect interaction.

  Steps: open a debate with a connective node → drag from a node to the connective → choose `link` → confirm the edge is created and persists on reload.

### Phase 4: D3 — root re-designation

#### Automated

- [x] 4.1 `set_debate_root` migration applies cleanly
- [x] 4.2 Integration: re-designation moves `root_node_id`, coerces role → `claim`, strips outgoing relations
- [x] 4.3 Integration: connective target rejected (422); unknown debate/node id → 404
- [x] 4.4 Integration: `PATCH /api/debates/:id` accepts only whitelisted fields
- [x] 4.5 Store unit test: apply-on-success updates `isRoot`/role/edges; failure leaves canvas unchanged
- [x] 4.6 `npm run lint` + `npx astro check` clean

#### Manual

- [x] 4.7 In the UI: "Set as Root Claim" → reload → choice persists; new root's outgoing edges gone; only one root

  > **Agent-automatable**: Partial — the DB effect is scriptable via SQL; the click + reload UX needs a browser.

  ```sql
  -- After clicking "Set as Root Claim" on node <nodeId> in debate <debateId>:
  select root_node_id from public.debates where id = '<debateId>';            -- Expected: <nodeId>
  select metadata->>'statement_type' from public.nodes where id = '<nodeId>'; -- Expected: claim
  select count(*) from public.relations where source_node_id = '<nodeId>';    -- Expected: 0
  ```

### Phase 5: D3 — root protection

#### Automated

- [ ] 5.1 Integration: demoting the root's `statement_type` → 422 (red→green); non-root demotion allowed; root title/body/position still patchable
- [ ] 5.2 Integration: deleting the root → 409; deleting a non-root → 204
- [ ] 5.3 Store/UI-logic test: root delete blocked client-side
- [ ] 5.4 `npm run lint` + `npx astro check` clean

#### Manual

- [ ] 5.5 In the UI: the root's delete is blocked with the specified message

  > **Agent-automatable**: No — requires inspecting the rendered node's disabled/blocked delete affordance and its message.

  Steps: open a debate → attempt to delete the root node → confirm it is refused and the message *"You cannot delete the root claim, but you can set a different claim as the root."* is shown.

### Phase 6: CI wiring

#### Automated

- [ ] 6.1 Workflow runs `test:unit` and it passes on a pushed branch / PR
- [ ] 6.2 Integration job (if wired) starts Supabase, runs `test:integration` green, stops it
- [ ] 6.3 Lint + build steps still pass in the updated workflow

#### Manual

- [ ] 6.4 A PR shows the test step running in GitHub Actions checks

  > **Agent-automatable**: Partial — workflow YAML is verifiable locally; the actual Actions run needs a push/PR and the GitHub UI (or `gh run watch`).

  ```bash
  gh run list --branch "$(git branch --show-current)" --limit 1
  gh run watch    # confirm the test step appears and passes
  ```

### Phase 7: Cookbook + sync

#### Automated

- [ ] 7.1 Full `npm test` suite green
- [ ] 7.2 `npm run lint` + `npm run build` pass

#### Manual

- [ ] 7.3 Reviewer confirms §6.1/§6.2 cookbook and §3 status match the shipped tests

  > **Agent-automatable**: No — a human reads the prose for accuracy against the tests on disk.

  Steps: read `context/foundation/test-plan.md` §6.1, §6.2, §6.6 and the §3 Phase-1 row; confirm file paths and patterns match `tests/`.
