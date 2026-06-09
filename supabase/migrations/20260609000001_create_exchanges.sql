-- S-02: Introduce exchanges table, invite lifecycle, and widen RLS read
-- predicates so an invited challenger can read the debate graph while pending.
-- Write policies (insert/update/delete) on debates/nodes/relations stay
-- owner/author-scoped — challenger writes are S-03.

-- ─── Enums ────────────────────────────────────────────────────────────────────

create type public.exchange_status as enum ('pending', 'accepted', 'declined');
create type public.turn_actor      as enum ('challenger', 'advocate');

-- ─── exchanges table ──────────────────────────────────────────────────────────

create table public.exchanges (
  id            uuid                    primary key default gen_random_uuid(),
  debate_id     uuid                    not null references public.debates  on delete cascade,
  advocate_id   uuid                    not null references auth.users      on delete cascade,
  challenger_id uuid                    not null references auth.users      on delete cascade,
  status        public.exchange_status  not null default 'pending',
  -- round_count: mirrors ROUND_COUNT_MIN/MAX in src/lib/exchange/constants.ts (lessons §3)
  round_count   int                     not null,
  current_round int                     not null default 1,
  current_turn  public.turn_actor       not null default 'challenger',
  created_at    timestamptz             not null default now(),
  responded_at  timestamptz             null,

  -- round_count in [1,5] — mirrors ROUND_COUNT_MIN/MAX constants
  constraint exchanges_round_count_range check (round_count between 1 and 5),
  -- current_round stays within [1, round_count]
  constraint exchanges_current_round_coherent check (current_round between 1 and round_count),
  -- self-invite backstop (defense in depth — also blocked app-side + UI)
  constraint exchanges_no_self_invite check (advocate_id <> challenger_id)
);

-- One open exchange per debate (partial — declined rows don't count, re-invite is allowed)
create unique index exchanges_one_open_per_debate
  on public.exchanges (debate_id)
  where status in ('pending', 'accepted');

-- Index for challenger inbox lookup and debate-membership probe
create index exchanges_challenger_id_idx on public.exchanges (challenger_id);
create index exchanges_debate_id_idx     on public.exchanges (debate_id);

-- ─── RLS on exchanges ─────────────────────────────────────────────────────────

alter table public.exchanges enable row level security;
revoke select on public.exchanges from anon;

-- Advocate and challenger can each read the exchange row
create policy exchanges_select on public.exchanges for select to authenticated
  using (
    advocate_id   = (select auth.uid())
    or challenger_id = (select auth.uid())
  );

-- Only the advocate (who must own the debate) can open an exchange
create policy exchanges_insert on public.exchanges for insert to authenticated
  with check (
    advocate_id = (select auth.uid())
    and exists (
      select 1 from public.debates d
      where d.id = debate_id
        and d.owner_id = (select auth.uid())
    )
  );

-- Only the challenger can respond (once), and only to a pending exchange.
-- Column-level grant below (revoke+grant) locks other columns so the challenger
-- cannot rewrite round_count / current_round / debate_id / etc. while flipping status.
create policy exchanges_update on public.exchanges for update to authenticated
  using  (challenger_id = (select auth.uid()) and status = 'pending')
  with check (status in ('accepted', 'declined'));

-- Column-level write lock: permit only status + responded_at for any authenticated update.
-- This physically prevents rewriting immutable columns (round_count, debate_id, …).
revoke update on public.exchanges from authenticated;
grant  update (status, responded_at) on public.exchanges to authenticated;

-- ─── READ membership predicate — inline EXISTS, not a helper function ─────────
--
-- An opaque security-definer helper evaluated per row defeats the planner's
-- semi-join.  An inline EXISTS with (select auth.uid()) is rewritten into one
-- semi-join per scan with auth.uid() hoisted to an InitPlan — same as the
-- existing owner-only policy.  Cost: the snippet is duplicated across three
-- tables; mitigated by this shared comment.  The partial-unique index on
-- exchanges(challenger_id) + (debate_id) keeps the challenger branch a cheap
-- index probe; the owner branch is a debates PK lookup that short-circuits
-- the common case.
--
-- Canonical snippet (parameterized by <debate_id_col>):
--
--   exists (
--     select 1 from public.debates d
--     where d.id = <debate_id_col> and d.owner_id = (select auth.uid())
--   )
--   or exists (
--     select 1 from public.exchanges e
--     where e.debate_id    = <debate_id_col>
--       and e.challenger_id = (select auth.uid())
--       and e.status in ('pending', 'accepted')
--   )
--
-- READ membership: owner OR pending/accepted challenger — keep in sync across
-- debates / nodes / relations.

-- ─── Widen debates_select ─────────────────────────────────────────────────────

drop policy debates_select on public.debates;

-- READ membership: owner OR pending/accepted challenger — keep in sync across
-- debates / nodes / relations.
-- NOTE: for debates itself, reference owner_id directly (no self-subquery) to
-- avoid the infinite-recursion trap; nodes/relations use the EXISTS subquery.
create policy debates_select on public.debates for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.exchanges e
      where e.debate_id     = debates.id
        and e.challenger_id = (select auth.uid())
        and e.status in ('pending', 'accepted')
    )
  );

-- ─── Widen nodes_select ───────────────────────────────────────────────────────

drop policy nodes_select on public.nodes;

-- READ membership: owner OR pending/accepted challenger — keep in sync across
-- debates / nodes / relations.
create policy nodes_select on public.nodes for select to authenticated
  using (
    exists (
      select 1 from public.debates d
      where d.id = nodes.debate_id and d.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.exchanges e
      where e.debate_id     = nodes.debate_id
        and e.challenger_id = (select auth.uid())
        and e.status in ('pending', 'accepted')
    )
  );

-- ─── Widen relations_select ───────────────────────────────────────────────────

drop policy relations_select on public.relations;

-- READ membership: owner OR pending/accepted challenger — keep in sync across
-- debates / nodes / relations.
create policy relations_select on public.relations for select to authenticated
  using (
    exists (
      select 1 from public.debates d
      where d.id = relations.debate_id and d.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.exchanges e
      where e.debate_id     = relations.debate_id
        and e.challenger_id = (select auth.uid())
        and e.status in ('pending', 'accepted')
    )
  );
