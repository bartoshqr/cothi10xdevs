---
date: 2026-06-20T14:55:09+02:00
researcher: bartoshqr
git_commit: 47f61a52f3837ad3bdda53ab00539842681b9bb0
branch: playwright-init
repository: cothi10xdevs
topic: "Refresh test-plan.md — unblock gated phases; ground critical-path e2e risk #7 (full advocate↔challenger lifecycle)"
tags: [research, codebase, test-plan, e2e, playwright, debate-lifecycle, auth, storageState]
status: complete
last_updated: 2026-06-20
last_updated_by: bartoshqr
---

# Research: Test-plan refresh — gate removal + critical-path e2e grounding

**Date**: 2026-06-20T14:55:09+02:00
**Researcher**: bartoshqr
**Git Commit**: 47f61a52f3837ad3bdda53ab00539842681b9bb0
**Branch**: playwright-init
**Repository**: cothi10xdevs

## Research Question

Ground the facts needed to refresh `context/foundation/test-plan.md`:

1. Confirm the §3 phase gates (Phase 4 on S-03/S-05, Phase 5 e2e on S-04) are now moot per roadmap status.
2. Back new **Risk #7** (full exchange lifecycle breaks at a boundary crossing) with live codebase facts: current route/component names for debate creation, invite, mark, submit, summary display.
3. Decide whether the challenger turn needs a second authenticated session or can mix API+UI.
4. Assess **Playwright `storageState`** feasibility for two users.
5. Confirm the lifecycle **survives real page reloads** (DB-persisted, not just in-memory store state) — the crux of Risk #7.

## Summary

- **Gates are moot.** `roadmap.md` shows S-01..S-06 and the north star **S-04 all `done`**. Phase 4 (gated on S-03/S-05) and Phase 5's e2e (gated on S-04) are no longer blocked. They stay `not started` as _test_ phases — shipping a feature ≠ opening a test phase — but the "do not open until X ships" language must be deleted.
- **Risk #7 is real and e2e-shaped.** Every layer is covered by unit/integration tests in isolation, but **zero true e2e** exercises the composed flow through real navigation + SSR + two authenticated sessions. This is the one risk in the project that genuinely needs a browser.
- **Reloads reflect DB state — confirmed.** `[id].astro` does a fresh **SSR fetch** of graph + marks on every load and hydrates the Zustand store from it; turn state is _derived_ from the DB `exchange.current_turn`, never retained client-side. A reload therefore reads persisted truth. This makes the "survives reload" assertion meaningful and testable.
- **storageState is feasible for two users.** Auth is **cookie-based** via `@supabase/ssr`; the middleware reads the user from cookies. Playwright `storageState` captures exactly those cookies. Recommended pattern: **two browser contexts**, one per user, each with its own saved auth state — run both in the same test.
- **UI-vs-API split:** the full round _can_ be driven 100% via API, but that would mock away nothing yet also prove nothing about the boundary Risk #7 is about (SSR↔island handoff, real navigation, multi-user session). The plan should drive the **critical path through the UI** (real reloads, real locators) and may use API/service-client only for **setup/teardown and second-user provisioning**, never to skip the boundary under test.

## Detailed Findings

### A. Phase-gate status (roadmap ground truth)

`context/foundation/roadmap.md` "At a glance" table — all critical-path slices are `done`:

- `roadmap.md:50` S-01 advocate-map-builder — **done**
- `roadmap.md:51` S-02 invite-and-open-exchange — **done**
- `roadmap.md:52` S-03 challenger-first-turn — **done**
- `roadmap.md:53` S-04 first-divergence-summary (north star) — **done**
- `roadmap.md:54` S-05 multiround-edit-invalidation — **done**
- `roadmap.md:55` S-06 debate-list-and-inbox — **done**

North star (`roadmap.md:32-34`) is **S-04**, done. → test-plan §3 gate text on Phases 4 & 5 and the §2 note ("code … is not yet on disk … both slices are `proposed`") are stale and must be removed/rewritten.

### B. Lifecycle UI map (Risk #7 anchors — route → component → accessible locators)

