-- Ban duplicate directed relations: at most one relation per (source, target) pair.
--
-- Two concurrent sessions could each optimistically create an A->B edge and both
-- POSTs would succeed, leaving two identical edges between the same nodes. This
-- enforces single ownership of a directed pair at the DB level. A->B and B->A
-- (opposite directions) remain allowed; only a duplicate in the same direction is
-- rejected (Postgres 23505 -> PostgREST 409). The app's existing create-rollback
-- path surfaces that as a dismissible error and removes the loser's optimistic edge.

-- De-duplicate any pre-existing pairs first so the constraint can be added on dirty
-- data: keep the earliest row per directed pair (by created_at, then id), drop the rest.
delete from public.relations r
using public.relations dup
where r.source_node_id = dup.source_node_id
  and r.target_node_id = dup.target_node_id
  and (dup.created_at, dup.id) < (r.created_at, r.id);

alter table public.relations
  add constraint relations_uniq_pair
  unique (source_node_id, target_node_id);
