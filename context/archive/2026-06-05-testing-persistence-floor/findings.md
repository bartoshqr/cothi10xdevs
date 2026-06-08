# Finding: Former-root source Handle unresponsive after re-designation

## Symptom

After setting a different node as root, the previously-root node gains a visible source handle (the dot at the top) but dragging from it does nothing — no connection line, no kind picker.

## Root Cause

React Flow keeps per-node `internals.handleBounds` — a cached record of which handles exist and where they are. This cache is populated when a Handle component **mounts** (via `useLayoutEffect` inside the Handle).

The source Handle in `StatementNode` was conditionally mounted:

```tsx
{!data.isRoot && !data.pending && (
  <Handle type="source" position={Position.Top} ... />
)}
```

When a node is the root (`isRoot: true`), the Handle is **never in the DOM**, so React Flow records `handleBounds.source = []` for that node. When re-designation flips `isRoot` to `false`, the Handle mounts for the first time on a node that already has an established (stale) `handleBounds` entry. The registration via `useEffect` does not reliably update the stale entry on an existing node, so React Flow still believes the node has no source handle — the drag never starts.

## Why `data.pending` does not trigger the same bug

When a pending node is confirmed, `reconcileNode` swaps the node's `id` (temp UUID → real server UUID). React Flow sees a **new node id** and creates a fresh `internals` record, including a clean `handleBounds`. The Handle mounts into a clean slate — no stale entry to fight.

For root re-designation the node's `id` never changes, so React Flow reuses the same stale `internals`.

## Fix

Keep the Handle **always mounted** when `!data.pending`. Control visibility and interactivity via CSS and the `connectable` prop instead of conditional rendering:

```tsx
{!data.pending && (
  <Handle
    type="source"
    position={Position.Top}
    connectable={!data.isRoot}
    style={{
      /* ... existing styles ... */
      opacity: data.isRoot ? 0 : 1,
      pointerEvents: data.isRoot ? "none" : "auto",
    }}
  />
)}
```

No mount/unmount on `isRoot` change → React Flow always has the handle registered → connection drag works immediately after re-designation.

## Affected file

`src/components/debate/nodes/StatementNode.tsx` — line 238 (the source Handle condition).