All canvas/turn/summary islands are `client:only="react"` (hydrate on client, no SSR HTML); `InviteChallenger` and the auth form are `client:load`. Verified at `src/pages/debates/[id].astro:64,71,76,97`.

| Stage                 | Route                  | Component (file)                                                                                                                                 | Primary accessible locators                                                                                                                                                                                                         |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Create debate      | `/debates/new`         | `src/components/debate/CreateDebateForm.tsx` (island `client:load` in `src/pages/debates/new.astro:13`)                                          | `getByLabel("Debate title")`, `getByLabel("Root claim")`, `getByLabel("Root claim details")`, `getByRole("button", { name: "Create debate" })` → navigates to `/debates/{id}`                                                       |
| 2. Canvas / build     | `/debates/{id}`        | `src/components/debate/MapEditor.tsx` (React Flow, `client:only="react"`); `AddNodeMenu.tsx`, `nodes/StatementNode.tsx`, `ConnectKindPicker.tsx` | add node via right-click → `getByRole("button", { name: /SOURCE\|DATA\|WARRANT\|claim/ })`; connect via drag-to-handle → `getByRole("button", { name: /supports\|rebuts\|rephrases\|link/ })`; edit via node dbl-click              |
| 3. Invite challenger  | `/debates/{id}` header | `src/components/debate/InviteChallenger.tsx` (`client:load`)                                                                                     | `getByRole("button", { name: "Invite challenger" })`, `getByLabel("Username")`, round buttons `getByRole("button", { name: /^[1-5]$/ })`, `getByRole("button", { name: "Send invite" })`                                            |
| 4. Challenger marks   | `/debates/{id}` canvas | `nodes/StatementNode.tsx` mark bar; labels from `src/lib/debate/mapVisualLanguage.ts`                                                            | within a node: `getByRole("button", { name: "Accept" \| "Challenge" \| "Abstain" })`                                                                                                                                                |
| 5. Submit turn        | `/debates/{id}` header | `src/components/debate/TurnBar.tsx` (`client:only="react"`)                                                                                      | `getByRole("button", { name: /Submit turn/ })` (label includes `(marked/total)`); after submit reads "Submitted"                                                                                                                    |
| 6. Advocate response  | `/debates/{id}`        | same as 2/4/5 with `viewerRole="advocate"`                                                                                                       | same locators                                                                                                                                                                                                                       |
| 7. Divergence summary | `/debates/{id}` header | `src/components/debate/DivergenceSummary.tsx` (`client:only="react"`)                                                                            | open: `getByRole("button", { name: /View divergence summary/ })`; assert headings `getByText("Common ground")`, `getByText("Open divergences")` + subheads `"Factual gaps"` / `"Premise gaps"`, `getByText("Unresolved positions")` |

**Summary classification is the real assertion target** (avoids the "page didn't error" anti-pattern). `src/lib/summary/classify.ts`:

- `classify.ts:42` `type DivergenceGap = "factual" | "values"`
- `classify.ts:56-65` `gapFor()` — Source/Data/Backing → `factual`; Warrant/Claim/Rebuttal → `values` (rendered as "Premise gaps").
- Buckets (`classify.ts:77-110`): `commonGround` (accept), `openDivergences` (challenge + gap), `unresolved` (abstain / `valid=false` / unmarked). Buckets are mutually exclusive — a strong oracle.

### C. Reload survival — DB-persisted, not in-memory (the Risk #7 crux)

`src/pages/debates/[id].astro` performs a fresh **server-side fetch on every request/reload**:

- `[id].astro:20` `getDebateGraph(supabase, debateId)` (`src/lib/debate/repository.ts:197-214`)
- `[id].astro:44` `getDebateMarks({ supabase, debateId })` (`src/lib/mark/repository.ts:30-42`)

These props hydrate the store (`src/components/debate/store.ts` `hydrate(...)` ~`store.ts:512-538`), which **clears in-flight client state** (debounce timers, unsaved edges) and rebuilds nodes/edges from DB rows. Turn awareness is **derived from the DB**, not stored: `src/lib/debate/viewer.ts:24-54` computes `isMyTurn` from `exchange.currentTurn === viewerRole`. → After an opponent submits, a reload re-derives the correct turn from persisted state.

