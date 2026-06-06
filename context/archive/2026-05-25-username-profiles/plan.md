# Username-attributed accounts (F-01) Implementation Plan

## Overview

Add a unique username to every account, captured at registration and enforced at the data layer, plus a server-side primitive to resolve a user by username. This is foundation F-01 — it unblocks S-02's invite-by-username search and provides the attribution identity used on statements and invites throughout the app. It also introduces the project's **first database migration** and the `profiles` model the rest of the schema will hang off.

## Current State Analysis

- **Auth works; usernames don't exist.** Email/password signup is implemented: `src/pages/api/auth/signup.ts:13` calls `supabase.auth.signUp({ email, password })`, and `src/components/auth/SignUpForm.tsx` collects email/password/confirm only. Sign-in (`src/pages/api/auth/signin.ts`) and signout exist; middleware (`src/middleware.ts`) loads `context.locals.user` and gates `PROTECTED_ROUTES`.
- **No data layer.** `supabase/config.toml` is present but there is no `supabase/migrations/` directory and no tables beyond Supabase Auth's built-in `auth.users`. This change creates the first migration.
- **Supabase client** is created server-side in `src/lib/supabase.ts` via `@supabase/ssr` `createServerClient`, returning `null` when env is unconfigured. Callers already null-check it.
- **Env**: `SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets declared in `astro.config.mjs` (`env.schema`, `access: "secret"`). Only the anon key is available — no service-role key is wired.
- **Runtime**: Cloudflare Workers — Web APIs only, no Node built-ins.
- **OAuth** is named in FR-001 but not implemented; only email/password exists today.

### Key Discoveries:

- The Supabase anon key + RLS is the only access path from the app; there is no service-role/admin client. Profile creation therefore cannot be an admin insert — it must happen inside the auth transaction (trigger) so it works under the user's own (pre-auth) context.
- `supabase.auth.signUp` accepts `options.data`, which lands in `auth.users.raw_user_meta_data` — the channel for passing username to a DB trigger.
- A trigger that raises on a duplicate/invalid username aborts the `auth.users` insert transaction, so a failed username yields **no orphaned account** — this is the atomicity guarantee the roadmap demands ("enforce at the data layer, not just the form").
- `src/env.d.ts` types only `App.Locals.user`. There is no generated DB types file yet; one should be introduced for type-safe `profiles` access.

## Desired End State

A new user signing up must provide a username (3–30 chars, `[a-z0-9_]`, case-insensitive-unique). On success an account and a matching `profiles` row exist atomically; on a taken username the signup is rejected with a friendly message and no account is created. Any authenticated server code can call a helper to resolve a user by exact username. Verified by: a clean `supabase db reset` applying the migration, signup creating a profile row, a duplicate-username signup being rejected, and the lookup helper returning the right `user_id` for a known username.

## What We're NOT Doing

- **No OAuth provider** wired in this slice (FR-001's OAuth path is deferred; the trigger is designed so OAuth can supply a username via metadata later).
- **No username editing/rename** — usernames are fixed after registration in MVP.
- **No invite-search UI** — that is S-02. F-01 ships only the server-side lookup primitive.
- **No email-based lookup** — invite search is username-only per FR-009 (email search was removed as unsafe: it leaks whether an arbitrary email is registered and the username tied to it).
- **No profile page, avatars, display names, or any profile fields beyond `username`.**
- **No backfill tooling** for pre-existing accounts (local dev `auth.users` is effectively empty; a fresh `db reset` is the baseline).

## Implementation Approach

Three phases, data-layer-first. Phase 1 lands the schema, RLS, and the `handle_new_user` trigger as one migration and regenerates DB types. Phase 2 threads the username through the existing signup form and route, relying on the DB constraint as the uniqueness authority and mapping its error to friendly copy. Phase 3 adds a thin, tested server helper for username resolution. The DB constraint — not application code — is the source of truth for uniqueness; the form and route do cheap format validation only.

## Critical Implementation Details

- **Trigger must be `SECURITY DEFINER` with a pinned `search_path`.** It runs during the auth insert and writes to a table in a schema the signing-up role cannot otherwise touch; an unpinned `search_path` is a known Supabase security footgun.
- **Case-insensitive uniqueness** is enforced via a unique index on `lower(username)` (preferred over enabling the `citext` extension — fewer moving parts, no extension dependency on the Cloudflare/edge path). Charset/length live in a `CHECK` constraint so they hold regardless of entry point (form, OAuth-later, direct SQL).
- **Username travels through `auth.users.raw_user_meta_data`** via `signUp({ options: { data: { username } } })`; the trigger reads `new.raw_user_meta_data->>'username'`. If the key is missing or fails the CHECK/unique constraint, the insert raises and the whole signup transaction rolls back.

## Phase 1: Data layer — profiles table, RLS, and creation trigger

### Overview

Create the first migration: a `profiles` table, RLS policies, and a trigger that materializes a profile from auth metadata atomically with account creation. Regenerate DB types for type-safe access.

### Changes Required:

#### 1. profiles migration

**File**: `supabase/migrations/<timestamp>_create_profiles.sql` (new; create via `npx supabase migration new create_profiles`)

**Intent**: Define the `profiles` table keyed to `auth.users`, enforce username format and case-insensitive uniqueness at the data layer, and turn on RLS. This is the schema foundation every later slice attributes to.

**Contract**:
- Table `public.profiles`: `id uuid primary key references auth.users(id) on delete cascade`, `username text not null`, `created_at timestamptz not null default now()`.
- `CHECK (username ~ '^[a-z0-9_]{3,30}$')` — charset + length, lowercase only.
- `CREATE UNIQUE INDEX profiles_username_lower_key ON public.profiles (lower(username));` — case-insensitive uniqueness authority.
- `ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;`

#### 2. RLS policies

**File**: same migration file

**Intent**: Allow each user to read/insert their own profile, and allow any authenticated user to read profiles for username lookup (S-02 invite search). No update/delete policies (usernames are immutable in MVP; cascade handles deletion).

**Contract**:
- SELECT policy `profiles_select_authenticated`: `to authenticated using (true)` — authenticated users can look up any profile by exact username (needed for invite search). (Acceptable: profiles hold only a public-handle username, no private data.)
- INSERT policy `profiles_insert_self`: `to authenticated with check (id = auth.uid())` — defensive; the trigger path is `SECURITY DEFINER` and bypasses RLS, but this keeps any direct insert honest.

#### 3. handle_new_user trigger

**File**: same migration file

**Intent**: On `auth.users` insert, create the matching profile from the username supplied in signup metadata, inside the same transaction so account and profile are atomic.

**Contract**: a `SECURITY DEFINER` function with `set search_path = ''` (fully-qualify `public.profiles`), plus an `after insert on auth.users for each row` trigger.

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

(A null/invalid/duplicate username makes the `insert` raise — `CHECK`/unique violation — which aborts the `auth.users` insert. No orphaned account results.)

#### 4. Generated DB types

**File**: `src/db/database.types.ts` (new) and a typed client accessor

**Intent**: Provide type-safe access to `profiles`. Generate types from the local schema and parameterize the Supabase client with them so callers get typed rows.

**Contract**: `database.types.ts` generated via `npx supabase gen types typescript --local`. `createClient` in `src/lib/supabase.ts` becomes `createServerClient<Database>(...)`. No behavioral change to the client.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly on a fresh DB: `npx supabase db reset`
- [ ] Type generation succeeds and compiles: `npx supabase gen types typescript --local > src/db/database.types.ts && npx astro sync`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] In Studio (`http://localhost:54323`), inserting a row into `auth.users` (or signing up) creates a matching `profiles` row; a second insert with the same username (any case) fails with a unique-violation; a username with uppercase/spaces/<3 chars fails the CHECK.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Capture username at signup

