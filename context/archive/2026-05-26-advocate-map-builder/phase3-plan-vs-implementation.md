---
date: 2026-05-30
researcher: bartoshqr
git_commit: b9e0561
branch: develop
repository: cothi10xdevs
topic: "Phase 3 (Editor Island) — differences between plan.md and the implemented end state"
tags: [research, advocate-map-builder, phase-3, plan-drift, react-flow, zustand]
status: complete
scope: "Commits b849e09..HEAD (28 refinement commits on top of the initial Phase 3 build)"
---

# Phase 3 — Plan vs Implementation Differences

**Plan section compared:** `plan.md:339-465` (Phase 3: Editor Island — Store, Canvas, Nodes, Detail Panel)
**Implementation end state:** `HEAD = 15494b3` (after 27 refinement commits on `b849e09`, the initial Phase 3 build)
**Companion doc:** `phase3-commit-reasons.md` (per-commit reasons + categories)

> Update note: this revision incorporates four later commits — `f90c269` (renamed the editing-state
> store fields to the `inEdit*` convention; symbol names below reflect the post-rename state),
> `e96dfc4` (source-URL **format** validation, deepening D11), `15494b3` (connective connection
> model rework — reverses the auto-`link` path and adds kind-based target-handle routing, reshaping D5
> and touching D3/D7), and `b9e0561` (removes the `edgeKind !== "link"` guard in `EdgeContextMenu`,
> making Edit available for all edge kinds — a direct consequence of `15494b3`). The intervening
> `dd1c60b` only added these research docs and touches no Phase 3 code.

> Scope note: the base commit `b849e09` already shipped the full Phase 3 file set and the Phase 2
> API/`repository.ts`. These differences therefore describe how the **post-refinement** end state
> departs from what `plan.md` Phase 3 specified — not Phase 4 work. Phase 4 artifacts
> (`src/pages/debates/`, `persistence.ts`, spike retirement) are correctly absent and out of scope here.

## Net file-level delta vs the plan's Phase 3 file list

| Plan said (plan.md:359-392) | Reality at HEAD | Status |
| --- | --- | --- |
| `DetailPanel.tsx` (central editing surface) | **Deleted** (`6b98b44`) | ✗ removed |
| `NodeContextMenu.tsx` | Present + carries the connective op-toggle | ✓ + extra role |
| `EdgeContextMenu.tsx` | Present | ✓ |
| `ConnectKindPicker.tsx` | Present, but re-scoped (see D5/D6) | ✓ changed |
| `AddNodeMenu.tsx` | Present, opens node straight into edit mode | ✓ + extra |
| — (not in plan) | `src/lib/debate/nodeConstraints.ts` **new** (`ce1de39`) | ＋ added |
| `mapVisualLanguage.ts`, nodes/, edges/, `MapLegend.tsx`, `store.ts`, `MapEditor.tsx` | Present, heavily modified | ✓ changed |

---

## D1 — The DetailPanel was replaced by in-node inline editing (the headline divergence)

- **Plan:** A single `DetailPanel` is a core Phase 3 deliverable — "single-panel detail view", with a
  role-badge selector in the panel header, editable title/body/url, a "Set as Root Claim" button
  "between the header and title field", and an AND/OR toggle for connectives (`plan.md:389-393`,
  `plan.md:422-432`). Success criterion 3.9 reads "Detail panel opens on select" (`plan.md:871`).
- **Implementation:** `DetailPanel.tsx` is **deleted** (commit `6b98b44`). All editing happens *inside
  the node*:
  - Edit mode renders inline `<textarea>`/`<input>` for title, body and (source) url —
    `StatementNode.tsx:247-420`.
  - The role selector is a badge dropdown portalled off the node's badge —
    `StatementNode.tsx:145-219`.
  - "Set as Root Claim" lives at the bottom of that badge dropdown —
    `StatementNode.tsx:203-214`.
  - The connective AND/OR toggle moved into `NodeContextMenu` ("Switch to OR/AND") —
    `NodeContextMenu.tsx:55-74`.
- **Sanctioned by:** `node-inline-edit.md` (a deliberate sub-plan, not an accident).

## D2 — Editing trigger model: double-click / right-click→Edit, not click-to-select

- **Plan:** "Click a node → detail panel opens" (`plan.md:455`); store holds `selectedNodeId` /
  `selectedEdgeId` (`plan.md:378`) with `selectNode(id)` / `selectEdge(id)` actions (`plan.md:384`).
