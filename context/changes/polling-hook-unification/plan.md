# Visibility-Gated Polling Hook Unification — Implementation Plan

## Overview

Four React components (`AdvocateSection`, `ChallengerSection`, `InviteChallenger`, `MapEditor`) each hand-roll the same ~30-line visibility-gated polling lifecycle: a `setInterval` poll, a `stopped` flag to suppress late `setState`, pause-on-tab-hidden via `visibilitychange`/`focus`, an immediate re-check on focus return, and listener teardown on unmount. This change extracts that lifecycle into one reusable hook `useVisibilityPolling` (in a new `src/hooks/` directory), swaps all four call sites onto it, and — as Layer 2 — merges the two debate-list islands into a single `DebatesList` parent that runs **one** `/api/debates` poll instead of two.

This is a **cleanup / tech-debt slice (roadmap T-01)** with **no intended user-visible behaviour change**. Success = identical runtime behaviour with the duplication removed and the existing suite green.

## Current State Analysis

The polling scaffold is duplicated verbatim across four files. The bodies differ only in four knobs:

| Site                | Interval | `check` body                                                                     | Immediate on initial mount | Enabled when                    |
| ------------------- | -------- | -------------------------------------------------------------------------------- | -------------------------- | ------------------------------- |
| `AdvocateSection`   | 15000ms  | fetch `/api/debates`, filter `role==="advocate"`, sort, `setItems`               | **no** (`start()` only)    | always (`[]`)                   |
| `ChallengerSection` | 15000ms  | fetch `/api/debates`, filter challenger + awaiting/in_progress, sort, `setItems` | **no**                     | always (`[]`)                   |
| `InviteChallenger`  | 1000ms   | fetch `/api/exchanges/:id`, branch accept/decline                                | yes                        | `status==="pending" && id`      |
| `MapEditor`         | 1000ms   | fetch `/api/exchanges/:id`, `reconcileFromServer()` + patch viewer               | yes                        | `viewer && !viewer.isCompleted` |

Key behavioural facts established during research:

- **Mount-vs-return asymmetry** (`ChallengerSection.tsx:91-111`, `AdvocateSection.tsx:79-99`): the two list sections call `start()` only on initial mount (no immediate fetch — SSR already seeded `initialItems`), but their `onVisibility` return path does `void check(); start()`. `InviteChallenger.tsx:185-188` and `MapEditor.tsx:467-470` fetch immediately on **both** initial mount and visibility return. So an `immediate` flag must govern **only the initial mount**; the visibility/focus-return path always checks.
- **`stopped` flag** (every site): each `check()` re-reads a closure `stopped` flag after `await fetch` and bails to avoid a `setState` on an unmounted component. This is the piece that changes shape — it becomes an `AbortSignal`.
- **Store-read inside `check`** (`MapEditor.tsx:410-411`): MapEditor reads `exchangeId`/`viewer` from `useStore.getState()` _inside_ `check`, not from the closure, and its `check` awaits `reconcileFromServer()` before patching `viewer`. The effect dep is `[viewer]`.
- **`/api/debates` is polled twice** (`AdvocateSection` + `ChallengerSection`), and these mount as **two separate `client:load` islands** in `src/pages/debates/index.astro:75,81` — independent React roots. A shared React hook would run once per island and would NOT dedupe; deduping requires either a module-level store or merging the two islands into one React root.
- **No DOM test harness**: `vitest.config.ts` defines only `node`-environment projects (`tests/unit/**`, `tests/integration/**`). There is no jsdom/happy-dom and no React Testing Library. The 27 existing tests are pure-function/Zustand-store unit tests + API integration tests; none of the four components has a render test. The codebase convention is "extract pure logic, test in node" (e.g. `MapEditor` exports `computeTurnGate`/`selectMapEditorState` precisely so `tests/unit/computeTurnGate.test.ts` can pin them).

### Key Discoveries

- Cross-island communication pattern already in use: module-level Zustand store + `window` CustomEvents (`MapEditor.tsx:311-320`, `InviteChallenger.tsx:26-28`). Layer 2 deliberately avoids this by merging the two list sections into one island instead.
- `InviteChallenger` already uses `useCallback` for its debounced user search (`InviteChallenger.tsx:91-103`) — the project is comfortable with the ref/callback idiom the hook needs.
- Lesson (`context/foundation/lessons.md`): "Never use `window.location.reload()`" — N/A here (no reloads introduced), but reaffirms the "drive UI via state" principle the merged island follows.
- Lesson: "Look ahead during planning — design for extension." `useVisibilityPolling` is the prerequisite primitive for the future Supabase Realtime swap (S-06 Technical Notes); once the lifecycle is one hook, replacing polling with a `postgres_changes` subscription is a single-site change.

