# Map Visual Spike (F-02) Implementation Plan

## Overview

Build a **disposable design spike** that renders a static, hardcoded multi-claim climate-advocacy
argument map in a React Flow (`@xyflow/react`) canvas. The deliverable is a **visual language** —
node design, relation-edge styling, layout, and a legend — proven on realistic content **before**
S-01 (`advocate-map-builder`) commits to a schema or builds the real editor. No Supabase, no Zustand,
no API, no persistence.

The spike also works out a **restructured argument model** (diverging from the PRD's flat
type-and-source-attribute model) that the user wants to see rendered:

- **Everything is a Claim.** There is one underlying statement node — fundamentally a claim (an
  assertion that can be agreed / challenged / rebutted). Source, Data, Warrant, Backing, and Rebuttal
  are not separate entity types — they are **roles** a claim takes on by its **position**. A statement
  with no role is **just a Claim** (the root claim, and any plain claim).
- **Logical connective nodes (AND / OR).** A second node category — a small **connective** node, set
  to `AND` (linked: all inputs required) or `OR` (alternative: any input suffices). Multiple statements
  are joined through a connective rather than each pointing at the claim independently. Connectives
  take any number of inputs and **nest in either order** (OR can feed AND and vice versa), so the
  premises of a claim form a boolean expression — e.g. `(p AND q) OR r`.
- **The Warrant is a peer, not an edge.** Data and Warrant are co-operands of an `AND` that supports
  the Claim — Data does **not** support the Warrant. The Warrant stays a claim-with-a-role so it can
  itself be **backed** and **rebutted**.
- **Four relations.** `link` wires statements/connectives *into* a connective (an operand, not
  support). `supports` lands on a claim (a connective → claim, or a lone supporter → claim directly).
  `rephrases` is a **general** relation between any statement and another it restates (faithful or
  strawman) — `Source → Data` is just one common instance. `rebuts` is `Rebuttal → claim/warrant/connective`.
- **Backbone:** `Source →(rephrases) Data → … → Claim`, with claims able to support higher claims.
  **Qualifier is dropped** (folded into the claim's wording).

Whether this reads better than the PRD model is exactly the spike's job to surface; it does not
change any PRD/roadmap artifact.

## Current State Analysis

- **Frontend**: Astro 6 + React 19 + Tailwind 4. React islands are `.tsx` components mounted in
  `.astro` pages via `client:` directives (`src/pages/auth/signin.astro:12` uses
  `<SignInForm client:load />`). `src/components/ui/button.tsx` shows the React+Tailwind component style.
- **Design tokens**: `src/styles/global.css` defines a shadcn-style token system (oklch CSS vars)
  with a `.dark` variant and `@custom-variant dark`. Primary accent is `oklch(0.55 0.12 220)` (blue);
  there is a 5-colour categorical ramp (`--chart-1`…`--chart-5`) plus `--foreground`/`--muted`/
  `--border`/`--card` etc. The spike draws **all** node/edge colours and typography from these tokens —
  role accents from the `--chart-*` ramp, base/structure from the semantic tokens — so it fits the
  existing design and works in light and dark without a bespoke palette.
- **Existing argument-map mockup**: `src/components/landing/ArgumentMapMockup.astro` is a static
  HTML/Tailwind depiction (Claim + Data + Warrant nodes, Agree/Challenge/Abstain toggles, climate
  nuclear-energy example). **This spike supersedes it** and is built so it could later replace the
  landing mockup with the React Flow version.
- **`@xyflow/react` is NOT installed** — `package.json` has no xyflow/reactflow dependency. This
  spike installs it.
- **Runtime constraint**: Cloudflare Workers — no Node built-ins, and React Flow must never SSR.
- **Layout**: single root layout `src/layouts/Layout.astro`; pages live in `src/pages/`.

### Key Discoveries:

- React Flow footgun set (confirmed in `advocate-map-builder` plan-brief): `nodeTypes`/`edgeTypes`
  objects must be module-level constants (stable identity) or memoized, the canvas must be inside a
  `ReactFlowProvider`, the stylesheet `@xyflow/react/dist/style.css` must be imported, and the
  component must be client-only on Workers.
- Existing islands hydrate with `client:load`; for React Flow use `client:only="react"` to skip SSR
  entirely (`src/pages/auth/*.astro:12` is the hydration-directive precedent).
- The PRD models statement *types* (Claim/Data/Warrant/Backing/Rebuttal) as a future `statement_type`
  enum and relations as a `relation_kind` enum. This spike **reframes** that into: (a) one statement
  node + an optional **role** (`source | data | warrant | backing | rebuttal`; none = plain claim),
  (b) a **connective** node (`AND` / `OR`), and (c) the relation set **supports / link / rephrases /
  rebuts**. It drops the PRD's `bridges` (the warrant is now a peer operand of an AND, not a bridge
  edge), adds `link` (wiring operands into connectives) and `rephrases` (any statement restating
  another — faithful or strawman; `Source → Data` is one common instance). Qualifier is dropped.

