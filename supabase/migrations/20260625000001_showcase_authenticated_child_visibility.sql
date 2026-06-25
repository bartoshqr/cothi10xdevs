-- S-09 bugfix, part 2: 20260624000002 fixed `debates` so a logged-in
-- non-participant can see a published debate, but missed its children.
-- nodes_select / relations_select / marks_select / exchanges_select (all
-- `to authenticated`, from 20260609000001 / 20260610000001) only match
-- owner/challenger rows and have no `public = true` branch, so a logged-in
-- viewer who isn't a participant still gets an empty graph on a published
-- debate even though the anon-only policies already cover them correctly.
--
-- profiles needs no fix: profiles_select_authenticated already uses (true).
--
-- RLS policies for the same role are OR'd, so add one additive permissive
-- policy per table — reusing the existing is_public_debate() SECURITY
-- DEFINER helper (already granted to authenticated, see 20260624000001) —
-- instead of touching the existing owner/challenger policies.
create policy nodes_select_authenticated_public on public.nodes for select to authenticated
  using (public.is_public_debate(debate_id));

create policy relations_select_authenticated_public on public.relations for select to authenticated
  using (public.is_public_debate(debate_id));

create policy marks_select_authenticated_public on public.marks for select to authenticated
  using (public.is_public_debate(debate_id));

create policy exchanges_select_authenticated_public on public.exchanges for select to authenticated
  using (public.is_public_debate(debate_id));
