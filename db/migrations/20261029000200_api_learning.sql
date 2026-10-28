-- The api learning layer: the seven v1 tracks, the attempt item columns, the holdout draw, rounds and
-- summaries, and the app job queue (R4.10, R4.11, R4.13, R4.14).
-- Source: A4 section 2 (learning state), whose status is proposed (A4 gets an errata line at the next
-- planning revision: app_job, holdout_draw, holdout_round, holdout_summary and the new attempt,
-- holdout_item and holdout_result columns are beyond its sketch); ADR 0005 (a Postgres table claimed with
-- FOR UPDATE SKIP LOCKED is the job mechanism); ADR 0011 (tracks); ADR 0001 (every user-owned table has
-- user_id); O-271 (tracks), O-274 (rated rules), O-275 (jobs), O-276 (holdout), O-277 (Goodhart flag).
-- Mechanism:
-- - track gets the seven v1 rows (O-271): family equilibrium, format cash, weight 1 (an enable multiplier;
--   the effective weight is computed on read), and scope jsonb naming the Rust action families, which hero
--   seats (any, non_blind or blind) and which formats the track takes. services/api/src/learning/tracks.ts
--   holds the same table and a database test compares the two.
-- - attempt gains hand_class (the hero's row label at the node, from solver-query) and panels_revealed
--   (O-274). attempt_item_idx serves the first-attempt rule over (solution, node, hand class); the GIN
--   index on track_ids serves per-track counts and averages.
-- - holdout_item becomes a stored deal (O-276): its class, configuration, pair, line, hero seat and the
--   deal seed replay it; one item per (track, solution, node, hand). The table is empty until the draw job
--   runs, so the new not null columns need no default. holdout_draw records each track's one-shot draw
--   (never redrawn), holdout_round one retest round per user and month, holdout_summary the round's close
--   per track with the Goodhart flag (O-277), and holdout_result carries its round.
-- - Holdout integrity (PR #27 review HIGH 1, HIGH 4): holdout_round.order_seed fixes the order the round
--   serves its items in for its user; holdout_result.outcome says whether an item was answered (with its
--   attempt), skipped (served in a session that ended or was replaced before an answer, scored 0) or
--   unservable (its replay no longer matches, or solver-query refused it with a 4xx, this round: unscored;
--   a transient failure resolves nothing, O-334); holdout_item.history keeps the line's actions as
--   solver-query labelled them at the draw, so serving an item needs no class catalog; and the partial
--   unique index practice_session_open_holdout_key allows one open holdout session per user.
-- - The idle closer (PR #27 review follow-up LOW 3): practice_session.idle_close_failures and
--   idle_close_failed_at record each end that failed for the session's own reasons, so the closer queues
--   such sessions after every other idle session and one batch of them cannot block the rest.
-- - app_job is the api's job queue (O-275, ADR 0005): one row per kind and period, claimed with FOR UPDATE
--   SKIP LOCKED over the queued rows that are due or the running rows whose lease ran out, so a job whose
--   process died is claimed again. The partial index serves the due scan.
-- - app gets select, insert and update on app_job and holdout_round, only select and insert on the
--   write-once holdout_draw and holdout_summary (PR #27 review LOW 13), and delete only on app_job (the
--   done-job prune, PR #27 review MEDIUM 9); builder, capture and query get nothing on them.

-- migrate:up

insert into track (key, family, format, scope, weight) values
  ('opens', 'equilibrium', 'cash',
    '{"families": ["rfi"], "hero": "any", "formats": ["online", "live"]}', 1),
  ('facing-open-ip', 'equilibrium', 'cash',
    '{"families": ["facing-open", "squeeze"], "hero": "non_blind", "formats": ["online", "live"]}', 1),
  ('blind-defense', 'equilibrium', 'cash',
    '{"families": ["facing-open", "squeeze"], "hero": "blind", "formats": ["online", "live"]}', 1),
  ('facing-3bet', 'equilibrium', 'cash',
    '{"families": ["facing-3bet"], "hero": "any", "formats": ["online", "live"]}', 1),
  ('four-bet-plus', 'equilibrium', 'cash',
    '{"families": ["facing-4bet"], "hero": "any", "formats": ["online", "live"]}', 1),
  ('blind-vs-blind', 'equilibrium', 'cash',
    '{"families": ["blind-vs-blind"], "hero": "any", "formats": ["online", "live"]}', 1),
  ('live-limped-straddled', 'equilibrium', 'cash',
    '{"families": ["limped-isolation", "straddled-pot"], "hero": "any", "formats": ["live"]}', 1);

alter table attempt
  add column hand_class text,
  add column panels_revealed boolean not null default false;

comment on column attempt.hand_class is 'the hero''s row label at the node as solver-query names it (O-274)';
comment on column attempt.panels_revealed is 'an answer-revealing panel was on when the decision was made (O-274)';

create index attempt_item_idx on attempt (user_id, solution_id, node_key, hand_class);
create index attempt_track_ids_idx on attempt using gin (track_ids);

alter table holdout_item
  add column spot_class_key text not null,
  add column config_id text not null references game_config (id),
  add column pair text not null,
  add column line text,
  add column hero_position text not null,
  add column deal_seed text not null,
  add column history jsonb not null,
  add column drawn_at timestamptz not null default now(),
  add constraint holdout_item_once_key unique (track_id, solution_id, node_key, hand);

comment on column holdout_item.deal_seed is 'the stored deal seed that replays the item (O-276)';
comment on column holdout_item.history is
  'the line''s actions (position, token, label) as solver-query labelled them at the draw (PR #27 review HIGH 4)';

create table holdout_draw (
  track_id uuid primary key references track (id),
  seed text not null,
  items int not null,
  drawn_at timestamptz not null default now()
);

comment on table holdout_draw is 'one recorded draw per track, never redrawn (O-276)';

create table holdout_round (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id) on delete cascade,
  month date not null,
  order_seed text not null check (order_seed ~ '^[0-9a-f]{16}$'),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (user_id, month)
);

comment on column holdout_round.order_seed is 'fixes the round''s serving order for its user (PR #27 review HIGH 1)';

create table holdout_summary (
  round_id uuid not null references holdout_round (id) on delete cascade,
  track_id uuid not null references track (id),
  answered int not null,
  total int not null,
  mean_score real,
  mu real,
  rd real,
  goodhart_flag boolean not null default false,
  primary key (round_id, track_id)
);

alter table holdout_result
  add column round_id uuid references holdout_round (id),
  add column outcome text not null default 'answered' check (outcome in ('answered', 'skipped', 'unservable')),
  add constraint holdout_result_once_key unique (user_id, holdout_item_id, round_id),
  add constraint holdout_result_attempt_check check ((outcome = 'answered') = (attempt_id is not null));

comment on column holdout_result.outcome is
  'answered (with its attempt), skipped (served, then its session ended unanswered: score 0) or unservable (PR #27 review HIGH 1, HIGH 4)';

create unique index practice_session_open_holdout_key on practice_session (user_id)
  where mode = 'holdout' and ended_at is null;

alter table practice_session
  add column idle_close_failures integer not null default 0 check (idle_close_failures >= 0),
  add column idle_close_failed_at timestamptz;

comment on column practice_session.idle_close_failures is
  'ends the idle closer tried that failed for the session''s own reasons (PR #27 review follow-up LOW 3)';
comment on column practice_session.idle_close_failed_at is
  'the last such failure; the closer queues sessions with one after every other idle session';

create table app_job (
  id uuid primary key default uuidv7(),
  kind text not null,
  period_key text not null,
  run_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts smallint not null default 0,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, period_key)
);

comment on table app_job is 'the api job queue: one row per kind and period, claimed with skip locked (O-275, ADR 0005)';

create index app_job_due_idx on app_job (run_at) where status = 'queued';

grant select, insert, update on app_job, holdout_round to app;
-- PR #27 review LOW 13: a draw and a round's summaries are written once and never changed.
grant select, insert on holdout_draw, holdout_summary to app;
-- PR #27 review MEDIUM 9: the job worker prunes done app_job rows past their retention (jobs/repository.ts
-- pruneDoneJobs), the only delete the app makes on the new tables.
grant delete on app_job to app;

-- migrate:down

revoke all privileges on app_job, holdout_draw, holdout_round, holdout_summary from app;
drop table if exists app_job;
drop index if exists practice_session_open_holdout_key;
alter table practice_session
  drop column if exists idle_close_failed_at,
  drop column if exists idle_close_failures;
alter table holdout_result drop constraint if exists holdout_result_attempt_check;
alter table holdout_result drop constraint if exists holdout_result_once_key;
alter table holdout_result drop column if exists outcome;
alter table holdout_result drop column if exists round_id;
drop table if exists holdout_summary;
drop table if exists holdout_round;
drop table if exists holdout_draw;
alter table holdout_item
  drop constraint if exists holdout_item_once_key,
  drop column if exists drawn_at,
  drop column if exists history,
  drop column if exists deal_seed,
  drop column if exists hero_position,
  drop column if exists line,
  drop column if exists pair,
  drop column if exists config_id,
  drop column if exists spot_class_key;
drop index if exists attempt_track_ids_idx;
drop index if exists attempt_item_idx;
alter table attempt
  drop column if exists panels_revealed,
  drop column if exists hand_class;
delete from track where key in (
  'opens', 'facing-open-ip', 'blind-defense', 'facing-3bet', 'four-bet-plus', 'blind-vs-blind',
  'live-limped-straddled'
);
