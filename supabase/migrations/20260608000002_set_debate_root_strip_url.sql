-- Root re-designation, follow-up (impl-review F1). The original set_debate_root
-- (20260608000001) coerced statement_type → 'claim' but left the target's
-- metadata.url untouched. The client's apply-on-success (store.ts setRootNode)
-- clears url on the promoted root, so server-persisted state diverged from the
-- canvas: on reload rowsToGraph re-read the stale url. A root is a claim, and a
-- claim has no source url — so strip it server-side too, restoring the
-- "client mirrors the persisted operation exactly" contract.
--
-- Behavioural delta from 20260608000001: the role-coercion UPDATE now also drops
-- the 'url' key (`metadata - 'url'`). Everything else is unchanged.
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
  -- INVARIANT: nodes.debate_id FKs to debates, so once this guard passes the
  -- debate row is guaranteed to exist — that is what makes it safe for the
  -- coercion + relation-delete below to run before the final `update debates`
  -- (which therefore always matches a row). All three are in one transaction.
  if not exists (
    select 1 from public.nodes
    where id = p_node_id and debate_id = p_debate_id and kind = 'statement'
  ) then
    return;
  end if;

  update public.nodes
  set metadata = (metadata - 'url') || jsonb_build_object('statement_type', 'claim')
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
