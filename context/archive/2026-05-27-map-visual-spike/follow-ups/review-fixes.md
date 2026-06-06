# Review follow-ups — map-visual-spike

From impl-review (2026-05-27). To fold into Phase 4 `findings.md`:

- [ ] **F1** — Document the floating-edge architecture as a spike finding: ConnectiveNode uses a single `in` handle + `floatingEdgeUtils.ts` (operands route to nearest node side) instead of the planned per-operand `in-0`/`in-1` multi-handles. Note this is what S-01 would inherit, and flag the open question of whether floating geometry scales to denser graphs.
- [ ] **F3** — Note the role-accent palette choice: roles map to `--primary`/`--destructive`/`--muted-foreground` + a subset of `--chart-*` rather than the full `--chart-1`…`--chart-5` ramp the plan named. Hard token rule (no raw hex/oklch) is honored; this is a steer for S-01 on whether a categorical ramp is preferred.
