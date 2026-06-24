# Publishable Debate Showcase (S-09) — Plan Brief

> Full plan: `context/changes/publishable-debate-showcase/plan.md`
> Research: `context/changes/publishable-debate-showcase/research.md`

## What & Why

Let an advocate **publish** a completed debate (one whose divergence summary exists), making its map and
divergence summary readable by anyone — logged in or not — at a public, read-only URL. The goal is
market feedback: let newcomers view a real structured exchange before signing up (roadmap S-09, Stream
D landing/onboarding).

## Starting Point

Greenfield — no publish/showcase/`public` code exists. The debate graph is a flat star (every child
table FKs straight to `debates`), the divergence summary is computed at read time (no summary table),
the `MapEditor` canvas already freezes via existing props, and the publishable precondition already
exists as code (`getDivergenceSummary(...) !== null`). Current RLS is authenticated-only; anon sees
nothing. The landing page has no live-debate embed yet.

## Desired End State

Advocates get a Publish/Unpublish toggle on their completed debates that surfaces a copyable
`/showcase/[id]` link. Anyone — logged out included — can browse `/showcase` (a list of published
debates) and open `/showcase/[id]` to see the real map, frozen and interactive (pan/zoom only), with
marks and the divergence summary. The landing page links to `/showcase`. An anonymous client can read
**only** rows from `public = true` debates — proven leak-free at the DB layer.

## Key Decisions Made

| Decision               | Choice                                                         | Why (1 sentence)                                                                                                      | Source   |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Column shape           | `public boolean` + `published_at timestamptz`                  | RLS reads the cheap boolean; `published_at` is audit/sort, written atomically together                                | Research |
| Anon RLS predicate     | `is_public_debate(uuid)` SECURITY DEFINER granted to `anon`    | One predicate across four child tables → no copy-paste drift (drift = the IDOR)                                       | Research |
| Publish lifecycle      | Toggle (publish + unpublish) via PATCH `{ public }`            | Publishing exposes the challenger's content with no consent in MVP, so pulling back must be possible                  | Research |
| Summary delivery       | Server-fetch as `initialSummary` prop                          | Keeps the anon read surface to one path (the page) — fewer surfaces to leak-test                                      | Research |
| Publishable gate       | Reuse `getDivergenceSummary(...) !== null`                     | Publishability and summary-availability can never drift                                                               | Research |
| Landing demo           | Link to a new `/showcase` index listing published debates      | Scales to many topics; no MapEditor coupling on the landing page                                                      | Plan     |
| Publish UX             | Toggle on the debate page that reveals a copyable showcase URL | Advocate publishes in-context and gets the shareable link immediately                                                 | Plan     |
| Risk #1 test layer     | DB-level integration with an anon-scoped client                | Tests the RLS boundary where the IDOR actually lives, table by table                                                  | Plan     |
| Unpublish friction     | One-click toggle, no confirm                                   | Unpublish removes exposure (the safe direction) and is instantly reversible                                           | Plan     |
| Anon `profiles` access | Sixth anon policy gated on `is_public_debate_participant`      | `getDebateExchange` resolves usernames from `profiles`; anon needs them, so expose only published-debate participants | Impl     |

## Scope

**In scope:** `public`/`published_at` columns; `is_public_debate` + `is_public_debate_participant`
helpers; anon SELECT RLS on all five graph tables **plus `profiles`** (participants of published
debates only); DB-level leak tests; `setDebatePublished`/`isPublishable`/`listPublicDebates` repository
fns; PATCH `{ public }` branch; publish/unpublish toggle UI with copyable URL; `/showcase` index +
`/showcase/[id]` detail (frozen map + summary); `DivergenceSummary` `initialSummary` prop; landing CTA.

**Out of scope:** challenger consent flow; recorded/video asset; admin/RBAC; new summary/statements
table; Playwright E2E; publish-consent or unpublish-confirm modals; the Cloudflare deploy blocker.

## Architecture / Approach

Build the security boundary first. **Phase 1** lands the migration (columns + `is_public_debate` helper

- additive `for select to anon` policies gated on `public = true`) and DB-level integration tests that
  prove an unpublished debate yields zero anon rows across all five tables. **Phase 2** adds the advocate
  path: repository mutation/check/list, the PATCH `{ public }` branch (409 if not round-complete), and the
  toggle UI. **Phase 3** adds the anon read pages, which simply consume the now-anon-reachable repository
  functions (never inline `supabase.from()`), plus the landing CTA. The frozen board is `MapEditor` with
  `canEdit={false}` + `viewer={null}` — no new client code.

## Phases at a Glance

| Phase                        | What it delivers                                      | Key risk                                                           |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Data layer & anon RLS     | Columns, helper, anon policies, leak tests            | IDOR/RLS leak (test-plan Risk #1) — predicate drift across tables  |
| 2. Publish primitive         | Repository fns, PATCH `{ public }`, toggle UI         | Publishing a non-publishable debate; owner-only scoping            |
| 3. Public showcase read path | `/showcase` index + detail, summary prop, landing CTA | Forgetting to load marks server-side; route accidentally protected |

**Prerequisites:** S-04 (done). Confirm `20260612000001_rename_agree_to_accept.sql` is applied in the
target env (summary output depends on the `accept` enum value).
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- **Risk #1 (IDOR/leak)** is the dominant risk: every table must share the exact `public = true`
  predicate; `exchanges` is the easy-to-forget one (its omission silently 404s the summary), and
  `profiles` is the easy-to-miss sixth surface (`getDebateExchange` reads usernames; anon 500s without
  a scoped policy).
- `is_public_debate` must `grant execute to anon` — the inverse of the existing helper convention.
- The Cloudflare deploy blocker (Open Roadmap Q4) gates any real public deploy — not solved here.

## Success Criteria (Summary)

- An advocate can publish a completed debate and share a working `/showcase/[id]` URL; unpublish pulls
  it back in one click.
- A logged-out visitor browses `/showcase`, opens a published debate, and sees the frozen interactive
  map + divergence summary; an unpublished/unknown id 404s.
- An anonymous client reads only `public = true` rows — zero rows from any unpublished debate across all
  five tables (proven by DB-level tests).
