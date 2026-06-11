-- S-04 Phase 1 (part 2 of 2): round-close + mini-turn + write-scope tightening.
--
-- Consolidates the former 000002 (round-close + read-widening) and 000003
-- (mini-turn) into a single migration so submit_turn is defined exactly ONCE here,
-- superseding 20260610000002_submit_turn_rpc.sql. Enum value 'completed' was added
-- in 000001 as its own migration (ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction that references the new value — SQLSTATE 55P04).
--
-- Contents:
--   1. Mini-turn runtime column on exchanges (in_mini_turn). The mini-turn is
--      ALWAYS enabled — there is no opt-in flag.
--   2. can_add_content_as_current_actor: turn-gate helper that also freezes the
--      challenger's content writes during the mini-turn.
--   3. submit_turn: drop + recreate with round-close AND mini-turn routing.
--   4. Read-scope widening to admit 'completed' (is_accepted_challenger; debates /
--      nodes / relations SELECT). exchanges_select is membership-only — no change.
--   5. Write-scope tightening: nodes/relations INSERT, UPDATE and DELETE all gate on
--      can_add_content_as_current_actor, so only the current-turn actor may write
--      their own content, NO ONE writes during the other party's turn, and the
--      challenger is additionally frozen during the mini-turn. The pre-exchange
--      owner branch (map-building before an exchange exists) is preserved.
--
-- Constraint note: exchanges_current_round_coherent requires current_round ∈ [1, round_count].
-- The final round enters the mini-turn and then completes on the challenger's
-- closing submit — neither step touches current_round (incrementing would breach
-- the constraint for round_count=1 rows). current_round stays at its final
-- in-range value — the correct historical record.

-- ─── 1. Mini-turn runtime column ──────────────────────────────────────────────
-- in_mini_turn: runtime state, flipped by submit_turn. The mini-turn is always
--   enabled, so an explicit runtime flag is still required — the formula
--   (current_turn='challenger' AND current_round=round_count) cannot tell the
--   INITIAL challenger turn from the mini-turn on a round_count=1 exchange; both
--   states look identical without it.

alter table public.exchanges
  add column in_mini_turn boolean not null default false;

-- ─── 2. Helper: can_add_content_as_current_actor ─────────────────────────────
-- Same as can_write_as_current_actor (kept for marks) except the challenger
-- branch also requires NOT in_mini_turn. Used by nodes/relations INSERT/UPDATE/
-- DELETE so the challenger cannot add or edit content during the mini-turn, while
-- marks (can_write_as_current_actor) stay allowed — challenger marks in the
-- closing turn as normal.

create function public.can_add_content_as_current_actor(p_debate_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as $$
    select exists (
      select 1 from public.exchanges e
      where e.debate_id = p_debate_id
        and e.status    = 'accepted'
        and (
          -- Advocate writes freely on their turn
          (e.advocate_id   = (select auth.uid()) and e.current_turn = 'advocate')
          or
          -- Challenger writes only on their regular turn (NOT during mini-turn)
          (e.challenger_id = (select auth.uid()) and e.current_turn = 'challenger'
           and not e.in_mini_turn)
        )
    )
  $$;

revoke execute on function public.can_add_content_as_current_actor(uuid) from public, anon;
grant  execute on function public.can_add_content_as_current_actor(uuid) to authenticated;

-- ─── 3. submit_turn: drop + recreate with round-close + mini-turn routing ─────
-- Drop first because CREATE OR REPLACE cannot change the return type / signature
-- on a function with dependents.

drop function if exists public.submit_turn(uuid);

create function public.submit_turn(p_exchange_id uuid)
  returns setof public.exchanges
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  v_exchange  public.exchanges;
  v_other_id  uuid;
  v_next_turn public.turn_actor;
  v_total     int;
  v_marked    int;
begin
  -- Resolve exchange: caller must hold the current turn on an ACCEPTED exchange.
  -- Completed exchanges take no further turns — the resolver keeps status='accepted'.
  select e.* into v_exchange
  from public.exchanges e
  where e.id     = p_exchange_id
    and e.status = 'accepted'
    and (
      (e.challenger_id = (select auth.uid()) and e.current_turn = 'challenger')
      or
      (e.advocate_id   = (select auth.uid()) and e.current_turn = 'advocate')
    );

  if not found then
    return;
  end if;

  -- Derive other-party id and next turn (actor-neutral, covers both S-03 and S-04).
  if v_exchange.current_turn = 'challenger' then
    v_other_id  := v_exchange.advocate_id;
    v_next_turn := 'advocate';
  else
    v_other_id  := v_exchange.challenger_id;
    v_next_turn := 'challenger';
  end if;

  -- Count total statement nodes authored by the other party in this debate.
  select count(*) into v_total
  from public.nodes n
  where n.debate_id = v_exchange.debate_id
    and n.kind      = 'statement'
    and n.author_id = v_other_id;

  -- Count valid marks by the caller on those other-party statements.
  select count(distinct m.node_id) into v_marked
  from public.marks m
  join public.nodes n on n.id = m.node_id
  where m.marker_id = (select auth.uid())
    and m.valid     = true
    and n.debate_id = v_exchange.debate_id
    and n.kind      = 'statement'
    and n.author_id = v_other_id;

  if v_marked < v_total then
    raise exception 'INCOMPLETE_MARKS: % of % statements marked',
      v_marked, v_total
      using errcode = 'P0001';
  end if;

  if v_next_turn = 'challenger' then
    -- ── Advocate just submitted ──────────────────────────────────────────────
    if v_exchange.current_round < v_exchange.round_count then
      -- Non-final round: advance round, flip turn back to challenger.
      update public.exchanges
        set current_turn  = 'challenger',
            current_round = current_round + 1
        where id = p_exchange_id
        returning * into v_exchange;

    else
      -- Final round: always enter the mini-turn (challenger marks only). The
      -- exchange completes when the challenger submits the closing mini-turn —
      -- never directly on the advocate's submit. Do NOT touch current_round.
      update public.exchanges
        set current_turn = 'challenger',
            in_mini_turn = true
        where id = p_exchange_id
        returning * into v_exchange;
    end if;

  else
    -- ── Challenger just submitted ────────────────────────────────────────────
    if v_exchange.in_mini_turn then
      -- Closing mini-turn submit: complete the exchange.
      update public.exchanges
        set status       = 'completed',
            in_mini_turn = false
        where id = p_exchange_id
        returning * into v_exchange;
    else
      -- Regular challenger turn: flip to advocate, round unchanged.
      update public.exchanges
        set current_turn = 'advocate'
        where id = p_exchange_id
        returning * into v_exchange;
    end if;
  end if;

  return next v_exchange;
end;
$$;

revoke execute on function public.submit_turn(uuid) from public, anon;
grant  execute on function public.submit_turn(uuid) to authenticated;

-- ─── 4. Read-scope widening: admit 'completed' ───────────────────────────────
-- Replace every READ predicate gating on status='accepted' (or
-- in('pending','accepted')) to also admit 'completed', so a completed exchange
-- stays visible to the pair (board + marks + summary). Write predicates below
-- stay on the turn gate. exchanges_select is membership-only — unchanged.

-- 4a. is_accepted_challenger: membership predicate (used by marks_select and as
--     the challenger-read branch). Name kept; now also admits completed exchanges.
create or replace function public.is_accepted_challenger(p_debate_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as $$
    select exists (
      select 1 from public.exchanges e
      where e.debate_id     = p_debate_id
        and e.challenger_id = (select auth.uid())
        and e.status        in ('accepted', 'completed')
    )
  $$;

revoke execute on function public.is_accepted_challenger(uuid) from public, anon;
grant  execute on function public.is_accepted_challenger(uuid) to authenticated;

-- 4b. debates_select: widen challenger branch to include completed.
drop policy debates_select on public.debates;

create policy debates_select on public.debates for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.exchanges e
      where e.debate_id     = debates.id
        and e.challenger_id = (select auth.uid())
        and e.status in ('pending', 'accepted', 'completed')
    )
  );

