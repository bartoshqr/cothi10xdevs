---
change_id: publishable-debate-showcase
title: Publish a completed debate to a public read-only showcase URL
status: impl_reviewed
created: 2026-06-20
updated: 2026-06-24
archived_at: null
---

## Notes

Roadmap **S-09** (Stream D, landing/onboarding). Goal: make WVMap attractive to newcomers
by letting them view a real structured exchange before signing up. Supports
`main_goal: market-feedback`.

**Outcome:** the advocate can **publish** a debate whose round is complete (a divergence
summary exists), making its map **and** divergence summary readable by anyone — logged in or
not — at a public, read-only URL. The landing page features one published debate as a live,
interactive demo.

**Two pieces of work:**

1. Publish primitive — a `public` boolean / `published_at` on `debates` + a publish button. Small.
2. Public read path (the meaty part) — a new route (e.g. `/showcase/[id]`) deliberately kept
   **out** of `PROTECTED_ROUTES`, a read-only canvas (reuse the map component in a frozen mode —
   precedent: S-05 final-round "content controls frozen"), and anon `SELECT` RLS policies gated
   on `debates.public = true` across **every** graph table (debates, statements, relations,
   marks, exchange, summary).

**Scope decisions (shaping 2026-06-20):**

- Asset form = interactive read-only map, **not** a recorded/Playwright video (no staleness pipeline).
- Publish authority = **advocate-only, no challenger consent** in MVP — accepted because the launch
  showcase is authored by two accounts the team controls. Publishing exposes the challenger's
  statements too; general-user consent is **deferred** to a later slice.
- Publishable precondition = round complete (summary present). In-progress/private exchanges can't publish.
- Showcase content = two ordinary accounts the team owns (e.g. `wvmap-advocate` / `wvmap-challenger`)
  run a real climate debate end-to-end, then publish it. **No admin role / RBAC.** Feature is
  content-agnostic — more topics later = publish more debates, zero new code.
- Launch content = one climate debate (v1).

**Prereq:** S-04 (done). Does **not** depend on S-08 (close).

**Top risk:** intersects test-plan **Risk #1** (private pair content leaking / IDOR / RLS gap). The
anon read path must expose **only** rows reachable from a `public = true` debate — integration tests
must prove an **un**published debate is not anon-readable through any table.

**Watch (not in scope here):** Open Roadmap Q4 — the Cloudflare deploy blocker gates any
public-facing deploy; a public showcase is the first surface strangers must reach.