## Desired End State

Visiting the spike route renders a top-down React Flow canvas showing a realistic multi-claim climate
argument in the connective model:

- A **Source** (`role: source`) `rephrases`→ a **Data** statement.
- **Data** and a **Warrant** both `link`→ an **AND** connective; that AND, together with an alternative
  line, `link`→ an **OR** connective which `supports`→ **Claim A** — i.e. `(Data AND Warrant) OR alt`
  supports the claim.
- The **Warrant** is `supports`-ed by an **OR** of two **Backing** statements (either suffices) and
  `rebuts`-ed by a **Rebuttal**.
- A higher **Claim B** is `supports`-ed directly by Claim A (lone supporter → direct edge) — the
  "several claims" requirement.
- Statement nodes render from one shared **claim-card** base; **role** shows as accent + badge
  (a plain claim has no badge; the **root claim carries a `ROOT` badge**). **Connective** nodes are small `AND`/`OR` junctions, visually distinct
  from claim cards. Data carries a multi-sentence interpretation; Source reads as a citation.

The user can pan, zoom, and drag nodes (React Flow defaults) but cannot add/edit/delete (data is
hardcoded). A legend explains the claim base, each role, the connective, and each relation kind. The
page builds and runs with no SSR errors on the Workers dev runtime.

Verify by: `npm run build` succeeds; `npm run dev` serves the route; the map renders the claim+role
statements, AND/OR connectives, and 4 relation kinds visually distinct, with `link` (into connectives)
clearly different from `supports` (onto claims); pan/zoom/drag work; legend is present.

## What We're NOT Doing

- **No persistence / store / API** — data is hardcoded module constants. No Supabase, no Zustand,
  no Zod, no autosave, no RLS. (All of that is S-01.)
- **No editing** — no add/edit/delete/connect interactions, no detail panel, no context menu.
- **Not deciding S-01's schema** — the unified claim+role model, the AND/OR connective nodes, the
  `link` relation, and the Source/Data split are visual findings to *inform* S-01; this spike does not
  change any PRD/roadmap artifact or migration.
- **No expression-builder logic** — connectives are hardcoded in the example; no validation of
  boolean structure, no auto-collapsing of single-input connectives, no editing of operators.
- **Not auto-layout** — node positions are hardcoded coordinates; no dagre/elk dependency.
- **Not replacing the landing page now** — the spike supersedes `ArgumentMapMockup.astro`
  conceptually and is built reuse-ready, but actually swapping the landing component is a later change.
- **No new theme** — colours and typography come entirely from `src/styles/global.css` tokens
  (`--chart-*`, `--foreground`, `--muted`, `--border`, fonts); no bespoke palette, no new global tokens.
- **No tests** — a disposable visual spike; verification is build + manual browser review.

## Implementation Approach

Bottom-up in three phases: (1) get an empty React Flow canvas mounting client-only without SSR
errors, (2) build the reusable visual-language modules — the claim-card statement node (role
data-driven), the AND/OR connective node, and the relation edge (4 kinds) — with a central
role/relation→style map, (3) compose the hardcoded climate example map and legend on top. Components
live under a single spike folder so the disposable surface is obvious and the reuse-ready modules are
easy to lift into S-01 later. Styling is wholly token-driven: role accents map to the `--chart-*`
ramp and base/structure to the semantic tokens in `global.css`, inheriting the `.dark` variant for free.

## Critical Implementation Details

