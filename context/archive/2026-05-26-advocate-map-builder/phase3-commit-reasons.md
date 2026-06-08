---
date: 2026-05-30
researcher: bartoshqr
git_commit: b9e0561
branch: develop
repository: cothi10xdevs
topic: "Phase 3 refinement commits — reasons (verified against full diffs), dual-lens categorization"
tags: [research, advocate-map-builder, phase-3, commits, plan-drift]
status: complete
scope: "28 commits in b849e09..HEAD (refinement on top of the initial Phase 3 build)"
evidence: "Reasons below are derived from reading each commit's full diff (git show), not just subject + diffstat."
---

# Phase 3 — Commit Reasons & Categories (diff-verified)

**Range:** `b849e09..HEAD` — the 28 commits after the initial Phase 3 build (`b849e09` itself is the
build: "feat(s-01): Phase 3 editor island — store, canvas, nodes, detail panel").
**HEAD = `b9e0561`.** Commits #25–27 (`f90c269`, `e96dfc4`, `15494b3`) were added after the first
revision of this doc; `dd1c60b` ("add advocate map builder context") sits between #24 and #25 but only
added these research docs — no Phase 3 code — so it is out of scope here, like the base build itself.
Commit #28 (`b9e0561`) is a direct follow-up to #27.
**Companion doc:** `phase3-plan-vs-implementation.md` (the `Dn` references point at its sections).

> **Evidence basis:** every row was checked against the commit's actual hunks. The commits carry no
> message bodies (subject-only WIP), but the diffs make intent unambiguous. Where the diff contradicted
> the subject line, the diff wins — see "Corrections the diff review forced" at the bottom.

**Two lenses per commit:**
- **Refinement-type** — *what the work was*: `pivot`, `feature`, `bugfix`, `refactor`, `cosmetic`.
- **Plan-gap** — *why the plan didn't anticipate it*: `underspec` (plan too thin on interaction),
  `discoverable` (only findable by using it), `react-flow` (library/React state surfaced it),
  `ai-cleanup` (comprehending/cleaning prior agent output).

---

## Per-commit table (chronological — oldest first)

