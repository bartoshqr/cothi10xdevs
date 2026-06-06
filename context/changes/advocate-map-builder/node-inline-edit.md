# Node Inline Editing — Plan

Replace `DetailPanel` with direct in-node editing for statement nodes, and a context-menu toggle for connectives.

## Interaction model

### Statement nodes
- **Double-click on node body** OR **right-click → Edit** → enter edit mode on that node.
- **Single click on any other node / pane / edge / menu** → exit edit mode (save implicitly — no discard).
- **Edit mode UI** (rendered inside the node, replacing read-only display):
  - `title` → single-line `<input>`, light border, pointer cursor suggests editability.
  - `url` (source nodes only) → single-line `<input>` below title, above an `<hr>`.
  - `body` → `<textarea>`, auto-grow if possible; light border.
  - All inputs carry `className="nodrag nopan"`.
- **Char counters** shown only in edit mode (inline, next to the field label).
- **Delete key suppression** — while any node is in edit mode, suppress React Flow's `deleteKeyCode` so typing doesn't delete the node.
- **Node resize** — React Flow v12 uses an internal `ResizeObserver` on every node; height changes from textarea growth are picked up automatically. No extra API call needed.

### Badge / role picker
- **Double-click on the badge** (works regardless of edit mode) → small inline dropdown listing all 6 roles + "Set as Root Claim" option at the bottom.
- Clicking a role calls `updateNodeFields` immediately; clicking "Set as Root Claim" calls `setRootNode`.
- Dropdown closes on any outside click.

### Connective nodes
- Remove "Edit" from the context menu; replace with the opposite op label (e.g. "Switch to OR" / "Switch to AND") that calls `updateNodeFields` directly — no panel.

## Files affected
- `src/components/debate/nodes/StatementNode.tsx` — add edit mode, inline fields, badge dropdown.
- `src/components/debate/nodes/ConnectiveNode.tsx` — no changes needed (toggle is in context menu).
- `src/components/debate/NodeContextMenu.tsx` — "Edit" triggers edit mode; connective variant shows op-switch instead.
- `src/components/debate/MapEditor.tsx` — pass `editingNodeId` state down; suppress `deleteKeyCode` while editing.
- `src/components/debate/store.ts` — no store changes needed.
- `src/components/debate/DetailPanel.tsx` — **delete**.

## Out of scope
- Persistence (Phase 4 concern).
- Validation errors / toast feedback.
- Undo/redo.
