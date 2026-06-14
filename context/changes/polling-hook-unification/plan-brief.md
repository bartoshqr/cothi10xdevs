# Visibility-Gated Polling Hook Unification — Plan Brief

> Full plan: `context/changes/polling-hook-unification/plan.md`

## What & Why

Four React components (`AdvocateSection`, `ChallengerSection`, `InviteChallenger`, `MapEditor`) each hand-roll the same ~30-line visibility-gated polling lifecycle (interval poll, pause when the tab is hidden, refetch on focus return, `stopped`-flag guard, listener teardown). We extract it into one reusable hook and swap all four onto it. This is roadmap **T-01**, a cleanup slice with **no user-visible behaviour change** — and the prerequisite primitive for the future Supabase Realtime swap.

## Starting Point

The scaffold is duplicated verbatim; only four knobs differ per site (interval 1000ms vs 15000ms, the `check` body, whether it fetches immediately on mount, and the enable condition). The two list sections additionally poll `/api/debates` independently, and they mount as **two separate Astro islands** in `debates/index.astro` (independent React roots), so a plain shared hook can't dedupe them.

## Desired End State

One `src/hooks/useVisibilityPolling.ts` owns the lifecycle; all four call sites are one-liners onto it. The debates page renders a single `DebatesList` island that runs **one** `/api/debates` poll feeding both sections. No hand-rolled `setInterval`/`visibilitychange` block survives in the debate components. Suite green; the four polling UIs behave identically.

## Key Decisions Made

| Decision                        | Choice                                               | Why (1 sentence)                                                                                | Source |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Test the hook lifecycle         | No new tests — lean on existing suite + manual smoke | No DOM harness exists; it's a behaviour-preserving refactor                                     | Plan   |
| Late-`setState` cancellation    | AbortSignal (threaded into `fetch`)                  | Standard Web API; cancels the in-flight request, not just the `setState`                        | Plan   |
| Hook location                   | New `src/hooks/`                                     | Generic hook (not debate-specific); clear discoverable home                                     | Plan   |
| Layer 2 (dedupe `/api/debates`) | Include it                                           | Removes the duplicate 15s request                                                               | Plan   |
| Layer 2 mechanism               | Merge the two islands into one `DebatesList` parent  | Two separate islands can't share React state; merging gives one root/one poll with no new store | Plan   |
| MapEditor conversion            | Isolate as the final phase                           | Its poll is entangled with store reads + `reconcileFromServer` — quarantine the risk            | Plan   |
| Manual verification depth       | Smoke each UI                                        | Behaviour-preserving refactor; full lifecycle drills not warranted                              | Plan   |

## Scope

**In scope:** the `useVisibilityPolling` hook; converting all four call sites; merging the two debate-list islands into one `DebatesList` island (Layer 2).

**Out of scope:** new test infra (jsdom/RTL); Supabase Realtime; any change to intervals, endpoints, payload handling, optimistic delete/dismiss logic, or MapEditor's store/reconcile/turn-gate machinery; a module-level store for the list.

## Architecture / Approach

`useVisibilityPolling(check, { intervalMs, enabled, immediate })` holds `check` in a ref (so a fresh closure each render doesn't rebuild the timer), creates an `AbortController` per run, and manages the interval + `visibilitychange`/`focus` handlers. The one subtlety it must encode: `immediate` governs **only the initial mount**; the visibility/focus-return path always refetches. Layer 2 lifts the `/api/debates` poll into a `DebatesList` parent that derives advocate/challenger slices and passes them to the two sections, which keep their own optimistic delete/dismiss state.

## Phases at a Glance

| Phase                       | What it delivers                    | Key risk                                                               |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| 1. Build the hook           | `src/hooks/useVisibilityPolling.ts` | Encoding the immediate-on-mount-only asymmetry correctly               |
| 2. Convert InviteChallenger | First real consumer on the hook     | Threading the signal through the accept/decline branch                 |
| 3. Layer 2 island merge     | One `DebatesList` island, one poll  | Preserving each section's optimistic delete/dismiss state + page DOM   |
| 4. Convert MapEditor        | Turn-sync poll on the hook          | `reconcileFromServer`-before-patch ordering; store-read inside `check` |

**Prerequisites:** none beyond the four call sites existing (they do). Local dev with two test users for the Phase 2/4 smoke checks.
**Estimated effort:** ~1–2 sessions across 4 phases; Phases 1–2 are quick, Phase 3 (island merge) and Phase 4 (MapEditor) carry the real work.

## Open Risks & Assumptions

- Phase 3 reshapes two components from self-polling islands into controlled children; their optimistic `deletedIds`/`dismissedIds` filtering must survive each parent poll tick or just-removed cards reappear.
- Phase 4 must preserve the `reconcileFromServer()`-before-viewer-patch ordering and the in-`check` `getState()` reads, or live turn hand-off can show stale/duplicated state.
- No automated coverage for the hook itself — the manual smoke per UI is the only regression net; the immediate-on-return and abort-after-await paths are the things to watch.

## Success Criteria (Summary)

- All four UIs poll, pause on tab-hide, and refetch on focus return exactly as before.
- The debates page issues exactly one `/api/debates` request per ~15s (down from two).
- `npm run test` green; no hand-rolled `visibilitychange` poller remains in `src/components/debate/`.
