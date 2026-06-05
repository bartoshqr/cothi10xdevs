-- Tighten nodes/relations UPDATE+DELETE policies to require debate ownership,
-- mirroring the insert policies. Closes the asymmetry flagged in impl-review F1:
-- update/delete previously checked only author_id, leaving a latent hole for
-- future collaboration/ownership-transfer (S-02). Forward-only; drops+recreates.

drop policy nodes_update on public.nodes;
create policy nodes_update on public.nodes for update to authenticated
  using (
    author_id = (select auth.uid())
    and exists (select 1 from public.debates d
                where d.id = nodes.debate_id and d.owner_id = (select auth.uid()))
  )
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.debates d
                where d.id = nodes.debate_id and d.owner_id = (select auth.uid()))
  );

drop policy nodes_delete on public.nodes;
create policy nodes_delete on public.nodes for delete to authenticated
  using (
    author_id = (select auth.uid())
    and exists (select 1 from public.debates d
                where d.id = nodes.debate_id and d.owner_id = (select auth.uid()))
  );

drop policy relations_update on public.relations;
create policy relations_update on public.relations for update to authenticated
  using (
    author_id = (select auth.uid())
    and exists (select 1 from public.debates d
                where d.id = relations.debate_id and d.owner_id = (select auth.uid()))
  )
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.debates d
                where d.id = relations.debate_id and d.owner_id = (select auth.uid()))
  );

drop policy relations_delete on public.relations;
create policy relations_delete on public.relations for delete to authenticated
  using (
    author_id = (select auth.uid())
    and exists (select 1 from public.debates d
                where d.id = relations.debate_id and d.owner_id = (select auth.uid()))
  );
