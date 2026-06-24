---
date: 2026-06-20T15:13:38+0200
researcher: bartoshqr
git_commit: 6d69c00b5de8deb9de31bf77888f51eac34b6832
branch: playwright-init
repository: cothi10xdevs
topic: "Critical-path e2e (Test Plan Phase 5 / Risk #7): ground the first Playwright spec for the full advocate↔challenger lifecycle"
tags: [research, codebase, e2e, playwright, debate-lifecycle, divergence-summary, storageState, two-user]
status: complete
last_updated: 2026-06-20
last_updated_by: bartoshqr
---

# Research: Critical-path e2e — full advocate↔challenger lifecycle (Phase 5 / Risk #7)

**Date**: 2026-06-20T15:13:38+0200
**Researcher**: bartoshqr
**Git Commit**: 6d69c00b5de8deb9de31bf77888f51eac34b6832
**Branch**: playwright-init
**Repository**: cothi10xdevs

## Research Question

Ground the facts needed to write the first Playwright e2e spec for Test Plan
**Phase 5 / Risk #7** — one browser run driving the full lifecycle: advocate
builds a graph → invites challenger → challenger marks every advocate statement

- submits → advocate marks + submits → **divergence summary renders with the
  correct classification**, surviving a real `page.reload()`. This pass verifies
  the prior grounding against live code and **closes the four open questions** left
  by `context/changes/test-plan-refresh-2026-06-20/research.md` (minimal happy-path
  to a rendered summary; storageState token/cookie survival; cookie chunking;
  poll-vs-reload timing).

## Summary

The prior refresh research is confirmed against live code (HEAD is one
docs-only commit ahead — no code drift). The four open questions are now closed,
and three planning-critical facts emerged that the prior pass did not have:

1. **Minimal path = `round_count=1` + THREE submits, asserting via the
   `completed` branch.** The summary gate is `status === "completed" ||
currentRound >= 2` (an **OR**, `src/lib/summary/repository.ts:38`). A
   1-round exchange never advances `current_round` past 1, so the ONLY way it
   opens is by reaching `completed` — which requires a **mini-turn**: challenger
   submits → advocate submits (enters `in_mini_turn`) → **challenger submits the
   mini-turn → `completed`**. So the e2e drives three submits, not two.

2. **The challenger accepts the invite from the `/debates` LIST page, not the
   canvas.** `RespondInvite.tsx` (Accept/Decline) renders inside
   `ChallengerInviteCard` on `src/pages/debates/index.astro` ("As challenger"
   section). The prior map implied this happened on the canvas — it does not.

3. **Several controls have no accessible name** and need scoping or a testid:
   the node title/body `<textarea>`s in edit mode, the React Flow pane/handles
   (right-click-add and drag-to-connect), and the invite username input (label
   not associated — use `getByPlaceholder('Search users…')`).

Confirmed unchanged: cookie-based `@supabase/ssr` auth → `storageState` is
feasible; two-user provisioning is portable verbatim from
`tests/integration/globalSetup.ts`; usernames auto-materialize via a signup
trigger so **invite-by-username works with no extra setup**; reloads reflect DB
truth (SSR refetch + store hydrate); turn state is derived from the DB.

**Test-shape recommendation:** drive the critical path through the **UI** in
**two browser contexts** (advocate + challenger, each with its own saved
`storageState`), use the service-role admin client only for user provisioning +
teardown, and assert the **summary's bucket classification** (not "no error").
Prefer `page.reload()` + `toBeVisible` on the post-flip control over racing the
~1 s `MapEditor` poll.

## Detailed Findings

### A. Minimal happy-path to a rendered summary (closes prior Open Q4)

**The gate is an OR, server- and client-side:**

- `src/lib/summary/repository.ts:38` — `const gateMet = exchange.status === "completed" || exchange.currentRound >= 2;` → returns `null` (→ 404 at `src/pages/api/debates/[id]/summary.ts:14-16`) when unmet.
- `src/components/debate/DivergenceSummary.tsx:168-172` mirrors it; the trigger button **renders nothing** until `gateMet`.

**Exchange state machine** (authoritative RPC is the _second_ migration,
`supabase/migrations/20260611000002_round_close_and_mini_turn.sql:77-179`, which
drops+recreates the first):

