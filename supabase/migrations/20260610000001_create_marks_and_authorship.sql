-- S-03 Phase 1: marks table, mark_stance enum, SECURITY DEFINER helpers,
-- widened node/relation INSERT RLS, marks RLS.
--
-- Two lessons applied:
--   1. 42P17 recursion: any WITH CHECK that reads exchanges from nodes/relations
--      must go through a SECURITY DEFINER helper (same pattern as is_debate_owner).
--   2. Turn-as-RLS-boundary: separate membership predicate (is_accepted_challenger,
--      read-scope / turn-agnostic) from write predicate (can_write_as_current_actor,
--      turn-gated) so off-turn writes are physically rejected by RLS.
--
-- Two write helpers exist at different scopes:
--   can_write_as_current_actor — generic turn gate; used for both nodes/relations
--                               INSERT (during an exchange) and marks INSERT/UPDATE.
--                               S-04-ready: no policy change needed when the advocate
--                               marking ships.
--   is_accepted_challenger     — membership predicate (read scope, turn-agnostic)

-- ─── Enum ────────────────────────────────────────────────────────────────────

create type public.mark_stance as enum ('agree', 'challenge', 'abstain');

-- ─── Table ───────────────────────────────────────────────────────────────────

create table public.marks (
  id         uuid               primary key default gen_random_uuid(),
  debate_id  uuid               not null references public.debates  on delete cascade,
  node_id    uuid               not null references public.nodes    on delete cascade,
  marker_id  uuid               not null references auth.users      on delete cascade,
  stance     public.mark_stance not null,
  created_at timestamptz        not null default now(),
  updated_at timestamptz        not null default now(),

  -- One mutable row per (node, marker). Re-marking updates stance in place.
  -- valid: true = current; false = counterpart's content changed, mark stale (S-05 flips it).
  -- The counterpart flips valid to false when the marked node changes — never deleted.
  valid      boolean            not null default true,

  constraint marks_node_marker_unique unique (node_id, marker_id)
);

create index marks_debate_id_idx on public.marks (debate_id);

-- ─── SECURITY DEFINER helpers ─────────────────────────────────────────────────
--
-- Both helpers break the 42P17 cross-table RLS recursion: nodes/relations INSERT
-- WITH CHECK reads exchanges (to test challenger membership), which would trigger
-- nodes/relations SELECT policies while those tables are mid-evaluation.
-- Wrapping in SECURITY DEFINER reads exchanges as the function owner (postgres),
-- bypassing node/relation RLS entirely. auth.uid() is still valid inside because
-- PostgREST sets request.jwt.claims at session level.

-- Membership predicate (read scope, turn-agnostic): "is this user an accepted
-- challenger of the given debate?"
create function public.is_accepted_challenger(p_debate_id uuid)
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
        and e.status        = 'accepted'
    )
  $$;

revoke execute on function public.is_accepted_challenger(uuid) from public, anon;
grant  execute on function public.is_accepted_challenger(uuid) to authenticated;

-- General turn-gated write predicate: true if the caller is whichever actor
-- currently holds the turn (challenger-on-challenger-turn OR advocate-on-advocate-turn).
-- Used for marks INSERT/UPDATE so both parties can mark the other's statements
-- in their respective turns — no policy change needed in S-04.
create function public.can_write_as_current_actor(p_debate_id uuid)
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
          (e.challenger_id = (select auth.uid()) and e.current_turn = 'challenger')
          or
          (e.advocate_id   = (select auth.uid()) and e.current_turn = 'advocate')
        )
    )
  $$;

revoke execute on function public.can_write_as_current_actor(uuid) from public, anon;
grant  execute on function public.can_write_as_current_actor(uuid) to authenticated;

-- ─── Widen nodes INSERT: pre-exchange owner OR in-exchange current actor ──────
--
-- Two branches to preserve the advocate's pre-exchange map-building flow while
-- enforcing the turn boundary symmetrically once an exchange is active:
--   Branch 1 (no exchange): owner writes freely — covers the advocate building
--     the initial map before any challenger is involved.
--   Branch 2 (active exchange): whoever holds current_turn may insert — covers
--     both S-03 (challenger adds nodes) and S-04 (advocate adds nodes on their
--     turn) without a policy change. Advocate is blocked during challenger turn.

