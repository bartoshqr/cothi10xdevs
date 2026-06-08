---
change_id: testing-persistence-floor
title: "Test Phase 1: stand up the runner + persistence/shape floor (risks #3, #6)"
status: implemented
created: 2026-06-05
updated: 2026-06-08
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Bootstrap + persistence/shape floor".
Risks covered: #3 (server accepts a structurally illegal graph), #6 (mutating endpoint on a missing/RLS-hidden id returns 200 instead of 404 — the lived RETURNS SETOF trap).
Test types planned: unit + integration.
Risk response intent:
- #3: prove that structurally illegal graphs (bad connective operands, a relation kind on an illegal target, an exchange with no root Claim) are rejected server-side, not just disabled in the UI; legal graphs are accepted.
- #6: prove that a patch/delete on an unknown id returns 404, not a 200-with-nulls record.
This phase also stands up the test runner (no test config or `test` script exists yet) — Vitest is the candidate per §4; ground its exact setup against current docs before committing config.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