- Insert defaults (`20260609000001_create_exchanges.sql:18-22`): `status='pending'`, `current_round=1`, `current_turn='challenger'`, `in_mini_turn=false`. `round_count` is caller-supplied, range `[1,5]`, default 3 (`src/lib/exchange/constants.ts:3`).
- From `accepted / challenger / round 1`:
  - **Challenger submits** → `current_turn='advocate'`, round unchanged.
  - **Advocate submits, final round** (`current_round == round_count`, e.g. 1) → `current_turn='challenger'`, **`in_mini_turn=true`**, round untouched. _(Non-final: `current_turn='challenger'`, `current_round += 1` → round 2.)_
  - **Challenger submits the mini-turn** (`in_mini_turn=true`) → **`status='completed'`**, `in_mini_turn=false`.
- Every `submit_turn` enforces the **FR-011 completeness gate**: the submitter must have a valid mark on every statement node authored by the _other_ party, else `raise INCOMPLETE_MARKS` (P0001 → **409** `ConflictError`, `src/lib/exchange/repository.ts:193`).

**Minimal path (recommended for the spec): `round_count = 1`, three submits.**

1. Challenger marks both advocate statements → submits → turn=advocate.
2. Advocate submits (no challenger statements to mark, `total=0`) → `in_mini_turn=true`, turn=challenger. **Gate still NOT met** (status still `accepted`, round still 1).
3. Challenger submits the mini-turn → `status='completed'` → **gate met, summary renders.**

The `currentRound >= 2` branch needs `round_count >= 2` and is no fewer actions
to first-render, so `round_count=1` + completed is the cheapest.

### B. Smallest deterministic graph + the classification oracle

**Smallest graph = root `claim` + one more statement node** (the invite gate
requires a root: `openExchange` throws `ValidationError` if `!debate.root_node_id`,
`src/lib/exchange/repository.ts:21-23`). Challenger **Accepts** one →
`commonGround`; **Challenges** the other → `openDivergences`.

Classification oracle — `src/lib/summary/classify.ts`:

- Buckets (`:77-110`): `accept → commonGround`; `challenge → openDivergences (+gap)`; `abstain` or no-valid-mark → `unresolved` (mutually exclusive — a strong oracle).
- Gap mapping `gapFor` (`:56-67`): `source|data|backing → "factual"`; `warrant|claim|rebuttal → "values"` (rendered as **"Premise gaps"**).
- Connectives skipped (`:81`: `node.kind !== "statement"`), so AND/OR nodes don't perturb buckets — **avoid connectives entirely** in the spec.
- Stance enum is `accept|challenge|abstain` (renamed from `agree` in `20260612000001_rename_agree_to_accept.sql`).

**Deterministic recipe:** make the second node a `data` (or `source`/`backing`)
node and **Challenge** it → lands under **"Factual gaps"**; **Accept** the root
`claim` → populates **"Common ground"**. Optionally link the second node to the
root with a `supports` relation to avoid the `ORPHANED` tag (bucketing is
unaffected by orphaning — `src/lib/summary/repository.ts:52-67`).

**Rendered assertion strings** (`DivergenceSummary.tsx`): panel `<h2>`
"Divergence summary" (`:237`); `<h3>` "Common ground" (`:240`) / "Open
divergences" (`:250`) / "Unresolved positions" (`:286`); `<h4>` "Factual gaps"
(`:258`) / "Premise gaps" (`:271`); empty states "No accepted statements yet."
/ "No challenged statements." / "Nothing unresolved." Author subgroups "My
statements" / "Challenger statements" | "Advocate statements".

### C. Verified UI locator map (per-stage, with hydration anchors)

Islands `MapEditor`, `TurnBar`, `DivergenceSummary` are **`client:only="react"`**
(`src/pages/debates/[id].astro:63,75,97`) → **no SSR HTML**; wait on a hydrated
control before acting. `InviteChallenger` is `client:load` (SSR-present).