- **Implementation:** there is **no selection concept**. Editing is entered by **double-clicking** the
  node (`StatementNode.tsx:86-89`) or **right-click → Edit** (`NodeContextMenu.tsx:78-82`). A single
  click *exits* edit mode rather than opening it (`MapEditor.tsx:144-151`). The store carries
  `inEditNodeId` / `inEditEdgeId` (`store.ts:31-32`) instead of `selectedNodeId`/`selectedEdgeId`,
  and `selectNode`/`selectEdge` do not exist. (The fields were named `editingNodeId`/`editingEdgeId`
  until commit `f90c269` renamed every `editing*` symbol to the `inEdit*` convention.)

## D3 — Store action surface diverged substantially from the plan contract

Plan store contract: `plan.md:378-385`. Implementation: `store.ts:27-53`.

- **Renamed concepts (two layers):** first vs the plan — `selectedNodeId`/`selectedEdgeId` →
  `inEditNodeId`/`inEditEdgeId` (`store.ts:31-32`), and `selectNode`/`selectEdge` →
  `setInEditNode`/`setInEditEdgeId` (`store.ts:50-51`). Note these store symbols themselves were renamed
  again in `f90c269` (`editing*`→`inEdit*`); the names here are the current post-rename ones.
- **`onConnect` split into a staged workflow:** the plan's single `onConnect`-on-`addEdge`
  (`plan.md:380`) became `stagePendingConnection` + `commitConnection` + `cancelConnection` +
  `addPendingPreview`. A short-lived `addEdgeDirect` (auto-`link` bypass) also existed here but was
  **deleted in `15494b3`** once the picker handled connectives.
- **New actions not in the plan:** `setRootNode`, `isInEditBlocked`, `tryExitNodeEdit`, `deleteEdge`,
  plus the staged-connection set above and `getTargetNode` (`15494b3`) — a selector that resolves the
  target node of the in-flight connection (edited edge's target, or the pending connection's target)
  so the picker can branch on node type without prop-drilling.
- **Kept as planned:** `onNodesChange`, `onEdgesChange`, `setGraph`, `createStatementNode`,
  `createConnectiveNode`, `updateNodeFields`, `deleteNodes`, `updateRelationKind` (`store.ts:33-46`).

## D4 — Connection became a staged interaction with a live "pending" preview

- **Plan:** "ConnectKindPicker opens on `onConnect`, offers the valid kinds … before committing the
  edge with `data.kind`" — a single straightforward step (`plan.md:418`).
- **Implementation:** a transient `"pending"` relation kind was added to the type union
  (`mapVisualLanguage.ts:7`), a preview edge with id `"__pending__"` is rendered while the picker is
  open (`store.ts:118-128`, `commitConnection` then strips it `store.ts:142`), and a custom
  `FloatingConnectionLine` tracks the cursor during the drag (`MapEditor.tsx:38-60`). This preview
  machinery is extra scope beyond the plan. (Commits `20f1431`, `2828c39`.)

## D5 — Connection-kind validation: procedural inference replaced declarative `isValidConnection`

- **Plan:** `isValidConnection` blocks self-loops *and* invalid pairings — "`link` must target a
  connective" (`plan.md:130`); the picker filters kinds per-pair ("`link` only into a connective,
  `rephrases` source→data, `rebuts` from a rebuttal, else `supports`", `plan.md:418`).
- **Implementation (end state at `15494b3`):**
  - `isValidConnection` only blocks self-loops (`MapEditor.tsx:76-78`).
  - "link into a connective" is now handled **through the picker**, not procedurally: dropping on a
    connective opens `ConnectKindPicker` like any other target, and the picker offers `link` **only when
    the target is a connective** — base `supports`/`rephrases`/`rebuts` otherwise. The branch is driven
    by the `getTargetNode` store selector (`ConnectKindPicker.tsx`: `targetIsConnective` →
    `[...BASE_KINDS, "link"]`).
  - The chosen kind then drives **target-handle routing** via the store's `targetHandleFor()` helper
    (see D7): `link`→`for-operands`, the rest→`outer`. So `link` is again an explicit, user-picked kind
    rather than an auto-derived one.
  - The role-pair auto-inference (`rephrases` source→data, `rebuts` from rebuttal) is **still not
    implemented** — parked as a future idea (`small_changes_in_the_future.md:6`, item 2).
