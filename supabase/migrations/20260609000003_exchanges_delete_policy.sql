-- S-02 (Phase 4.5): allow the advocate to REVOKE a still-pending invite.
--
-- Revoking a pending exchange deletes the row, which re-opens the
-- one-open-exchange-per-debate slot (alongside decline) so the advocate can
-- re-invite. Only a still-`pending` row owned by the advocate may be deleted —
-- an accepted/declined exchange is immutable to delete (withdrawing an accepted
-- exchange is a later slice). RLS is the boundary; the repository also pre-checks.

create policy exchanges_delete on public.exchanges for delete to authenticated
  using (advocate_id = (select auth.uid()) and status = 'pending');

-- Table-level DELETE is granted to authenticated by Supabase default privileges,
-- but make it explicit so the policy above is actually reachable.
grant delete on public.exchanges to authenticated;
