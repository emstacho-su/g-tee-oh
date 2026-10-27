-- The api trainer: admin settings writes, the admin flag, coverage requests and attempt rows that
-- carry their own feedback (R3.4, R3.5, R3.6, R3.7).
-- Source: A4 sections 2 and 3, whose status is proposed (A4 gets an errata line at the next planning
-- revision); A5 section 3 (admin endpoints, coverage requests); ADR 0018 (no request path starts a
-- solve); O-88 and O-241 (the app grant on builder_setting), O-242 (who may use the admin endpoints),
-- O-240 (coverage requests), O-246 (attempt columns), O-92 (feedback rendered from the attempt row).
-- Mechanism:
-- - builder_setting holds overrides only: the builder reads every key on each claim and uses its own
--   default for an absent key (O-188), and S18 seeds no rows, so a settings write is an upsert. app gets
--   insert and update on it (O-88 named update only; O-241 adds insert for the upsert) and still no
--   delete, and nothing else on builder tables.
-- - app_user.is_admin gates the admin endpoints (O-242); create-user --admin sets it. Existing rows
--   default to false.
-- - coverage_request records a gap request the api could not turn into a priority raise, because no
--   build_job exists for the spot or the gap is preflop. app cannot insert build_job (the tree hash is
--   the builder's, ADR 0004), so the planner reads these rows in a later builder session (O-240). The
--   request never creates a job or a solution here (ADR 0018).
-- - attempt gains the per-action arrays and best and graded indexes the feedback shows, so feedback is a
--   pure function of the row (O-92) and S29's recompute compares the row with an independent recompute.
--   state_version is the session version the decision was made at; the unique index makes a decision at
--   one version graded once even if two requests race past the api's own checks. Rows written before
--   this migration keep nulls.

-- migrate:up

grant insert, update on builder_setting to app;

alter table app_user add column is_admin boolean not null default false;

comment on column app_user.is_admin is 'may use the admin builder endpoints (O-242)';

create table coverage_request (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id) on delete cascade,
  game_config_id text not null references game_config (id),
  position_pair text not null,
  flop text,
  line text,
  created_at timestamptz not null default now()
);

comment on table coverage_request is 'gap requests with no build_job to raise; the builder planner reads them later (O-240)';

create index coverage_request_spot_idx on coverage_request (game_config_id, position_pair, created_at desc);

grant select, insert on coverage_request to app;
grant select on coverage_request to builder;

alter table attempt
  add column state_version integer,
  add column freq_by_action real[],
  add column ev_by_action real[],
  add column loss_pct_pot_by_action real[],
  add column best_action_indexes smallint[],
  add column graded_action_index smallint;

comment on column attempt.state_version is 'the practice_session.state_version the decision was made at (O-246)';
comment on column attempt.graded_action_index is 'the action the policy graded: the chosen action, or its group member in Grouped and Simple modes';

create unique index attempt_session_version_key on attempt (session_id, state_version)
  where state_version is not null;

-- migrate:down

drop index if exists attempt_session_version_key;
alter table attempt
  drop column if exists graded_action_index,
  drop column if exists best_action_indexes,
  drop column if exists loss_pct_pot_by_action,
  drop column if exists ev_by_action,
  drop column if exists freq_by_action,
  drop column if exists state_version;
revoke all privileges on coverage_request from app, builder;
drop table if exists coverage_request;
alter table app_user drop column if exists is_admin;
revoke insert, update on builder_setting from app;
