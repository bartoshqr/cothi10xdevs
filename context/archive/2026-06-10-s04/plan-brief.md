# S-04 `first-divergence-summary` — Plan Brief

> Full plan: `context/changes/s04/plan.md`
> Research: `context/changes/s04/research.md`

## What & Why

S-04 is the product's **north star** — the smallest end-to-end slice that proves the core hypothesis (a structured exchange surfaces the crux). The advocate marks every challenger statement, adds their own nodes/relations, submits to **complete round 1**, and either party triggers the **deterministic divergence summary** (common ground / open divergences / unresolved), private to the pair.

## Starting Point

S-03 shipped a deliberately symmetric turn machine: the advocate's DB + RLS layer already works (actor-neutral `submit_turn`, the `can_write_as_current_actor` write gate). What's missing is the round-close behavior, a terminal status, the un-stubbed advocate frontend, and the entire (greenfield) summary feature — `src/lib/` has no `summary/`.

## Desired End State

The advocate can run a real turn from `TurnBar` and submit. The submit advances the round mid-exchange and **completes** the exchange on the final round. After ≥1 complete round, either party opens a read-only divergence-summary panel on the debate page: counterpart-Agreed statements as common ground, counterpart-Challenged as open divergences (tagged factual vs values gap), counterpart-Abstained-or-unmarked as unresolved.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| "Common ground" semantics | Single counterpart mark | A node is markable only by its counterpart (never twice), so "mutual" = graph-wide symmetry, not a per-node handshake. | Plan |
| Rebuttal gap label | Values / premise gap | PRD omits rebuttal; user chose to treat it like warrant/claim. | Plan |
| Summary placement | Pure TS fn + repository read | Unit-testable classifier; RLS-scoped read inherits pair privacy free; matches the repository-only lesson. | Research/Plan |
| Round-complete detection | `status='completed' OR current_round >= 2` | `current_round >= 2` alone fails (and the increment breaks the check constraint) for `round_count=1` — a `completed` status is required. | Plan |
| Write-immutability on close | Defer to S-05 | `completed` is purely the summary-gate signal; FR-019/FR-027 immutability stays S-05. | Plan |
| Unmarked counterpart statements | Default to unresolved | Advocate's just-added statements are unmarked until S-05's mini-turn; default keeps the summary complete and forward-compatible with FR-019. | Plan |
| Two-marker store refactor | Not needed | Marks are disjoint per node, so `node_id → stance` stays unambiguous (resolves a research concern). | Plan |
| Child-debate inclusion | Out of scope | Parent linking is S-07, not built. | Plan |
| Summary UX | Inline panel + button | Keeps the user in the debate context; no new route / `PROTECTED_ROUTES` change. | Plan |
| Testing | Unit (classifier) + integration (advocate turn + gate) | E2E is Test-plan Phase 5; out of scope. | Plan |

## Scope

**In scope:** advocate `submit_turn` round-close + `completed` status; read-scope widening; un-stub `computeTurnGate` + `TurnBar` advocate branch; pure `classifyDivergence`; summary repository read with the gate; `GET /api/debates/[id]/summary`; read-only summary panel; `deriveViewer` handling of `completed`.

**Out of scope:** write-immutability / close machinery / final-round mini-turn (S-05); mark invalidation (S-05); `marker_id` store refactor; child-debate inclusion (S-07); a dedicated `/summary` route; E2E.

## Architecture / Approach

DB-first. The summary gate depends on the round-close behavior, so Phase 1 ships the `submit_turn` change + the `completed` enum value + the read-side status-predicate widening together (the sequencing pin). Phase 2 un-stubs the advocate frontend (the cross-island gate plumbing already exists). Phases 3–5 build the summary bottom-up: pure classifier → RLS-scoped repository read (enforces `status='completed' OR current_round >= 2`) → `withAuth` endpoint → read-only React panel.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB round close | `submit_turn` increments/completes; `completed` status; reads widened; types regen | Cross-cutting RLS status-predicate audit (read vs write split) |
| 2. Advocate turn | Generalized `computeTurnGate` + live `TurnBar` advocate submit | Mostly un-stubbing; completed-state display |
| 3. Summary algorithm | Pure `classifyDivergence` + gated repository read | Oracle correctness (exhaustive unit tests) |
| 4. Summary endpoint | `GET /api/debates/[id]/summary` | Gate + 404/409 contract |
| 5. Summary UI | Button + read-only panel; `deriveViewer` handles `completed` | Rendering only; build/typecheck |

**Prerequisites:** S-03 (done); local Supabase stack running; integration env configured.
**Estimated effort:** ~2–3 sessions across 5 phases.

## Open Risks & Assumptions

- `ALTER TYPE ... ADD VALUE 'completed'` may need to be committed before first use — keep it at the top of the migration or split the file if `supabase db reset` errors.
- Deferring write-immutability leaves a small gap: a `completed` exchange still permits writes via `can_write_as_current_actor` until S-05. Intentional, documented.
- The read-scope widening must touch **every** `status='accepted'` read predicate; missing one would hide the summary from the challenger after a 1-round completion.

## Success Criteria (Summary)

- The advocate completes round 1 (or a 1-round exchange) and the exchange state advances/completes correctly.
- Either party views a deterministic, correctly-bucketed divergence summary after ≥1 complete round, read-only and private to the pair.
- Unit tests pin the classifier oracle; integration tests pin the round-close + summary gate.
