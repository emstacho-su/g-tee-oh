-- The hand log: one row per finished hand (R3.13, S40, O-352, O-400 to O-403).
-- Source: O-352 (hand summaries are not shown; each finished hand is logged under the user's account
-- with its session, hand number, history, board, end reason and hero position); O-400 (written in the
-- transaction of the decision that ends the hand); O-401 (the ending attempt and the hero's hole cards
-- join O-352's list); O-402 (every graded mode logs hands); ADR 0001 (user_id with a foreign key on
-- every user-owned row).
-- Mechanism: POST /sessions/{id}/decisions runs the session's machine forward from the decided state
-- to the hand's end before its transaction opens (never dealing the next hand) and, when the hand
-- ended, inserts this row right after the attempt, so the row commits or rolls back with the decision.
-- The row copies what the next prompt's previous_hand says about the hand (hand_no, history, board,
-- end), plus the hero's seat and cards and the attempt that ended it.
-- Owner scope in the schema: the session reference is the pair (session_id, user_id) against
-- practice_session (id, user_id), so a row can only name a session of its own user. That needs a
-- unique (id, user_id) on practice_session; id is already the primary key, so the new index is
-- built once over a small personal table (a short ACCESS EXCLUSIVE lock at this size) and never
-- rejects a row. The api also scopes every read by user_id.
-- The log is append-only: the app role may read and insert, never update or delete. builder, capture
-- and query get nothing. Rows go when their user, session or attempt goes (cascade), as attempts do.

-- migrate:up

alter table practice_session
  add constraint practice_session_id_user_key unique (id, user_id);

create table hand_record (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id) on delete cascade,
  session_id uuid not null,
  attempt_id uuid not null unique references attempt (id) on delete cascade,
  hand_no int not null check (hand_no >= 0),
  hero_position text not null check (char_length(hero_position) between 2 and 4),
  hero_hand text not null check (char_length(hero_hand) = 4),
  history jsonb not null check (jsonb_typeof(history) = 'array'),
  board text[] not null default '{}' check (cardinality(board) <= 5),
  end_reason text not null check (end_reason in ('fold', 'street_closed', 'off_range', 'stop_rule')),
  created_at timestamptz not null default now(),
  constraint hand_record_session_owner_fkey foreign key (session_id, user_id)
    references practice_session (id, user_id) on delete cascade,
  constraint hand_record_session_hand_key unique (session_id, hand_no)
);

comment on table hand_record is 'one row per finished hand, written with the decision that ended it (O-352, O-400); append-only';
comment on column hand_record.attempt_id is 'the decision that ended the hand (O-401)';
comment on column hand_record.history is 'the hand''s actions as the prompt showed them, each with its street';
comment on column hand_record.board is 'the board the hand reached: the flop when a full hand ended at its reveal';
comment on column hand_record.end_reason is 'previous_hand.end: fold, street_closed, off_range or stop_rule';

create index hand_record_user_timeline_idx on hand_record (user_id, created_at desc);

grant select, insert on hand_record to app;

-- migrate:down

revoke all privileges on hand_record from app;
drop table if exists hand_record;
alter table practice_session drop constraint if exists practice_session_id_user_key;
