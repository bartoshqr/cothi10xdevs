<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Advocate Map Builder (S-01)

- **Plan**: context/changes/advocate-map-builder/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION → all findings triaged & fixed
- **Findings**: 0 critical, 4 warnings, 3 observations (all resolved)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1–F4) → fixed |
| Architecture | PASS |
| Pattern Consistency | WARNING (F3, F6) → fixed |
| Success Criteria | PASS (lint + build green; F2/F3/F4 smoke-tested) |

Note: the plan was amended post-implementation with as-built reconciliation blocks
(D1–D16, P4-D1–D4). Code matches the as-built spec; no undocumented drift, no scope
creep (api.ts/seed.sql/nodeConstraints.ts/landing CTAs all accounted for).

## Findings

### F1 — RLS update/delete policies omit the debate-ownership check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000001_create_debate_graph.sql:117-122,144-149
- **Detail**: insert policies require author_id = auth.uid() AND debate ownership; update/delete checked only author_id. Latent hole for S-02 collaboration/ownership-transfer.
- **Fix**: New migration `20260605000001_tighten_graph_write_policies.sql` drops+recreates nodes_update/delete + relations_update/delete with the `exists(debates owned by auth.uid())` clause.
- **Decision**: FIXED — verified via pg_policies (all 4 write policies reference debates ownership).

### F2 — Non-atomic metadata merge in updateNode (SELECT-then-UPDATE race)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/lib/debate/repository.ts:98-141
- **Detail**: updateNode read metadata, merged in JS, wrote the whole object back — two concurrent flushes could lose a field.
- **Fix**: New migration `20260605000002_atomic_node_metadata_patch.sql` adds `patch_node(...) returns setof public.nodes` doing `metadata || p_metadata_patch` in one UPDATE; `updateNode` now calls the RPC. (SETOF chosen over bare composite so a 0-row match yields null, not an all-NULL row — caught in smoke testing.)
- **Decision**: FIXED — smoke-tested: atomic PATCH 200, merge preserved statement_type while applying title+body.

### F3 — Raw Supabase/Postgres error messages returned to the client on 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (info disclosure) / Pattern
- **Location**: every debate route's catch block (e.g. src/pages/api/debates/index.ts)
- **Detail**: catch returned `{ error: err.message }`, leaking Postgres internals. Auth routes never leak raw errors.
- **Fix**: `withAuth` (src/lib/api.ts) now wraps the handler in try/catch — logs server-side, returns generic `{ error: "Internal error" }` 500. Removed the redundant per-route 500 catch blocks from all six route files.
- **Decision**: FIXED — verified lint/build; unauth POST → 401, 400 Zod path still detailed.

### F4 — Nested PATCH/DELETE routes returned 500 (not 404) for unknown/unowned ids

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Pattern / Reliability
- **Location**: repository.updateNode / updateRelation / deleteNode / deleteRelation
- **Detail**: RLS-hidden rows surfaced as 500 via `.single()` "no rows".
- **Fix**: Added `NotFoundError` (src/lib/errors.ts); `withAuth` maps it to 404. updateNode/updateRelation use `.maybeSingle()` + throw NotFoundError when null; deleteNode/deleteRelation `.select("id")` and throw when 0 rows deleted.
- **Decision**: FIXED — smoke-tested: PATCH/DELETE nonexistent node + PATCH nonexistent relation all → 404; real root PATCH → 200. (Confirmed `deleteNodes` relies on server cascade and does not fire per-relation deletes, so no spurious 404s.)

### F5 — Module-scoped mutable cursor globals in MapEditor

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Reliability
- **Location**: src/components/debate/MapEditor.tsx (liveFlowCursor/liveScreenCursor)
- **Detail**: Module-level `let` shared across instances/remounts.
- **Fix**: `FloatingConnectionLine` now uses React Flow's own `toX/toY` props (the manual flow-cursor tracking was redundant); the remaining screen-cursor is a component-scoped `useRef` read only in event handlers (satisfies react-compiler's no-ref-in-render rule).
- **Decision**: FIXED — lint (incl. react-compiler) + build green.

### F6 — Dead `statementNodeSchema` diverged from API body optionality

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/lib/debate/nodeConstraints.ts
- **Detail**: `statementNodeSchema`/`StatementNodeInput` were exported but imported nowhere; modeled `body` as required vs optional in the live API schemas.
- **Fix**: Deleted the unused schema + type (and the now-unused `zod` import) — removed the divergence at the source.
- **Decision**: FIXED.

### F7 — Dead "not authenticated" branch in create_debate_with_root → 500

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Reliability
- **Location**: src/lib/debate/repository.ts createDebate + RPC
- **Detail**: RPC's auth.uid() guard is unreachable through withAuth; would surface as 500, not 401.
- **Fix**: Added a clarifying comment at the call site documenting the DB-layer guard as intentional, unreachable defense-in-depth (avoided brittle Postgres error-string → 401 mapping).
- **Decision**: FIXED (documented).
