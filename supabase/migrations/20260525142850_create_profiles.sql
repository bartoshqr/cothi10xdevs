-- profiles: one row per account, keyed to auth.users, carrying a unique username.
-- This is the project's first migration and the attribution identity (F-01).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,30}$')
);

-- Case-insensitive uniqueness authority (preferred over the citext extension).
create unique index profiles_username_lower_key on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- profiles is read-only to signed-in users (S-02 username lookup); logged-out
-- users should not even discover the table, so drop the default anon SELECT grant.
revoke select on public.profiles from anon;

-- Authenticated users can read any profile (username lookup for invite search, S-02).
-- Profiles hold only a public-handle username, no private data.
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

-- Defensive: the trigger path is SECURITY DEFINER and bypasses RLS, but this
-- keeps any direct insert honest. (select auth.uid()) is evaluated once, not per row.
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- Materialize a profile from signup metadata atomically with account creation.
-- A null/invalid/duplicate username makes the insert raise, aborting the
-- auth.users insert transaction so no orphaned account results.
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

-- The trigger fires this function internally regardless of EXECUTE grants, so
-- revoke API/RPC access — a SECURITY DEFINER function must not be callable via
-- /rest/v1/rpc by anon or authenticated.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
