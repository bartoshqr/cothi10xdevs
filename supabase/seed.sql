-- seed.sql: Local dev fixture data for S-01 advocate-map-builder.
-- Runs as postgres superuser after all migrations on `npx supabase db reset`.
-- Fixed UUIDs → idempotent: re-running db reset always produces the same rows.
-- DO NOT use this file in production or against a cloud project.

-- ─── Auth users ──────────────────────────────────────────────────────────────
-- Two users so RLS isolation (step 1.7) can be tested without signing up manually.
-- s@e.pl  owns the test debate.
-- a@e.pl  owns nothing — used to verify they cannot read seed1's data.

-- NOTE: the token columns (confirmation_token, recovery_token, email_change,
-- email_change_token_new, email_change_token_current, phone_change,
-- phone_change_token, reauthentication_token) MUST be empty strings, not NULL.
-- GoTrue scans them into Go `string` (not sql.NullString), so a NULL value
-- causes "converting NULL to string is unsupported" at sign-in time even
-- though the row inserts cleanly.

insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  role,
  aud,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    's@e.pl',
    crypt('pwd123!', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"username": "user1"}',
    'authenticated',
    'authenticated',
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'a@e.pl',
    crypt('pwd123!', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"username": "user2"}',
    'authenticated',
    'authenticated',
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  )
on conflict (id) do nothing;

-- ─── Auth identities ─────────────────────────────────────────────────────────
-- GoTrue requires an auth.identities row per user for sign-in to work.
-- A UI sign-up creates this automatically; a raw auth.users insert does not.

-- provider_id is NOT NULL since late 2023; for the email provider the
-- convention (matching dashboard sign-up) is the user's UUID cast to text,
-- NOT the email address. Using the email here is what makes login fail
-- silently for some auth.identities lookups.

insert into auth.identities (
  id,
  user_id,
  provider,
  provider_id,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'email',
    '00000000-0000-0000-0000-000000000001',
    '{"sub": "00000000-0000-0000-0000-000000000001", "email": "s@e.pl", "email_verified": true}',
    now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'email',
    '00000000-0000-0000-0000-000000000002',
    '{"sub": "00000000-0000-0000-0000-000000000002", "email": "a@e.pl", "email_verified": true}',
    now(), now(), now()
  )
on conflict (id) do nothing;

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- The on_auth_user_created trigger creates profiles automatically on auth.users
-- insert, but only when the row is actually written (not when ON CONFLICT skips it).
-- Explicit inserts here make the seed idempotent on re-runs.

insert into public.profiles (id, username)
values
  ('00000000-0000-0000-0000-000000000001', 'user1'),
  ('00000000-0000-0000-0000-000000000002', 'user2')
on conflict (id) do nothing;

-- ─── Debate graph (seed1 owns it) ────────────────────────────────────────────
-- Build a small but complete graph that exercises every node kind and relation kind.
-- Layout mirrors exampleMap.ts from the spike for easy visual comparison.
--
-- Nodes:
--   root_claim   (statement/claim,   isRoot)
--   data_node    (statement/data)
--   warrant_node (statement/warrant)
--   source_node  (statement/source,  url set)
--   rebuttal_node(statement/rebuttal)
--   and_node     (connective/and)
--
-- Relations (one of each kind):
--   data_node    → and_node       (link)
--   warrant_node → and_node       (link)
--   and_node     → root_claim     (supports)
--   source_node  → data_node      (rephrases)
--   rebuttal_node→ root_claim     (rebuts)

do $$
declare
  v_owner      uuid := '00000000-0000-0000-0000-000000000001';
  v_debate     uuid := '00000000-0000-0000-0000-000000000010';
  v_root       uuid := '00000000-0000-0000-0000-000000000011';
  v_data       uuid := '00000000-0000-0000-0000-000000000012';
  v_warrant    uuid := '00000000-0000-0000-0000-000000000013';
  v_source     uuid := '00000000-0000-0000-0000-000000000014';
  v_rebuttal   uuid := '00000000-0000-0000-0000-000000000015';
  v_and        uuid := '00000000-0000-0000-0000-000000000016';
begin
  -- Debate row (root_node_id is deferrable — set after node insert)
  insert into public.debates (id, owner_id, title, root_node_id)
  values (v_debate, v_owner, 'Seed: Climate Change Debate', null)
  on conflict (id) do nothing;

  -- Nodes
  insert into public.nodes (id, debate_id, author_id, kind, position_x, position_y, metadata)
  values
    (
      v_root, v_debate, v_owner, 'statement', 400, 50,
      jsonb_build_object(
        'statement_type', 'claim',
        'title',          'Humans are causing climate change',
        'body',           'The scientific consensus is clear: anthropogenic emissions are driving global temperature rise.'
      )
    ),
    (
      v_data, v_debate, v_owner, 'statement', 150, 250,
      jsonb_build_object(
        'statement_type', 'data',
        'title',          'CO₂ levels at record highs',
        'body',           'Atmospheric CO₂ exceeded 420 ppm in 2023, the highest in 800,000 years.'
      )
    ),
    (
      v_warrant, v_debate, v_owner, 'statement', 400, 250,
      jsonb_build_object(
        'statement_type', 'warrant',
        'title',          'CO₂ is a greenhouse gas',
        'body',           'Higher CO₂ concentrations trap infrared radiation, raising surface temperatures.'
      )
    ),
    (
      v_source, v_debate, v_owner, 'statement', 50, 450,
      jsonb_build_object(
        'statement_type', 'source',
        'title',          'NOAA Global Monitoring Laboratory',
        'url',            'https://gml.noaa.gov/ccgg/trends/'
      )
    ),
    (
      v_rebuttal, v_debate, v_owner, 'statement', 650, 250,
      jsonb_build_object(
        'statement_type', 'rebuttal',
        'title',          'Natural cycles argument',
        'body',           'Climate has changed before without human activity — this rebuttal challenges the causal link.'
      )
    ),
    (
      v_and, v_debate, v_owner, 'connective', 300, 150,
      jsonb_build_object('op', 'and')
    )
  on conflict (id) do nothing;

  -- Set root_node_id (deferrable FK, safe to set after node row exists)
  update public.debates set root_node_id = v_root where id = v_debate;

  -- Relations (one of each kind)
  insert into public.relations (debate_id, author_id, source_node_id, target_node_id, kind)
  values
    (v_debate, v_owner, v_data,     v_and,        'link'),      -- data feeds into AND connective
    (v_debate, v_owner, v_warrant,  v_and,        'link'),      -- warrant feeds into AND connective
    (v_debate, v_owner, v_and,      v_root,       'supports'),  -- combined evidence supports root claim
    (v_debate, v_owner, v_source,   v_data,       'rephrases'), -- source rephrases the data node
    (v_debate, v_owner, v_rebuttal, v_root,       'rebuts')     -- rebuttal attacks the root claim
  on conflict do nothing;
end;
$$;