drop policy nodes_insert on public.nodes;

create policy nodes_insert on public.nodes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      -- Pre-exchange: debate owner builds the map freely
      (
        exists (
          select 1 from public.debates d
          where d.id = nodes.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = nodes.debate_id and e.status = 'accepted'
        )
      )
      -- During exchange: current turn actor inserts
      or public.can_write_as_current_actor(nodes.debate_id)
    )
  );

-- ─── Relax nodes UPDATE/DELETE: author_id only (no owner gate) ───────────────
-- Previously required debate ownership (tighten_graph_write_policies migration).
-- Now: each party edits only their own nodes; the owner gate is dropped so
-- challengers can edit their own content. RLS still prevents editing the other
-- party's nodes because author_id = auth.uid() fails for foreign nodes.

drop policy nodes_update on public.nodes;

create policy nodes_update on public.nodes for update to authenticated
  using  (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy nodes_delete on public.nodes;

create policy nodes_delete on public.nodes for delete to authenticated
  using (author_id = (select auth.uid()));

-- ─── Widen relations INSERT: same two-branch pattern as nodes ────────────────

drop policy relations_insert on public.relations;

create policy relations_insert on public.relations for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      -- Pre-exchange: debate owner builds the map freely
      (
        exists (
          select 1 from public.debates d
          where d.id = relations.debate_id and d.owner_id = (select auth.uid())
        )
        and not exists (
          select 1 from public.exchanges e
          where e.debate_id = relations.debate_id and e.status = 'accepted'
        )
      )
      -- During exchange: current turn actor inserts
      or public.can_write_as_current_actor(relations.debate_id)
    )
  );

-- ─── Relax relations UPDATE/DELETE: author_id only ────────────────────────────

drop policy relations_update on public.relations;

create policy relations_update on public.relations for update to authenticated
  using  (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy relations_delete on public.relations;

create policy relations_delete on public.relations for delete to authenticated
  using (author_id = (select auth.uid()));

-- ─── Marks RLS ───────────────────────────────────────────────────────────────

alter table public.marks enable row level security;
revoke select on public.marks from anon;

-- Members (owner OR accepted challenger) can read all marks for their debate.
create policy marks_select on public.marks for select to authenticated
  using (
    exists (
      select 1 from public.debates d
      where d.id = marks.debate_id and d.owner_id = (select auth.uid())
    )
    or public.is_accepted_challenger(marks.debate_id)
  );

-- Either party may insert a mark while it is their turn, on a Statement node
-- authored by the OTHER party. Connective nodes and own-party nodes are excluded
-- (F3). Works for both S-03 (challenger marks advocate statements) and S-04
-- (advocate marks challenger statements) without any policy change.
--   1. marker_id = caller (cannot mark as someone else).
--   2. can_write_as_current_actor — caller holds the current turn.
--   3. node is a 'statement' authored by someone other than the caller.
create policy marks_insert on public.marks for insert to authenticated
  with check (
    marker_id = (select auth.uid())
    and public.can_write_as_current_actor(marks.debate_id)
    and exists (
      select 1 from public.nodes n
      where n.id        = marks.node_id
        and n.kind      = 'statement'
        and n.author_id <> (select auth.uid())  -- counterpart's node only
    )
  );

-- Re-marking (UPDATE) follows the same rules. marker_id and node_id are
-- immutable after insert — only stance, valid, and updated_at may be changed.
create policy marks_update on public.marks for update to authenticated
  using  (marker_id = (select auth.uid()))
  with check (
    marker_id = (select auth.uid())
    and public.can_write_as_current_actor(marks.debate_id)
    and exists (
      select 1 from public.nodes n
      where n.id        = marks.node_id
        and n.kind      = 'statement'
        and n.author_id <> (select auth.uid())
    )
  );

-- No marks_delete in S-03. FK cascade handles node deletion.
-- S-05 wires up the valid=false flip trigger; no schema change needed there.

-- Column grant: marker_id and node_id are immutable after insert.
-- Only stance and updated_at may be updated.
grant insert on public.marks to authenticated;
grant update (stance, valid, updated_at) on public.marks to authenticated;
