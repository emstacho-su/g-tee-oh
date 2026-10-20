-- Identity: app_user and auth_session (R0.6).
-- Source: A4 data model section 2 (identity); ADR 0001 (multi-user-ready schema: every user-owned row
-- carries user_id with a foreign key to app_user); A9 section 3 (argon2id password hashing, session expiry).
-- Mechanism: primary keys default to uuidv7(), native in Postgres 18, so inserts that omit the id get a
-- time-ordered key (A4 section 1). Timestamps are timestamptz throughout.

-- migrate:up

create table app_user (
  id uuid primary key default uuidv7(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table auth_session (
  id uuid primary key default uuidv7(),
  user_id uuid not null references app_user (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index auth_session_user_id_idx on auth_session (user_id);

-- migrate:down

drop table if exists auth_session;
drop table if exists app_user;