- **Evolution (diff-confirmed) — three reversals:** started (commit `88f1927`) as a *picker filter* (a
  `targetNodeType` prop dropped `link` for statement targets), refactored into the store (`c1225ae`),
  then the filter + `link` option were **deleted outright** (`554e4ad`) once auto-`link`-on-drop made
  in-picker filtering dead. Finally `15494b3` **reversed the procedural auto-`link`**: it removed
  `addEdgeDirect` + the `handleConnect` connective branch and **restored `link` to the picker** (shown
  only for connective targets), because differentiating *which* connective handle the edge attaches to
  requires the explicit kind choice. So the design landed close to the plan's "picker offers the valid
  kinds" after a full round-trip through procedural handling.

## D6 — Edge-kind editing: right-click→Edit and re-drag, not label-click

- **Plan:** change an edge's kind by right-click edge → Edit → picker, **or** by clicking the edge
  label/badge (`plan.md:409-411, 419-421`).
- **Implementation:**
  - Right-click → Edit opens the picker (`EdgeContextMenu.tsx:48-56` → `MapEditor.tsx:320-323`).
  - Edge **label click is not a trigger**; instead, **re-dragging the same source→target pair** opens
    the picker on the existing edge (`MapEditor.tsx:179-184`; commit `27fc794`).
  - ~~`link` edges have **no Edit option** at all.~~ **Reversed by `b9e0561`:** after `15494b3`
    made `link` an explicit picker choice (not auto-derived), the `edgeKind !== "link"` guard hiding
    Edit for link edges was removed — Edit is now available uniformly for all edge kinds.

## D7 — Handle geometry: top-center + always-visible source, root has no source handle

- **Plan:** source handles at the **top-right corner, visible on hover**; target handles invisible
  (`plan.md:413-416`, criterion 3.7). The plan itself flagged this as "provisional" (`plan.md:462`).
- **Implementation:** the source handle is at **`Position.Top` (top-center), always visible**, accent
  coloured (`StatementNode.tsx:223-235`; `ConnectiveNode.tsx:20-31`). The **root claim has no source
  handle** at all (`StatementNode.tsx:223` — `!data.isRoot`), a rule not in the plan. The statement
  target handle covers the whole node body, is invisible, and only accepts pointer events mid-drag
  (`StatementNode.tsx:423-437`).
- **Connective dual target handles (`15494b3`, not in the plan):** a connective node now exposes **two**
  invisible target handles — `for-operands` (full-body catch-all, for `link` edges) and `outer` (a
  bottom-edge point, for supports/rephrases/rebuts). Both ids come from shared constants
  (`CONNECTIVE_OPERAND_HANDLE` / `CONNECTIVE_OUTER_HANDLE` in `mapVisualLanguage.ts`), and the store's
  pure `targetHandleFor(targetNode, kind)` helper picks which one each edge attaches to — applied in
  both `commitConnection` and `updateRelationKind`. Statement targets return `undefined` (single
  unnamed handle, React Flow default). This is what motivated reversing the auto-`link` flow in D5: the
  edge's target handle depends on the user's kind choice, which only the picker provides.

## D8 — New nodes open straight into edit mode; claim-without-badge is half-built

- **Plan:** AddNodeMenu creates a node "with correct accent + badge" (`plan.md:407-408`).
- **Implementation:** after creating a statement node, the menu immediately enters edit mode on it
  (`AddNodeMenu.tsx:30-35`). Separately, AddNodeMenu has a code path to render `claim` as a plain
  text label instead of a badge (`AddNodeMenu.tsx:92-95`), but it is currently **dead** because
  `roleDescriptors.claim.badge` is `"CLAIM"` not `null` (`mapVisualLanguage.ts:29`); "claim without a
  badge" is still a future idea (`small_changes_in_the_future.md`, item 3).

## D9 — Viewport-aware menu flipping (not in the plan)

All four floating menus flip upward when they would overflow the viewport bottom, via a shared
`MENU_VIEWPORT_MARGIN` constant: `AddNodeMenu.tsx:19-23`, `NodeContextMenu.tsx:17-21`,
`EdgeContextMenu.tsx:17-21`, `ConnectKindPicker.tsx:21-25`; constant at `mapVisualLanguage.ts:1`.
Not mentioned anywhere in the plan. (Commits `1034dc6`, `a95843a`.)

