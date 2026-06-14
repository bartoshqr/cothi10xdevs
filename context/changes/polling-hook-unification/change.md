---
change_id: polling-hook-unification
title: Unify visibility-gated polling into one reusable hook
status: planned
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

Roadmap T-01 (cleanup / tech-debt slice, below S-08). The visibility-gated polling
lifecycle — start/stop the timer, pause when the tab is hidden, fetch immediately on
focus/visibility return, tear down listeners on unmount — is hand-copied across four
components: `AdvocateSection`, `ChallengerSection`, `InviteChallenger`, `MapEditor`.
~30 lines of identical scaffold per site.

Layer 1 (primary): extract `useVisibilityPolling(check, { intervalMs, enabled, immediate })`.
Varying knobs are interval (1000ms vs 15000ms), the `check` body, immediate-on-mount, and
the enable condition. Replace the per-site `stopped` flag with an `AbortSignal` (or
`isMounted` getter) passed into `check`, so each body checks `signal.aborted`. Store `check`
in a ref inside the hook so a fresh closure each render doesn't rebuild the timer.

Layer 2 (optional, decide separately): `AdvocateSection` + `ChallengerSection` both poll
`/api/debates` every 15s independently on the same page — two timers for identical data.
Optionally a shared `useDebateList()` (one timer, two consumers). Changes data flow, so
separate go/no-go from Layer 1.

No user-visible behaviour change. Success = identical runtime behaviour, duplication removed,
same tests green. Prerequisite cleanup for the future Supabase Realtime upgrade (S-06
Technical Notes) — once lifecycle is one hook, swapping polling for a `postgres_changes`
subscription is a single-site change.
