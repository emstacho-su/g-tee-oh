-- Extensions and enumerations (R0.6).
-- Source: A4 data model section 1 (conventions) and section 2 (schema sketch); ADR 0005 (Postgres plus an
-- S3 (Simple Storage Service) object store, migrations in plain SQL through dbmate).
-- Mechanism: the enums are Postgres types, so every later table references a shared value list and a new
-- value is added by a later migration (A4 section 1). pgcrypto supplies digest(), which the seed migration
-- uses to compute sizing_convention.spec_hash in SQL. uuidv7() needs no extension: it is native in
-- Postgres 18, which A4 section 1 asks for, so the first statement fails fast on an older server.

-- migrate:up

do $$
begin
  if current_setting('server_version_num')::int < 180000 then
    raise exception 'g-tee-oh needs Postgres 18 or later for native uuidv7() (A4 section 1), found %',
      current_setting('server_version');
  end if;
end
$$;

create extension if not exists pgcrypto;

-- Online and live are the two rake models (ADR 0014).
create type game_format as enum ('online', 'live');

-- own: built by library-builder. reference: imported by the private capture repo (A4 section 3).
create type solution_source as enum ('own', 'reference');

create type solution_kind as enum ('preflop', 'flop_build');

create type job_status as enum ('queued', 'running', 'done', 'failed', 'blocked_budget');

create type practice_mode as enum ('automated', 'drill', 'holdout', 'prediction', 'range_paint');

-- migrate:down

drop type if exists practice_mode;
drop type if exists job_status;
drop type if exists solution_kind;
drop type if exists solution_source;
drop type if exists game_format;
drop extension if exists pgcrypto;