- **No SSR for React Flow**: the canvas island must be mounted with `client:only="react"` (not
  `client:load`) — React Flow touches `window`/measurement APIs and will break SSR on the Workers
  runtime. The `.astro` page renders only a wrapper; the canvas is fully client-rendered.
- **Stable `nodeTypes` / `edgeTypes`**: declare these mapping objects as module-level constants
  outside the component (or `useMemo`). Re-creating them per render makes React Flow remount all
  nodes and emit console warnings.
- **Stylesheet import**: `import "@xyflow/react/dist/style.css";` is required once in the canvas
  component or it renders unstyled/broken.
- **Everything-is-a-claim statement node**: there is ONE statement component. Its `data.role`
  (optional) selects the accent + badge; absent role = plain claim. Do not build five separate node
  components — build one claim card whose role is data-driven. This is the model the legend must teach.
- **Connective node (AND/OR)**: a second, separate node component — small `AND`/`OR` junction with a
  `data.op` of `and` | `or`, visually unmistakable from claim cards (much smaller, neutral). It takes
  any number of incoming `link` edges and emits one outgoing edge (a `link` to another connective, or
  a `supports` to a claim). The two are distinct React Flow `nodeTypes` (`statement`, `connective`).
- **`link` vs `supports`**: `link` wires operands *into* a connective (`Data → AND`, `Backing → OR`,
  `AND → OR`) — it is NOT support. `supports` only lands on a claim — either a connective's single
  output (`OR → Claim`) or a lone supporter (`Claim A → Claim B`). Style `link` and `supports`
  distinctly so the difference is obvious; this is the subtlest part of the visual language.
- **Relation directions**: `rephrases` runs from the restating statement to the one it restates — it
  can connect **any** statement to any other (`Source → Data` is one common case, not a constraint).
  `link` runs from each operand to its connective. `supports` runs from a connective
  (or lone supporter) up to the claim. `rebuts` runs from the Rebuttal to its target. Keep
  `source`/`target` consistent so arrowheads read correctly.

### React Flow (`@xyflow/react` v12) API constraints — verified against the `react-flow` skill

These are hard library requirements (not style), confirmed in `.claude/skills/react-flow/` and its
`references/`. Treat them as part of the contracts below.

- **Typed `data` must extend `Record<string, unknown>`.** v12's generics require it:
  `interface StatementNodeData extends Record<string, unknown> { … }`, then
  `type StatementNode = Node<StatementNodeData, "statement">`. Same for `ConnectiveNodeData` and the
  edge data (`Edge<RelationEdgeData, "relation">`). Omitting the `Record` constraint is the most likely
  `astro check` break. Components are typed `NodeProps<StatementNode>` / `EdgeProps<RelationEdge>`.