| Stage                 | Locator(s)                                                                                                                                                                                                                                                                    | File                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Sign in               | `getByLabel('Email address')`, `getByLabel('Password')`, `getByRole('button',{name:'Sign in'})` → `waitForURL('**/debates')`                                                                                                                                                  | `SignInForm.tsx:47,60,84`; redirect `api/auth/signin.ts:19`                        |
| Create debate         | `getByLabel('Debate title')`, `getByLabel('Root claim')`, `getByLabel(/Root claim details/)`, `getByRole('button',{name:'Create debate'})` → client nav `window.location.href=/debates/{id}`                                                                                  | `CreateDebateForm.tsx:60,72,85,114,49`                                             |
| Canvas ready (anchor) | `getByRole('button',{name:'zoom in'})` (React Flow Controls); fallback `.react-flow__controls`                                                                                                                                                                                | `MapEditor.tsx:636`                                                                |
| Add node              | right-click pane (`.react-flow__pane`, no a11y name) → `getByRole('button',{name:'CLAIM'\|'SOURCE'\|'DATA'\|'WARRANT'\|'BACKING'\|'REBUTTAL'\|'AND'\|'OR'})`                                                                                                                  | `AddNodeMenu.tsx:74-133`; badges `mapVisualLanguage.ts:46-53`                      |
| Edit node text        | dbl-click node → **unlabeled** `<textarea>` title (`:365`) / body (`:465`) — **scope within node card or add testid**; source URL `getByPlaceholder('https://... (required)')` (`:439`)                                                                                       | `StatementNode.tsx`                                                                |
| Connect               | drag `.react-flow__handle` source→target → `ConnectKindPicker` `getByRole('button',{name:/supports\|rebuts\|rephrases\|link/})`                                                                                                                                               | `ConnectKindPicker.tsx:73-101`                                                     |
| Mark bar              | `getByRole('button',{name:'Accept'\|'Challenge'\|'Abstain'})` per node; visible only for counterpart's statements; interactive only on your turn (else `disabled`)                                                                                                            | `StatementNode.tsx:515-563`; labels `mapVisualLanguage.ts:75-79`                   |
| Invite                | open `getByRole('button',{name:'Invite challenger'})`; username **`getByPlaceholder('Search users…')`** (label NOT associated); pick result `getByRole('button',{name:<username>})`; rounds `getByRole('button',{name:'1'..'5'})`; `getByRole('button',{name:'Send invite'})` | `InviteChallenger.tsx:313,336,343,388,430`                                         |
| Challenger accepts    | **on `/debates` list page** ("As challenger") → `getByRole('button',{name:'Accept'})`                                                                                                                                                                                         | `RespondInvite.tsx:38`; `ChallengerInviteCard.tsx:94`; `pages/debates/index.astro` |
| Submit turn           | `getByRole('button',{name:/^Submit turn \(\d+\/\d+\)$/})`; after submit flips to `getByRole('button',{name:'Submitted'})` (disabled); turn labels "My Turn"/"My mini-turn"/"Advocate's turn"/…                                                                                | `TurnBar.tsx:78-99,142`                                                            |
| Summary               | trigger `getByRole('button',{name:/divergence summary/})` (renders only when gate met); panel `getByRole('heading',{name:'Divergence summary'})` + section headings above                                                                                                     | `DivergenceSummary.tsx:170-172,224,237`                                            |

**Controls with NO accessible name (need testid or CSS/scoping):** node
title/body textareas; `.react-flow__pane`; `.react-flow__handle`; invite
username input (use placeholder); node role-badge `<span>`. A small `data-testid`
addition on the node title/body textareas would make the build step robust —
flag for `/10x-plan` to decide (testid vs scope-within-card).

**Cross-island event bridge:** `TurnBar`/`DivergenceSummary`/`InviteChallenger`
exchange live state with `MapEditor` over `window` CustomEvents
(`wvmap:turn-gate`, `wvmap:submit-turn`, `wvmap:set-can-edit`,
`wvmap:connectivity`). **Wait for the canvas (Controls visible) before asserting
TurnBar/Summary state.**

### D. Reload survival — confirmed DB-persisted (Risk #7 crux)

`src/pages/debates/[id].astro` SSR-refetches on every load
(`getDebateGraph` `:20`, `getDebateMarks` `:44`) and hydrates the store, clearing
in-flight client state. Turn awareness is **derived from the DB**
(`exchange.current_turn`), never retained client-side. → `page.reload()` mid-flow
is a meaningful DB-truth checkpoint. **Caveat:** reload only reflects what reached
the DB — `await` the relevant network response (create/mark/submit) before
reloading; do not reload mid-edit (400 ms-debounced field saves, `pending`
optimistic creates).

### E. Auth + storageState + test infra (closes prior Open Q1/Q2)