## Desired End State

- A single `src/hooks/useVisibilityPolling.ts` owns the start/stop/pause/teardown/abort lifecycle.
- All four call sites call the hook; none contains a hand-rolled `setInterval` + `visibilitychange`/`focus` + `stopped`-flag block.
- `src/pages/debates/index.astro` renders **one** `DebatesList` island that runs a single `/api/debates` poll; `AdvocateSection`/`ChallengerSection` are child components of it.
- `npm run test` is green; the four polling UIs behave exactly as before (verified by smoke per UI).

Verification: grep for `setInterval`/`addEventListener("visibilitychange"` across `src/components/debate/` returns only the new hook (no residual copies); `npm run test` passes; manual smoke of each UI confirms live updates still work.

## What We're NOT Doing

- **No new test infrastructure** — not adding jsdom, React Testing Library, or a third vitest project. No new automated tests for the hook (decision: lean on the existing suite + manual smoke). This is a behaviour-preserving refactor.
- **No Supabase Realtime** — the hook is a prerequisite for that future swap, but this change keeps REST polling exactly as-is.
- **No change to poll intervals, endpoints, response handling, or the optimistic delete/dismiss logic** in any section.
- **No module-level store for the debate list** — Layer 2 is done by island-merge, not by a new Zustand store.
- **No changes to `MapEditor`'s store, `reconcileFromServer`, turn-gate broadcasts, or cross-island events** — only its turn-sync polling effect is reshaped onto the hook.

## Implementation Approach

Build the primitive first (Phase 1), prove it on the lowest-entanglement consumer (`InviteChallenger`, Phase 2), then take on the two structural-risk areas in isolation: the Layer-2 island merge (Phase 3) and the store-entangled `MapEditor` poll (Phase 4). Each phase is independently shippable and independently smoke-verifiable.

The hook's contract is driven entirely by the four knobs in the current-state table plus the mount-vs-return asymmetry. The `stopped` flag is upgraded to an `AbortSignal` the hook creates per run and passes into `check`; each `check` body threads the signal into its `fetch` (so the in-flight request is actually cancelled, not just its `setState` suppressed) and checks `signal.aborted` after the await.

## Critical Implementation Details

