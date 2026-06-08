-- Root re-designation (D3-3c, Risk #3). Before this, "Set as Root Claim" fired
-- two unsynced client calls (a statement_type patch + a client-only setRootNode),
-- so the new root was never persisted and was lost on reload. This function makes
-- re-designation a single atomic, persisted operation:
--   1. coerce the target's statement_type → 'claim' (a root is always a claim),
--   2. strip the target's outgoing relations (a root claim is a sink — nothing it
--      argues *for* survives the promotion),
--   3. re-point debates.root_node_id.
-- All three run in the function's single transaction, so a partial failure cannot
-- leave a debate pointing at a non-claim or a stale edge set.
--
-- SECURITY INVOKER (default) + params-only, mirroring patch_node — so RLS still
-- applies in production but the function is directly callable under any client.
--
-- Returns SETOF (not a bare composite) so an unknown debate/node pair yields an
-- empty set → PostgREST `[]` → `.maybeSingle()` → real null → caller maps to 404
-- (lessons §4). The app layer pre-checks the target kind (statement vs connective)
-- and surfaces a 422, mirroring the D1 link-target guard; the `kind = 'statement'`
-- guard here is the DB-side backstop.
create or replace function public.set_debate_root(
  p_debate_id uuid,
  p_node_id uuid
) returns setof public.debates
language plpgsql
set search_path = ''
as $$
begin
  -- Target must be a statement node belonging to this debate; otherwise no-op
  -- (empty set → 404). The app layer already distinguishes 404 from 422.
  if not exists (
    select 1 from public.nodes
    where id = p_node_id and debate_id = p_debate_id and kind = 'statement'
  ) then
    return;
  end if;

  update public.nodes
  set metadata = metadata || jsonb_build_object('statement_type', 'claim')
  where id = p_node_id;

  delete from public.relations where source_node_id = p_node_id;

  return query
    update public.debates
    set root_node_id = p_node_id
    where id = p_debate_id
    returning *;
end;
$$;

revoke execute on function public.set_debate_root(uuid, uuid) from public, anon;
grant execute on function public.set_debate_root(uuid, uuid) to authenticated;
