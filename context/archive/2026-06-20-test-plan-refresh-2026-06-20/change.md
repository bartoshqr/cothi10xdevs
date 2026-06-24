---
change_id: test-plan-refresh-2026-06-20
title: Refresh test-plan.md - unblock gated phases, add critical-path e2e risk
status: archived
created: 2026-06-20
updated: 2026-06-24
archived_at: 2026-06-24T12:25:43Z
---

## Notes

Refresh context/foundation/test-plan.md. The guide is stale: §3 Phases 2-4 (and Phase 5's e2e portion) carried a gate ("don't open until S-03/S-04/S-05 ship") that roadmap.md shows is now moot - S-03, S-04, S-05, S-06 are all `done`. Remove the gate language from those rows (they remain `not started` for testing purposes - shipping a feature is not the same as a test phase opening - just no longer blocked).

Add new top risk #7 to §2: the full exchange lifecycle (advocate builds a debate graph -> invites challenger -> challenger marks/submits -> advocate marks/submits -> divergence summary renders) breaks at a boundary crossing (auth<->routing, store<->API, API<->DB, SSR<->island handoff, round-to-round state) even though every layer passes in isolation today (16 unit + 11 integration test files exist, zero true e2e). Impact: High. Likelihood: Medium. Source: roadmap.md's own "North star" / Primary Success Criterion line ("build -> invite -> challenger marks/adds -> advocate responds -> summary"); user-stated top concern this session; the existing Phase 5 placeholder ("e2e on the critical flow") had no risk row backing it.

Risk #7 response guidance: what proves protection - a single browser session, signed in as the advocate, builds a debate graph, invites a challenger, drives the challenger's turn (sign in as challenger, mark+submit), drives the advocate's turn (mark+submit), and the divergence summary renders with the correct common-ground/divergence classification, surviving real page reloads (not just in-memory store state). Must challenge: "all unit/integration tests are green, so the chain works" - per-layer correctness doesn't prove the layers compose through real navigation/SSR/multi-user sessions. Context /10x-research must ground: current route/component names for debate creation, invite, mark, submit, summary display; whether the challenger turn needs a second authenticated session or can mix API+UI; storageState feasibility for two users. Likely cheapest layer: e2e (Playwright) - the one risk in this project that genuinely needs a browser. Anti-pattern to avoid: mocking Supabase auth/DB (mocks away the exact boundary this risk is about); asserting only "page didn't error" instead of the summary's actual classification.

Revise §3 Phase 5 to "Critical-path e2e": one Playwright spec drives the full advocate<->challenger lifecycle from debate creation through divergence summary. Risks covered: #7. Test types: e2e (Playwright). Promote it ahead of Phases 2-4 in execution order (those remain valid, just no longer falsely gated) since this is the highest-value gap and what the user explicitly asked to build this session.

After creating the folder, follow the downstream continuation rule (next: /10x-research).
