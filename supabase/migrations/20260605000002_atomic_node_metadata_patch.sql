-- Atomic node patch (impl-review F2). The previous updateNode read metadata,
-- merged in JS, and wrote the whole object back — two concurrent flushes could
-- read the same pre-image and lose a field. This function does the merge inside
-- a single UPDATE (metadata || p_metadata_patch) under the row lock, so the
-- read-modify-write is atomic. SECURITY INVOKER (default) — RLS still applies.

-- Returns SETOF (not a bare composite) so a zero-row match yields an empty set —
-- a bare `returns public.nodes` would emit a row of all-NULL columns on no match,
-- which the caller cannot distinguish from a real row (would 200 instead of 404).
create or replace function public.patch_node(
  p_node_id uuid,
  p_metadata_patch jsonb default null,
  p_position_x double precision default null,
  p_position_y double precision default null
) returns setof public.nodes
language sql
set search_path = ''
as $$
  update public.nodes
  set metadata = case
        when p_metadata_patch is not null then metadata || p_metadata_patch
        else metadata
      end,
      position_x = coalesce(p_position_x, position_x),
      position_y = coalesce(p_position_y, position_y)
  where id = p_node_id
  returning *;
$$;

revoke execute on function public.patch_node(uuid, jsonb, double precision, double precision) from public, anon;
grant execute on function public.patch_node(uuid, jsonb, double precision, double precision) to authenticated;