## D10 — Constraints extracted to a shared module + "warn" thresholds added

- **Plan:** char limits enforced at Zod + DB, with a UI counter (`plan.md:161, 428`); schemas live in
  `src/lib/debate/schemas.ts`.
- **Implementation:** `NODE_CONSTRAINTS` (title/body `max` **and** new `warnAt` thresholds 50/220) was
  extracted to a new `src/lib/debate/nodeConstraints.ts:3-6` and reused by both `schemas.ts:13-14,22-23,38-39`
  and `StatementNode.tsx:289,328,333,390,407,412`. The `warnAt` counter-goes-red behaviour
  (`StatementNode.tsx:327-331`) is new UX beyond the plan's plain counter. (Commit `ce1de39`.)

## D11 — Client-side "can't leave an invalid node" lock + source url made REQUIRED and FORMAT-VALIDATED

- **Plan:** title `min(1)` and url validation at the Zod boundary only; the plan explicitly says **"No
  source URL validation … `url` is free text"** (`plan.md:99`), and Phase 2's `updateNodeSchema.url`
  is `.optional()` (`schemas.ts:39`).
- **Implementation:** `isInEditBlocked()` prevents exiting edit mode, opening any menu, or starting a
  connection while the editing node has an empty title — or is a **source whose url is empty _or
  malformed_** (`store.ts:240-248, 264-272`; gates at `MapEditor.tsx:173, 215, 225, 235`). The UI now
  treats url as **required for source nodes** ("URL is required for source nodes") and, when present but
  not a valid http/https URL, shows "Must be a valid URL (e.g. https://example.com)" with a destructive
  border (`StatementNode.tsx:347, 363-365`). This **contradicts** the plan's free-text/optional-url
  decision.
- **Shared `isValidUrl` helper:** format checking is centralised in `nodeConstraints.ts:16-23` (uses the
  Web API `URL` constructor, accepts only `http:`/`https:`) and consumed by both the store
  (`store.ts:270`) and the node UI (`StatementNode.tsx:133, 347, 363`). Even the Enter-to-advance
  shortcut on the url field now requires a valid URL (`StatementNode.tsx:133`).
- **Plus an API-layer reversal (diff-confirmed):** the node schema `url` was tightened from
  `z.string().optional()` to **`z.url().optional()`** (`schemas.ts:24,40`; changed in commit `ce1de39`),
  so the API now rejects non-URL strings — directly against `plan.md:99` "no source URL validation."
- **Evolution (three escalating steps):** `1eed3ef` added URL-required messaging, `e06e887` added the
  `isInEditBlocked` lock, and `e96dfc4` escalated *presence* into *format* validation via the shared
  `isValidUrl` — none named in a way that signals a plan reversal. The store guard in `setInEditNode`
  was also simplified in `e96dfc4` to delegate to `isInEditBlocked()` rather than re-check the fields
  inline (`store.ts:240-248`).

## D12 — Full keyboard model in edit mode + Escape-to-revert (not in the plan)

- Enter advances between fields, Ctrl/Cmd+Enter commits, Escape reverts to a snapshot taken on entry
  (`StatementNode.tsx:96-143`); the revert snapshot is `originalDataRef` (`StatementNode.tsx:53, 65,
  96-103`). React Flow's `deleteKeyCode` is suppressed while editing (`MapEditor.tsx:272`). Only the
  delete-key suppression was anticipated (in `node-inline-edit.md`, not `plan.md`); the rest is
  emergent. (Commit `fc51f72`.)

## D13 — Local-state mirror inside the node to stop caret jumping

`StatementNode` keeps `localTitle`/`localBody`/`localUrl` mirrored from the store and writes through
on change ("Local state keeps cursor stable — store is write-through only.",
`StatementNode.tsx:42-45`). The plan assumed inputs would call `updateNodeData`/`updateNodeFields`
directly (`plan.md:131-132`); the naive version caused caret jumping, forcing this pattern. (Commits
`ce84abe`, `30f3fd3`.)

## D14 — Active-target highlight while dragging a connection (not in the plan)

The hovered target node shows a primary-coloured border + ring during a drag, via `useConnection()`
(`StatementNode.tsx:24-25, 239-240`; `ConnectiveNode.tsx:14-15, 38-39`). Matches a "future" item that
was pulled forward (`small_changes_in_the_future.md:3`, "DONE"). (Commit `ad4e90f`.)

