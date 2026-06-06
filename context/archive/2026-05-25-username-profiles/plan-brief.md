# Username-attributed accounts (F-01) — Plan Brief

> Full plan: `context/changes/username-profiles/plan.md`

## What & Why

Every account needs a unique, human-readable username so challengers can be found by handle (S-02 invite search) and so statements/invites carry stable attribution. This is foundation F-01: small, no prerequisites, and it unblocks the whole exchange path. It also lands the project's first DB migration and the `profiles` model everything else builds on.

## Starting Point

Email/password auth works (`signUp`/`signIn`/middleware), but there is no username concept and no data layer at all — no migrations, no tables beyond Supabase's `auth.users`. The app talks to Supabase only through the anon key + RLS; there is no service-role/admin client.

## Desired End State

New signups must supply a username (3–30, `[a-z0-9_]`, case-insensitive-unique); a matching `profiles` row is created atomically with the account, and a taken username is rejected with no orphaned account. A tested server helper resolves a user by username, ready for S-02 to consume.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Profile creation | DB trigger from auth metadata | Atomic with account creation, no orphans, works for OAuth later | Plan |
| Lookup scope | Server query primitive only | Unblocks S-02 without pre-building its UI | Plan |
| Username rules | 3–30, `[a-z0-9_]`, case-insensitive | Mention/URL-safe, no `Bob`/`bob` confusion | Plan |
| OAuth | Email/password only in F-01 | OAuth has no username form; full path is a later slice | Plan |
| Mutability | Fixed after registration | Stable attribution; no rename/collision concerns in MVP | Plan |
| Uniqueness authority | DB unique index; route maps the error | Race-proof under concurrent signups | Plan |
| Case-insensitivity | `lower(username)` unique index (not `citext`) | No extension dependency on edge runtime | Plan |

## Scope

**In scope:** `profiles` table + RLS + `handle_new_user` trigger; username field on signup form/route; generated DB types; server-side `findUserByUsername` helper.

**Out of scope:** OAuth, username editing, invite-search UI, profile page/avatars/display names, email-based lookup, backfill tooling.

## Architecture / Approach

Data-layer-first. The DB constraint is the single source of truth for uniqueness; the form/route do cheap format validation only. Username flows `signUp(options.data)` → `auth.users.raw_user_meta_data` → `SECURITY DEFINER` trigger → `public.profiles`. A bad/duplicate username makes the trigger raise, rolling back the auth insert.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | profiles migration, RLS, trigger, DB types | Trigger/`search_path` + atomicity correctness |
| 2. Signup capture | username field + route metadata + friendly errors | Mapping the constraint error to clean UX |
| 3. Lookup primitive | tested `findUserByUsername` helper | Keeping lookup exact-match (no enumeration surface) |

**Prerequisites:** Local Supabase stack running (`npx supabase start`); Docker.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Invite search is username-only (FR-009 dropped email search as unsafe — it leaks account existence); F-01 ships no email-based lookup.
- Assumes a fresh `db reset` baseline — no pre-existing accounts to backfill.
- OAuth remains unbuilt; the trigger is designed to accept an OAuth-supplied username later.

## Success Criteria (Summary)

- A user signs up with a username and gets an account + `profiles` row atomically; a taken (case-insensitive) username is rejected with no account.
- Invalid usernames are blocked at both the form and the server.
- `findUserByUsername` returns the right user for a known handle and null otherwise.
