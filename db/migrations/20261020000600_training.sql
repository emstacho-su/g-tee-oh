-- Training: drill, practice_session and attempt (R0.6).
-- Source: A4 data model section 2 (training); ADR 0001 (user_id with a foreign key to app_user on every
-- user-owned row); A5 section 3 (the session state machine persists on every transition with an optimistic
-- state_version, so a browser refresh resumes the hand).
-- Mechanism: attempt is the one graded decision, written once per decision with the expected value (EV)
-- figures solver-query computed, so later rating, scheduling and leak passes read attempts instead of
-- recomputing. The two attempt indexes serve the per-user timeline and the per-spot-class leak queries.

-- migrate:up

create table drill (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id),
  name text not null,
  tags text[] not null default '{}',
  spot_filter jsonb not null,
  trainer_settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drill_user_id_idx on drill (user_id);

create table practice_session (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id),
  mode practice_mode not null,
  drill_id uuid references drill (id),
  settings jsonb not null,
  state jsonb not null,
  state_version int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index practice_session_user_id_idx on practice_session (user_id);

create table attempt (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id),
  session_id uuid not null references practice_session (id),
  solution_id uuid not null references solution (id),
  node_key text not null,
  spot_class_key text not null,
  track_ids uuid[] not null,
  hand text not null,
  action_index smallint not null,
  action_token text not null,
  bucket text,
  ev_chosen_bb real not null,
  ev_best_bb real not null,
  ev_loss_bb real not null,
  ev_loss_pct_pot real not null,
  floor_pct_pot real not null,
  score real not null,
  label text not null,
  reference_strategy text not null default 'equilibrium',
  rng_roll smallint,
  confidence text check (confidence in ('sure', 'unsure')),
  response_ms int,
  rated bool not null,
  weight real not null,
  item_difficulty real,
  noise_flags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index attempt_user_timeline_idx on attempt (user_id, created_at desc);
create index attempt_user_spot_class_idx on attempt (user_id, spot_class_key, created_at desc);
create index attempt_session_id_idx on attempt (session_id);
create index attempt_solution_id_idx on attempt (solution_id);

-- migrate:down

drop table if exists attempt;
drop table if exists practice_session;
drop table if exists drill;