## D15 — RelationEdge was extended, not reused "verbatim"

- **Plan:** keep the spike's `RelationEdge` and `floatingEdgeUtils` "verbatim / as-is"
  (`plan.md:135-138, 365-366`).
- **Implementation:** `RelationEdge` gained a diamond `SquareMarker` terminator for `link` edges in
  place of the arrow (`RelationEdge.tsx:20-33, 97-99`), horizontal routing for `rebuts`
  (`RelationEdge.tsx:55-62`), a pending-preview path (`RelationEdge.tsx:46-54`), and `curvature: 1` for
  `link` (`RelationEdge.tsx:82-84`); `floatingEdgeUtils` gained `getHorizontalFloatingTargetParams`
  and pending support (`+55` lines, commit `2828c39`). "Verbatim reuse" became "extended".

## D16 — `RelationKind` type carries a UI-only `"pending"` member

`mapVisualLanguage.ts:7` defines `RelationKind = "supports" | "link" | "rephrases" | "rebuts" |
"pending"` and `relationDescriptors.pending` (`mapVisualLanguage.ts:72-75`). The DB `relation_kind`
enum has only the 4 real kinds; `"pending"` is a client-only transient that must never be persisted —
a small type-purity divergence to keep in mind when Phase 4 wires persistence.

---

## Verification-status note (not a code divergence, but a plan-tracking gap)

Phase 3's **manual** success criteria 3.4–3.10 are still unchecked in the plan
(`plan.md:866-872`), even though the features exist. The automated criteria 3.1–3.3 are checked
(`plan.md:860-862`). The implementation is functionally ahead of what the checklist records.

## Summary table

| # | Divergence | Plan ref | Impl ref | Type |
| --- | --- | --- | --- | --- |
| D1 | DetailPanel → inline node editing | plan.md:389-432 | StatementNode.tsx:247-420 | Design pivot (sanctioned) |
| D2 | Double-click/right-click edit, no select | plan.md:455,378 | MapEditor.tsx:144-151 | Interaction redesign |
| D3 | Store action surface diverged (`editing*`→`inEdit*` `f90c269`; `addEdgeDirect` removed + `getTargetNode` added `15494b3`) | plan.md:378-385 | store.ts:27-57 | Contract change |
| D4 | Staged connection + pending preview | plan.md:418 | store.ts:118-146 | Scope addition |
| D5 | Conn-kind: auto-`link` reverted to picker, `link` shown for connectives (`15494b3`) | plan.md:130,418 | MapEditor.tsx, ConnectKindPicker.tsx | Behaviour change (round-trip) + partial defer |
| D6 | Edge edit via re-drag, no label click; Edit now available for all edge kinds (`b9e0561`) | plan.md:409-421 | MapEditor.tsx:179-184, EdgeContextMenu.tsx:48 | Trigger change + restriction removed |
| D7 | Top-center handle; no root handle; connective **dual** target handles + kind-based routing (`15494b3`) | plan.md:413-416 | StatementNode.tsx, ConnectiveNode.tsx, store.ts | Provisional refinement + addition |
| D8 | New node opens in edit mode; plain-claim half-built | plan.md:407-408 | AddNodeMenu.tsx:30-35 | Addition + dead path |
| D9 | Viewport menu flipping | (none) | *ContextMenu/Picker | Pure addition |
| D10 | nodeConstraints extracted + warnAt | plan.md:161,428 | nodeConstraints.ts | Refactor + UX add |
| D11 | Edit lock + source url REQUIRED & format-validated (`e96dfc4`) | plan.md:99 | store.ts:240-272, nodeConstraints.ts:16-23 | **Reverses a plan decision** |
| D12 | Keyboard nav + Escape revert | (none) | StatementNode.tsx:96-143 | Pure addition |
| D13 | Local-state caret-stability mirror | plan.md:131-132 | StatementNode.tsx:42-45 | Impl detail (bug-driven) |
| D14 | Active-target highlight | (none) | StatementNode.tsx:239-240 | Pure addition |
| D15 | RelationEdge extended, not verbatim | plan.md:135-138,365 | RelationEdge.tsx:20-99 | Reuse-plan broke |
| D16 | UI-only `pending` relation kind | plan.md:188 | mapVisualLanguage.ts:7 | Type-purity drift |