-- 4c. nodes_select: widen challenger branch.
drop policy nodes_select on public.nodes;

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
        and e.status in ('pending', 'accepted', 'completed')
    )
  );

-- 4d. relations_select: widen challenger branch.
drop policy relations_select on public.relations;

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
        and e.status in ('pending', 'accepted', 'completed')
    )
  );

-- marks_select needs no text change — it calls is_accepted_challenger (4a), now widened.

-- ─── 5. Write-scope tightening: INSERT / UPDATE / DELETE turn-gated ───────────
-- All three operations on nodes/relations adopt the same two-branch pattern:
--   Branch 1 (pre-exchange): the debate owner writes freely ONLY while no
--     pending/accepted/completed exchange exists — i.e. before any invite is sent.
--     Once the advocate invites a challenger (status='pending') the map is locked
--     as the basis the challenger is deciding on; a 'declined' exchange is dead and
--     does not lock (the advocate may revise and re-invite).
--   Branch 2 (during exchange): only the current-turn actor may write their OWN
--     content (author_id = auth.uid()). This means NO ONE may add/edit/delete on
--     the other party's turn, and the challenger is frozen during the mini-turn
--     (can_add_content_as_current_actor excludes them while in_mini_turn=true).
-- Net effect: the map is editable only pre-invite (owner) or by the current actor
--   on their turn. While 'pending' both branches are false → frozen. On a COMPLETED
--   exchange branch 1 is shut off and branch 2's helper requires status='accepted',
--   so it returns false — the graph is fully immutable once the exchange completes.
-- Marks are NOT gated here — they keep can_write_as_current_actor so the
-- challenger can still mark during the mini-turn.

-- 5a. nodes INSERT
drop policy nodes_insert on public.nodes;

create policy nodes_insert on public.nodes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = nodes.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = nodes.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(nodes.debate_id)
    )
  );

-- 5b. nodes UPDATE — same gate on both the targeted row (using) and the result
--     row (with check); author_id stays the caller's.
drop policy nodes_update on public.nodes;

create policy nodes_update on public.nodes for update to authenticated
  using (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = nodes.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = nodes.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(nodes.debate_id)
    )
  )
  with check (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = nodes.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = nodes.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(nodes.debate_id)
    )
  );

-- 5c. nodes DELETE
drop policy nodes_delete on public.nodes;

create policy nodes_delete on public.nodes for delete to authenticated
  using (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = nodes.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = nodes.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(nodes.debate_id)
    )
  );

-- 5d. relations INSERT
drop policy relations_insert on public.relations;

create policy relations_insert on public.relations for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = relations.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = relations.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(relations.debate_id)
    )
  );

-- 5e. relations UPDATE
drop policy relations_update on public.relations;

create policy relations_update on public.relations for update to authenticated
  using (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = relations.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = relations.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(relations.debate_id)
    )
  )
  with check (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = relations.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = relations.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(relations.debate_id)
    )
  );

-- 5f. relations DELETE
drop policy relations_delete on public.relations;

create policy relations_delete on public.relations for delete to authenticated
  using (
    author_id = (select auth.uid())
    and (
      (
        exists (
          select 1 from public.debates d
          where d.id = relations.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = relations.debate_id and e.status in ('pending', 'accepted', 'completed')
        )
      )
      or public.can_add_content_as_current_actor(relations.debate_id)
    )
  );
