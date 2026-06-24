---
change_id: testing-critical-path-e2e
title: Critical-path e2e — full advocate↔challenger lifecycle (Test Plan Phase 5)
status: archived
created: 2026-06-20
updated: 2026-06-24
archived_at: 2026-06-24T12:25:43Z
---

## Notes

Test Plan Phase 5 (Critical-path e2e), covering Risk #7: one Playwright spec
drives the full advocate↔challenger lifecycle — debate creation → invite →
challenger marks/submits → advocate marks/submits → divergence summary renders,
surviving a real page reload. See `context/foundation/test-plan.md` §3 Phase 5
and Risk #7 (§2 row 7, Risk Response Guidance row #7). Grounding for the first
spec (route/component map, accessible locators, two-user `storageState`, reload
assertion) lives in `context/changes/test-plan-refresh-2026-06-20/research.md`.
