-- seed_showcase_debate.sql: inserts the climate-change debate from
-- tests/e2e/critical-path.spec.ts in its END state — two accounts
-- (climatologist / skeptic), the full 11-node / 10-edge graph, all
-- closing marks, and a completed 2-round exchange — then publishes it
-- (public = true, published_at = now()) so it appears on /showcase.
--
-- Mirrors the structure of supabase/seed.sql (same auth.users +
-- auth.identities + profiles insert pattern) but is meant to run against
-- a real (prod) project via scripts/seed_showcase_debate.sh, not
-- `supabase db reset`. Fixed UUIDs make it idempotent — re-running skips
-- rows that already exist via `on conflict do nothing`.
--
-- Password for both accounts: pwd123! (same fixed demo password used by
-- tests/e2e/global-setup.ts). NOTE: the token columns on auth.users must
-- be empty strings, not NULL — GoTrue scans them into a Go `string`, and
-- a NULL crashes sign-in even though the row inserts cleanly.

do $$
declare
  v_advocate   uuid := '00000000-0000-4000-8000-000000000031';  -- climatologist
  v_challenger uuid := '00000000-0000-4000-8000-000000000032';  -- skeptic

  v_debate         uuid := '00000000-0000-4000-8000-000000000040';
  v_root           uuid := '00000000-0000-4000-8000-000000000041';
  v_data           uuid := '00000000-0000-4000-8000-000000000042';
  v_warrant        uuid := '00000000-0000-4000-8000-000000000043';
  v_source         uuid := '00000000-0000-4000-8000-000000000044';
  v_and            uuid := '00000000-0000-4000-8000-000000000045';
  v_natural_cycles uuid := '00000000-0000-4000-8000-000000000046';
  v_fast_warming   uuid := '00000000-0000-4000-8000-000000000047';
  v_log_saturation uuid := '00000000-0000-4000-8000-000000000048';
  v_abrupt_shifts  uuid := '00000000-0000-4000-8000-000000000049';
  v_sat_aloft      uuid := '00000000-0000-4000-8000-00000000004a';
  v_past_regional  uuid := '00000000-0000-4000-8000-00000000004b';

  v_exchange uuid := '00000000-0000-4000-8000-000000000050';
