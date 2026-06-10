---
change_id: challenger-first-turn
title: Challenger marks statements and submits first turn
status: plan_reviewed
created: 2026-06-09
updated: 2026-06-10
archived_at: null
---

## Notes

Roadmap S-03: Challenger audits the map and submits the first turn.

### Outcome
Challenger can mark every unmarked advocate statement (Agree/Challenge/Abstain), add their own typed statements with sources and directed relations, and submit their turn, which activates the advocate's turn.

### PRD References
US-02, FR-011, FR-012, FR-013, FR-014

### Prerequisites & Dependencies
- **Prerequisite:** S-02 (Open an exchange and invite a challenger)
- **Parallel with:** S-06 (Debate list and challenger inbox)

### UI Requirements
- Statements must display three-state marks (Agree / Challenge / Abstain) adjacent to each statement.
- Challenger-authored nodes must be visually distinct from advocate-authored nodes — use a different background shade (light red, light gray, or light blue) instead of white to signal ownership.

### Store/Schema Requirements
- Extend statement/node schema to track authorship (`authorId` or `authorRole: 'advocate' | 'challenger'`).
- Enforce editing restrictions: challenger can only add/edit their own statements and edges; cannot edit advocate statements/edges (can only mark them). Symmetrically, advocate cannot edit challenger statements in S-04.
- Persist mark state (Agree/Challenge/Abstain) per statement per user per turn.

### Key Risk
This adds the three-state mark schema and turn-submission gating (cannot submit until every advocate statement is marked). Correctness of the mark model matters more than UI polish — this is half the input to the summary algorithm. Ownership tracking and edit-permission checks must be enforced consistently to prevent data corruption across rounds.

### Unknowns
- Marking obligation is "every currently-unmarked statement" — confirm carry-over semantics are deferred to S-05 (multi-round) and round 1 simply requires marking all advocate statements.
