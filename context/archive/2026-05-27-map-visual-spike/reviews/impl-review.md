<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Map Visual Spike (F-02)

- **Plan**: context/changes/map-visual-spike/plan.md
- **Scope**: Phases 1–3 of 4 (Phase 4 `findings.md` pending)
- **Date**: 2026-05-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS (astro check 0 errors, build complete, lint clean) |

## Findings

### F1 — Per-operand multi-handle contract replaced by floating-edge architecture

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence / Architecture
- **Location**: src/components/spike/ConnectiveNode.tsx, src/components/spike/exampleMap.ts, src/components/spike/RelationEdge.tsx + floatingEdgeUtils.ts
- **Detail**: Plan made per-operand handle ids (`in-0`/`in-1`) a hard React Flow contract; impl uses a single `in` handle (no `inputs` prop), edges set no `targetHandle`/`sourceHandle`, and an unplanned `floatingEdgeUtils.ts` routes operands to the nearest node side. Renders correctly (manual 3.6 signed off) but S-01 inherits the floating-edge model, not the documented one.
- **Fix A ⭐ Recommended**: Keep the floating-edge approach; document it in findings.md.
  - Strength: Preserves working signed-off code; the deviation is itself a spike finding for S-01.
  - Tradeoff: plan.md and shipped architecture diverge unless annotated.
  - Confidence: HIGH — render verified.
  - Blind spot: Whether floating geometry scales to denser graphs (S-01 concern).
- **Fix B**: Revert to planned per-operand multi-handle model.
  - Strength: Matches the contract S-01 expects to inherit.
  - Tradeoff: Reworks signed-off disposable code for no visual gain.
  - Confidence: MEDIUM — handle spacing never actually rendered.
  - Blind spot: Multi-handle spacing untested here.
- **Decision**: FIXED via Fix A — keep floating-edge approach, capture in Phase 4 findings.md (queued in follow-ups/review-fixes.md)

### F2 — Orphaned dead code: demoData.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/spike/demoData.ts
- **Detail**: A second, larger argument-map dataset (~17 statements + renewable-energy branch) imported by nothing; canvas wires exampleMap.ts. Superseded leftover.
- **Fix**: Delete src/components/spike/demoData.ts.
- **Decision**: SKIPPED

### F3 — Role accents deviate from the --chart-* ramp the plan specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/spike/mapVisualLanguage.ts
- **Detail**: Plan said role accents come from `--chart-1`…`--chart-5`; impl uses `--primary`/`--destructive`/`--muted-foreground` for several roles (chart-1/chart-4 unused). The hard no-raw-hex/oklch rule IS honored — palette-mapping deviation only.
- **Fix**: Note the ramp choice in findings.md (signed off at manual 2.4).
- **Decision**: SKIPPED — note in Phase 4 findings.md (queued)

### F4 — Canvas wires onNodesChange/onEdgesChange despite "static, no handlers"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/spike/MapSpikeCanvas.tsx
- **Detail**: Plan said no change handlers; impl uses controlled useNodesState/useEdgesState + onNodesChange/onEdgesChange. Benign — only persists drag position (a planned interaction); no edit/connect/delete wired.
- **Fix**: None needed — drag persistence is intended.
- **Decision**: ACCEPTED — intended behavior

### F5 — Legend is a slide-out drawer; one raw rgba() literal

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline / Pattern Consistency
- **Location**: src/components/spike/MapLegend.tsx:69
- **Detail**: Plan said Panel/overlay; impl is a richer interactive slide-out drawer (within the overlay contract). Reads from mapVisualLanguage.ts (no duplicated styling). One cosmetic `drop-shadow(... rgba(0,0,0,0.12))` is the only non-token color.
- **Fix**: Tokenize the shadow only if the legend graduates beyond the spike.
- **Decision**: ACCEPTED — spike-appropriate

### F6 — Unused export getFloatingTargetParams

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/spike/floatingEdgeUtils.ts:59
- **Detail**: Exported but never imported; sibling helpers are used by RelationEdge. Harmless dead export.
- **Fix**: Delete the unused export.
- **Decision**: ACCEPTED — left as-is

### F7 — StatementNode handle direction inverted vs plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/spike/StatementNode.tsx
- **Detail**: Plan said top target / bottom source; impl is source=Top, target=Bottom — intentional and internally consistent with bottom-up support flow. Adds an EXTRA `url?` field for source citations (benign).
- **Fix**: None — inversion is correct for the layout direction.
- **Decision**: ACCEPTED — intentional
