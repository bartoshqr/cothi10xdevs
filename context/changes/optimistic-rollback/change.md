---
change_id: optimistic-rollback
title: Add rollback/reconciliation to all optimistic store mutations
status: implemented
created: 2026-06-06
updated: 2026-06-08
archived_at: null
---

## Notes

Add rollback/reconciliation to all optimistic store mutations in `src/components/debate/store.ts`. Today only optimistic creates roll back (`rollbackNode`, `rollbackEdge`); the five other paths only call `reportError` and leave the canvas diverged from the DB until refresh:

1. update node fields (debounced/coalesced via `patchBuffers`→`flushPatch`→`apiUpdateNode`)
2. update node position (`onNodesChange`→`schedulePatch`)
3. update edge kind (`updateRelationKind`→`apiUpdateRelation`)
4. delete node (`deleteNodes`→`apiDeleteNode`)
5. delete edge (`deleteEdge`→`apiDeleteRelation`)

**Chosen strategy (decided with user):** re-fetch authoritative state from the server on any mutation failure — `reportError` + re-hydrate the affected node(s)/edge(s) or the whole graph via `setGraph` — so the canvas always reconciles to persisted state. This sidesteps the snapshot/coalescing bookkeeping that a per-path client snapshot would require (the debounced node-update path makes naive snapshot/restore prone to clobbering newer edits).

**Concrete trigger:** deleting the root node is FK-blocked server-side (`debates_root_node_id_fkey` is `ON DELETE NO ACTION`, returns an error → 500) but `deleteNodes` optimistically removes it with no rollback, so the node vanishes then reappears on refresh. See research findings **3a** + **3d** in `context/changes/testing-persistence-floor/research.md`.

**Flag for planning:** related findings **3b** (root can be demoted off `claim` via PATCH) and **3c** ("Set as Root" not persisted — no debate-PATCH endpoint to move `root_node_id`) are root-identity gaps. They may belong in this change or a separate one — decide during planning.

Distinct from the `testing-persistence-floor` test phase but informed by its research; primarily Risk #2 (store↔canvas↔persistence fidelity) territory. `store.ts` is the repo's highest-churn file (~94 commits/30d) — warrants a reviewed plan before editing.
