-- Pre-flight username availability check for the signup form.
-- SECURITY DEFINER so the pre-auth (anon) caller can probe uniqueness without a
-- direct SELECT on profiles (anon has no read grant). Returns only a boolean —
-- no row data — and usernames are public handles by design (S-02 invite search),
-- so "is this taken" is not a leak. The unique index remains the race-proof
-- authority; this only improves the common-case UX message.
create function public.username_available(check_username text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(check_username)
  );
$$;

-- Callable pre-auth and post-auth; revoke from public to keep the surface explicit.
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
