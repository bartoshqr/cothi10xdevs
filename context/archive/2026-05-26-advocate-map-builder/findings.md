# Findings: Spike Code vs. PRD / Plan

> Scope: compare `src/components/spike/` (map-visual-spike commits) against
> `context/foundation/prd.md` and `context/changes/advocate-map-builder/plan.md`.
> The spike is treated as the reference for what is correct.
> Nothing has been changed yet — these are analysis-only notes.

---

## Finding 1 — `source` is a statement role in the spike; the PRD models it as a separate sub-entity

### Spike (`mapVisualLanguage.ts`, `StatementNode.tsx`, `exampleMap.ts`)
- `StatementRole = "claim" | "source" | "data" | "warrant" | "backing" | "rebuttal"` — 6 types
- A `source` is a **first-class canvas node** with a role badge, accent colour, and optional
  clickable `url` prop on the node data itself.
- Sources connect to other statements via `rephrases` edges on the canvas.

### PRD / Plan
- `statement_type` enum = `('claim','data','warrant','backing','rebuttal')` — 5 types; no "source".
- Sources are a **separate sub-entity** in a `sources` table (`statement_id → content`).
- FR-005: "attach a source (URL or citation) to any Statement" — managed in a detail panel,
  not a canvas node.
- The plan's DetailPanel describes sources as an add/remove form control, not draggable nodes.

### Why the spike is right
Treating a source as a canvas node makes its reliability explicitly contestable — the legend
reads "SOURCE: Assertion about a cited origin — its reliability can be contested." This is
consistent with Toulmin: a source is itself a claim that can be challenged, not merely a
footnote. A sub-entity in a sidebar cannot be marked Agree/Challenge/Abstain by the challenger;
a source node can.

---

## Finding 2 — Connective nodes (AND / OR) exist in the spike but are absent from the PRD entirely

### Spike (`ConnectiveNode.tsx`, `mapVisualLanguage.ts`, `exampleMap.ts`)
- `ConnectiveOp = "and" | "or"` — a second node type (`type: "connective"`) for logical grouping.
- AND / OR nodes are intermediate aggregators between data / warrant nodes and claims.
- The legend describes them as "All operands required" / "Any operand suffices".
- The `link` relation kind exists specifically to feed statements into these connectives.
- Both demo maps (`exampleMap.ts`, `demoData.ts`) rely heavily on them for accurate structure.

### PRD / Plan
- No mention of connective / logical nodes anywhere — not in FR-004 (statement types),
  FR-006 (relations), or the schema migration section.
- Plan specifies: "One `StatementNode` keyed by `data.type`" — implies only one node component.
- `statement_type` enum has no "connective" entry.

### Why the spike is right
Without AND / OR connectives, multi-premise arguments cannot be represented correctly.
A claim supported by the _conjunction_ of data + warrant AND an independent observation
requires a logical aggregator. Forcing every multi-premise argument into a flat list of
`supports` edges loses essential logical structure that the divergence summary depends on.

---

## Finding 3 — Relation kinds diverge: spike has 4, PRD has 3, and two names differ

### Spike (`mapVisualLanguage.ts`)
`RelationKind = "supports" | "link" | "rephrases" | "rebuts"`

| Kind | Purpose |
|------|---------|
| `supports` | Connective / claim supports a higher claim |
| `link` | Operand feeds into a connective node |
| `rephrases` | Source node restates / cites the data node it grounds |
| `rebuts` | Rebuttal node attacks a claim |

### PRD / Plan (`relation_kind` enum)
`('supports', 'bridges', 'rebuts')`

| Kind | Purpose |
|------|---------|
| `supports` | Supports a claim |
| `bridges` | Logical bridge connecting data to claim (warrant role) |
| `rebuts` | Attacks a claim |

### Mapping
| Spike | PRD | Notes |
|-------|-----|-------|
| `supports` | `supports` | ✓ exact match |
| `link` | — | spike-only; feeds connective nodes |
| `rephrases` | — | spike-only; source restates data |
| — | `bridges` | PRD-only; no equivalent in spike |
| `rebuts` | `rebuts` | ✓ exact match |

### Why the spike is right
`link` is architecturally required by connective nodes (Finding 2).
`rephrases` makes source→data relationships explicit on the canvas and contestable.
`bridges` was conceived for a world without connective nodes — the warrant node itself
plays the bridging role in the spike's model. `bridges` can be dropped.

---

## Finding 4 — Statement node data shape: spike has `url` at node level; plan uses a `sources` sub-entity array

### Spike (`StatementNodeData`)
```ts
{ role?: StatementRole; title: string; body: string; url?: string; isRoot?: boolean }
```
- `url` is a direct field on the node (used for source nodes that link to external references).
- `isRoot` is a boolean display flag on node data.

### PRD / Plan (`StatementData` in store contract)
```ts
{ type, title, body, sources }  // sources: array loaded from separate `sources` table
```
- `url` is inside a `sources` sub-entity array, not on the node itself.
- Root is tracked via `debates.root_statement_id` FK, not a data flag.

### Why the spike is right
If sources are canvas nodes (Finding 1), the `url` field belongs directly on the statement row.
A separate `sources` table is the wrong abstraction once sources are nodes — it would duplicate
the statement row for every source node. The `isRoot` flag is a derived display property;
`root_statement_id` remains the DB ground truth while `isRoot: true` in node data is just a
local hydration convenience.

---

## Finding 5 — Edge routing: spike has floating-edge utils; the plan does not mention them

### Spike (`floatingEdgeUtils.ts`, `RelationEdge.tsx`)
- `getNotTopFloatingTargetParams`: `link` edges find the nearest non-top entry point on
  a connective node.
- `getHorizontalFloatingTargetParams`: `rebuts` edges approach the target from the left or
  right side (horizontal attack).
- Standard bezier for `supports` and `rephrases`.

### PRD / Plan
- `RelationEdge styles by data.kind with a kind label` — no routing specifics.
- Floating edge logic not mentioned.

### Why the spike is right
The routing is essential for visual clarity. Rebuttal arrows need to attack horizontally;
link arrows arriving at connectives need to find the nearest side dynamically.
This is an implementation detail that transfers directly into S-01 without any PRD conflict —
the plan just doesn't mention it yet.

---

## Summary: Reconciliation Required

| Topic | Spike (correct) | PRD / Plan (needs update) | Required action |
|-------|----------------|--------------------------|----------------|
| Statement types | 6: claim / source / data / warrant / backing / rebuttal | 5: no source | Add `source` to `statement_type`; revise FR-004 |
| Connective nodes | AND / OR node type | Not mentioned | Add connective concept to schema + FR-004 or new FR |
| Relation kinds | supports / link / rephrases / rebuts | supports / bridges / rebuts | Replace `bridges` → `link` + `rephrases`; update enum |
| Source handling | Source as canvas node with `url` field | Source as sub-entity in `sources` table | Remove `sources` table; add `url` field to `statements`; revise FR-005 |
| Root flag | `isRoot` on node data (derived) | `root_statement_id` FK (DB truth) | Both coexist — no schema change, plan note added |
| Edge routing | Floating utils for link / rebuts edges | Not mentioned | Add implementation note to plan Phase 3 |
