-- S-09 publishable-debate-showcase, Phase 1: publish primitive + anon read path.
--
-- Makes a debate publishable and, when published, readable by the anonymous
-- (logged-out) PostgREST role across the whole flat-star graph. The security
-- invariant (test-plan Risk #1 / IDOR): an anon client may read ONLY rows
-- reachable from a `public = true` debate; an unpublished debate leaks nothing
-- on any of the five tables.
--
-- Contents:
--   1. Columns on debates: public (cheap RLS boolean) + published_at (audit/sort).
--   2. is_public_debate(uuid): SECURITY DEFINER predicate shared across the four
--      child tables so the gate cannot drift (a drift IS the IDOR). This helper is
--      the EXCEPTION to the repo convention — it GRANTS execute to anon, where
--      is_debate_owner / is_accepted_challenger REVOKE it.
--   3. Re-grant table-level SELECT to anon on all five tables (the base migrations
--      revoked it; without the grant a `for select to anon` policy is inert).
--   4. Five additive `for select to anon` policies. RLS policies are OR'd per role,
--      so the existing `to authenticated` owner/challenger policies are untouched.
--
-- Additive + reversible: new nullable/defaulted columns, a new helper, and new
-- anon-only policies. No data backfill; existing debates default to public=false
-- (private), so nothing becomes public implicitly.

-- ─── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.debates
  add column public       boolean     not null default false,
  add column published_at timestamptz null;

-- ─── 2. is_public_debate helper ───────────────────────────────────────────────
-- SECURITY DEFINER so the child-table anon policies never back-reference the
-- child table that called the helper (recursion-proof, 42P17). Reads `debates`
-- as the function owner. The `debates` anon policy itself stays a plain column
-- predicate (no subquery → no cycle), so it does NOT use this helper.

create function public.is_public_debate(p_debate_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as $$
    select exists (
      select 1 from public.debates d
      where d.id = p_debate_id and d.public = true
    )
  $$;

-- EXCEPTION to the helper convention: anon MUST be able to execute this.
revoke execute on function public.is_public_debate(uuid) from public;
grant  execute on function public.is_public_debate(uuid) to anon, authenticated;

-- ─── 3. Re-grant table-level SELECT to anon ───────────────────────────────────
-- The base migrations revoked SELECT from anon on every graph table. RLS needs
-- BOTH the table privilege AND a policy, so re-grant here; the policies below
-- still scope anon to public debates only.

grant select on public.debates   to anon;
grant select on public.nodes     to anon;
grant select on public.relations to anon;
grant select on public.exchanges to anon;
grant select on public.marks     to anon;

-- ─── 4. Anon SELECT policies (additive; one shared predicate) ─────────────────
-- debates: plain column predicate (no subquery → recursion-proof on its own).
create policy debates_select_anon on public.debates for select to anon
  using (public = true);

-- children: the shared SECURITY DEFINER predicate, gated by their own debate_id.
create policy nodes_select_anon on public.nodes for select to anon
  using (public.is_public_debate(debate_id));

create policy relations_select_anon on public.relations for select to anon
  using (public.is_public_debate(debate_id));

create policy marks_select_anon on public.marks for select to anon
  using (public.is_public_debate(debate_id));

-- exchanges: easy to forget — the summary gate reads status/current_round here.
-- Omitting it leaks nothing but silently 404s the summary on a published debate.
create policy exchanges_select_anon on public.exchanges for select to anon
  using (public.is_public_debate(debate_id));

-- ─── 5. profiles: expose the two participants' usernames on public debates ─────
-- getDebateExchange (used by getDivergenceSummary and the showcase detail page)
-- resolves advocate/challenger usernames from `profiles`. anon had SELECT revoked,
-- so the anon read path needs a sixth policy. Scope: a profile is anon-readable
-- only when that user is the advocate or challenger of a PUBLISHED debate's
-- exchange — usernames stay private for everyone else.
--
-- SECURITY DEFINER helper so the profiles policy does not trigger RLS-within-RLS
-- on exchanges/debates (and to keep the predicate in one place). Reads as owner;
-- references neither `profiles` nor any table whose policy references profiles, so
-- no 42P17 cycle.
create function public.is_public_debate_participant(p_user_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as $$
    select exists (
      select 1
      from public.exchanges e
      join public.debates d on d.id = e.debate_id
      where d.public = true
        and (e.advocate_id = p_user_id or e.challenger_id = p_user_id)
    )
  $$;

revoke execute on function public.is_public_debate_participant(uuid) from public;
grant  execute on function public.is_public_debate_participant(uuid) to anon, authenticated;

grant select on public.profiles to anon;

create policy profiles_select_anon on public.profiles for select to anon
  using (public.is_public_debate_participant(id));
