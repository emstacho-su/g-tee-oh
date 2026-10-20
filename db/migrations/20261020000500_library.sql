-- Library: solution, scenario, build_job, builder_setting and storage_ledger (R0.6).
-- Source: A4 data model section 2 (library); O-17 (the scenario table belongs to v1: every v1 build is a
-- scenario set, so no v1 build is re-solved later); ADR 0005 (the build queue is a Postgres table claimed
-- with FOR UPDATE SKIP LOCKED); ADR 0019 (manifest_uri points into the SeaweedFS library bucket);
-- A1 section 6 (builder settings live in a table so a change needs no redeploy).
-- Mechanism: build_job_queue is a partial index over queued rows ordered by priority, so the builder's claim
-- query reads only the queue head instead of scanning finished jobs. The unique key on
-- (game_config_id, position_pair, flop, tree_config_hash) makes a build idempotent to re-plan.

-- migrate:up

create table solution (
  id uuid primary key default uuidv7(),
  kind solution_kind not null,
  source solution_source not null,
  game_config_id text not null references game_config (id),
  position_pair text,
  flop text,
  engine_version text,
  manifest_uri text not null,
  exploitability_pct_pot real[],
  status text not null check (status in ('published', 'unavailable', 'superseded')),
  created_at timestamptz not null default now()
);

create index solution_lookup_idx on solution (game_config_id, kind, status);

-- v1 per O-17 (A4 marked it v1.5; the errata in 02 Architecture record the move).
create table scenario (
  id uuid primary key default uuidv7(),
  solution_id uuid not null references solution (id),
  game_config_id text not null references game_config (id),
  position_pair text not null,
  flop text not null,
  turn text not null,
  river text not null,
  flop_weight smallint not null,
  created_at timestamptz not null default now()
);

create index scenario_lookup_idx on scenario (game_config_id, position_pair);
create index scenario_solution_id_idx on scenario (solution_id);

create table build_job (
  id uuid primary key default uuidv7(),
  game_config_id text not null references game_config (id),
  position_pair text not null,
  flop text not null,
  preflop_lines text[] not null,
  tree_config_hash bytea not null,
  k_runouts smallint not null,
  priority real not null,
  status job_status not null default 'queued',
  attempts smallint not null default 0,
  last_exploitability_pct_pot real[],
  locked_by text,
  locked_at timestamptz,
  progress jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_config_id, position_pair, flop, tree_config_hash)
);

-- The queue head: only queued rows, highest priority first (A4 section 2, ADR 0005).
create index build_job_queue on build_job (priority desc) where status = 'queued';

-- schedule, cpu share, budget, K runouts per flop (A1 section 6)
create table builder_setting (
  key text primary key,
  value jsonb not null
);

create table storage_ledger (
  day date primary key,
  library_bytes bigint not null,
  reference_bytes bigint not null
);

-- migrate:down

drop table if exists storage_ledger;
drop table if exists builder_setting;
drop table if exists build_job;
drop table if exists scenario;
drop table if exists solution;
