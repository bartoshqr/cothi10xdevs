# Map Visual Spike (F-02) — Plan Brief

> Full plan: `context/changes/map-visual-spike/plan.md`

## What & Why

Build a disposable React Flow spike that renders a static, multi-claim climate-advocacy argument map,
establishing the **visual language** (node design, relation-edge styling, layout, legend) and a
**restructured argument model** before S-01 (`advocate-map-builder`) commits to a schema or builds the
real editor. The canvas is the most product-defining surface for the Polish climate-advocate launch
community — proving its look cheaply de-risks S-01 and gives a pitch-worthy artifact.

**The model (this spike works it out visually):** everything is a **Claim**; Source/Data/Warrant/
Backing/Rebuttal are **roles** a claim takes by position (no role = plain/root claim). Premises combine
through **logical connective nodes** — `AND` (linked: all required) / `OR` (alternative: any suffices)
— which nest in either order to form boolean expressions like `(p AND q) OR r`. The Warrant is a **peer
operand** of an AND (Data does *not* support the Warrant), still backable and rebuttable. Four
relations: **link** (operand → connective), **supports** (connective or lone supporter → claim),
**rephrases** (any statement restating another — `Source → Data` is one common case), **rebuts**.
Qualifier dropped (folded into claim wording).

## Starting Point

Astro 6 + React 19 + Tailwind 4 with shadcn-style oklch design tokens and a `.dark` variant. React
islands mount via `client:` directives. A static HTML mockup of an argument map already exists at
`src/components/landing/ArgumentMapMockup.astro`. `@xyflow/react` is **not installed** — this spike
adds it. No domain data layer exists (correct — none is needed here).

## Desired End State

`/spike/map` renders a top-down React Flow canvas of a realistic climate argument in the connective
model: Source `rephrases`→ Data; Data and Warrant `link`→ an AND; that AND and an alternative line
`link`→ an OR that `supports`→ Claim A (`(Data AND Warrant) OR alt`); the Warrant is backed by an OR of
two Backings and rebutted by a Rebuttal; Claim B is supported directly by Claim A. Statement nodes are
one shared claim card (role = accent + badge; plain claim none; root claim shows a `ROOT` badge); connectives are small `AND`/`OR`
junctions. A legend teaches "every statement is a claim; badge = role" and "link feeds connectives,
supports lands on claims". User can pan/zoom/drag (no editing). Builds and runs with no SSR errors on
the Workers runtime.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Layout | Top-down hierarchical, hardcoded coords | Reads as argument flowing to its claim; no auto-layout dep | Plan |
| Interactivity | Pan/zoom + draggable, no editing | Demonstrates the canvas feel with zero editor logic | Plan |
| Example content | Real climate argument | Resonates with launch community; doubles as pitch material | Plan |
| Core model | Everything is a Claim; role is positional | Unifies the model; only the root/plain claims are role-less | Plan (user) |
| Connectives | AND/OR connective nodes; nest in either order | Premises combine as boolean expressions; one node type, op = mode | Plan (user) |
| Warrant | Peer operand of an AND, not an edge | Data does NOT support the Warrant; warrant stays backable + rebuttable | Plan (user) |
| Node design | One claim card + role accent/badge; separate small connective node | Proves "claim with a hat"; connective unmistakable from statements | Plan (user) |
| Edge design | Color + line style + label | `link` vs `supports`, and `supports` vs `rebuts`, must never confuse | Plan |
| Relation set | supports / link / rephrases / rebuts (dropped `bridges`) | `link` feeds connectives (not support); `supports` lands on claims; `rephrases` is general (any statement → any) | Plan (user) |
| Qualifier | Dropped | Complicates the model; fold "almost certain" into the claim text | Plan (user) |
| Reuse posture | Structure for reuse (clean modules) | Components liftable into S-01 + could replace landing mockup | Plan |
| Canvas chrome | Background + Controls + legend | Legend makes the spike self-explanatory as a design reference | Plan |
| Styling | All colours/fonts from `global.css` tokens (`--chart-*` + semantic) | Fits the existing design, inherits light/dark, no bespoke palette | Plan (user) |
| Supersede mockup | Spike replaces `ArgumentMapMockup.astro` conceptually | Built reuse-ready so landing could later adopt the RF version | Plan (user) |
| SSR | `client:only="react"` | React Flow can't SSR on Workers | Plan |

## Scope

**In scope:** install `@xyflow/react`; throwaway `/spike/map` route + client-only canvas island; ONE
claim-card statement node (role data-driven: source/data/warrant/backing/rebuttal + plain); ONE
AND/OR connective node; 1 relation edge (supports/link/rephrases/rebuts); central role/relation→style
map; hardcoded climate example exercising AND, OR + nesting (`(Data AND Warrant) OR alt → Claim`, Warrant
backed by `B1 OR B2`, rebuttal, claim-as-data chaining); legend that teaches claim+role and
link-vs-supports.

**Out of scope:** persistence/store/API/Supabase/Zod; any editing or expression-builder logic;
deciding S-01's actual schema; auto-layout; swapping the landing component now; new global theming; tests.

## Architecture / Approach

A browser-only React island (`ReactFlowProvider`, `client:only="react"`) under
`src/components/spike/`. A single `mapVisualLanguage.ts` holds the role/connective/relation→style map
(one source of truth, also feeds the legend). `StatementNode.tsx` is the claim card (role data-driven);
`ConnectiveNode.tsx` is the AND/OR junction; `RelationEdge.tsx` is the relation edge — registered via
module-level (stable) `nodeTypes` (`statement`, `connective`) / `edgeTypes`. `exampleMap.ts` holds the
hardcoded nodes/edges. Built bottom-up: scaffold → visual-language modules → compose map + legend.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Install & scaffold | `@xyflow/react` + empty client-only canvas on `/spike/map` | SSR on Workers — must use `client:only`; RF CSS import |
| 2. Nodes, connectives & edges | Claim card + AND/OR connective + relation edge (4 kinds) + style map | RF footguns; `link` vs `supports` legibility; connective distinct from cards |
| 3. Compose map + legend | Hardcoded climate map (AND/OR + nesting) + legend | Boolean expression reading clearly; curating a legible argument |

**Prerequisites:** none (no Supabase, no F-01 dependency for the spike itself).
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Discipline risk: must stay disposable — no store/persistence creep (that's S-01).
- The unified claim+role model, AND/OR connective nodes, the `link` relation, and the Source/Data split
  diverge from the PRD's type-enum + source-attribute model; recorded as spike findings to inform S-01,
  not committed changes. Connectives + `link` are a sizable schema addition if adopted.
- The example content is a sketch (`argumentation_examples.md`); wording/structure tunable live.
- Palette + typography come from `global.css` tokens (`--chart-*` ramp, semantic tokens, app fonts),
  not a bespoke palette; only the role→token assignment is reviewed live, and `.dark` is inherited.
- React Flow must never SSR on the Cloudflare Workers runtime.

## Success Criteria (Summary)

- The climate argument renders on `/spike/map`: claim cards with role accent/badges, AND/OR
  connectives, and 4 distinct relation kinds (`link` vs `supports` clearly separated), plus a legend.
- `(Data AND Warrant) OR ObservedWarming` supports Claim A; the Warrant is backed by an OR of two Backings
  and rebutted; Source rephrases Data; Claim A supports Claim B.
- The visual language + model are judged good enough to hand to S-01 and to eventually supersede the
  landing mockup.
