-- S-01 advocate-map-builder: debate graph schema.
-- Tables: debates, nodes (JSONB metadata), relations.
-- Enums mirror the spike's visual language exactly (findings.md).

-- ─── Enums ───────────────────────────────────────────────────────────────────

create type public.node_kind as enum ('statement', 'connective');

-- 6 statement roles (Finding 1: source is a first-class canvas node, not a sub-entity).
create type public.statement_type as enum (
  'claim', 'source', 'data', 'warrant', 'backing', 'rebuttal'
);

create type public.connective_op as enum ('and', 'or');

-- 4 relation kinds (Finding 3: bridges dropped; link + rephrases added).
create type public.relation_kind as enum ('supports', 'link', 'rephrases', 'rebuts');

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table public.debates (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users on delete cascade,
  title        text not null check (char_length(title) <= 120),
  -- Deferrable: we insert the debate before its root node exists; the FK is
  -- satisfied within the same transaction before it commits.
  root_node_id uuid null,
  created_at   timestamptz not null default now()
);

create table public.nodes (
  id         uuid primary key default gen_random_uuid(),
  debate_id  uuid not null references public.debates on delete cascade,
  author_id  uuid not null references auth.users on delete cascade,
  kind       public.node_kind not null,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  -- Statement metadata: { statement_type, title, body?, url? }
  -- Connective metadata: { op }
  -- Kind-specific shape validated by Zod at the API boundary.
  metadata   jsonb not null,
  created_at timestamptz not null default now(),
  -- Char limits backed by DB constraints (Zod is the first line; DB is the backstop).
  check (kind <> 'statement' or char_length(metadata->>'title') <= 60),
  check (kind <> 'statement' or metadata->>'body' is null or char_length(metadata->>'body') <= 250)
);

-- Add the deferrable FK after nodes exists to avoid a forward-reference issue.
alter table public.debates
  add constraint debates_root_node_id_fkey
  foreign key (root_node_id) references public.nodes (id)
  deferrable initially deferred;

create table public.relations (
  id             uuid primary key default gen_random_uuid(),
  debate_id      uuid not null references public.debates on delete cascade,
  author_id      uuid not null references auth.users on delete cascade,
  source_node_id uuid not null references public.nodes on delete cascade,
  target_node_id uuid not null references public.nodes on delete cascade,
  kind           public.relation_kind not null,
  created_at     timestamptz not null default now(),
  check (source_node_id <> target_node_id)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

create index nodes_debate_id_idx        on public.nodes     (debate_id);
create index relations_debate_id_idx    on public.relations (debate_id);
create index relations_source_node_idx  on public.relations (source_node_id);
create index relations_target_node_idx  on public.relations (target_node_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────

alter table public.debates   enable row level security;
alter table public.nodes     enable row level security;
alter table public.relations enable row level security;

-- Logged-out users must not even discover these tables.
revoke select on public.debates   from anon;
revoke select on public.nodes     from anon;
revoke select on public.relations from anon;

-- debates: owner-only access.
create policy debates_select on public.debates for select to authenticated
  using (owner_id = (select auth.uid()));

create policy debates_insert on public.debates for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy debates_update on public.debates for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy debates_delete on public.debates for delete to authenticated
  using (owner_id = (select auth.uid()));

-- nodes: scoped via debate ownership (subquery evaluated once per statement).
create policy nodes_select on public.nodes for select to authenticated
  using (
    exists (
      select 1 from public.debates d
      where d.id = nodes.debate_id
        and d.owner_id = (select auth.uid())
    )
  );

create policy nodes_insert on public.nodes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.debates d
      where d.id = nodes.debate_id
        and d.owner_id = (select auth.uid())
    )
  );

create policy nodes_update on public.nodes for update to authenticated
  using  (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy nodes_delete on public.nodes for delete to authenticated
  using (author_id = (select auth.uid()));

-- relations: same pattern via debate_id.
create policy relations_select on public.relations for select to authenticated
  using (
    exists (
      select 1 from public.debates d
      where d.id = relations.debate_id
        and d.owner_id = (select auth.uid())
    )
  );

create policy relations_insert on public.relations for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.debates d
      where d.id = relations.debate_id
        and d.owner_id = (select auth.uid())
    )
  );

create policy relations_update on public.relations for update to authenticated
  using  (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy relations_delete on public.relations for delete to authenticated
  using (author_id = (select auth.uid()));

-- ─── Root-claim creation RPC ──────────────────────────────────────────────────
-- Atomically: insert debate → insert root node → set root_node_id.
-- A partial failure cannot leave a debate without a root because all three
-- statements run in the same implicit transaction.

create function public.create_debate_with_root(
  p_title      text,
  p_root_title text,
  p_root_body  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_debate   uuid;
  v_root     uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- 1. Debate row (root_node_id deferred — null is valid until commit).
  insert into public.debates (owner_id, title)
  values (v_user_id, p_title)
  returning id into v_debate;

  -- 2. Root claim node (single row — no atomicity concern beyond this RPC).
  insert into public.nodes (debate_id, author_id, kind, metadata)
  values (
    v_debate,
    v_user_id,
    'statement',
    jsonb_build_object(
      'statement_type', 'claim',
      'title',          p_root_title,
      'body',           p_root_body
    )
  )
  returning id into v_root;

  -- 3. Satisfy the deferred FK before the transaction commits.
  update public.debates set root_node_id = v_root where id = v_debate;

  return v_debate;
end;
$$;

-- Revoke broad execute; only authenticated callers may invoke.
revoke execute on function public.create_debate_with_root(text, text, text) from public, anon;
grant  execute on function public.create_debate_with_root(text, text, text) to authenticated;