- **Mount-vs-return asymmetry is load-bearing.** The `immediate` option controls ONLY whether `check` fires on the initial enable. The hook's visibility/focus-return handler must ALWAYS call `check` immediately (then resume the interval), for every consumer, regardless of `immediate`. Getting this wrong silently changes list-refresh timing on tab return.
- **`check` must be ref-stored.** Consumers pass a fresh `check` closure each render (it closes over component state). If the effect depended on `check` directly it would tear down and rebuild the interval every render. The hook stores the latest `check` in a ref (updated in a layout/normal effect each render) and the polling effect depends only on `intervalMs` + `enabled`.
- **AbortSignal lifecycle.** One `AbortController` per "run" (an enable period). On unmount, on `enabled→false`, and on tab-hide the hook aborts the controller so any in-flight `check` cancels; a fresh controller is created when polling (re)starts. Each `check` body must tolerate an `AbortError` from `fetch` (swallow it like today's transient catch) and must re-check `signal.aborted` after `await` before calling `setState`.
- **MapEditor reads state inside `check`, not via closure.** Preserve that: its `check` continues to read `exchangeId`/`viewer` from `useStore.getState()` at call time. The hook's `enabled` for MapEditor is derived from the subscribed `viewer` (`!!viewer && !viewer.isCompleted`), matching the current `[viewer]` dep so the effect restarts when viewer identity changes.

## Phase 1: Build `useVisibilityPolling`

### Overview

Create the reusable hook. No call sites change in this phase — it is pure addition.

### Changes Required:

#### 1. New hook

**File**: `src/hooks/useVisibilityPolling.ts` (new file; new directory)

**Intent**: Encapsulate the visibility-gated polling lifecycle (interval start/stop, pause on tab-hidden, immediate check on focus/visibility return, AbortSignal-based cancellation, listener teardown) so each consumer supplies only a `check` function and the four knobs.

**Contract**: Export `useVisibilityPolling(check, options): void`.

```ts
// signal is created by the hook per run; check threads it into fetch and re-checks after await.
type PollCheck = (signal: AbortSignal) => Promise<void>;

interface UseVisibilityPollingOptions {
  intervalMs: number;
  enabled: boolean; // effect is inert while false; flipping true (re)starts polling
  immediate?: boolean; // default false — fire check once on the initial enable (NOT on visibility return, which always fires)
}
```

Behavioural contract the implementation must satisfy:

- While `enabled` is false: no interval, no listeners, no fetch.
- On enable: if `immediate`, call `check(signal)` once; then (unless the tab is hidden) start the interval. Register `visibilitychange` (on `document`) and `focus` (on `window`) handlers.
- Visibility/focus handler: if `document.hidden` → stop interval + abort the current run; else → `check(signal)` immediately + restart interval. (Immediate-on-return is unconditional, independent of `immediate`.)
- On cleanup (unmount, `enabled→false`, or deps change): clear the interval, abort the controller, remove both listeners.
- `check` is held in a ref refreshed each render so the polling effect depends only on `intervalMs` and `enabled`, never on `check`'s identity.

### Success Criteria:

#### Automated Verification:

- [ ] Existing suite still passes (no regressions from the new file): `npm run test`

#### Manual Verification:

- [ ] 1.x Hook file compiles and is internally consistent (covered by the PostToolUse type/lint hook on save; no runtime consumer yet).

  > **Agent-automatable**: Yes — type/lint is enforced by the per-edit hook; nothing to exercise at runtime until Phase 2 wires a consumer.

---

## Phase 2: Convert `InviteChallenger`

### Overview

Swap `InviteChallenger`'s pending-invite freshness poll (`InviteChallenger.tsx:126-197`) onto the hook. This is the cleanest single consumer and proves `immediate: true` + conditional `enabled` + signal-threaded fetch.

### Changes Required:

#### 1. InviteChallenger freshness poll

**File**: `src/components/debate/InviteChallenger.tsx`

**Intent**: Replace the hand-rolled `useEffect` (lines ~126-197: `stopped`/`intervalId`/`start`/`stop`/`onVisibility` block) with a `useVisibilityPolling` call. Keep the `check` body's accept/decline branching and its cross-island `wvmap:exchange-accepted` / `signalCanEdit` dispatches unchanged.

**Contract**: `useVisibilityPolling(check, { intervalMs: 1000, enabled: activeStatus === "pending" && !!activeId, immediate: true })`. The `check` signature becomes `(signal) => Promise<void>`; pass `signal` into the `fetch(`/api/exchanges/${activeId}`, { signal })` call and replace the `if (stopped || json.status === "pending")` guard's `stopped` term with `signal.aborted`. The existing `activeId`/`activeStatus` locals (lines 124-125) already isolate the deps the `enabled` expression needs.

### Success Criteria:

#### Automated Verification:

- [ ] Suite green: `npm run test`

#### Manual Verification:

- [ ] 2.x Pending-invite freshness still works (smoke).

  > **Agent-automatable**: No — requires a browser session with an authenticated advocate plus a second user accepting/declining the invite; the accept/decline transition and the canvas-unlock are visual cross-island effects.

  Smoke steps (browser, local dev): as an advocate with a draft debate, send an invite → the header shows "awaiting response"; from the challenger account accept it → within ~1s the advocate's line flips to the round counter and the canvas stays locked; repeat and **decline** → the advocate's line clears and the canvas re-enables. Background the advocate tab during "awaiting" and confirm no console errors on return.

---

## Phase 3: Layer 2 — merge the two debate-list islands

### Overview

Replace the two `client:load` islands (`AdvocateSection`, `ChallengerSection`) with a single `DebatesList` parent island that runs **one** `/api/debates` poll via `useVisibilityPolling`, derives the advocate/challenger slices, and renders the two sections as child components. This eliminates the duplicate 15s request while keeping each section's local optimistic state intact.

### Changes Required:

#### 1. New parent island + shared list hook

**File**: `src/components/debate/DebatesList.tsx` (new)

**Intent**: Own the single `/api/debates` poll and the raw debate list; pass derived slices down to the two section components. This is the only React root for the list page, so its one hook instance genuinely dedupes the poll.

**Contract**: `export default function DebatesList({ initialAdvocateItems, initialChallengerItems }: Props)`. Holds the raw `debates` array in state (seeded from a new prop or re-derived from the two initial-item props — see note), runs `useVisibilityPolling(check, { intervalMs: 15000, enabled: true, immediate: false })` where `check` fetches `/api/debates` (threading `signal`) and stores the raw `debates`. Computes the advocate slice and challenger slice from `debates` (reusing the existing `toItem`/`sortItems` logic, relocated or imported) and renders `<AdvocateSection items=… />` + `<ChallengerSection items=… />`. The `immediate: false` mirrors today's list behaviour (SSR seeds the first paint).

> **Note on initial data**: today each island receives its own SSR-computed `initialItems`. The merged island can either (a) accept both `initialAdvocateItems` + `initialChallengerItems` as today and only adopt the shared poll for subsequent refreshes, or (b) additionally receive the raw SSR `debates` to seed `debates` state. Prefer (a): least change to `index.astro`'s frontmatter — seed each child's first render from its existing initial-items prop, and let the first poll tick populate the shared `debates` state. Confirm the first 15s-delayed refresh still replaces both lists correctly.

#### 2. AdvocateSection becomes a controlled child

**File**: `src/components/debate/AdvocateSection.tsx`

**Intent**: Remove the self-contained polling `useEffect` (lines 50-108). The component receives its `items` (or the raw slice) from the parent and keeps ONLY its local optimistic state: `deletedIds`, `deleting`, `deleteError`, and `handleDelete`. Rendering and the empty-state are unchanged.

**Contract**: Props shift from `{ initialItems }` to receiving the polled items from the parent (e.g. `{ items }` plus retaining internal `deletedIds` filtering so a just-deleted debate isn't revived by the next parent poll). The optimistic `handleDelete` + `deletedIds.current.add(id)` logic stays; it now also needs the parent's next poll to respect `deletedIds` — keep the filter local to this child (filter the incoming items through `deletedIds` before render). `sortItems` stays or moves to the parent (parent already sorts the slice).

#### 3. ChallengerSection becomes a controlled child

**File**: `src/components/debate/ChallengerSection.tsx`

**Intent**: Same shape as AdvocateSection — drop the polling `useEffect` (lines 67-120), receive items from the parent, keep `dismissedIds` + `handleRemove` local so declined cards stay filtered across parent polls.

**Contract**: Props shift to receiving polled items; retain the `dismissedIds` ref and filter incoming items through it before render. `toItem`/`sortItems` move to (or are shared with) the parent, which produces the challenger slice.

#### 4. Page renders one island

**File**: `src/pages/debates/index.astro`

**Intent**: Replace the two `<AdvocateSection client:load .../>` + `<ChallengerSection client:load .../>` islands (lines 75, 81) with a single `<DebatesList client:load .../>`, passing the existing SSR-computed `advocateItems` and `challengerItems`.

**Contract**: One `client:load` directive instead of two; imports collapse to `DebatesList`. The surrounding section markup/headings (the "ONE page, two sections" layout from S-06) is preserved — move the two `<section>` wrappers either into `DebatesList` or keep them in the `.astro` around the single island, whichever preserves the current DOM. Preserve heading text and ordering exactly.

### Success Criteria:

#### Automated Verification:

- [ ] Suite green (the `tests/integration/debateList.test.ts` API contract is unchanged): `npm run test`

#### Manual Verification:

- [ ] 3.x Both list sections still live-update from one poll (smoke).

  > **Agent-automatable**: No — requires an authenticated browser session and visual confirmation that both sections render, update, and that delete/dismiss optimistic actions persist across a poll tick.

  Smoke steps (browser, local dev): open `/debates` as a user who is advocate on ≥1 debate and challenger on ≥1 invite → both sections render with correct items. Delete a `drafting` debate → it vanishes and does NOT reappear after the next 15s poll. Decline a challenger invite → card stays gone across the next poll. In DevTools Network, confirm only **one** `/api/debates` request per ~15s (not two). Background the tab, return, confirm an immediate refresh and no console errors.

---

## Phase 4: Convert `MapEditor`

### Overview

Convert `MapEditor`'s counterpart turn-sync poll (`MapEditor.tsx:404-479`) onto the hook. Isolated as the final phase because its `check` awaits `reconcileFromServer()` and patches the store viewer — the highest-entanglement conversion.

### Changes Required:

#### 1. MapEditor turn-sync poll

**File**: `src/components/debate/MapEditor.tsx`

**Intent**: Replace the hand-rolled polling `useEffect` (lines 404-479: `stopped`/`intervalId`/`start`/`stop`/`onVisibility`) with `useVisibilityPolling`. The `check` body — read `exchangeId`/`viewer` from `useStore.getState()`, fetch `/api/exchanges/:id`, compare server turn-state, `await reconcileFromServer()` then `useStore.setState` to patch viewer flags — is preserved verbatim except the `stopped` guard becomes `signal.aborted` and `fetch` takes `{ signal }`.

**Contract**: `useVisibilityPolling(check, { intervalMs: 1000, enabled: !!viewer && !viewer.isCompleted, immediate: true })`. `viewer` is the already-subscribed slice value (`MapEditor.tsx:280`), so `enabled` recomputes when viewer identity/flags change — matching the current `[viewer]` effect dep. Keep the in-`check` `getState()` reads (do not lift them to the closure). The order — `reconcileFromServer()` BEFORE the viewer `setState` patch (lines 434-444) — must be preserved (see the inline note at 430-433: a failed resync must leave viewer flags un-patched so the next tick retries).

### Success Criteria:

#### Automated Verification:

- [ ] Suite green, including the selector-contract test that pins MapEditor's store subscription: `npm run test`
- [ ] No residual hand-rolled pollers remain in the debate components: `! grep -rn 'addEventListener("visibilitychange"' src/components/debate/` returns nothing (the only `visibilitychange` listener now lives in `src/hooks/useVisibilityPolling.ts`).

#### Manual Verification:

- [ ] 4.x Live turn hand-off still syncs for the counterpart (smoke).

  > **Agent-automatable**: No — requires two authenticated browser sessions (advocate + challenger) in an active exchange and visual confirmation that the non-submitting seat's header and canvas update within ~1s of the other party submitting.

  Smoke steps (browser, local dev, two sessions in an accepted exchange): challenger submits a turn → within ~1s the advocate's header flips to "your turn", the round counter updates, and the challenger's new nodes/marks appear on the advocate's canvas (reconcile worked). Background the advocate tab during the challenger's turn, submit, then refocus → an immediate sync on return, no console errors, no duplicate/stale state.

---

## Testing Strategy

### Unit Tests

- None added (decision: no new test infra). The existing `tests/unit/` store/selector tests — notably `mapEditorSelector.store.test.ts` and `computeTurnGate.test.ts` — continue to guard MapEditor's store-subscription contract, which Phase 4 must not break.

### Integration Tests

- No new tests. `tests/integration/debateList.test.ts` and `tests/integration/exchange.test.ts` exercise the `/api/debates` and `/api/exchanges/:id` endpoints the hook polls; they must stay green (the change is client-side only, so they should be unaffected).

### Manual Testing Steps

Per phase (see each phase's Manual Verification). Cross-cutting smoke after Phase 4:

1. `/debates` page: both sections render and live-update; exactly one `/api/debates` request per ~15s.
2. Invite flow: send → accept/decline reflects within ~1s; canvas locks/unlocks.
3. Active exchange: counterpart turn hand-off syncs within ~1s.
4. For each: background the tab, return, confirm immediate refresh + clean console.

## Performance Considerations

Layer 2 removes one redundant `/api/debates` request every 15s on the list page (two polls → one). No other perf change; intervals and payloads are unchanged. AbortSignal additionally cancels in-flight requests on tab-hide/unmount, marginally reducing wasted work.

## Migration Notes

None — no schema, API, or data changes. Pure client-side refactor. Rollback is reverting the commits; no state to migrate.

## References

- Change identity: `context/changes/polling-hook-unification/change.md`
- Roadmap slice: `context/foundation/roadmap.md` → T-01 (and the "Polling cadence and Supabase Realtime (S-06)" Technical Note this unblocks)
- Duplicated scaffold: `AdvocateSection.tsx:50-108`, `ChallengerSection.tsx:67-120`, `InviteChallenger.tsx:126-197`, `MapEditor.tsx:404-479`
- Two-island mount point: `src/pages/debates/index.astro:75,81`
- Cross-island store/event pattern (deliberately NOT used for Layer 2): `MapEditor.tsx:311-355`
- Store-subscription contract guarded in test: `tests/unit/mapEditorSelector.store.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Build useVisibilityPolling

#### Automated

- [ ] 1.1 Existing suite still passes: `npm run test`

#### Manual

- [ ] 1.2 Hook file compiles and is internally consistent (type/lint hook on save; no runtime consumer yet)

### Phase 2: Convert InviteChallenger

#### Automated

- [ ] 2.1 Suite green: `npm run test`

#### Manual

- [ ] 2.2 Pending-invite freshness still works (send → accept/decline → canvas lock/unlock; tab-background returns clean)

### Phase 3: Layer 2 — merge the two debate-list islands

#### Automated

- [ ] 3.1 Suite green (debateList integration contract unchanged): `npm run test`

#### Manual

- [ ] 3.2 Both sections live-update from one poll; delete/dismiss persist across a tick; exactly one `/api/debates` request per ~15s

### Phase 4: Convert MapEditor

#### Automated

- [ ] 4.1 Suite green incl. selector-contract test: `npm run test`
- [ ] 4.2 No residual hand-rolled pollers: `! grep -rn 'addEventListener("visibilitychange"' src/components/debate/`

#### Manual

- [ ] 4.3 Live turn hand-off syncs for the counterpart within ~1s (incl. reconcile of new nodes/marks; tab-background returns clean)
