-- S-09 bugfix: a logged-in user who is neither the owner nor the challenger of a
-- debate could not see it in the showcase listing even after it was published.
-- `debates_select` (to authenticated, from 20260611000002) only matches owner/
-- challenger rows and has no `public = true` branch, so `listPublicDebates`
-- silently returned nothing for any debate the viewer doesn't participate in.
--
-- RLS policies for the same role are OR'd, so add a second permissive policy —
-- mirroring `debates_select_anon` — instead of touching the existing one.
create policy debates_select_authenticated_public on public.debates for select to authenticated
  using (public = true);