### Overview

Add the username field to the signup form and route, thread it through `signUp` metadata, validate format server-side, and surface a friendly "username taken" message on the unique-violation path.

### Changes Required:

#### 1. SignUpForm username field

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Add a required username input with client-side format validation mirroring the DB CHECK, so users get immediate feedback. Client validation is UX only — never the authority.

**Contract**: new `username` state + `FormField` (name `username`), validated against `/^[a-z0-9_]{3,30}$/` in the existing `validate()` flow; error wired into the existing `errors` object. Field posts with the existing form (`action="/api/auth/signup"`).

#### 2. signup route threads username

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Read `username` from the form, re-validate format server-side (defense in depth), pass it via `signUp` metadata, and translate a uniqueness/constraint failure into a friendly redirect message.

**Contract**: `form.get("username")`; reject malformed input with a redirect carrying an error param before calling Supabase; call `supabase.auth.signUp({ email, password, options: { data: { username } } })`; on error, map unique/constraint violations to `"That username is taken"` (and keep the generic message otherwise) in the existing `?error=` redirect.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build`

#### Manual Verification:

- [ ] Signing up with a fresh username creates the account and a `profiles` row; the username shows in Studio.
- [ ] Submitting a taken username (differing only in case) shows "That username is taken" and creates no account.
- [ ] Submitting an invalid username (spaces, uppercase, <3 chars) is blocked client-side, and blocked server-side if client validation is bypassed.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Lookup-by-username primitive

### Overview

A reusable server-side helper that resolves a user by exact username, backed by the Phase-1 RLS read policy. No UI — this is the primitive S-02 consumes.

### Changes Required:

#### 1. user lookup helper

**File**: `src/lib/users.ts` (new)

**Intent**: Given a username and an authenticated Supabase client, return the matching user's `{ id, username }` (or null). Username matches case-insensitively against `profiles`.

**Contract**: `findUserByUsername(supabase, username): Promise<{ id: string; username: string } | null>` querying `profiles` with `.ilike("username", username)` (exact, not pattern) or an equivalent `lower()`-based filter. Lookup is username-only by design — email-based search was removed from FR-009 as unsafe (it leaks account existence and the username tied to an arbitrary email).

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build`
- [ ] Type checking passes: `npx astro sync` (no type errors against generated `Database` types)