| # | Commit | Subject | Refinement-type | Plan-gap | What the diff actually shows | Maps to |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `84d826f` | add root claim, debug, add edit node context menus | feature + debug | underspec | **New** `NodeContextMenu.tsx` + `EdgeContextMenu.tsx`; `DetailPanel` *enhanced* (Set-as-Root button, positioned `Wrapper`); auto-create root claim on empty canvas; `setRootNode`/`deleteEdge` added; **added `console.log` debug lines** (the "debug" in the subject). Panel still alive & `selectNode`-based. | D2, D7 |
| 2 | `2828c39` | floating lines | feature | react-flow | `FloatingConnectionLine`, `addPendingPreview`, `getRectIntersection`, full-node-cover invisible target handle (`pointerEvents: inProgress`). **Removed the debug `console.log`s** from `onConnect`. | D4, D7, D15 |
| 3 | `1034dc6` | flip menus while near the bottom | feature | discoverable | `MENU_VIEWPORT_MARGIN` + `useLayoutEffect` flip-up logic added to all 3 menus + picker. | D9 |
| 4 | `88f1927` | connection kind based on the target node | feature | underspec | **Split `onConnect` → `stagePendingConnection` + `addEdgeDirect`**; `handleConnect` auto-creates `link` when target is connective; picker gains `targetNodeType` prop + `availableKinds` filter; EdgeContextMenu hides Edit for `link`. | D5, D3 |
| 5 | `6b98b44` | editable nodes | **pivot** | underspec | **Deletes `DetailPanel.tsx` (300 lines)**; inline edit mode inside `StatementNode` (portal badge dropdown, double-click, title/body/url inputs writing straight to store); `editingNodeId`/`setEditingNode` added; NodeContextMenu Edit→edit mode, connective→Switch-op; `deleteKeyCode` suppressed while editing. | D1, D2, D3 |
| 6 | `30f3fd3` | fix writing expand | bugfix | discoverable | Title `<input>`→auto-growing `<textarea>` (`resizeEl`), `break-words`. | D13 |
| 7 | `1eed3ef` | nodes cleaning | **feature + bugfix** (not cleanup) | discoverable | **Misnamed.** Opens new node in edit mode; **flips `claim` badge `null`→`"CLAIM"`** (this is what makes the "plain claim" path dead code); adds edit-mode `×` delete button; **introduces the "URL is required for source" rule** + destructive border; first `tryExitEditing` source-url guard; "controversial" Set-as-Root comment. | D8, D11 |
| 8 | `e06e887` | next steps | **feature** (not notes) | underspec | **Misnamed.** Introduces `isEditingBlocked()` and wires the **edit-lock** into every handler; title-required guard; `setEditingNode` store guard; role-switch-away-from-source clears `url`; `setRootNode` clears `url`; focus-title effect. | D11 |
| 9 | `ce84abe` | fix cursor jumping | bugfix | react-flow | Adds `localTitle`/`localBody`/`localUrl` write-through mirror so store re-renders don't move the caret; `dataRef`/`prevRoleRef`. | D13 |
| 10 | `ce1de39` | abstract title body validation | refactor + small behaviour | ai-cleanup | Extracts `nodeConstraints.ts` (`NODE_CONSTRAINTS` + `statementNodeSchema`), shares with `schemas.ts` and node UI. **Also tightens API schema `url: z.string()→z.url()`** (a real validation change). | D10, D11 |
| 11 | `1cde4e5` | name tweaks | cosmetic | ai-cleanup | Rename local `pending`→`pendingConnection`; add a comment. Trivial. | D3 |
| 12 | `85accfb` | cleaning mapEditor | refactor | ai-cleanup | Moves `isEditingBlocked`/`tryExitEditing` **from component into the store**; reorders handlers; groups menu vs click logic. | D3 |
| 13 | `1f2e811` | cleaning | refactor | ai-cleanup | Moves `editingEdgeId` from component `useState` **into the store**; renames `tryExitEditing`→`tryExitNodeEditing`; adds `closeConnectionPicker` helper. | D3 |
| 14 | `d4a9df2` | code cleaning | refactor | ai-cleanup | Collapses 3 click handlers into one `cleanupFlow`; **deletes `selectNode`/`selectEdge`/`selectedNodeId`/`selectedEdgeId` entirely** (dead after the pivot). | D2, D3 |
| 15 | `c1225ae` | move picked target to store | refactor | ai-cleanup | Moves `pickerTargetNodeType` computation into a store selector `getPickerTargetNodeType()`. | D5 |
| 16 | `43ca774` | fix handling link relations without reason | bugfix | react-flow | One-line guard `if (!useStore.getState().pendingConnection) return` in `handleConnectEnd` — reads **current** store, not the stale closure, so the picker doesn't pop for an auto-`link` that set no pending connection. | D5 |
| 17 | `20f1431` | add pending relation | feature | discoverable | Adds a real `"pending"` member to `RelationKind` + neutral descriptor; preview edge stops borrowing `"supports"` styling. | D4, D16 |
| 18 | `554e4ad` | simplify | refactor | ai-cleanup | Removes `link` from picker `KINDS` and deletes `getPickerTargetNodeType`/`availableKinds` — dead once auto-`link` (16/4) handled connectives. | D5 |
| 19 | `4d0ee87` | add a comment | cosmetic | ai-cleanup | Single `// TOTHINK:` comment in `ConnectKindPicker`. | D5 |
| 20 | `a95843a` | edge kind picker never at the top | bugfix + refactor | discoverable | **Removes the `Panel` fallback entirely** (position now required), flattening the `inner`/`Panel` branch so the picker always renders as a positioned overlay; `showKindPicker` also requires `kindPickerPosition`. | D9 |
| 21 | `7908562` | small tweaks | bugfix + cosmetic (not pure cosmetic) | discoverable | **Real fix:** new `handleNodeClick` that does *not* exit editing when you click the node you're editing (`if (node.id !== editingNodeId)`); plus role-order swap and badge-dropdown simplification; min-width 280→140. | D2 |
| 22 | `fc51f72` | events on keydown | feature | underspec | Full keyboard model — Enter advances field, Ctrl/Cmd+Enter commits, Escape reverts to `originalDataRef` snapshot; `bodyRef`/`urlRef`. | D12 |
| 23 | `ad4e90f` | border while catching target node | feature | discoverable | `isActiveTarget = inProgress && toNode?.id === id` → primary border + ring on hovered target (both node types). | D14 |
| 24 | `27fc794` | edit edge while creating the same | feature | underspec | `handleConnect` detects an existing source→target edge and opens the picker on it (re-drag to edit); tracks `liveScreenCursor`. | D6 |
| 25 | `f90c269` | rename editing state fields to inEdit convention | refactor | ai-cleanup | **Pure rename sweep, zero behaviour change** across `store.ts` + 4 components: `editingNodeId`→`inEditNodeId`, `editingEdgeId`→`inEditEdgeId`, `setEditingNode`→`setInEditNode`, `setEditingEdgeId`→`setInEditEdgeId`, `isEditingBlocked`→`isInEditBlocked`, `tryExitNodeEditing`→`tryExitNodeEdit`. Rationale (in the commit body): `inEdit` reads as a *state* descriptor, not an ongoing action. | D3 |
| 26 | `e96dfc4` | validate source node URL format in UI and store | feature + refactor | discoverable | Adds shared `isValidUrl` helper (http/https via Web API `URL` ctor) in `nodeConstraints.ts`; `isInEditBlocked` now blocks exit on **malformed** source URLs, not just empty ones; `setInEditNode` **dedups** its guard to delegate to `isInEditBlocked()`; `StatementNode` shows red border + "Must be a valid URL (e.g. https://example.com)" for present-but-invalid, and Enter-to-advance requires a valid URL. **Deepens the D11 plan reversal.** | D11 |
| 27 | `15494b3` | route connective edges to target handle by relation kind | **feature + refactor** | ai-cleanup | **Reworks the connective connection model** (cleaning a messy prior-agent execution). **Reverses the auto-`link`-on-drop bypass**: deletes `addEdgeDirect` + the `handleConnect` connective branch, so dropping on a connective now opens `ConnectKindPicker` like any other target. The picker offers `link` **only** when the target is connective, derived via new store selector `getTargetNode`. A pure `targetHandleFor()` helper routes each edge to the correct connective target handle (`link`→`for-operands`, supports/rephrases/rebuts→`outer`, statements→`undefined`), applied in **both** `commitConnection` and `updateRelationKind` so create and edit stay consistent. `ConnectiveNode` gains a second `outer` target handle; both handle ids now come from shared `CONNECTIVE_OPERAND_HANDLE`/`CONNECTIVE_OUTER_HANDLE` constants (former `in` handle renamed to `for-operands`). **Partially un-does D5's procedural inference.** | D5, D3, D7 |
| 28 | `b9e0561` | show Edit option for all edge kinds in EdgeContextMenu | bugfix | discoverable | **Direct follow-up to #27.** Removes the `edgeKind !== "link"` conditional that hid the Edit button in `EdgeContextMenu` for `link` edges, and drops the now-unused `edgeKind` store selector. The guard was added in #4 (`88f1927`) when `link` was procedurally auto-derived (drop on connective → instant link, no picker). After #27 reversed that bypass and made `link` an explicit picker choice, the guard became semantically wrong — users can legitimately want to re-edit a `link` edge they explicitly picked. | D6 |

