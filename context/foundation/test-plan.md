# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-05 (Phase 1 change opened)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. WVMap's integrity risks are mostly server-side and
   graph-shaped — they fall to unit and integration tests, not e2e.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data. The Phase 2
   interview named turn integrity, React Flow churn, and store↔canvas drift
   as lived pain; those drove the top of the risk map.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/components/debate/`,
`src/pages/api/debates/`, `src/lib/debate/`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|---------------------------------|
| 1 | A user reads, edits, or marks a debate / node / relation belonging to a **pair they are not part of** — one couple's private reasoning map leaks to an outsider (IDOR / RLS gap). | High | High | PRD FR-021, FR-026 (ownership); git churn: recent `harden … graph RLS` + write-policy tightening commits; abuse lens (authorization/IDOR) |
| 2 | A save → reload **round-trips to a different graph** than was on the canvas: store state is not faithfully mapped through the nodes/relations API, silently losing or mangling nodes/edges. | High | High | interview Q2 (React Flow burn), Q3 (store↔canvas roulette); PRD guardrail "map data integrity"; hot-spot dir `src/components/debate/` (94 commits/30d) |
| 3 | The server **accepts a structurally illegal graph**: a connective with invalid operands, a relation kind landing on an illegal target, or an exchange initiated with no root Claim. | High | Medium | interview Q3 (graph-shape rules); PRD FR-004a, FR-006, FR-007; hot-spot dir `src/lib/debate/` (9 commits/30d) |
| 4 | A party **mutates a locked statement** (after submitting their turn, or outside their active turn) or acts out of round order — turn / round integrity corrupts the exchange. | High | High | interview Q1 (top worry); PRD FR-026, FR-017 — *mechanic lands with roadmap S-03/S-05; not yet built* |
| 5 | An edit or delete **corrupts the graph**: orphaned nodes left unflagged, dangling relations, or marks left pointing at deleted / edited statements (silent data loss). | High | High | PRD US-04, FR-026; roadmap S-05 ("heaviest, riskiest slice"); interview Q3 — *mechanic lands with roadmap S-05; not yet built* |
| 6 | A mutating endpoint on a **missing or RLS-hidden id returns 200** with a garbage all-null record instead of 404 (the lived `RETURNS SETOF` trap). | Medium | Medium | `lessons.md` (lived in S-01: `patch_node` 200'd on unknown id); abuse lens (server-side validation parity) |

**Impact × Likelihood rubric.** High = user loses access/data; failure is
publicly visible / we have already been burned here. Medium = feature
degrades, a workaround exists / touched occasionally, source of bugs. Low =
cosmetic / stable code. Protect High × High first.

Risks #4 and #5 are scored High × High on the *mechanic*, but the code that
implements turn-locking (roadmap S-03) and edit/delete mark-invalidation
(roadmap S-05) is not yet on disk — both slices are `proposed`. They are
held as forward-looking rollout targets: §3 Phase 4 is explicitly gated on
those slices shipping. Phases 1–3 only test what is on disk today.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | User B's request for User A's debate / node / relation is **denied at the database**, not merely hidden in the UI; the API returns 404/403, never the row. | "Logged-in implies authorized" — authentication is not ownership. | RLS policy shape on the graph tables; how the API maps an RLS-denied / empty result to a status code; a two-user fixture. | integration (Supabase local, two users) | testing only the owner's happy path; asserting the UI hides the resource while the API still serves it. |
| #2 | A graph built on the canvas, persisted then reloaded, yields an **identical node + edge set with identical types** — a round-trip property holds. | "It rendered, so it saved" — canvas state is not persisted state. | the store → API payload mapping; the reload / hydration path; id and handle stability across the round-trip. | unit on the store / persistence mapping; integration on the full round-trip | snapshotting the canvas DOM; mocking the persistence layer so the mapping under test never runs. |
| #3 | Structurally illegal graphs are **rejected server-side** (not just disabled in the UI); legal ones are accepted. | "The UI prevents it, so the server is safe" — a client guard is not a server guard. | the connective / relation legality rules; the FR-007 root-claim initiation gate; where validation actually executes. | unit (constraint / schema rules) + integration (API rejects) | mirroring the validator's own logic in the assertion (oracle problem); UI-only coverage. |
| #4 | A mutation on a **locked or out-of-turn statement is refused**; a round advances only when both turns are submitted. | "Final status 200 implies the turn was legal." | the turn-state machine; the lock boundary on submit; the who-can-act-when rule. | integration | asserting current behavior as correct without an independent oracle; brittle turn-ordering assumptions. |
| #5 | After a delete: **dangling relations are gone, stale marks cleared, orphans flagged**; nothing references a deleted node. | "Delete succeeded, so the graph is still consistent." | the cascade rules; the orphan-detection definition; the mark-invalidation trigger. | integration | over-mocking the DB so the cascade never runs; happy-path delete only. |
| #6 | A patch / delete on an **unknown id returns 404**, not 200-with-nulls. | "A non-null object means the row was found" (the SETOF trap). | the RPC return contract (SETOF vs composite); the not-found branch. | integration (not-found branch) | testing only the found path — `lint` + `build` cannot see this class of bug. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|----------------|
| 1 | Bootstrap + persistence/shape floor | Stand up the test runner and lock the shipped S-01 persistence + graph-shape rules at the cheapest layer | #3, #6 | unit + integration | change opened | context/changes/testing-persistence-floor/ |
| 2 | Authorization / RLS | Prove cross-pair access to debates / nodes / relations is denied at the database | #1 | integration | not started | — |
| 3 | Canvas↔store↔persistence round-trip | Defend store / persistence fidelity — the drift the team fears most | #2 | unit + integration | not started | — |
| 4 | Turn / round + edit-delete integrity | Lock turn-locking, mark-invalidation, and orphaning once the slices ship | #4, #5 | integration | not started | — |
| 5 | Quality-gates wiring | Wire lint + typecheck + unit/integration into CI; e2e on the critical flow | cross-cutting | gates + e2e | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

Phase 4 is **gated**: its risks (#4, #5) cover the turn / mark-invalidation
state machine delivered by roadmap slices S-03 (`challenger-first-turn`) and
S-05 (`multiround-edit-invalidation`), both currently `proposed`. Do not open
Phase 4 until those slices are on disk — `/10x-research` would have no code
to ground. Phase 5's e2e on the critical flow similarly waits for S-04
(`first-divergence-summary`). Phases 1–3 are actionable now against shipped
S-01.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations are grounded in local manifests/configs plus the MCP/tools
exposed in the current session.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | none yet — see Phase 1 | — | No test runner, config, or `test` script exists today. Phase 1 stands up Vitest (Vite-native; Astro/React 19 + TS already use Vite). |
| API / DB integration | Supabase local stack | — | `supabase start` gives a real Postgres with the project's migrations + RLS; two-user fixtures for Risk #1. Verify via `mcp__supabase-local__execute_sql`. |
| component / store | Vitest + Testing Library | — | For the Zustand store and persistence mapping (Risk #2). Add `@testing-library/react` in Phase 3 if a rendered-component test is justified over a pure store test. |
| e2e | Playwright (candidate) | — | none yet — see Phase 5; reserved for the one critical flow (build → invite → mark → summary) once S-04 lands. No Playwright MCP this session. |
| accessibility | none yet | — | Out of scope for the integrity-first rollout; revisit if a UI-regression risk surfaces. |

**Stack grounding tools (current session):**
- Docs: `ctx7` CLI (Context7) — available; use to ground exact Vitest / Playwright / Astro-on-Vite / Supabase test-setup APIs and current config syntax before Phase 1 writes config; checked: 2026-06-05
- Search: none (no Exa / web-search MCP exposed this session) — rely on Context7 for docs; checked: 2026-06-05
- Runtime/browser: no Playwright MCP exposed this session — e2e (Phase 5) would run via a local Playwright config, not an MCP; checked: 2026-06-05
- Provider/platform: Supabase MCP (`supabase-local` + plugin) — `execute_sql`, `list_tables`, `get_advisors`, `apply_migration`, `list_migrations`; directly supports Risk #1 RLS verification and Risk #6 not-found-path checks at the DB layer; checked: 2026-06-05

Use docs MCPs for current framework/library APIs and setup details. Do not
use MCP docs/search to infer code failure anchors; those belong in per-phase
`/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (already wired: `npm run lint`, `astro check`, CI on push/PR) | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | persistence + graph-shape logic regressions (#2, #3, #6) |
| RLS / authorization integration | CI on PR | required after §3 Phase 2 | cross-pair data leaks (#1) |
| e2e on the critical flow | CI on PR | required after §3 Phase 5 (waits for S-04) | a broken build → invite → mark → summary path |
| post-edit hook | local (agent loop) | recommended after §3 Phase 1 | regressions at edit time (re-runs unit on save) — local only, not a CI substitute |

Husky pre-commit (lint-staged) already runs ESLint/Prettier locally; it is
not a test gate. CI currently runs lint + build only — Phase 1 adds the test
step, Phase 5 adds e2e.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads "TBD — see
§3 Phase `<N>`."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (graph-shape constraint / schema rules: connective
  operand legality, relation-target legality, shared validation limits).

### 6.2 Adding an integration test (API endpoint)

- TBD — see §3 Phase 1 (debates / nodes / relations CRUD, incl. the
  not-found 404 branch — Risk #6) and §3 Phase 2 (cross-pair RLS denial —
  Risk #1).

### 6.3 Adding a store / persistence round-trip test

- TBD — see §3 Phase 3 (store → API payload → reload fidelity — Risk #2).

### 6.4 Adding a turn / mark-invalidation integrity test

- TBD — see §3 Phase 4 (gated on roadmap S-03 / S-05 — Risks #4, #5).

### 6.5 Adding an e2e test for the critical flow

- TBD — see §3 Phase 5 (gated on roadmap S-04: build → invite → mark →
  summary).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **The F-02 design spike (`src/components/spike/`, `src/pages/spike/`)** —
  a disposable design artifact, not production code. Re-evaluate only if
  spike code is promoted into the real editor. (Source: Phase 2 interview Q5.)
- **Static Polish landing / marketing pages (`src/components/landing/`)** —
  they change for copy, not logic; snapshot tests would break on every copy
  edit and catch nothing. Re-evaluate if interactive logic is added to a
  landing surface. (Source: Phase 2 interview Q5.)
- **Generated Supabase types (`src/db/database.types.ts`)** — the generator
  is the test. Re-evaluate never; regenerate instead. (Source: Phase 2
  interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-05
- Stack versions last verified: 2026-06-05
- AI-native tool references last verified: 2026-06-05

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