begin
  -- ─── Auth users ──────────────────────────────────────────────────────────
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  values
    (
      v_advocate, '00000000-0000-0000-0000-000000000000', 'climatologist@example.com',
      crypt('pwd123!', gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('username', 'climatologist'),
      'authenticated', 'authenticated', now(), now(),
      '', '', '', '', '', '', '', ''
    ),
    (
      v_challenger, '00000000-0000-0000-0000-000000000000', 'skeptic@example.com',
      crypt('pwd123!', gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('username', 'skeptic'),
      'authenticated', 'authenticated', now(), now(),
      '', '', '', '', '', '', '', ''
    )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider, provider_id, identity_data,
    last_sign_in_at, created_at, updated_at
  )
  values
    (
      v_advocate, v_advocate, 'email', v_advocate::text,
      jsonb_build_object('sub', v_advocate::text, 'email', 'climatologist@example.com', 'email_verified', true),
      now(), now(), now()
    ),
    (
      v_challenger, v_challenger, 'email', v_challenger::text,
      jsonb_build_object('sub', v_challenger::text, 'email', 'skeptic@example.com', 'email_verified', true),
      now(), now(), now()
    )
  on conflict (id) do nothing;

  -- Idempotent backstop — the on_auth_user_created trigger already materializes
  -- these from raw_user_meta_data.username; on conflict skips it on re-runs.
  insert into public.profiles (id, username)
  values (v_advocate, 'climatologist'), (v_challenger, 'skeptic')
  on conflict (id) do nothing;

  -- ─── Debate ──────────────────────────────────────────────────────────────
  -- root_node_id is the deferrable FK — set after the node row exists below.
  insert into public.debates (id, owner_id, title, root_node_id)
  values (v_debate, v_advocate, 'Is human activity driving climate change?', null)
  on conflict (id) do nothing;

  -- ─── Nodes (final 11 — orphaned/retracted nodes from the test's mid-exchange
  -- deletions are intentionally absent) ────────────────────────────────────
  insert into public.nodes (id, debate_id, author_id, kind, position_x, position_y, metadata)
  values
    (
      v_root, v_debate, v_advocate, 'statement', 0, 0,
      jsonb_build_object(
        'statement_type', 'claim',
        'title',          'Humans are causing climate change',
        'body',           'The scientific consensus is clear: anthropogenic emissions are driving global temperature rise.'
      )
    ),
    (
      v_data, v_debate, v_advocate, 'statement', -148, 343,
      jsonb_build_object(
        'statement_type', 'data',
        'title',          'CO₂ levels at record highs',
        'body',           'Atmospheric CO₂ exceeded 420 ppm in 2023, the highest in 800,000 years.'
      )
    ),
    (
      v_warrant, v_debate, v_advocate, 'statement', 178, 336,
      jsonb_build_object(
        'statement_type', 'warrant',
        'title',          'CO₂ is a greenhouse gas',
        'body',           'Higher CO₂ concentrations trap infrared radiation, raising surface temperatures. Specifically, it slows the rate at which the surface loses heat to space — it doesn''t reverse the net direction of heat flow, so the Second Law isn''t implicated.'
      )
    ),
    (
      v_source, v_debate, v_advocate, 'statement', -148, 516,
      jsonb_build_object(
        'statement_type', 'source',
        'title',          'NOAA Global Monitoring Laboratory',
        'url',            'https://gml.noaa.gov/ccgg/trends/'
      )
    ),
    (
      v_and, v_debate, v_advocate, 'connective', 117, 225,
      jsonb_build_object('op', 'and')
    ),
    (
      v_natural_cycles, v_debate, v_challenger, 'statement', 517, 100,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Natural cycles argument',
        'body',           'Climate shifted dramatically before humans existed — glacial cycles and the medieval warm period were driven by orbital and solar variation, so warming need not be anthropogenic.'
      )
    ),
    (
      v_fast_warming, v_debate, v_advocate, 'statement', 950, 100,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Current warming is too fast for natural cycles',
        'body',           'Orbital (Milankovitch) cycles act over tens of thousands of years; ~1.1 °C in 150 years is orders of magnitude faster, and solar output has been flat since 1980 — natural forcing cannot produce this.'
      )
    ),
    (
      v_log_saturation, v_debate, v_challenger, 'statement', 517, 450,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'CO₂ forcing is logarithmic and largely saturated',
        'body',           'CO₂''s main absorption bands are already near-saturated, so radiative forcing rises only with the logarithm of concentration — doubling CO₂ yields ~1 °C directly. Larger warming hinges on uncertain positive feedbacks, so CO₂ is at most a weak driver.'
      )
    ),
    (
      v_abrupt_shifts, v_debate, v_challenger, 'statement', 1380, 100,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Abrupt natural shifts have happened before',
        'body',           'Dansgaard–Oeschger events and the Younger Dryas saw multi-°C regional swings within decades, so a fast rate of change is not a unique fingerprint of human causation.'
      )
    ),
    (
      v_sat_aloft, v_debate, v_advocate, 'statement', 550, 820,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Saturation doesn''t hold aloft — emission height rises',
        'body',           'The band centre is saturated only near the surface; adding CO₂ raises the effective emission altitude into colder, thinner air, so Earth radiates less to space. Forcing keeps growing — about 3.7 W/m² per doubling, measured, not negligible.'
      )
    ),
    (
      v_past_regional, v_debate, v_advocate, 'statement', 1400, 450,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Past abrupt shifts were regional heat redistribution',
        'body',           'Dansgaard–Oeschger events and the Younger Dryas were driven by ocean-circulation changes that moved heat around the North Atlantic; global mean temperature barely moved. Today''s warming is global, synchronous, and tied to a measured forcing.'
      )
    )
  on conflict (id) do nothing;

  update public.debates set root_node_id = v_root where id = v_debate;

  -- ─── Relations (final 10 edges) ──────────────────────────────────────────
  insert into public.relations (debate_id, author_id, source_node_id, target_node_id, kind)
  values
    (v_debate, v_advocate,   v_data,           v_and,            'link'),
    (v_debate, v_advocate,   v_warrant,        v_and,            'link'),
    (v_debate, v_advocate,   v_and,            v_root,           'supports'),
    (v_debate, v_advocate,   v_source,         v_data,           'rephrases'),
    (v_debate, v_challenger, v_natural_cycles, v_root,           'rebuts'),
    (v_debate, v_advocate,   v_fast_warming,   v_natural_cycles, 'rebuts'),
    (v_debate, v_challenger, v_log_saturation, v_warrant,        'rebuts'),
    (v_debate, v_challenger, v_abrupt_shifts,  v_fast_warming,   'rebuts'),
    (v_debate, v_advocate,   v_sat_aloft,      v_log_saturation, 'rebuts'),
    (v_debate, v_advocate,   v_past_regional,  v_abrupt_shifts,  'rebuts')
  on conflict do nothing;

  -- ─── Marks — final closing judgement, one per statement node (the AND
  -- connective is not markable) ────────────────────────────────────────────
  insert into public.marks (debate_id, node_id, marker_id, stance)
  values
    (v_debate, v_root,           v_challenger, 'challenge'),
    (v_debate, v_data,           v_challenger, 'accept'),
    (v_debate, v_warrant,        v_challenger, 'challenge'),
    (v_debate, v_source,         v_challenger, 'accept'),
    (v_debate, v_natural_cycles, v_advocate,   'challenge'),
    (v_debate, v_fast_warming,   v_challenger, 'challenge'),
    (v_debate, v_log_saturation, v_advocate,   'challenge'),
    (v_debate, v_abrupt_shifts,  v_advocate,   'challenge'),
    (v_debate, v_sat_aloft,      v_challenger, 'challenge'),
    (v_debate, v_past_regional,  v_challenger, 'abstain')
  on conflict (node_id, marker_id) do nothing;

  -- ─── Exchange — 2 rounds, fully closed ───────────────────────────────────
  -- This is the S-09 publishable shape: isPublishable() only requires a
  -- completed exchange, which this satisfies.
  insert into public.exchanges (
    id, debate_id, advocate_id, challenger_id,
    status, round_count, current_round, current_turn, in_mini_turn, responded_at
  )
  values (
    v_exchange, v_debate, v_advocate, v_challenger,
    'completed', 2, 2, 'challenger', false, now()
  )
  on conflict (id) do nothing;

  -- ─── Publish — makes the debate visible on /showcase ─────────────────────
  update public.debates
  set public = true, published_at = now()
  where id = v_debate;
end;
$$;
