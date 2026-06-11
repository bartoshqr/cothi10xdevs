-- seed.sql: Local dev fixture data for the WVMap debate app.
-- Runs as postgres superuser after all migrations on `npx supabase db reset`.
-- Fixed UUIDs → idempotent: re-running db reset always produces the same rows.
-- DO NOT use this file in production or against a cloud project.

-- ─── Auth users (10) ─────────────────────────────────────────────────────────
-- Ten ready users so the FR-009 invite search has a realistic pool and RLS
-- pair-visibility can be exercised by hand without signing up.
--
--   email     user01@e.pl … user10@e.pl   (password: pwd123!  for all)
--   username  user01      … user10
--   id        00000000-0000-4000-8000-000000000001 … …00000000000a
--
-- The ids are valid **v4-shaped** UUIDs (version nibble `4` in group 3, variant
-- nibble `8` in group 4). This matters: Zod 4's z.uuid() — the API's challengerId
-- guard — rejects the old nil-pattern ids (…000000000002) because it checks the
-- version/variant bits, not just the hyphen shape. A nil-pattern challengerId
-- would 400 with "Invalid UUID" before it ever reached the repository.
--
-- NOTE: the token columns (confirmation_token, recovery_token, email_change,
-- email_change_token_new, email_change_token_current, phone_change,
-- phone_change_token, reauthentication_token) MUST be empty strings, not NULL.
-- GoTrue scans them into Go `string` (not sql.NullString), so a NULL value
-- causes "converting NULL to string is unsupported" at sign-in time even
-- though the row inserts cleanly.
--
-- The on_auth_user_created trigger materializes a profiles row from
-- raw_user_meta_data.username on each auth.users insert; the explicit profiles
-- insert below is an idempotent backstop for re-runs (ON CONFLICT skips it when
-- the trigger already created the row).

do $$
declare
  i      int;
  uid    uuid;
  uname  text;
  uemail text;
begin
  for i in 1..10 loop
    -- v4-shaped id: group 3 = 4xxx, group 4 = 8xxx; suffix is the user index in hex.
    uid    := ('00000000-0000-4000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid;
    uname  := 'user' || lpad(i::text, 2, '0');
    uemail := uname || '@e.pl';

    insert into auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    )
    values (
      uid,
      '00000000-0000-0000-0000-000000000000',
      uemail,
      crypt('pwd123!', gen_salt('bf')),
      now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('username', uname),
      'authenticated',
      'authenticated',
      now(), now(),
      '', '', '', '', '', '', '', ''
    )
    on conflict (id) do nothing;

    -- GoTrue requires an auth.identities row per user for sign-in. provider_id is
    -- the user's UUID cast to text (NOT the email) — the dashboard-signup convention.
    insert into auth.identities (
      id, user_id, provider, provider_id, identity_data,
      last_sign_in_at, created_at, updated_at
    )
    values (
      uid, uid, 'email', uid::text,
      jsonb_build_object('sub', uid::text, 'email', uemail, 'email_verified', true),
      now(), now(), now()
    )
    on conflict (id) do nothing;

    insert into public.profiles (id, username)
    values (uid, uname)
    on conflict (id) do nothing;
  end loop;
end;
$$;

