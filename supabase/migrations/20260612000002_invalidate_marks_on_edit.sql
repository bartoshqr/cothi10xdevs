-- S-05 Phase 1: mark invalidation on node content edit.
--
-- Two new SECURITY DEFINER functions:
--   can_write_node_content      — shared auth helper that mirrors the nodes_update
--                                  RLS predicate. Used only by patch_node_and_invalidate
--                                  so the DEFINER body can enforce the same gate as RLS
--                                  without bypassing it silently.
--   patch_node_and_invalidate   — replaces patch_node as the repository edit path.
--                                  When content actually changes, flips the counterpart's
--                                  valid marks to valid = false, forcing re-evaluation
--                                  before the counterpart can submit.
--
-- No schema / column changes. marks.valid already exists with default true (S-03).
-- Existing patch_node is left intact (no other callers at this revision).
--
-- Lessons applied:
--   - SECURITY DEFINER for the marks UPDATE: marks_update RLS requires
--     marker_id = auth.uid(), but the author (not the marker) is the caller here.
--     Running inside DEFINER body bypasses RLS on marks, which is exactly what we
--     need — the author legitimately flips the counterpart's marks.
--   - Replicate nodes_update predicate via a helper to avoid drift (§Critical Details).
--   - RETURNS SETOF: empty set → .maybeSingle() null → 404 in the caller.

-- ─── Auth helper ────────────────────────────────────────────────────────────────
-- Mirrors the nodes_update USING predicate from 20260611000002:
--   node.author_id = caller
--   AND (pre-exchange owner OR can_add_content_as_current_actor)

create function public.can_write_node_content(p_node_id uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as $$
    select exists (
      select 1 from public.nodes n
      where n.id        = p_node_id
        and n.author_id = (select auth.uid())
        and (
          (
            exists (
              select 1 from public.debates d
              where d.id = n.debate_id and d.owner_id = (select auth.uid())
            )
            and not exists (
              select 1 from public.exchanges e
              where e.debate_id = n.debate_id
                and e.status in ('pending', 'accepted', 'completed')
            )
          )
          or public.can_add_content_as_current_actor(n.debate_id)
        )
    )
  $$;

revoke execute on function public.can_write_node_content(uuid) from public, anon;
grant  execute on function public.can_write_node_content(uuid) to authenticated;

-- ─── Invalidation RPC ────────────────────────────────────────────────────────────
-- Replaces patch_node as the repository edit path.
--
-- Returns SETOF (same SETOF→404 contract as patch_node): an unauthorized or
-- unknown node yields an empty set → .maybeSingle() null → NotFoundError.
--
-- The marks UPDATE runs inside the DEFINER body (as function owner), so it is
-- not blocked by marks_update RLS (which requires marker_id = auth.uid()).
-- All marks on a given node belong to the counterpart (marks_insert enforces
-- author_id <> marker_id), so this update always targets the counterpart's rows.

create function public.patch_node_and_invalidate(
  p_node_id        uuid,
  p_metadata_patch jsonb            default null,
  p_position_x     double precision default null,
  p_position_y     double precision default null
) returns setof public.nodes
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  v_node public.nodes;
begin
  -- Auth guard: replicate nodes_update predicate via the shared helper.
  -- Returns empty set (→ 404) when the caller is not the author, lacks turn
  -- permission, or the node is unknown.
  -- Service-role callers have auth.uid() = NULL (no sub claim) and bypass RLS
  -- on the underlying tables — skip the check for them, matching the behaviour of
  -- the original SECURITY INVOKER patch_node.
  --
  -- INVARIANT (safety depends on this): unlike the old patch_node, this DEFINER
  -- body bypasses RLS on the `marks` UPDATE below — there is NO RLS backstop. So a
  -- service-role caller flips counterpart marks with zero authorization. This is
  -- only safe because the sole caller (updateNode, src/lib/debate/repository.ts)
  -- invokes it with the per-request anon/RLS client where auth.uid() is set. Never
  -- call patch_node_and_invalidate with a service-role client; if a service-role
  -- edit path is ever needed, add an explicit authorization check here first.
  if (select auth.uid()) is not null and not public.can_write_node_content(p_node_id) then
    return;
  end if;

  -- Fetch current node for metadata comparison.
  select * into v_node from public.nodes where id = p_node_id;
  if not found then
    return;
  end if;

  -- Flip counterpart marks only on a real content change.
  -- Position-only patches (p_metadata_patch is null) and identical re-saves
  -- (merged result equals stored metadata) do NOT invalidate.
  if p_metadata_patch is not null
     and (v_node.metadata || p_metadata_patch) is distinct from v_node.metadata
  then
    update public.marks
       set valid      = false,
           updated_at = now()
     where node_id = p_node_id
       and valid   = true;
  end if;

  -- Apply the patch (identical logic to patch_node) and return the updated row.
  return query
    update public.nodes
       set metadata   = case
                          when p_metadata_patch is not null
                            then metadata || p_metadata_patch
                          else metadata
                        end,
           position_x = coalesce(p_position_x, position_x),
           position_y = coalesce(p_position_y, position_y)
     where id = p_node_id
     returning *;
end;
$$;

revoke execute on function public.patch_node_and_invalidate(uuid, jsonb, double precision, double precision) from public, anon;
grant  execute on function public.patch_node_and_invalidate(uuid, jsonb, double precision, double precision) to authenticated;
