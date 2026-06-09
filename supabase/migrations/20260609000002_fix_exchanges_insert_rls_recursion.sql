-- S-02 fix: break RLS infinite recursion in exchanges_insert.
--
-- Root cause: exchanges_insert WITH CHECK queries public.debates (to verify
-- the advocate owns the debate), which triggers debates_select USING, which
-- queries public.exchanges (the widened challenger predicate), which brings
-- PostgreSQL back to the exchanges table while exchanges RLS is already being
-- evaluated for the INSERT — Postgres fires its cycle detector (42P17).
--
-- Fix: wrap the debate-ownership check in a SECURITY DEFINER function so it
-- reads public.debates as the function owner (postgres), bypassing debates_select
-- RLS entirely and breaking the cycle.  auth.uid() works correctly inside
-- security-definer functions because PostgREST sets request.jwt.claims as a
-- session-level setting that is unaffected by security context.
--
-- The SELECT read-membership predicates on debates/nodes/relations keep using
-- inline EXISTS — this change only touches the INSERT check on exchanges.

create function public.is_debate_owner(p_debate_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as $$
    select exists(
      select 1 from public.debates
      where id = p_debate_id and owner_id = (select auth.uid())
    )
  $$;

revoke execute on function public.is_debate_owner(uuid) from public, anon;
grant  execute on function public.is_debate_owner(uuid) to authenticated;

drop policy exchanges_insert on public.exchanges;

create policy exchanges_insert on public.exchanges for insert to authenticated
  with check (
    advocate_id = (select auth.uid())
    and public.is_debate_owner(debate_id)
  );
