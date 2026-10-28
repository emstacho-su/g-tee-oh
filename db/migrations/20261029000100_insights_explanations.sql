-- Prediction answers and the action kinds range drift reads (R3.16, R3.18).
-- Source: 05 sections 8 and 9; A4 section 2 (attempt, practice_mode); S27 plan decisions 3, 6, 7 and
-- 14; O-301 (prediction levels unlock per spot class and ladder from the user's own answers),
-- O-302 (prediction and range_paint sessions are drill-backed and write no attempt row), O-304
-- (drift compares the user's chosen action kind with the solver's frequencies by kind).
-- Mechanism:
-- - prediction_answer keeps one row per answered prediction prompt: the spot class, the ladder, the
--   level it was asked at and whether it was correct. The api reads the last answers per (user, spot
--   class, ladder, level) to decide the unlock (packages/learning prediction-levels). A prediction is
--   never an attempt, so it can never reach the rating, scheduling or leak tables (R3.16: unrated).
-- - attempt.action_kinds stores the kinds of the node's actions in record order, copied from
--   solver-query's node actions when the decision is graded (ADR 0004: Rust names the kinds), so drift
--   can add the solver's frequencies by kind across nodes without reading solver-query again. Rows
--   written before this migration keep null and drift skips them.

-- migrate:up

create table prediction_answer (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id) on delete cascade,
  session_id uuid not null references practice_session (id) on delete cascade,
  spot_class_key text not null,
  ladder text not null check (ladder in ('range', 'hand')),
  level smallint not null check (level between 1 and 3),
  correct boolean not null,
  created_at timestamptz not null default now()
);

comment on table prediction_answer is 'answered prediction prompts; unrated, never an attempt (R3.16, O-301)';

create index prediction_answer_level_idx on prediction_answer (user_id, spot_class_key, ladder, level, created_at desc);

grant select, insert on prediction_answer to app;

alter table attempt add column action_kinds text[];

comment on column attempt.action_kinds is 'the node''s action kinds in record order, from solver-query (O-304)';

-- migrate:down

alter table attempt drop column if exists action_kinds;
drop table if exists prediction_answer;