- **Cookie auth confirmed.** `src/lib/supabase.ts:22-26` `createServerClient` writes cookies via `setAll`. Cookie name `sb-<ref>-auth-token`; for local Supabase the ref is host-derived (`127` → `sb-127-auth-token`) and the session is **chunked** into `.0`, `.1`, …. `storageState` captures all cookies, so chunking is transparent — **confirm the exact name at runtime** (it depends on the local URL).
- **Token rotation self-heals.** Middleware calls `getUser()` every request through the same client; a refreshed token is re-set on that response. A saved `storageState` survives access-token expiry as long as the **refresh token** is still valid; if the whole session expired, regenerate. → keep runs short / regenerate state per run in global-setup.
- **Protected routes** (`src/middleware.ts:4`): `["/dashboard","/debates"]`, matched by `startsWith`, so `/debates` and `/debates/new` both gated; unauth → redirect `/auth/signin` (`:20`).
- **Two-user provisioning portable verbatim** (`tests/integration/globalSetup.ts:49-66`): service-role admin client → `admin.auth.admin.createUser({ email, password, email_confirm:true, user_metadata:{ username } })`. Emails/passwords/usernames are **random per run** (`tu_<uuid>` truncated to 30, matching DB regex). Return the challenger's username so the advocate test can invite by it. `helpers.ts:72-85 createTestUser` is a standalone copy to lift.
- **Usernames auto-materialize** — trigger `on_auth_user_created` → `handle_new_user()` inserts `profiles(id, username)` from `raw_user_meta_data->>'username'` (`supabase/migrations/20260525142850_create_profiles.sql:39-59`). So **invite-by-username works out of the box** with no extra step. Username search is RLS-gated to authenticated users; endpoint `src/pages/api/users/search.ts`.
- **Env vars:** dev server needs `SUPABASE_URL`, `SUPABASE_KEY` (anon); provisioning additionally needs `SUPABASE_SERVICE_ROLE_KEY` (lives in `.env.test:4`, the standard local-demo JWT). `readIntegrationEnv()` merges `.env` + `.env.test`. Local Supabase: API `127.0.0.1:54321`, DB `54322`, Studio `54323`, Inbucket `54324` (`supabase/config.toml`).

### F. Playwright config — what exists vs what's missing

`playwright.config.js`: `testDir './tests/e2e'` (`:16`), `fullyParallel:true`,
projects **chromium + firefox**, `reporter html`, `trace 'on-first-retry'`,
`webServer { command:'npm run dev', url:'http://localhost:4321',
reuseExistingServer:!CI }`. **No `storageState`, no `globalSetup`, no
`baseURL`** — all must be added. `tests/e2e/example.spec.js` is the throwaway to
replace. `package.json` scripts: `test`/`test:unit`/`test:integration` exist;
**no `test:e2e`** — currently `npx playwright test`; consider adding a script.
`npm run dev` = `astro dev` (Cloudflare workerd adapter) on default **4321**.

## Code References

- `src/lib/summary/repository.ts:38` — summary gate (`completed || currentRound>=2`), `:52-67` orphan tagging
- `src/pages/api/debates/[id]/summary.ts:14-16` — null → 404
- `src/components/debate/DivergenceSummary.tsx:168-172` (client gate), `:224,237-291` (rendered strings)
- `src/lib/summary/classify.ts:56-67` (gapFor), `:77-110` (buckets)
- `supabase/migrations/20260611000002_round_close_and_mini_turn.sql:77-179` — submit_turn state machine + mini-turn close
- `supabase/migrations/20260609000001_create_exchanges.sql:18-22` — exchange defaults
- `src/lib/exchange/repository.ts:21-23` (root-claim invite gate), `:187-198` (submit_turn wrapper, 409 mapping); `src/lib/exchange/constants.ts:3` (round range)
- `src/pages/debates/[id].astro:20,44,63,71,75,97` — SSR refetch + island hydration directives
- `src/lib/debate/viewer.ts:24-54` — turn derived from DB (per prior research)
- UI: `SignInForm.tsx:47,60,84`; `CreateDebateForm.tsx:49,60,72,85,114`; `MapEditor.tsx:521-537,602,621,636`; `AddNodeMenu.tsx:74-133`; `nodes/StatementNode.tsx:305,343,365,439,465,515-563,578`; `ConnectKindPicker.tsx:6,28,73-101`; `InviteChallenger.tsx:275,313,325,336,343,384,388,430`; `RespondInvite.tsx:38,46`; `ChallengerInviteCard.tsx:94`; `TurnBar.tsx:52,67,78-99,142,156,168`; `mapVisualLanguage.ts:17,46-53,75-79`
- Auth/infra: `src/lib/supabase.ts:16-26`; `src/pages/api/auth/signin.ts:13,19`; `src/middleware.ts:4,11-12,18,20`; `tests/integration/globalSetup.ts:41-72`; `tests/integration/helpers.ts:72-85`; `tests/integration/env.ts:21-26`; `supabase/migrations/20260525142850_create_profiles.sql:4-12,39-59`; `playwright.config.js:16-79`; `package.json:6,13-15,48`; `supabase/config.toml`

