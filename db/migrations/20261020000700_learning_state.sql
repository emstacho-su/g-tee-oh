-- Learning state: track, rating, rating_history, schedule_card, mastery, leak_stat, leak_history,
-- holdout_item, holdout_result, streak_day and cosmetic_unlock (R0.6).
-- Source: A4 data model section 2 (learning state); A4 section 1 and ADR 0001 (every user-owned table has
-- user_id and a foreign key to app_user, so the history and result tables that the sketch leaves bare get
-- the foreign key here); ADR 0011 (one overall rank with per-track ratings, Glicko-2 columns mu, rd and
-- volatility); ADR 0012 (Free Spaced Repetition Scheduler (FSRS) scheduling and Bayesian Knowledge Tracing
-- (BKT) mastery, no content gating, so cosmetic_unlock is cosmetic only).
-- Mechanism: per-user state tables are keyed by (user_id, spot_class_key) or (user_id, track_id), so one
-- row per knowledge component is updated in place while the history tables append.

-- migrate:up

create table track (
  id uuid primary key default uuidv7(),
  key text unique not null,
  family text not null check (family in ('equilibrium', 'exploit')),
  format text not null check (format in ('cash', 'mtt')),
  scope jsonb not null,
  weight real not null
);

create table rating (
  user_id uuid not null references app_user (id),
  track_id uuid not null references track (id),
  mu real not null,
  rd real not null,
  volatility real not null,
  updated_at timestamptz not null,
  primary key (user_id, track_id)
);

create table rating_history (
  user_id uuid not null references app_user (id),
  track_id uuid references track (id),
  session_id uuid references practice_session (id),
  mu real,
  rd real,
  volatility real,
  recorded_at timestamptz not null default now()
);

create index rating_history_user_track_idx on rating_history (user_id, track_id, recorded_at desc);

create table schedule_card (
  user_id uuid not null references app_user (id),
  spot_class_key text not null,
  fsrs_state jsonb not null,
  due timestamptz not null,
  primary key (user_id, spot_class_key)
);

create index schedule_card_due_idx on schedule_card (user_id, due);

create table mastery (
  user_id uuid not null references app_user (id),
  spot_class_key text not null,
  p_known real not null,
  updated_at timestamptz not null,
  primary key (user_id, spot_class_key)
);

create table leak_stat (
  user_id uuid not null references app_user (id),
  spot_class_key text not null,
  freq_prior_per_1k real not null,
  freq_personal_per_1k real,
  n int not null,
  miss_rate real not null,
  ev_per_miss_bb real not null,
  leak_cost_bb_per_1k real not null,
  computed_at timestamptz not null,
  primary key (user_id, spot_class_key)
);

create table leak_history (
  user_id uuid not null references app_user (id),
  spot_class_key text not null,
  week date not null,
  leak_cost_bb_per_1k real,
  primary key (user_id, spot_class_key, week)
);

create table holdout_item (
  id uuid primary key default uuidv7(),
  track_id uuid not null references track (id),
  solution_id uuid not null references solution (id),
  node_key text not null,
  hand text not null
);

create index holdout_item_track_id_idx on holdout_item (track_id);

create table holdout_result (
  user_id uuid not null references app_user (id),
  holdout_item_id uuid references holdout_item (id),
  attempt_id uuid references attempt (id),
  taken_at timestamptz not null
);

create index holdout_result_user_id_idx on holdout_result (user_id, taken_at desc);

create table streak_day (
  user_id uuid not null references app_user (id),
  day date not null,
  rated_decisions int not null,
  freeze_used bool not null default false,
  repaired bool not null default false,
  primary key (user_id, day)
);

create table cosmetic_unlock (
  user_id uuid not null references app_user (id),
  cosmetic_key text not null,
  unlocked_at timestamptz not null,
  primary key (user_id, cosmetic_key)
);

-- migrate:down

drop table if exists cosmetic_unlock;
drop table if exists streak_day;
drop table if exists holdout_result;
drop table if exists holdout_item;
drop table if exists leak_history;
drop table if exists leak_stat;
drop table if exists mastery;
drop table if exists schedule_card;
drop table if exists rating_history;
drop table if exists rating;
drop table if exists track;