---

## Grouped by Refinement-type (corrected)

- **Architecture pivot (1):** `6b98b44`. Enabled by `84d826f` (context menus) and finalized by
  `d4a9df2` (deleting the now-dead selection state).
- **Feature / scope additions:** `84d826f`, `2828c39`, `1034dc6`, `88f1927`, `1eed3ef`, `e06e887`,
  `20f1431`, `fc51f72`, `ad4e90f`, `27fc794`, `e96dfc4`, `15494b3` — note `1eed3ef` and `e06e887` move
  *into* this bucket after diff review (they were not cleanup); `15494b3` (connective handle routing) is
  the newest and is also a refactor — it deletes the auto-`link` bypass while reshaping the model.
- **Bugfixes (6):** `30f3fd3`, `ce84abe`, `43ca774`, `a95843a`, `7908562`, `b9e0561`. Three are React-Flow /
  React-state artifacts (autogrow, caret, stale closure); two are positioning/interaction fixes; `b9e0561`
  removes a guard that became wrong once #27 reversed the auto-link path.
- **Internal refactors (7):** `ce1de39`, `85accfb`, `1f2e811`, `d4a9df2`, `c1225ae`, `554e4ad`,
  `f90c269`. The first six are about *where state lives* (component→store) and deleting code the
  pivot/auto-link made dead; `f90c269` is a name-convention sweep (`editing*`→`inEdit*`).
- **Pure cosmetic / comments (2):** `1cde4e5`, `4d0ee87`.

## Grouped by Plan-gap (corrected)

- **`underspec` — plan too thin on the interaction model (6):** `84d826f`, `88f1927`, `6b98b44`,
  `e06e887`, `fc51f72`, `27fc794`. Every one is about *how editing/connecting works* — context menus,
  the staged connection, inline editing, the edit-lock, keyboard, re-drag-to-edit. **Largest lesson
  surface.**