## Architecture Insights

- **The mini-turn is the gotcha.** Naively a 1-round exchange "should" close after the advocate's response, but the closing pass is a challenger **mini-turn** — the e2e must drive THREE submits to reach `completed` and a rendered summary. Plan the spec around `round_count=1` + 3 submits.
- **Summary classification is a deterministic oracle** (mutually-exclusive buckets + fixed factual/values gap mapping). Assert the classification strings, never "page didn't error" — that's exactly Risk #7's named anti-pattern.
- **SSR-first hydration makes reload a clean DB checkpoint** — the cheapest way to prove the layers composed is to reload between turns and re-verify, but only after awaiting the persisting network call.
- **`client:only` islands have no SSR HTML** and talk to `MapEditor` over `window` CustomEvents — tests must gate on canvas hydration (Controls visible) before reading TurnBar/Summary.
- **Don't over-cover.** Turn/mark enforcement is an RLS/RPC boundary already covered by `tests/integration/marks.test.ts` (cookbook §6.4). The e2e proves _composition through the browser_, not the boundary — drive marks/submit via the UI, not the API.

## Historical Context (from prior changes)

- `context/changes/test-plan-refresh-2026-06-20/research.md` — the grounding this pass verifies and extends; its 4 Open Questions are now closed here (§A minimal path, §D reload, §E token/cookie). Its route/component map is confirmed with two corrections: challenger accept is on the **list page** (not canvas), and several controls lack accessible names.
- `context/changes/testing-persistence-floor/research.md` (archived `2026-06-05-testing-persistence-floor/`) — Phase 1 floor; established the Vitest unit+integration split, `describeIntegration` self-skip, and the two-user provisioning reused here.
- `context/foundation/lessons.md` — priors that bound what the e2e need NOT re-test: SETOF not-found 404 (also guards `submit_turn`), 42P17 RLS-recursion helpers, **turn-as-RLS-predicate**, invalidation-as-flag, repository-only Supabase access, and **never `window.location.reload()`** (the app drives updates via store; the _test_ may still use Playwright `page.reload()` — that's a browser navigation, not the banned in-app call).

## Related Research

- `context/changes/test-plan-refresh-2026-06-20/research.md` — primary predecessor.
- `context/foundation/test-plan.md` §2 Risk #7 + Risk Response row #7, §3 Phase 5, §6.5 (cookbook TBD this change fills).

## Open Questions

1. **Node text input locators:** title/body textareas have no accessible name. Decide in `/10x-plan`: add a `data-testid` (small prod-code change, robust) vs scope `.locator('textarea').first()` within the node card (no prod change, more brittle). Recommend testid.
2. **Exact local cookie name:** `sb-127-auth-token` is host-derived; confirm at runtime on first navigation (and that all chunks are captured) when the spec is written.
3. **Firefox in the suite:** config runs chromium + firefox. For the first spec, consider gating to chromium only (faster, fewer flakes) and adding firefox once green — a `/10x-plan` decision.
4. **Where the challenger reads/marks:** confirm during spec-writing that after accepting on `/debates`, the challenger navigates to `/debates/{id}` to mark (the canvas is the marking surface); the accept happens on the list, the marking on the canvas.
5. **Global-setup vs per-test provisioning:** decide whether to provision the two users + save two `storageState` files in a Playwright `globalSetup` (fast, shared) or per-test (isolated). Given random-per-run users and short token life, a global-setup that regenerates each run is the likely fit.
