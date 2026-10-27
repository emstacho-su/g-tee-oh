-- api sessions and Idempotency-Key storage (R3.1).
-- Source: A9 section 3 (HTTP-only session cookies, session expiry, CSRF (cross-site request forgery)
-- protection on mutating routes); A5 section 3 (every mutating request accepts an Idempotency-Key, so a
-- double-submitted request is handled once); O-230 (synchronizer CSRF token per session), O-231 (the
-- session cookie carries a random token and only its sha256 is stored), O-232 (Idempotency-Key semantics).
-- This extends the A4 identity tables, whose status is proposed; A4 gets an errata line at the next
-- planning revision.
-- Mechanism: auth_session keeps its uuidv7 id as the row key, but the cookie never carries that id, which
-- is time-ordered and partly guessable. The cookie carries 32 random bytes; token_hash is their sha256, so
-- a copy of the table cannot be replayed as a cookie. csrf_token is a second random value per session that
-- the browser reads from POST /auth/login or GET /me and echoes in x-csrf-token; it is useless without the
-- cookie, so it is stored as is. Existing session rows predate both columns and could never be presented,
-- so they are deleted before the not-null columns are added.
-- idempotency_key holds one row per (user, key). The api claims the row before the handler runs (status_code
-- null means in flight, claim_token names the claiming request), and a handler with a side effect stores the
-- status and body in the same transaction as the side effect, so a committed write always has its stored
-- response; a repeat with the same request_hash replays it, a repeat with a different hash is refused. An
-- in-flight claim older than the api's lease may be taken over with a new claim_token, and the user's rows
-- older than the retention window are purged when that user claims a key; the created_at index serves both.

-- migrate:up

delete from auth_session;

alter table auth_session
  add column token_hash bytea not null,
  add column csrf_token text not null;

alter table auth_session add constraint auth_session_token_hash_key unique (token_hash);

comment on column auth_session.token_hash is 'sha256 of the random session token the cookie carries (O-231)';
comment on column auth_session.csrf_token is 'per-session synchronizer token sent back as x-csrf-token (O-230)';

create table idempotency_key (
  user_id uuid not null references app_user (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 255),
  method text not null,
  route text not null,
  request_hash bytea not null,
  claim_token uuid not null default gen_random_uuid(),
  status_code smallint,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, key)
);

comment on table idempotency_key is 'first response of each Idempotency-Key per user, replayed on a repeat (O-232)';
comment on column idempotency_key.status_code is 'null while the first request is still in flight';
comment on column idempotency_key.claim_token is 'which request owns the claim; a claim taken over after its lease cannot be completed by the old owner';

create index idempotency_key_created_at_idx on idempotency_key (created_at);

grant select, insert, update, delete on idempotency_key to app;

-- migrate:down

revoke all privileges on idempotency_key from app;
drop table if exists idempotency_key;
alter table auth_session drop constraint if exists auth_session_token_hash_key;
alter table auth_session drop column if exists csrf_token;
alter table auth_session drop column if exists token_hash;