- **Do not hand-wrap nodes/edges in `React.memo`.** The node-ts skill template uses `memo`, but this
  repo runs `eslint-plugin-react-compiler` (`react-compiler/react-compiler: error`) which auto-memoizes.
  Write plain function components; let the compiler handle it. (This diverges from the skill template on
  purpose — the repo's compiler makes manual `memo` redundant.)
- **Custom edge rendering**: import `BaseEdge` + a path util (`getBezierPath` for support/rephrase,
  `getSmoothStepPath` for `link` into connectives reads well as orthogonal) from `@xyflow/react`. Each
  util takes the `EdgeProps` (it carries `sourceX/Y`, `targetX/Y`, `sourcePosition`, `targetPosition`)
  and returns `[edgePath, labelX, labelY]`. Render `<BaseEdge id={id} path={edgePath} style={…} />`.
- **Edge labels**: use the `EdgeText` component (`<EdgeText x={labelX} y={labelY} label={…} />`) for the
  simple SVG label this spike needs — no interactivity required, so `EdgeLabelRenderer` (HTML overlay) is
  unnecessary here. Color/dash come from the relation descriptor's `style`.
- **`fitView` on load**: pass it as the boolean prop `<ReactFlow fitView fitViewOptions={{ padding: 0.2 }} />`
  — no `useReactFlow()` call needed for the static spike. (The hook is only needed for programmatic
  control, which this spike does not do.)
- **Arrowheads**: relation direction is conveyed by `markerEnd` — set `MarkerType.ArrowClosed` via the
  edge's `markerEnd` (or `defaultEdgeOptions`) so `supports`/`rebuts`/`link`/`rephrases` read directionally.

## Phase 1: Install & scaffold the canvas

### Overview

Add the dependency and get an empty, styled React Flow canvas rendering client-only on a throwaway
route, with Background and Controls, proving the SSR-free mount on the Workers runtime.

### Changes Required:

#### 1. Install React Flow

**File**: `package.json`

**Intent**: Add `@xyflow/react` as a dependency so the spike can render a canvas.

**Contract**: New entry under `dependencies`: `@xyflow/react` (latest v12). Installed via
`npm install @xyflow/react`; lockfile updated.

#### 2. Spike canvas island

**File**: `src/components/spike/MapSpikeCanvas.tsx`

**Intent**: A React component that renders a `ReactFlowProvider` wrapping a `ReactFlow` canvas with
`Background` and `Controls`, initially with empty/placeholder nodes. This is the client-only island.

**Contract**: Default-exported React component. Imports `@xyflow/react/dist/style.css`. Uses
`ReactFlow`, `ReactFlowProvider`, `Background`, `Controls` from `@xyflow/react`. Canvas given a fixed
full-height container. `nodeTypes`/`edgeTypes` left empty for now (added Phase 2).

#### 3. Spike page / route

**File**: `src/pages/spike/map.astro`

**Intent**: A throwaway route that mounts the canvas island client-only, inside the existing layout.

**Contract**: Uses `src/layouts/Layout.astro`. Mounts `<MapSpikeCanvas client:only="react" />`.
Full-viewport container so the canvas has height. Not added to `PROTECTED_ROUTES` (public spike).

### Success Criteria:

#### Automated Verification:

- Dependency installs: `npm install` completes and `@xyflow/react` is in `package.json`
- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- `npm run dev` serves `/spike/map` and an empty React Flow canvas renders with Background dots
      and zoom/fit Controls
- No SSR/hydration errors in the browser console or dev server logs (confirms `client:only` mount)

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation
that the empty canvas renders cleanly before building the visual language.

---

## Phase 2: Nodes, connectives & relation edges (the visual language)

### Overview

Build the reusable visual-language modules: the claim-card **statement** node (role data-driven), the
**connective** node (AND/OR), and the relation-edge component for the 4 relation kinds — all driven by
a central role/relation→style map. This is the core deliverable S-01 will inherit.

### Changes Required:

#### 1. Role / relation → style map

**File**: `src/components/spike/mapVisualLanguage.ts`

**Intent**: Single source of truth mapping each statement **role**, the **connective** operators, and
each **relation kind** to its visual treatment. Encodes "everything is a claim, role is a hat; links
feed connectives, supports lands on claims" — what the node components and the legend all read.

**Contract**: Exports a `StatementRole` union (`claim | source | data | warrant | backing | rebuttal`,
`claim` = role-less base), a `ConnectiveOp` union (`and | or`), and a `RelationKind` union
(`supports | link | rephrases | rebuts`). Exports a record from each role to its style descriptor
(accent color, badge text; `claim` = base, no badge, but a root claim shows a `ROOT` badge), each connective op to its text label (`AND`/`OR`) +
style, and each relation kind to its edge style (color, stroke solid/dashed, label). `link` and
`supports` must be visually well-separated. Every colour references a `global.css` token — role
accents from `--chart-1`…`--chart-5`, base/structure from `--foreground`/`--muted`/`--border`/`--card`,
relation-edge colours from the ramp or semantic tokens — and typography uses the app's existing font
stack. No raw hex/oklch literals; the `.dark` variant is inherited automatically (but not verified in
this spike — see Phase 2 Implementation Note). The role→token assignment is the one thing reviewed live.

#### 2. The statement (claim card) node component

**File**: `src/components/spike/StatementNode.tsx`

**Intent**: ONE custom React Flow node that renders the shared **claim card** for every statement,
layering on a role accent + badge from the style map. No role = plain claim (no badge); when
`data.isRoot`, the card shows a `ROOT` badge. `data` role surfaces its multi-sentence *interpretation*
as the body; `source` role reads as a citation whose *reliability* is contestable.

**Contract**: A single React Flow custom node typed `NodeProps<StatementNode>` where
`StatementNode = Node<StatementNodeData, "statement">` and `StatementNodeData extends Record<string, unknown>`
with `role?`, `title`, `body`, `isRoot?`. Reads `data.role?`, `data.title`, `data.body`, `data.isRoot?`.
Renders a top `<Handle type="target" position={Position.Top} />` and a bottom
`<Handle type="source" position={Position.Bottom} />` (single handle each side — a statement has one
in, one out). Looks up styling from `mapVisualLanguage.ts`. Plain function component (no `memo` — see
React Flow API constraints). Registered under the `statement` key in the module-level `nodeTypes`
constant. Tailwind `className` styling per the custom-nodes reference; tokens via `global.css` vars.

#### 3. The connective node component

**File**: `src/components/spike/ConnectiveNode.tsx`

**Intent**: A small AND/OR junction node, visually unmistakable from claim cards (compact, neutral,
shows the `AND`/`OR` text label — not `∧`/`∨` symbols, which read as too academic), expressing how
multiple operands combine to support a claim.

**Contract**: A React Flow custom node typed `NodeProps<ConnectiveNode>` where
`ConnectiveNode = Node<ConnectiveNodeData, "connective">` and `ConnectiveNodeData extends Record<string, unknown>`
with `op` (`and | or`) and an operand count (e.g. `inputs: number`) so the handles can be rendered.
Renders multiple target `<Handle type="target" position={Position.Top} id={…} />` (incoming `link`s)
**each with a distinct `id`** (e.g. `in-0`, `in-1`, … — per the custom-nodes reference, a node with >1
same-type handle requires `id`s or edges silently collapse onto the first handle; space them with a
per-handle `style` left-offset) and one source `<Handle type="source" position={Position.Bottom} id="out" />`
(outgoing `link` or `supports`). The handle ids are part of this node's contract — `exampleMap.ts` edges
reference them via `targetHandle`/`sourceHandle`. Plain function component (no `memo`). Styled from the
connective entry in `mapVisualLanguage.ts`. Registered under the `connective` key in `nodeTypes`. Handle
count is static here, so `useUpdateNodeInternals` is **not** needed (it is only for handles added/removed
at runtime).

#### 4. Relation edge component

**File**: `src/components/spike/RelationEdge.tsx`

**Intent**: Custom edge rendering that distinguishes supports / link / rephrases / rebuts by color +
line style + a small label — with `link` (into connectives) clearly distinct from `supports` (onto
claims).

**Contract**: A React Flow custom edge typed `EdgeProps<RelationEdge>` where
`RelationEdge = Edge<RelationEdgeData, "relation">` and `RelationEdgeData extends Record<string, unknown>`
with `kind` (`supports | link | rephrases | rebuts`). Computes the path with a util that takes the
props directly — `const [edgePath, labelX, labelY] = getSmoothStepPath(props)` for `link` (orthogonal
into connectives reads cleanly) or `getBezierPath(props)` for the others — and renders
`<BaseEdge id={id} path={edgePath} style={…} markerEnd={markerEnd} />` with `style` (stroke color,
`strokeDasharray` for dashed kinds) from the relation-kind descriptor, plus an
`<EdgeText x={labelX} y={labelY} label={…} />` SVG label. Use `MarkerType.ArrowClosed` for direction.
Plain function component (no `memo`). Registered in a module-level `edgeTypes` constant under the
`relation` key. (For this static spike a single `relation` edge type switching on `data.kind` is simpler
than four edge types.)

#### 5. Wire node/edge types into the canvas

**File**: `src/components/spike/MapSpikeCanvas.tsx`

**Intent**: Replace the empty `nodeTypes`/`edgeTypes` with the real registries.

**Contract**: Module-level `const nodeTypes` / `const edgeTypes` constants passed to `ReactFlow`
(stable identity, no inline object).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- One claim-card node renders a plain claim plus each of the 5 roles (source/data/warrant/backing/
      rebuttal) with a distinct accent + badge, all sharing the same base card
- A plain claim renders with the base card and no badge; a root claim shows a `ROOT` badge
- The connective node renders as a small `AND`/`OR` junction, clearly distinct from claim cards
- The 4 relation kinds render distinct (color + line style + label); `link` and `supports` are
      not confusable, nor are `supports` and `rebuts`
- `data`-role node displays a multi-sentence interpretation; `source`-role node reads as a citation

**Implementation Note**: After Phase 2 automated verification passes, pause for live review of the
node/edge visual language (confirm the role→token assignment reads well in light) before composing the
map. Dark mode is token-inherited (`.dark` variant) but **not verified in this spike** — the app wires
no theme toggle, so light is the reviewed surface.

---

## Phase 3: Compose the example map + legend

### Overview

Hardcode the realistic multi-claim climate argument in the connective model — exercising AND, OR, and
nesting — lay it out top-down, and add a legend panel explaining the visual language.

### Changes Required:

#### 1. Hardcoded example map data

**File**: `src/components/spike/exampleMap.ts`

**Intent**: The curated climate argument (from `context/foundation/argumentation_examples.md`, treated
as a tunable sketch) as static statement + connective nodes and edges:

- **Source** "Krzywa Keelinga — pomiary CO₂ z Mauna Loa" `rephrases`→ **Data** "Stężenie CO₂ w
  atmosferze systematycznie rośnie".
- **Data** and **Warrant** "Przy stałym dopływie energii ze Słońca więcej CO₂ zatrzymuje więcej
  energii → temperatura musi wzrosnąć" both `link`→ an **AND**.
- That **AND** and an alternative **Data** "obserwowany wzrost średniej temperatury globalnej" both
  `link`→ an **OR**, which `supports`→ **Claim A** "Średnia temperatura Ziemi będzie rosnąć wraz ze
  wzrostem CO₂" — i.e. `(Data AND Warrant) OR ObservedWarming` supports Claim A.
- Two **Backing** statements ("fizyka efektu cieplarnianego — Fourier/Tyndall/Arrhenius"; "dodatni
  bilans radiacyjny +0,6 W/m²") both `link`→ an **OR** that `supports`→ the Warrant (either backs it).
- **Rebuttal** "Nie zadziałałoby, gdyby Słońce osłabło — ale nie osłabia" `rebuts`→ the Warrant.
- **Claim B** "Globalne ocieplenie wymaga pilnych działań ograniczających emisje" `supports`-ed
  directly by Claim A (lone supporter → direct edge). Claim B is the top-level thesis, so it is the
  **root** (`isRoot: true` → `ROOT` badge); Claim A is a plain claim (no role, no badge).

Hardcoded top-down x/y coordinates.

**Contract**: Exports `nodes` and `edges` arrays typed to the canvas's node/edge data shapes.
Statement nodes carry `type: "statement"`, `role?`, `title`, `body`/`interpretation`, `isRoot?`,
`position`. Connective nodes carry `type: "connective"`, `data.op` (`and|or`), `position`. Edges into
connectives use `kind: "link"` and **must set `targetHandle`** to the connective's per-operand handle id
(`in-0`, `in-1`, …) so each operand anchors to its own handle rather than collapsing onto the first; a
connective's output edge sets `sourceHandle` to the connective's `out` handle. A connective's output to
a claim and a lone supporter→claim use `kind: "supports"`; `Source→Data` uses `rephrases`; the rebuttal
uses `rebuts`. Content reviewed live.

#### 2. Render the example + fitView

**File**: `src/components/spike/MapSpikeCanvas.tsx`

**Intent**: Feed the hardcoded `nodes`/`edges` into the canvas and fit the view on load.

**Contract**: Imports `nodes`/`edges` from `exampleMap.ts`, passes to `ReactFlow`, and enables fit-on-load
via the boolean prop `fitView` (optionally `fitViewOptions={{ padding: 0.2 }}`) — no `useReactFlow()`
needed. Pass `nodeTypes`/`edgeTypes` (the module-level constants) and `defaultEdgeOptions={{ type: "relation",
markerEnd: { type: MarkerType.ArrowClosed } }}` so every edge resolves to the custom edge with an arrowhead.
Nodes draggable, canvas pan/zoom enabled (React Flow defaults); no `onConnect`/`onNodesChange`/edit
handlers wired (static data).

#### 3. Legend panel

**File**: `src/components/spike/MapLegend.tsx`

**Intent**: A small panel explaining each node type (color + label) and each edge kind (color/line +
label), making the spike self-explanatory as a design reference and pitch artifact.

**Contract**: A React Flow `Panel` (or absolutely-positioned overlay) listing the claim base + the 5
roles, the AND/OR connective, and the 4 relation kinds from `mapVisualLanguage.ts` (single source of
truth — no duplicated styling). It must make legible both "every statement is a claim; the badge is
its role" and "link feeds connectives, supports lands on claims". Mounted inside `MapSpikeCanvas`.

#### 4. Spike findings note (the actual hand-off to S-01)

**File**: `context/changes/map-visual-spike/findings.md`

**Intent**: Capture the spike's *verdict* — the reason the spike exists — so it survives the disposable
code. The components are liftable, but the model judgment (does claim+role + AND/OR connectives + the
`link` relation read better than the PRD's type-enum + source-attribute model?) must be written down or
it is lost when the spike folder is deleted.

**Contract**: A short note (one or two paragraphs + the canvas screenshot) recording: (a) the verdict on
the unified claim+role model vs. the PRD type-enum, (b) whether AND/OR connectives + the `link` relation
earn their keep visually, (c) the Source/Data split via `rephrases`, and (d) any concrete steer for
S-01's schema. Written after the final sign-off so it reflects the reviewed result. Not a formal doc —
the decision, not prose.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- `/spike/map` renders the full climate argument: statement roles, AND/OR connectives, 4 relation kinds
- Source `rephrases`→ Data is visible; Data shows a multi-sentence interpretation
- `(Data AND Warrant) OR ObservedWarming` reads correctly: Data and Warrant `link`→ AND, AND + alt
      `link`→ OR, OR `supports`→ Claim A — `link` and `supports` are visually distinct
- Warrant is `supports`-ed by an OR of two Backings and `rebuts`-ed by the Rebuttal
- Root claim (Claim B) shows a `ROOT` badge; plain claims (Claim A) have none; Claim B supported directly by Claim A
- Legend conveys "every statement is a claim; badge = role" and "link feeds connectives, supports
      lands on claims", and explains all relation kinds
- Pan, zoom, fit, and node-drag all work; layout reads top-down and is screenshot-worthy
- Visual language is judged good enough to (a) hand to S-01 and (b) eventually supersede
      `ArgumentMapMockup.astro`
- `findings.md` written, capturing the model verdict (claim+role vs PRD enum, connectives + `link`,
      Source/Data split) + screenshot — the hand-off that outlives the disposable code

**Implementation Note**: After Phase 3, pause for final sign-off that the token-based styling reads
well as a whole (in light — dark is token-inherited but unverified, see Phase 2 note).

---

## Testing Strategy

### Unit Tests:

- None — disposable visual spike. Correctness is judged visually.

### Integration Tests:

- None.

### Manual Testing Steps:

1. `npm run dev`, open `/spike/map`.
2. Confirm one claim card renders for every statement, with plain claims (no badge) and each role
   (source/data/warrant/backing/rebuttal) shown via a distinct accent + badge; connectives render as
   small `AND`/`OR` junctions.
3. Confirm `(Data AND Warrant) OR ObservedWarming` supports Claim A via AND/OR connectives; the Warrant
   is backed by an OR of two Backings and rebutted by the Rebuttal; Source rephrases Data; Claim A
   supports Claim B directly.
4. Confirm the 4 edge kinds are visually unambiguous (color + line style + label), especially `link`
   vs `supports`.
5. Pan, zoom, fit, drag a node — confirm React Flow interactions work and reset on reload.
6. Confirm the legend matches what's on the canvas.
7. Confirm no console/SSR errors.

## Performance Considerations

Trivial — a single static graph of a few dozen nodes. No performance budget concerns; React Flow
handles this size effortlessly.

## Migration Notes

None — no schema, no data, no migrations. The unified claim+role model, the AND/OR connective nodes,
the `link` relation, and the Source/Data split are recorded as spike findings to inform S-01's modeling
discussion; they do not alter any existing artifact. Notably, S-01's current plan models statement
*type* as an enum, relations as a flat `relation_kind`, and *source* as an attribute — if the spike's
model wins, that's a deliberate S-01 schema revisit (connectives + `link` are a sizable addition).

## References

- Roadmap entry: `context/foundation/roadmap.md` → F-02 (map-visual-spike)
- Argument example (sketch): `context/foundation/argumentation_examples.md`
- Downstream consumer: `context/changes/advocate-map-builder/plan-brief.md` (S-01 inherits this visual language)
- Superseded mockup: `src/components/landing/ArgumentMapMockup.astro`
- Hydration precedent: `src/pages/auth/signin.astro:12`
- Design tokens: `src/styles/global.css`
- React Flow library: `@xyflow/react` (v12); skills `react-flow`, `react-flow-node-ts`
- React Flow API references (consulted for the constraints above):
  - `.claude/skills/react-flow/SKILL.md` — quick start, implementation gates (stable types, CSS, provider)
  - `.claude/skills/react-flow/references/custom-nodes.md` — `NodeProps<T>`, `Handle`, multi-handle `id`s, `useUpdateNodeInternals`, Tailwind styling, `nodrag`/`nopan`
  - `.claude/skills/react-flow/references/custom-edges.md` — `EdgeProps<T>`, `getBezierPath`/`getSmoothStepPath`, `BaseEdge`, `EdgeText`, `EdgeLabelRenderer`, `DefaultEdgeOptions`
  - `.claude/skills/react-flow/references/viewport.md` — `fitView`/`useReactFlow` (not needed by this static spike)
  - `.claude/skills/react-flow/references/reactflow-ctx7-docs.md` — ctx7-pulled snippet collection (floating edges, handles, viewport)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Install & scaffold the canvas

#### Automated

- [x] 1.1 Dependency installs; `@xyflow/react` in `package.json` — 0572625
- [x] 1.2 Build passes: `npm run build` — 0572625
- [x] 1.3 Lint passes: `npm run lint` — 0572625

#### Manual

- [x] 1.4 `/spike/map` renders an empty canvas with Background + Controls — 0572625
- [x] 1.5 No SSR/hydration errors (confirms `client:only` mount) — 0572625

### Phase 2: Nodes, connectives & relation edges (the visual language)

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Build passes: `npm run build`
- [x] 2.3 Lint passes: `npm run lint`

#### Manual

- [x] 2.4 One claim-card component renders plain claim + all 5 roles, sharing one base card — d07c7d6
- [x] 2.5 Plain claim has no badge; root claim shows a `ROOT` badge — d07c7d6
- [x] 2.6 Connective node renders as a small `AND`/`OR` junction, distinct from claim cards — d07c7d6
- [x] 2.7 All 4 relation kinds render distinct; `link` vs `supports` not confusable — d07c7d6
- [x] 2.8 `data`-role node shows interpretation; `source`-role node reads as citation — d07c7d6

### Phase 3: Compose the example map + legend

#### Automated

- [x] 3.1 Build passes: `npm run build` — 9b99376
- [x] 3.2 Lint passes: `npm run lint` — 9b99376
- [x] 3.3 Type checking passes: `npx astro check` — 9b99376

#### Manual

- [x] 3.4 Full climate argument renders: statement roles, AND/OR connectives, 4 relation kinds — 9b99376
- [x] 3.5 Source `rephrases`→ Data; Data shows interpretation — 9b99376
- [x] 3.6 `(Data AND Warrant) OR ObservedWarming` supports Claim A; `link` vs `supports` visually distinct — 9b99376
- [x] 3.7 Warrant backed by an OR of two Backings; Rebuttal rebuts the Warrant — 9b99376
- [x] 3.8 Root claim (Claim B) shows a `ROOT` badge; plain Claim A has none; Claim B supported directly by Claim A — 9b99376
- [x] 3.9 Legend conveys claim+role and link-vs-supports, and all relation kinds — 9b99376
- [x] 3.10 Pan/zoom/fit/drag work; top-down layout is screenshot-worthy — 9b99376
- [x] 3.11 Visual language judged good enough for S-01 handoff and to supersede the landing mockup — 9b99376
- [x] 3.12 `findings.md` written: model verdict (claim+role vs PRD enum, connectives + `link`, Source/Data) + screenshot → moved to Phase 4

### Phase 4: Spike findings

#### Automated

_(none — doc-only phase)_

#### Manual

- [x] 4.1 `context/changes/map-visual-spike/findings.md` written: model verdict (claim+role vs PRD type-enum, AND/OR connectives + `link` relation, Source/Data split via `rephrases`), concrete steer for S-01 schema, plus screenshot of the rendered map
