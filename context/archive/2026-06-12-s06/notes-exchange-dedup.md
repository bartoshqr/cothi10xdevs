# Exchange deduplication note

## Context

While reviewing the `exchangeByDebate` deduplication loop in the debate list query, a question arose: can a single debate have multiple `completed` or `open` exchanges?

## What the DB enforces

- **One open exchange at most** — `exchanges_one_open_per_debate` is a partial unique index on `(debate_id) WHERE status IN ('pending', 'accepted')`. Two open rows for the same debate are physically impossible.
- **No constraint on `completed`** — `completed` is outside the partial index, so multiple completed rows per debate are technically allowed at the schema level.

## What the UI enforces

There is currently **no UI path to re-invite or start a new exchange after an exchange completes**. Once an exchange reaches `completed`, the advocate cannot send a new invite for that debate. This means:

- At most one `completed` row per debate will ever exist in practice.
- The "prefer newer completed" branch in the dedup loop is **dead code** given current product scope.

## Implication for the dedup loop

The full loop effectively reduces to: _pick the one non-declined exchange for this debate, if any._ The `exchangeByDebate` map will never see two rows competing for the same `debate_id` under normal operation.

## If S-08 or a future slice adds re-invite

S-08 (advocate-close-and-timeout) adds an explicit close path but still does not add a re-invite flow. If a future slice ever allows the advocate to re-invite after close/complete, the "prefer newer completed" branch would become load-bearing. At that point the dedup logic is already correct — no change needed, just remove this note.
