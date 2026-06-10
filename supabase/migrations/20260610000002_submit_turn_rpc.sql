-- S-03 Phase 2: submit_turn() RPC — atomic turn-submission gate.
--
-- Lessons applied:
--   1. RETURNS SETOF: zero matches → empty set → PostgREST [] → .maybeSingle() null → 404.
--      A bare composite would return all-NULL columns on no match, serializing as a
--      truthy object and 200-ing instead of 404.
--   2. Column grant lock: current_turn / current_round are NOT in the client UPDATE grant
--      (exchanges only permits status + responded_at). This function is SECURITY DEFINER
--      so it writes as the function owner (postgres), bypassing the column-level grant.
--   3. Symmetric actor design: resolver and gate are actor-neutral — works for both
--      challenger-submits (S-03) and advocate-submits (S-04) without modification.
--      Other-party id is derived from the exchange row; next turn is computed, not
--      hard-coded. No S-04 migration needed for this RPC.
--
-- Role inference: no author_role column — other-party author_id = v_other_id (derived
-- from exchange.challenger_id / advocate_id depending on who holds current_turn).

create function public.submit_turn(p_exchange_id uuid)
  returns setof public.exchanges
  language plpgsql
  security definer
  set search_path = public
  as $$
declare
  v_exchange  public.exchanges;
  v_other_id  uuid;
  v_next_turn public.turn_actor;
  v_total     int;
  v_marked    int;
begin
  -- Resolve exchange: caller must hold the current turn on an accepted exchange.
  -- Covers S-03 (challenger-on-challenger-turn) and S-04 (advocate-on-advocate-turn)
  -- with no code change. Any other condition → empty set (→ 404/403).
  select e.* into v_exchange
  from public.exchanges e
  where e.id     = p_exchange_id
    and e.status = 'accepted'
    and (
      (e.challenger_id = (select auth.uid()) and e.current_turn = 'challenger')
      or
      (e.advocate_id   = (select auth.uid()) and e.current_turn = 'advocate')
    );

  if not found then
    -- Return empty set: unknown id, wrong caller, wrong turn, or wrong status.
    -- PostgREST maps [] from .maybeSingle() to null → handler returns 404/409.
    return;
  end if;

  -- Derive other-party id and next turn from the resolved exchange.
  -- No author_role column: other party = whichever exchange member is NOT the caller.
  if v_exchange.current_turn = 'challenger' then
    v_other_id  := v_exchange.advocate_id;
    v_next_turn := 'advocate';
  else
    v_other_id  := v_exchange.challenger_id;
    v_next_turn := 'challenger';
  end if;

  -- Count total statement nodes authored by the other party in this debate.
  -- Connective nodes (AND/OR) excluded by kind = 'statement'.
  select count(*) into v_total
  from public.nodes n
  where n.debate_id = v_exchange.debate_id
    and n.kind      = 'statement'
    and n.author_id = v_other_id;

  -- Count valid marks by the caller on those other-party statements.
  select count(distinct m.node_id) into v_marked
  from public.marks m
  join public.nodes n on n.id = m.node_id
  where m.marker_id = (select auth.uid())
    and m.valid     = true
    and n.debate_id = v_exchange.debate_id
    and n.kind      = 'statement'
    and n.author_id = v_other_id;

  -- Gate: every other-party statement must carry a valid mark before the turn flips.
  -- Raises SQLSTATE P0001 (raise_exception); Phase 3 backend maps this to 409/422.
  if v_marked < v_total then
    raise exception 'INCOMPLETE_MARKS: % of % statements marked',
      v_marked, v_total
      using errcode = 'P0001';
  end if;

  -- All marks present — flip the turn atomically.
  -- SECURITY DEFINER bypasses the column-level grant lock on current_turn.
  update public.exchanges
  set current_turn = v_next_turn
  where id = p_exchange_id
  returning * into v_exchange;

  return next v_exchange;
end;
$$;

revoke execute on function public.submit_turn(uuid) from public, anon;
grant  execute on function public.submit_turn(uuid) to authenticated;