#### Manual Verification:

- [ ] Calling `findUserByUsername` with a known username (varying case) returns the correct `user_id`; an unknown username returns null.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Manual Testing Steps:

1. `npx supabase db reset`, then sign up with username `alice` → confirm `profiles` row exists with `id = auth.users.id`.
2. Sign up again with `ALICE` / `Alice` → rejected as taken; no account created.
3. Sign up with `ab` or `bad name` → blocked by validation (client and server).
4. Resolve `alice` via `findUserByUsername` → returns the right id; resolve `nobody` → null.

## Migration Notes

- This is the first migration in the repo; `supabase/migrations/` will be created. No existing production data to backfill — the local stack is reset-based.
- The `lower(username)` unique index (not the `citext` extension) is the deliberate choice to avoid an extension dependency on the edge runtime path.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01)
- PRD: `context/foundation/prd.md` (FR-001, FR-002, Access Control)
- Existing signup: `src/pages/api/auth/signup.ts`, `src/components/auth/SignUpForm.tsx`
- Supabase client: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — profiles table, RLS, and creation trigger

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh DB (`npx supabase db reset`) — 27bc9d8
- [x] 1.2 Type generation succeeds and compiles (`gen types` + `astro sync`) — 27bc9d8
- [x] 1.3 Linting passes (`npm run lint`) — 27bc9d8
- [x] 1.4 Build passes (`npm run build`) — 27bc9d8

#### Manual

- [x] 1.5 Studio: profile auto-created on user insert; case-insensitive duplicate and invalid-format usernames rejected — 27bc9d8

### Phase 2: Capture username at signup

#### Automated

- [x] 2.1 Linting passes (`npm run lint`) — 3c6d17b
- [x] 2.2 Build passes (`npm run build`) — 3c6d17b

#### Manual

- [x] 2.3 Fresh-username signup creates account + profile row — 3c6d17b
- [x] 2.4 Taken username (case-differing) shows friendly error, no account — 3c6d17b
- [x] 2.5 Invalid username blocked client- and server-side — 3c6d17b

### Phase 3: Lookup-by-username primitive

#### Automated

- [x] 3.1 Linting passes (`npm run lint`) — f479929
- [x] 3.2 Build passes (`npm run build`) — f479929
- [x] 3.3 Type checking passes (`npx astro sync`) — f479929

#### Manual

- [x] 3.4 `findUserByUsername` returns correct id for known username (case-varying); null for unknown — f479929
