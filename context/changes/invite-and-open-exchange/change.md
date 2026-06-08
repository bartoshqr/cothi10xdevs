---
change_id: invite-and-open-exchange
title: Advocate invites a challenger and opens the exchange
status: planned
created: 2026-06-08
updated: 2026-06-08
archived_at: null
---

## Notes

Roadmap slice **S-02** (`context/foundation/roadmap.md`).

**Outcome:** advocate can initiate an exchange once a root Claim exists, set the round count (1–5, default 3), search for a registered user by username, and send an invite the challenger can accept or decline.

- **PRD refs:** US-01, FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** S-01 (advocate-map-builder, done), F-01 (username-profiles, done)
- **Parallel with:** S-07 (parent-debate-linking)
- **Risk:** Introduces the exchange + invite + round-config schema and the challenger-first/advocate-last turn ordering. The exchange-initiation gate (root Claim must exist) is the integrity boundary; get it wrong and thin maps reach challengers.
