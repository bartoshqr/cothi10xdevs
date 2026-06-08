---
project: WVMap
version: 1
status: draft
created: 2026-05-25
updated: 2026-06-08
prd_version: 1
main_goal: market-feedback
top_blocker: capacity
---

# Roadmap: WVMap

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Worldview debates on social media are chaotic because free-form comment formats hide
*what* people actually disagree on. WVMap gives an advocate a structured Toulmin map
(Claim → Data → Warrant) and runs a turn-based private exchange with a challenger who
marks each statement Agree / Challenge / Abstain. The payoff is a deterministic
**divergence summary** that separates common ground from genuine cruxes.

The product wedge — the one trait that, if removed, makes this just another comment
thread — is that disagreement is forced onto individual typed statements and resolved
node-by-node, so a factual gap (contested Data) is visibly distinct from a values gap
(contested Warrant). The launch community is Polish climate advocates, so the bet pays
off only when real advocates run a real exchange end-to-end.

## North star

**S-04: A single exchange round completes and both parties see a divergence summary** —
this is the smallest end-to-end flow that proves the core hypothesis (structured exchange
surfaces the crux), so it is sequenced as early as its prerequisites allow.

> "North star" here means the smallest end-to-end slice whose successful delivery would
> prove the core product hypothesis — placed as early as Prerequisites permit because
> every other slice only matters if this one works. It traces to the Primary Success
> Criterion: build → invite → challenger marks/adds → advocate responds → summary.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                | Prerequisites | PRD refs                                  | Status   |
| ---- | --------------------------- | ------------------------------------------------------------------- | ------------- | ----------------------------------------- | -------- |
| F-01 | username-profiles           | (foundation) register with a unique username; look users up by it   | —             | FR-001, FR-002                            | done     |
| S-00 | landing-page-refresh        | land on a page that clearly pitches WVMap and directs them to sign up | —           | —                                         | done     |
| F-02 | map-visual-spike            | (design spike) see a static example Toulmin map rendered in React Flow — node/edge visual language | —  | US-01 (visual), FR-004, FR-006 (visual)   | done |
| S-01 | advocate-map-builder        | build a debate: root Claim, typed statements, sources, relations    | F-01, F-02    | US-01, FR-003, FR-004, FR-005, FR-006     | done     |
| S-02 | invite-and-open-exchange    | set round count, invite a challenger by username, they accept | S-01          | US-01, FR-007, FR-008, FR-009, FR-010     | proposed |
| S-03 | challenger-first-turn       | mark every advocate statement and add own statements, submit turn   | S-02          | US-02, FR-011, FR-012, FR-013, FR-014     | proposed |
| S-04 | first-divergence-summary    | respond, complete round 1, and view the divergence summary          | S-03          | US-03, FR-015, FR-016, FR-017, FR-018, FR-020, FR-021 | proposed |
| S-05 | multiround-edit-invalidation| edit/delete across rounds with mark invalidation; close exchange    | S-04          | US-04, FR-019, FR-026, FR-027             | proposed |
| S-06 | debate-list-and-inbox       | see all own debates with state, and an inbox of invites/exchanges   | S-02          | FR-024, FR-025                            | proposed |
| S-07 | parent-debate-linking       | link a new debate to a parent statement and navigate between them   | S-01          | FR-022, FR-023                            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                                          | Note                                                              |
| ------ | ------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| D      | Landing / onboarding | `S-00`                                        | Standalone; no prerequisites, parallel with everything. Ships whenever ready. |
| A      | Core exchange loop  | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` → `S-05` | The critical path to the north star (`S-04`) and the heavy state machine after it. |
| E      | Visual foundation   | `F-02` → `S-01`                                 | Disposable design spike; proves the canvas's node/edge visual language before `S-01` commits to a schema. |
| B      | Navigation & inbox  | `S-06`                                          | Joins Stream A at `S-02`; can be built in parallel with `S-03`/`S-04` (capacity lever). |
| C      | Fractal linking     | `S-07`                                          | Branches from `S-01`; highest value once `S-04` summaries exist, parallel with `S-05`. |

## Baseline

What's already in place in the codebase as of `2026-05-25` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4; layouts, pages, UI components (`src/components`, `src/pages`).
- **Backend / API:** partial — Astro API routes exist for auth only (`src/pages/api/auth/*`); no domain endpoints yet.
- **Data:** absent — Supabase configured (`supabase/config.toml`) but no migrations or tables; `auth.users` only.
- **Auth:** present — Supabase SSR auth wired: signin/signup/signout + middleware route protection (`src/middleware.ts`). Covers FR-002 and the email/OAuth part of FR-001; the unique-username requirement is not yet built.
- **Deploy / infra:** present — Cloudflare Workers/Pages (`wrangler.jsonc`, `@astrojs/cloudflare` 13.5.3), CI at `.github/workflows/ci.yml`.
- **Observability:** absent — no logging / error-tracking / metrics libraries (acceptable for MVP scope).

## Foundations

### F-01: Username-attributed accounts

- **Outcome:** (foundation) every user has a unique username captured at registration and is discoverable by it; attribution is available everywhere a statement or invite is shown.
- **Change ID:** username-profiles
- **PRD refs:** FR-001, FR-002 (Access Control)
- **Unlocks:** S-02 (invite search by username needs a username store), and statement/turn attribution used by S-03, S-04, S-05.
- **Prerequisites:** — (Supabase auth already present per Baseline)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Username uniqueness + the email/OAuth registration flow must be enforced at the data layer, not just the form; getting it wrong here propagates to every invite and attribution downstream. Sequenced first because it is small and unblocks the whole exchange path.
- **Status:** done

### F-02: Map visual spike (design foundation)

- **Outcome:** (design spike) a static, hardcoded example Toulmin map renders in a React Flow canvas — a root Claim plus Data/Warrant/Backing/Rebuttal nodes wired with supports/bridges/rebuts edges — establishing the node/edge visual language (per-type node design, per-kind edge styling, color palette, layout) before any schema or store is built.
- **Change ID:** map-visual-spike
- **PRD refs:** US-01 (visual only), FR-004 (statement types — visual), FR-006 (relation kinds — visual)
- **Unlocks:** S-01 — its Phase 3 editor inherits the proven visual conventions instead of guessing at them; de-risks the most product-defining surface (the canvas) cheaply.
- **Prerequisites:** — (`@xyflow/react` installed by this spike; no Supabase, no Zustand, no API)
- **Parallel with:** all other slices
- **Blockers:** —
- **Unknowns:**
  - Final color palette and node typography chosen live during build, not pinned beforehand. Owner: user (reviews live). Block: no.
- **Risk:** Deliberately disposable — the output is a visual language, not production code. The discipline risk is letting it creep into a half-built editor (store/persistence), which would create rework; keep it genuinely static. Low technical risk; high leverage on comprehension and first impressions for the Polish climate advocate community.
- **Status:** done

## Slices

### S-00: Landing page refresh

- **Outcome:** a visitor landing on the root URL sees a clear product pitch for WVMap (what it is, who it's for, what the exchange mechanic produces) and is directed to sign up or sign in.
- **Change ID:** landing-page-refresh
- **PRD refs:** — (supports `main_goal: market-feedback`; no specific FR)
- **Prerequisites:** —
- **Parallel with:** all other slices
- **Blockers:** —
- **Unknowns:**
  - Copy language and visual scope TBD — confirm before `/10x-plan`. Owner: user. Block: yes (gates planning).
- **Risk:** Low implementation risk; high leverage on first impressions for the Polish climate advocate community. Keep it lean: hero, one-liner, CTA. No analytics or A/B infra in MVP.
- **Status:** done

### S-01: Advocate builds a structured map

- **Outcome:** advocate can create a debate with a designated root Claim, add typed statements (Claim/Data/Warrant/Backing/Rebuttal), attach sources, and draw directed relations between them.
- **Change ID:** advocate-map-builder
- **PRD refs:** US-01, FR-003, FR-004, FR-005, FR-006
- **Prerequisites:** F-01, F-02 (inherits the visual language; not a hard build blocker)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Source field is free-text URL-or-citation with no validation in MVP — confirm no canonical format is needed yet. Owner: user. Block: no.
- **Risk:** This establishes the debate/statement/relation/source schema the entire graph depends on, plus the React Flow map editor. Invest deeply in the data model here; a shaky schema forces rework in every later slice. Frontend kept lean by leaning on React Flow rather than a custom canvas.
- **Status:** done

### S-02: Advocate invites a challenger and opens the exchange

- **Outcome:** advocate can initiate an exchange once a root Claim exists, set the round count (1–5, default 3), search for a registered user by username, and send an invite the challenger can accept or decline.
- **Change ID:** invite-and-open-exchange
- **PRD refs:** US-01, FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** S-01, F-01
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Introduces the exchange + invite + round-config schema and the challenger-first/advocate-last turn ordering. The exchange-initiation gate (root Claim must exist) is the integrity boundary; get it wrong and thin maps reach challengers.
- **Status:** proposed

### S-03: Challenger audits the map and submits the first turn

- **Outcome:** challenger can mark every unmarked advocate statement (Agree/Challenge/Abstain), add their own typed statements with sources and directed relations, and submit their turn, which activates the advocate's turn.
- **Change ID:** challenger-first-turn
- **PRD refs:** US-02, FR-011, FR-012, FR-013, FR-014
- **Prerequisites:** S-02
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - Marking obligation is "every currently-unmarked statement" — confirm carry-over semantics are deferred to S-05 (multi-round) and round 1 simply requires marking all advocate statements. Owner: TBD. Block: no.
- **Risk:** Adds the three-state mark schema and turn-submission gating (cannot submit until every advocate statement is marked). This is half the input to the summary algorithm; correctness of the mark model matters more than UI polish.
- **Status:** proposed

### S-04: Advocate responds, round 1 completes, divergence summary appears  ⟵ north star

- **Outcome:** advocate can mark every challenger statement, add their own statements/relations, submit to complete round 1, and either party can trigger the deterministic divergence summary (common ground / open divergences / unresolved), private to the pair.
- **Change ID:** first-divergence-summary
- **PRD refs:** US-03, FR-015, FR-016, FR-017, FR-018, FR-020, FR-021
- **Prerequisites:** S-03
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - Summary must render within the 10s NFR; no graph-size cap in MVP — confirm the deterministic algorithm is O(graph) and fits the edge-runtime CPU budget. Owner: user. Block: no.
- **Risk:** This is the validation milestone — the first time the full loop produces the artifact the product exists to create. Round-completion semantics (both turns submitted) gate the summary trigger. Deterministic-only; no AI. The summary classification (contested Data → factual gap, contested Warrant → values gap) is the core deliverable.
- **Status:** proposed

### S-05: Multi-round exchange with edit/delete, mark invalidation, and close

- **Outcome:** across rounds 2+, each party can edit/delete only their own statements during their active turn; edits/deletes invalidate the other party's marks (re-evaluation enforced for edits, auto-clear for deletes), orphaned statements are highlighted, the final-round mini turn runs, and the exchange closes (round exhaustion, explicit close, or 7-day challenger-inactivity) into immutability.
- **Change ID:** multiround-edit-invalidation
- **PRD refs:** US-04, FR-019, FR-026, FR-027
- **Prerequisites:** S-04
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - "Silent" = no turn submission within 7 days; partial activity (login/view/draft) does not extend the clock. PRD documents the intended call — confirm at implementation. Owner: user / implementation. Block: no.
- **Risk:** The heaviest, riskiest slice — the turn/mark-invalidation/orphaning/mini-turn state machine is where the data-integrity guardrail is won or lost. Deliberately sequenced AFTER the north star: market-feedback wants a working single-round loop in front of advocates before this complexity lands. A correctness bug here silently corrupts a user's reasoning map.
- **Status:** proposed

### S-06: Debate list and challenger inbox

- **Outcome:** a user can view all their debates with current state (drafting / in progress / closed) and an inbox of pending invites and active exchanges where they are the challenger, and navigate to each.
- **Change ID:** debate-list-and-inbox
- **PRD refs:** FR-024, FR-025
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low-risk navigation surface; without it the product has no entry point after the first session. Marked parallel-with the exchange slices so it can be batched against the critical path — the most actionable lever given the capacity blocker.
- **Status:** proposed

### S-07: Parent debate linking

- **Outcome:** when creating a debate, the advocate can optionally link it to an existing debate (same two users) as parent and pick a correspondence statement; parent and child are navigable from each other; ancestor chain capped at 4.
- **Change ID:** parent-debate-linking
- **PRD refs:** FR-022, FR-023
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - MVP restricts linking to the same two users; confirm the role-reversal rule (child creator is always Advocate) is enforced at creation. Owner: user. Block: no.
- **Risk:** Informational foreign-key link, no consistency check — low implementation risk. Most useful once S-04 summaries surface contested statements worth deepening, so its value lands late even though it only needs S-01 structurally.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                     | Ready for `/10x-plan` | Notes |
| ---------- | ---------------------------- | --------------------------------------------------------- | --------------------- | ----- |
| F-01       | username-profiles            | Add unique-username registration and user lookup          | yes                   | Run `/10x-plan username-profiles` |
| S-00       | landing-page-refresh         | Refresh the landing page for WVMap's target community     | no                    | Confirm copy/visual scope first |
| F-02       | map-visual-spike             | Static React Flow Toulmin map to design node/edge visuals | yes                   | Disposable design spike; run `/10x-new map-visual-spike` |
| S-01       | advocate-map-builder         | Advocate builds a structured Toulmin map                  | no                    | Prereq F-01, F-02 |
| S-02       | invite-and-open-exchange     | Open an exchange and invite a challenger                  | no                    | Prereq S-01 |
| S-03       | challenger-first-turn        | Challenger marks and adds statements (turn 1)             | no                    | Prereq S-02 |
| S-04       | first-divergence-summary     | Complete round 1 and generate the divergence summary      | no                    | North star; prereq S-03 |
| S-05       | multiround-edit-invalidation | Multi-round edit/delete, mark invalidation, and close     | no                    | Prereq S-04; heaviest slice |
| S-06       | debate-list-and-inbox        | Debate list and challenger inbox                          | no                    | Prereq S-02; parallelizable |
| S-07       | parent-debate-linking        | Link debates to a parent statement                        | no                    | Prereq S-01; parallelizable |

## Open Roadmap Questions

1. **Challenger account friction** — requiring challengers to create an account raises the barrier for the skeptic to engage. Owner: user (post-launch product team). Block: `roadmap-wide` (informs whether invite-acceptance is a success blocker; does not gate any slice).
2. **Source format** — FR-005 / FR-013 allow free-text URL-or-citation with no validation or canonical format in MVP. Owner: user. Block: gates nothing (affects S-01, S-03 polish only).
3. **"Silent" definition for the 7-day window** — clock starts at turn open; only turn submission stops it. Owner: user / implementation. Block: S-05 (must be resolved at implementation time, not before planning).
4. **Cloudflare deploy path (infra)** — `infrastructure.md` flags an unresolved Astro 6 + Supabase Auth + Cloudflare adapter build failure (GitHub #15796), High likelihood, blocks first deploy; and preview URLs are public by default for a private-user app. Owner: user. Block: gates first production deploy of any slice — verify issue status and pin the adapter before deploying.

## Parked

- **Public debate maps / map gallery** — Why parked: PRD §Non-Goals; prevents scope creep toward a social platform before the core mechanic is proven.
- **Team / org accounts** — Why parked: PRD §Non-Goals; individual accounts only in MVP.
- **Mobile-native UX** — Why parked: PRD §Non-Goals; desktop web only.
- **Real-time collaborative editing** — Why parked: PRD §Non-Goals; turn model owns the map one party at a time.
- **External notifications (email/push/in-app)** — Why parked: PRD §Non-Goals; turn state and countdowns surfaced via UI only in MVP.
- **AI Warrant suggestion** — Why parked: PRD §Deferred to Phase 2; a bad AI warrant is worse than none.
- **Fork mechanic for closed maps** — Why parked: PRD §Deferred to Phase 2; MVP ships post-close immutability without a correction path.
- **AI-enhanced divergence summary** — Why parked: PRD §Deferred to Phase 2; deterministic summary ships first.
- **Cross-pair parent debate linking** — Why parked: PRD §Deferred to Phase 2; FR-022 same-two-users constraint stands in MVP.
- **Statement / graph size caps** — Why parked: PRD §Deferred to Phase 2; revisit on abuse or if the 10s summary NFR breaks.
- **Public sharing of completed exchange maps** — Why parked: PRD §Deferred to Phase 2; needed to fully satisfy the Secondary success criterion.

## Done

- **F-01: (foundation) register with a unique username; look users up by it** — Archived 2026-05-26 → `context/archive/2026-05-25-username-profiles/`. Lesson: —.
- **S-00: land on a page that clearly pitches WVMap and directs them to sign up** — Archived 2026-05-26 → `context/archive/2026-05-26-landing-page-refresh/`. Lesson: —.
- **F-02: (design spike) a static, hardcoded example Toulmin map renders in a React Flow canvas — a root Claim plus Data/Warrant/Backing/Rebuttal nodes wired with supports/bridges/rebuts edges — establishing the node/edge visual language (per-type node design, per-kind edge styling, color palette, layout) before any schema or store is built.** — Archived 2026-05-27 → `context/archive/2026-05-27-map-visual-spike/`. Lesson: —.
- **S-01: advocate builds a structured map** — Archived 2026-06-08 → `context/archive/2026-05-26-advocate-map-builder/`. Lesson: —.
