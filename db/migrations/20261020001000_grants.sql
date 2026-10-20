-- Grants for app, builder, capture and query, and the revocation of every default from public (R0.6).
-- Source: A4 data model section 3 (role table) refined by O-28 (query is the read-only role for
-- solver-query, the private role is capture); A9 section 3 (least-privilege Postgres roles);
-- A5 section 1 (api connects as app, library-builder as builder, solver-query as query).
-- Mechanism: privileges are granted to the NOLOGIN group roles and reach the login users through role
-- membership, so adding a connection never needs a grant. Nothing uses ALTER DEFAULT PRIVILEGES: a table
-- added by a later migration starts with no grants and that migration states its own, which keeps every
-- privilege visible in one place per table. The grant of UPDATE (priority) on build_job is a column-level
-- grant, so app can raise a job's priority (A5 section 3, POST /coverage/requests) and nothing else on it.
-- public is revoked from the schema and the database first, so a role has exactly what is listed below.

-- migrate:up

-- Nothing for public: no schema usage, no connect, no temp (A9 section 3).
revoke all on schema public from public;
do $$
begin
  execute format('revoke all on database %I from public', current_database());
  execute format('grant connect on database %I to app, builder, capture, query', current_database());
end
$$;
grant usage on schema public to app, builder, capture, query;

-- app (api): reads and writes user, training, learning-state and explanation tables.
grant select, insert, update, delete on
  app_user, auth_session,
  drill, practice_session, attempt,
  track, rating, rating_history, schedule_card, mastery, leak_stat, leak_history,
  holdout_item, holdout_result, streak_day, cosmetic_unlock,
  explanation, llm_spend
to app;
-- app reads the catalog, the library and the empty v2 opponent_profile table.
grant select on
  stake, sizing_convention, game_config,
  solution, scenario, build_job, builder_setting, storage_ledger,
  opponent_profile
to app;
-- app may bump a build's priority and touch no other column of build_job (A4 section 3).
grant update (priority) on build_job to app;

-- builder (library-builder): reads and writes the library, reads the catalog, no user tables.
grant select, insert, update, delete on
  solution, scenario, build_job, builder_setting, storage_ledger
to builder;
grant select on stake, sizing_convention, game_config to builder;

-- capture (private repo): inserts catalog rows and solution rows, the trigger in the previous migration
-- limits solution rows to source = 'reference'. No select, so the capture tooling supplies its own ids and
-- cannot use RETURNING or ON CONFLICT, which both need SELECT.
grant insert on stake, sizing_convention, game_config, solution to capture;

-- query (solver-query): select only on the catalog and the library (O-28).
grant select on
  stake, sizing_convention, game_config,
  solution, scenario, build_job, builder_setting, storage_ledger
to query;

-- migrate:down

revoke all privileges on all tables in schema public from app, builder, capture, query;
revoke usage on schema public from app, builder, capture, query;
do $$
begin
  execute format('revoke connect on database %I from app, builder, capture, query', current_database());
  execute format('grant connect, temp on database %I to public', current_database());
end
$$;
grant usage on schema public to public;