-- ─── Debate graph (user01 advocate, user02 challenger) ───────────────────────
-- A small but complete graph exercising every node kind and relation kind, then
-- extended to imitate a challenger who has RESPONDED and SUBMITTED round 1:
-- he marks the advocate's statements (agrees with the data + source, challenges
-- the root claim and the warrant) and adds his own counter-structure.
-- Every debate here is created WITH a root claim — never seed a rootless debate
-- (the create_debate_with_root RPC is the only creation path and always sets one).
--
-- Advocate nodes (user01):
--   root_claim   (statement/claim,   isRoot)
--   data_node    (statement/data)
--   warrant_node (statement/warrant)
--   source_node  (statement/source,  url set)
--   and_node     (connective/and)
--
-- Challenger nodes (user02) — his submitted counter-structure:
--   rebuttal_node  (statement/rebuttal) "Natural cycles argument" → rebuts root
--   c_rebuttal     (statement/rebuttal) thermodynamics objection   → rebuts warrant
--   c_data         (statement/data)     "atmosphere colder than surface"
--   c_source       (statement/source)   Gerlich & Tscheuschner (2009)
--
-- Relations:
--   data_node    → and_node       (link)       advocate
--   warrant_node → and_node       (link)       advocate
--   and_node     → root_claim     (supports)   advocate
--   source_node  → data_node      (rephrases)  advocate
--   rebuttal_node→ root_claim     (rebuts)     challenger
--   c_rebuttal   → warrant_node   (rebuts)     challenger
--   c_data       → c_rebuttal     (supports)   challenger
--   c_source     → c_data         (rephrases)  challenger
--
-- Challenger marks (user02 on user01's statements): root=challenge,
-- warrant=challenge, data=agree, source=agree.

do $$
declare
  v_owner      uuid := '00000000-0000-4000-8000-000000000001';  -- user01 (advocate)
  v_challenger uuid := '00000000-0000-4000-8000-000000000002';  -- user02 (challenger)
  -- v4-shaped UUIDs (group 3 = 4xxx, group 4 = 8xxx); suffixes 0x10–0x19 don't
  -- collide with the user ids (0x01–0x0a above).
  v_debate     uuid := '00000000-0000-4000-8000-000000000010';
  v_root       uuid := '00000000-0000-4000-8000-000000000011';
  v_data       uuid := '00000000-0000-4000-8000-000000000012';
  v_warrant    uuid := '00000000-0000-4000-8000-000000000013';
  v_source     uuid := '00000000-0000-4000-8000-000000000014';
  v_rebuttal   uuid := '00000000-0000-4000-8000-000000000015';
  v_and        uuid := '00000000-0000-4000-8000-000000000016';
  -- challenger's counter-structure (suffixes 0x17–0x19)
  v_c_rebuttal uuid := '00000000-0000-4000-8000-000000000017';
  v_c_data     uuid := '00000000-0000-4000-8000-000000000018';
  v_c_source   uuid := '00000000-0000-4000-8000-000000000019';
begin
  -- Debate row (root_node_id is deferrable — set after node insert)
  insert into public.debates (id, owner_id, title, root_node_id)
  values (v_debate, v_owner, 'Seed: Climate Change Debate', null)
  on conflict (id) do nothing;

  -- Nodes
  insert into public.nodes (id, debate_id, author_id, kind, position_x, position_y, metadata)
  values
    (
      v_root, v_debate, v_owner, 'statement', 183, -75,
      jsonb_build_object(
        'statement_type', 'claim',
        'title',          'Humans are causing climate change',
        'body',           'The scientific consensus is clear: anthropogenic emissions are driving global temperature rise.'
      )
    ),
    (
      v_data, v_debate, v_owner, 'statement', 35, 268,
      jsonb_build_object(
        'statement_type', 'data',
        'title',          'CO₂ levels at record highs',
        'body',           'Atmospheric CO₂ exceeded 420 ppm in 2023, the highest in 800,000 years.'
      )
    ),
    (
      v_warrant, v_debate, v_owner, 'statement', 361, 261,
      jsonb_build_object(
        'statement_type', 'warrant',
        'title',          'CO₂ is a greenhouse gas',
        'body',           'Higher CO₂ concentrations trap infrared radiation, raising surface temperatures.'
      )
    ),
    (
      v_source, v_debate, v_owner, 'statement', 35, 441,
      jsonb_build_object(
        'statement_type', 'source',
        'title',          'NOAA Global Monitoring Laboratory',
        'url',            'https://gml.noaa.gov/ccgg/trends/'
      )
    ),
    (
      v_rebuttal, v_debate, v_challenger, 'statement', 624, 116,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Natural cycles argument',
        'body',           'Climate shifted dramatically before humans existed — glacial cycles and the medieval warm period were driven by orbital and solar variation, so warming need not be anthropogenic.'
      )
    ),
    (
      v_and, v_debate, v_owner, 'connective', 300, 150,
      jsonb_build_object('op', 'and')
    ),
    -- Challenger's counter-structure rebutting the warrant "CO₂ is a greenhouse gas".
    (
      v_c_rebuttal, v_debate, v_challenger, 'statement', 640, 380,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Greenhouse effect breaks thermodynamics',
        'body',           'A cooler atmosphere cannot transfer net heat to the warmer surface, so CO₂ back-radiation cannot raise surface temperature without violating the Second Law of Thermodynamics.'
      )
    ),
    (
      v_c_data, v_debate, v_challenger, 'statement', 640, 540,
      jsonb_build_object(
        'statement_type', 'data',
        'title',          'Atmosphere is colder than the surface',
        'body',           'The atmosphere''s radiating layer averages about −18 °C, far colder than Earth''s ~15 °C surface — a cold body cannot heat a warmer one.'
      )
    ),
    (
      v_c_source, v_debate, v_challenger, 'statement', 640, 700,
      jsonb_build_object(
        'statement_type', 'source',
        'title',          'Gerlich & Tscheuschner (2009)',
        'url',            'https://arxiv.org/abs/0707.1161'
      )
    )
  on conflict (id) do nothing;

  -- Set root_node_id (deferrable FK, safe to set after node row exists)
  update public.debates set root_node_id = v_root where id = v_debate;

  -- Relations: advocate's support structure + challenger's rebuttals.
  insert into public.relations (debate_id, author_id, source_node_id, target_node_id, kind)
  values
    (v_debate, v_owner,      v_data,       v_and,        'link'),      -- data feeds into AND connective
    (v_debate, v_owner,      v_warrant,    v_and,        'link'),      -- warrant feeds into AND connective
    (v_debate, v_owner,      v_and,        v_root,       'supports'),  -- combined evidence supports root claim
    (v_debate, v_owner,      v_source,     v_data,       'rephrases'), -- source rephrases the data node
    (v_debate, v_challenger, v_rebuttal,   v_root,       'rebuts'),    -- challenger: natural cycles rebut the root claim
    (v_debate, v_challenger, v_c_rebuttal, v_warrant,    'rebuts'),    -- challenger: thermodynamics objection rebuts the warrant
    (v_debate, v_challenger, v_c_data,     v_c_rebuttal, 'supports'),  -- challenger: data backs the thermo rebuttal
    (v_debate, v_challenger, v_c_source,   v_c_data,     'rephrases')  -- challenger: source rephrases that data
  on conflict do nothing;

  -- ─── Challenger's marks (user02 marks user01's statements) ──────────────────
  -- The challenger responded and SUBMITTED round 1: agrees with the data and its
  -- source, challenges the root claim and the warrant. Marks are disjoint per node
  -- and only land on the counterpart's statements — the challenger's own nodes and
  -- the connective are not markable. marker_id = challenger.
  insert into public.marks (debate_id, node_id, marker_id, stance)
  values
    (v_debate, v_root,    v_challenger, 'challenge'),
    (v_debate, v_warrant, v_challenger, 'challenge'),
    (v_debate, v_data,    v_challenger, 'agree'),
    (v_debate, v_source,  v_challenger, 'agree')
  on conflict (node_id, marker_id) do nothing;
end;
$$;

-- ─── Exchange (user01 advocate ⇄ user02 challenger, accepted) ─────────────────
-- The challenger has already RESPONDED and SUBMITTED round 1, so the turn has
-- flipped to the advocate: current_turn='advocate', current_round=1 (challenger
-- submit leaves the round unchanged). This sets up the S-04 advocate-turn flow:
-- sign in as user01, open debate …010, mark the challenger's statements, submit.
-- round_count=3 leaves room to exercise the multi-round path; responded_at is set
-- because user02 accepted. Fixed id keeps it idempotent; the partial unique index
-- (one open exchange per debate) is respected since this is the debate's only exchange.
insert into public.exchanges (
  id, debate_id, advocate_id, challenger_id,
  status, round_count, current_round, current_turn, responded_at
)
values (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000010',  -- debate (owned by user01)
  '00000000-0000-4000-8000-000000000001',  -- advocate  = user01
  '00000000-0000-4000-8000-000000000002',  -- challenger = user02
  'accepted', 3, 1, 'advocate', now()
)
on conflict (id) do nothing;