- **`discoverable` — only findable by using it (8):** `1034dc6`, `30f3fd3`, `1eed3ef`, `20f1431`,
  `a95843a`, `7908562`, `ad4e90f`, `e96dfc4`, `b9e0561`. Menu clipping, textarea growth, caret, hover
  feedback, picker position, "don't exit when I click the node I'm editing," "an empty-but-present URL
  still isn't a URL" (`e96dfc4`), and — only obvious once you right-click a link edge — "link edges
  should also be editable now that the user explicitly chose the kind" (`b9e0561`).
- **`react-flow` — library / React state surfaced it (3):** `2828c39`, `ce84abe`, `43ca774`. Floating
  routing, controlled-input re-render caret, and a stale-closure read.
- **`ai-cleanup` — comprehending/cleaning prior agent output (9):** `ce1de39`, `1cde4e5`, `85accfb`,
  `1f2e811`, `d4a9df2`, `c1225ae`, `554e4ad`, `f90c269`, `15494b3`. State-location moves, dead-code
  removal, the `editing*`→`inEdit*` naming-convention sweep (`f90c269`), and the connective
  connection-model rework (`15494b3`) that undid a messy auto-`link` execution and centralised handle
  routing into one `targetHandleFor` helper.

## Corrections the diff review forced (vs the subject-only first pass)

These are the places where reading the actual hunks changed the verdict — worth keeping as a meta-lesson
about trusting commit subjects:

1. **`84d826f` is not a pivot and not "moving away from the panel."** It *enhanced* `DetailPanel` and
   *added* debug `console.log`s. The pivot is solely `6b98b44`.
2. **`1eed3ef` "nodes cleaning" is mostly feature/UX**, not cleanup: it flipped the `claim` badge to
   `"CLAIM"` (creating the dead "plain claim" path, D8) and **introduced the source-URL-required rule**
   that contradicts the plan (D11).
3. **`e06e887` "next steps" is the edit-lock feature** (`isEditingBlocked`), not TODO notes.
4. **`43ca774` is a React stale-closure bug**, not an underspec edge case — the fix literally reads
   `useStore.getState()` instead of the closure.
5. **`7908562` "small tweaks" carries a real interaction fix** (don't exit edit mode when clicking the
   node being edited), not just cosmetics.
6. **The debug `console.log`s lived for exactly one commit** — added in `84d826f`, removed in `2828c39`
   and `6b98b44`. Invisible in a diffstat; only the hunks show it.
7. **The plan's `selectNode`/`selectEdge` survived until `d4a9df2`**, three commits after the pivot —
   selection state lingered as dead code before being removed, not deleted at pivot time.

## Headline reading for the lessons step (unchanged conclusions, firmer evidence)

1. **The plan's weakest area was the interaction model, not the data/contract.** Every `underspec`
   commit edits *how the user edits/connects*; none touch schema, RLS, or API shape. Plans should spec
   interaction flows (triggers, focus, keyboard, exit conditions) as concretely as data contracts.
2. **"Cleanup" commit subjects under-report feature work.** 2 of the 4 commits that *sound* like
   cleanup actually shipped behaviour (`1eed3ef`, `e06e887`). A reviewer trusting subjects would have
   missed the URL-required regression and the edit-lock.
3. **A lot of churn was state relocation** (`85accfb`, `1f2e811`, `c1225ae`, `d4a9df2`): logic born in
   the component kept migrating into the Zustand store. Lesson: decide the store boundary up front.
4. **One plan decision was silently reversed, then reversed *harder*** (source `url` optional/free-text
   → required in UI at `1eed3ef`, `z.string()`→`z.url()` in the API at `ce1de39`, and finally
   full http/https **format** validation in UI + store at `e96dfc4` via a shared `isValidUrl`, D11).
   The plan said "no source URL validation … `url` is free text"; three separate commits walked that
   all the way to strict format enforcement. Capture such reversals back into the plan/PRD instead of
   leaving them implicit in (often misleadingly-subjected) WIP commits.
5. **The connective connection model was reversed twice.** The plan filtered kinds in the picker
   (`88f1927`); refinement replaced that with auto-`link`-on-drop, deleting the picker path for
   connectives (`554e4ad`); then `15494b3` reversed *that*, restoring the picker for connectives (now
   offering `link` explicitly) and adding kind-based target-handle routing. Net lesson: a UX flow that
   gets auto-derived "to save a click" tends to come back when a later requirement (here, choosing
   *which* connective handle) needs the explicit step after all — worth pricing that volatility into the
   plan rather than hard-committing to the shortcut.
