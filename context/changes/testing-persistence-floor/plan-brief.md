# Test Phase 1: Bootstrap + persistence/shape floor — Plan Brief

> Full plan: `context/changes/testing-persistence-floor/plan.md`
> Research: `context/changes/testing-persistence-floor/research.md`

## What & Why

Phase 1 of the project's test rollout. It stands up the test runner (none exists today), then locks the shipped persistence + graph-shape rules at the cheapest layer that gives a real signal. Along the way it ships two small server features test-first — a `link`→connective guard and root-Claim identity handling — because research found the product oracle and the shipped code diverge there. Risks covered: **#3** (server accepts a structurally illegal graph) and **#6** (a mutating endpoint on a missing id returns 200-with-nulls instead of 404).

## Starting Point

No test runner, config, or `test` script exists. Risk #6 is already correctly handled in code (the tests pin it against regression). The `link` rule and the root-Claim invariant exist only at creation / only in the React UI — the server accepts illegal edits that bypass the client. Repository functions are dependency-injected (they take a `supabase` client), so they're directly testable against Supabase local.

## Desired End State

`npm test` runs a green Vitest suite (unit + integration). The server rejects an illegal `link`, refuses to demote or delete the root, persists a root re-designation atomically (coercing the node to a Claim, moving the root, stripping its outgoing edges), and returns 404 on every unknown-id mutation. The test-plan cookbook documents how to add more tests.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test-DB connection | Service-role client for assertions | Phase 1 is shape/not-found; RLS is Phase 2's job | Plan |
| Fixtures | Per-test via `create_debate_with_root` RPC | Exercises the real creation path, isolation by construction | Plan |
| Seeding auth wrinkle | Dedicated test user seeds; service-role asserts | The RPC needs `auth.uid()`, which a pure service-role client lacks | Plan |
| Re-designation endpoint | `PATCH /api/debates/:id`, whitelisted fields | REST-conventional; room for future debate-level edits (e.g. title) | Plan |
| Atomicity | New atomic `set_debate_root` RPC | Three steps can't half-complete and corrupt the graph | Research D3 / Plan |
| RPC: check vs do | Coerce role→`claim` (not reject) | Matches user intent; kills the 3c two-call drift; only guard is "target is a statement in this debate" | Plan |
| `link` guard placement | Repository/handler (TypeScript), 422 | Keeps the existing insert path; mirrors current not-found guards | Research D1 / Plan |
| Client reconcile | Apply-on-success (after 200) | No rollback needed here; can't leave canvas disagreeing with DB | Plan |
| Root delete (3a) | UI block + map FK → 409 | Fixes the user-facing problem and the non-UI caller | Plan |
| Test mode | TDD the two features; plain-implement runner + docs | Each feature has a one-sentence red test | Plan |
| CI wiring | Its own phase (6) in this change | test-plan §5 marks it required after Phase 1 | Plan |

## Scope

**In scope:** Vitest runner (unit + integration); pin Risk #6 on four endpoints + the new one; `link`→connective server guard (D1); root-Claim identity — block demotion (3b), persisted re-designation (3c), block delete (3a); CI test gate; test-plan cookbook.

**Out of scope:** connective operand cardinality (D2); optimistic-rollback machinery (D4); two-user / RLS-hidden fixtures and Risk #1 (D5 → Phase 2); guards on `supports`/`rephrases`/`rebuts`.

## Architecture / Approach

Vitest with two projects: `unit` (node, fast, no infra) and `integration` (node, Supabase local). Integration seeds each test via the real `create_debate_with_root` RPC using a dedicated authenticated test user, then asserts/cleans up with a service-role client (RLS bypassed — fine for shape/not-found). Server features add a pure rule module + app-layer guards (`ValidationError`→422, `ConflictError`→409 mapped in `withAuth`) and one new `SECURITY INVOKER` RPC (`set_debate_root`). The client wires "Set as Root Claim" to a new `PATCH /api/debates/:id` and applies all canvas effects only after a 200.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap | Vitest config, test clients, fixtures, smoke tests | Service-role can't call the seeding RPC (auth.uid()) — handled by the seeding-user split |
| 2. Risk #6 floor | Unknown-id → 404 ×4 + SETOF contract | Tests are green from the start (regression pins, no red) |
| 3. `link` guard (TDD) | Server rejects `link`→non-connective (422) | Adding a guard without over-constraining the other three kinds |
| 4. Root re-designation (TDD) | `set_debate_root` RPC + `PATCH /api/debates/:id` + client wiring | Atomicity + correct canvas reconcile on success |
| 5. Root protection (TDD) | Demotion → 422; delete → 409 + UI block | Locating "is this the root" cheaply in the patch/delete path |
| 6. CI wiring | Test step in the GitHub workflow | Supabase-in-CI cost — may keep integration ad-hoc, unit required |
| 7. Cookbook + sync | test-plan §6 cookbook + status flip | Docs drift from the shipped tests |

**Prerequisites:** Supabase local running; `SUPABASE_SERVICE_ROLE_KEY` in the local test env (plus existing `SUPABASE_URL` / `SUPABASE_KEY`).
**Estimated effort:** ~3–4 sessions across 6 phases (phases 4–5 are the heavy ones).

## Open Risks & Assumptions

- Exact Vitest version must be matched to Vite 7 at install (`^3.2` or `^4`).
- Connective-target rejection in `set_debate_root` can be a repository pre-check or an RPC-raised tagged error — implement chooses, keeping it consistent with the Phase-3 link-guard placement.
- Integration-in-CI depends on Supabase being startable in the GitHub runner; if too heavy, Phase 6 keeps integration ad-hoc/local and gates only unit in CI (per CLAUDE.md / test-plan §4 guidance).

## Success Criteria (Summary)

- `npm test` green; `npm run lint` + `npx astro check` clean; the new migration applies cleanly.
- A user cannot demote or delete the root, can re-designate it (persisted), and cannot create an illegal `link` — proven server-side, not just in the UI.
- Every unknown-id mutation returns 404, including the new re-designation endpoint.