**Test implication:** a `page.reload()` mid-flow is a legitimate, meaningful assertion point — it forces a real SSR round-trip to the DB. Caveat: in-flight optimistic creates (`pending`) and 400 ms-debounced field edits are _not yet persisted_; reload only reflects what reached the DB, so reload _after_ awaiting the relevant network response, not mid-edit.

### D. Turn / mark / submit API (UI-vs-API split)

All steps have HTTP endpoints (so API-driven setup is possible):

| Step          | Endpoint                          | Method                                                              |
| ------------- | --------------------------------- | ------------------------------------------------------------------- |
| create node   | `/api/debates/{id}/nodes`         | POST                                                                |
| connect       | `/api/debates/{id}/relations`     | POST                                                                |
| invite        | `/api/exchanges`                  | POST                                                                |
| accept invite | `/api/exchanges/{id}/respond`     | POST `{accept}`                                                     |
| mark          | `/api/debates/{id}/marks`         | POST `{nodeId, stance}`                                             |
| submit turn   | `/api/exchanges/{id}/submit-turn` | POST                                                                |
| read state    | `/api/exchanges/{id}`             | GET → `{status, currentTurn, inMiniTurn, currentRound, roundCount}` |
| summary       | `/api/debates/{id}/summary`       | GET                                                                 |

`submit-turn` enforces the **FR-011 completeness gate** server-side (`supabase/migrations/20260610000002_submit_turn_rpc.sql:60-84`): it counts the counterpart's statement nodes (connectives excluded) vs the actor's valid marks and raises P0001 → **409** if incomplete; on success flips `current_turn`. The mark gate is **symmetric** — both parties must mark every counterpart statement before they can submit.

**Recommendation for the spec:** drive the _critical path_ through the **UI** (this is what proves the SSR↔island↔store↔API↔DB composition and survives reload). Use the **API / service-role client only** for: provisioning the two users, optional bulk graph seeding outside the assertion window, and teardown. Do **not** drive marks/submit purely via API in the e2e — that re-tests the integration layer (already covered by `tests/integration/marks.test.ts`, cookbook §6.4) and dodges the boundary Risk #7 targets.

### E. Auth model & two-user storageState feasibility

- **Cookie-based session.** `src/pages/api/auth/signin.ts` calls `supabase.auth.signInWithPassword(...)` then `redirect("/debates")`. The client is built with `@supabase/ssr` `createServerClient` (`src/lib/supabase.ts`) whose `cookies.setAll` writes the Supabase auth cookie(s) (`sb-*-auth-token`, possibly chunked) to the response.
- **Middleware reads cookies.** `src/middleware.ts` calls `supabase.auth.getUser()` (cookie-backed) and gates `PROTECTED_ROUTES = ["/dashboard", "/debates"]`.
- **Sign-in form** (`src/components/auth/SignInForm.tsx`, island in `src/pages/auth/signin.astro:12`): `getByLabel("Email address")`, `getByLabel("Password")`, `getByRole("button", { name: "Sign in" })`; success lands on `/debates`.
- **Test-user provisioning already exists.** `tests/integration/globalSetup.ts` creates two users via `admin.auth.admin.createUser({ ..., email_confirm: true })` — `seedingUser` (advocate) and `challengerUser` — and `tests/integration/helpers.ts` `getClientAsUser(email, password)` signs in via anon key. Same pattern is reusable for e2e. Env needed: `SUPABASE_URL`, `SUPABASE_KEY` (anon), `SUPABASE_SERVICE_ROLE_KEY`. `email_confirm: true` sidesteps the local "confirm email" toggle (README §Email confirmation).

**Verdict:** ✅ `storageState` works because auth is cookie-based. Recommended architecture — **two browser contexts**, each created with `browser.newContext({ storageState })` for advocate and challenger, both alive in one test so the exchange can ping-pong between them with real reloads. A Playwright global-setup (mirroring `globalSetup.ts`) provisions both users and saves two storageState files.

## Code References

- `context/foundation/roadmap.md:32-58` — north star + slice statuses (S-01..S-06 done)
- `context/foundation/test-plan.md` §2 risk map, §3 phase table + gate notes, §4 stack (Playwright "candidate"), §5 e2e gate, §6.5 (TBD) — the refresh targets
- `src/pages/debates/new.astro:13` + `src/components/debate/CreateDebateForm.tsx` — create flow
- `src/pages/debates/[id].astro:20,44,64,71,76,97` — SSR fetch + island hydration directives
- `src/components/debate/MapEditor.tsx`, `nodes/StatementNode.tsx`, `AddNodeMenu.tsx`, `ConnectKindPicker.tsx`, `InviteChallenger.tsx`, `TurnBar.tsx`, `DivergenceSummary.tsx` — lifecycle UI
- `src/lib/debate/viewer.ts:24-54` — turn derived from DB
- `src/lib/summary/classify.ts:42-110` — summary buckets + gap classification (assertion oracle)
- `supabase/migrations/20260610000002_submit_turn_rpc.sql:60-84` — completeness gate / turn flip
- `src/pages/api/auth/signin.ts`, `src/lib/supabase.ts`, `src/middleware.ts` — cookie auth + protection
- `tests/integration/globalSetup.ts`, `tests/integration/helpers.ts` — reusable two-user provisioning
- `playwright.config.js` — base scaffold (testDir `./tests/e2e`, webServer `npm run dev` @ `:4321`, chromium+firefox); `tests/e2e/example.spec.js` is the throwaway sample to replace

## Architecture Insights

- **SSR-first hydration is the safety net for Risk #7.** Because the page re-reads the DB on every load and never trusts retained client memory, a reload is a clean DB-truth checkpoint — the cheapest way to assert "the layers composed correctly" is to reload between turns and re-verify.
- **Turn enforcement is an RLS/RPC boundary, not a UI lock** (lessons.md: "Enforce turn/phase as an RLS predicate"). The e2e proves the _composition_, not the boundary itself (that's the integration suite's job).
- **The summary's bucket exclusivity + factual/values gap mapping is a deterministic oracle** — assert the classification, not pixels and not "no error". Matches Risk #7's stated anti-pattern.
- **`client:only="react"` islands** mean the canvas/turn/summary have no server HTML; tests must wait for hydration (e.g. wait for the React Flow viewport / a known control to be visible) before acting.

## Historical Context (from prior changes)

- `context/changes/testing-persistence-floor/` — Phase 1 floor (Risk #3, #6); established Vitest unit+integration split and the `describeIntegration` self-skip pattern reused here for env gating.
- `context/foundation/lessons.md` — relevant priors: SETOF not-found 404 (also guards `submit_turn`), 42P17 RLS-recursion helpers, turn-as-RLS-predicate, invalidation-as-flag, repository-only Supabase access, never `window.location.reload()`. These bound what the e2e need NOT re-test (boundaries already integration-covered).
- `context/foundation/react-ssr-workerd-debugging.md` — SSR/workerd dev runtime notes; relevant to why dev server is `npm run dev` on workerd and to island hydration timing.

## Related Research

- `context/changes/testing-persistence-floor/research.md` — Phase 1 decisions (SETOF, auth split, integration-not-in-CI).

## Open Questions

1. **storageState refresh:** Supabase access tokens are short-lived; if a saved storageState's token expires between global-setup and test run, the first request refreshes via the refresh-token cookie — confirm the SSR `setAll` writes the rotated cookie back so the session survives (likely fine; verify in the spec's first navigation).
2. **Cookie chunking:** `@supabase/ssr` may split the auth cookie into `…-auth-token.0/.1`. `storageState` captures all cookies, so this should be transparent — note it if a login helper ever reads a single cookie by name.
3. **Polling vs e2e timing:** `MapEditor` polls `/api/exchanges/{id}` (~1s) and reconciles on turn flip. A two-context test may observe a transient pre-flip state; prefer asserting via `page.reload()` + `waitForURL`/`toBeVisible` on the post-flip control rather than racing the poll.
4. **Round count for the spec:** a 1-round exchange is the smallest path to a summary (summary gates on `currentRound >= 2` or `completed`). Confirm whether 1 round closes to `completed` after the advocate's response or whether the mini-turn intervenes — decide the minimal happy path in `/10x-plan`.
