# db: migrations, roles and the catalog seed

This directory holds the Postgres schema for g-tee-oh as plain SQL migrations run by dbmate (architecture decision record (ADR) 0005), the catalog seed, and the tests that prove them (requirement identifier (R ID) R0.6). The schema follows the A4 data model in the planning vault; where an open-question identifier (O-ID) changed A4, the migration header says which one.

## Running migrations and tests

The recipes in the root justfile are the contract; continuous integration (CI) calls the same ones.

| Command | What it does |
|---|---|
| just dev-up | Starts the Compose dev profile (Postgres 18, SeaweedFS, Caddy) and waits for the health checks |
| just db-migrate | dbmate --wait --no-dump-schema up: applies every pending file in db/migrations |
| just db-status | dbmate status: lists applied and pending migrations |
| just db-test | node --test "db/test/*.test.mjs": the migration, role and seed tests |
| just codegen | Regenerates the Kysely types from the migrated database (ADR 0005) |
| dbmate rollback | Runs the migrate:down section of the last applied migration |

dbmate and the tests read DATABASE_URL from the environment, then from the gitignored .env at the repo root. The URL is the superuser one, postgres://postgres:...@localhost:5432/gto?sslmode=disable, because the tests SET ROLE to each group role and the migrations create roles and grants.

The app role may write only the email and password_hash of app_user, so it can never set is_admin (O-242). An admin account is created by `create-user --admin`, which connects through CREATE_USER_ADMIN_DATABASE_URL, the owner URL of the same form as DATABASE_URL, passed in the caller's environment for that one command (for example `docker compose exec -T -e CREATE_USER_ADMIN_DATABASE_URL api node dist/create-user.js --admin <email>`); it is deliberately not in .env.example.

Each migration is a timestamped file with a migrate:up and a migrate:down section and a header comment that names its source (A4 section, ADR, O-ID) and explains the mechanism before the rule. Migrations are forward-only in production (A4 section 1): the down sections exist so a developer can roll back locally and so the test suite can prove the pair is consistent. The applied list lives in the schema_migrations table dbmate maintains.

Order of the files:

| File | Contents |
|---|---|
| 20261020000100_extensions_and_enums.sql | Postgres 18 check, pgcrypto, the five enums |
| 20261020000200_roles.sql | Group roles app, builder, capture, query (NOLOGIN) |
| 20261020000300_identity.sql | app_user, auth_session |
| 20261020000400_catalog.sql | stake (with note, O-71), sizing_convention, game_config (with ante_cbb, O-33) |
| 20261020000500_library.sql | solution, scenario (v1 per O-17), build_job and its queue index, builder_setting, storage_ledger |
| 20261020000600_training.sql | drill, practice_session, attempt |
| 20261020000700_learning_state.sql | track, rating, rating_history, schedule_card, mastery, leak_stat, leak_history, holdout_item, holdout_result, streak_day, cosmetic_unlock |
| 20261020000800_explanations.sql | explanation, llm_spend, opponent_profile |
| 20261020000900_capture_solution_guard.sql | The BEFORE INSERT trigger on solution |
| 20261020001000_grants.sql | Revocation from public, grants per role |
| 20261020001100_seed_catalog.sql | Three stakes, eleven placeholder sizing conventions, eleven game_config rows |
| 20261027000100_api_auth_idempotency.sql | auth_session token_hash and csrf_token (O-230, O-231), idempotency_key and its app grant (O-232) |
| 20261027000200_solution_publish_record.sql | The builder's publish record on solution (S18) |
| 20261028000100_api_trainer.sql | builder_setting writes for app (O-241), app_user.is_admin (O-242), coverage_request (O-240), attempt feedback columns (O-246) |
| 20261029000100_insights_explanations.sql | prediction_answer and its app grant (O-301), attempt.action_kinds for range drift (O-304) |
| 20261029000200_api_learning.sql | The seven tracks (O-271), attempt hand_class and panels_revealed (O-274), the holdout draw, round, summary and result columns (O-276, O-277), one open holdout session per user, the idle closer's failure columns on practice_session, app_job (O-275) |

## Role model

Privileges belong to four NOLOGIN group roles (A4 section 3, refined by O-28, which gives solver-query its own read-only role instead of sharing builder). Nobody connects as a group role. The Compose init script creates one login user per group (app_login, builder_login, capture_login, query_login), gives each the password from .env, and makes it a member of its group, so the login user inherits the group's privileges at connect time. Adding a connection therefore never needs a grant, and no password ever appears in SQL.

| Role | Used by | Reads | Writes | Explicitly not |
|---|---|---|---|---|
| app | api (A5 section 1) | catalog, library, opponent_profile | user, training, learning-state and explanation tables; UPDATE (priority) on build_job | status or any other build_job column, builder_setting, any schema named capture |
| builder | library-builder | catalog | solution, scenario, build_job, builder_setting, storage_ledger | user tables |
| capture | the private capture repo | nothing | INSERT on stake, sizing_convention, game_config, solution (source reference only, see below) | select, update or delete anywhere |
| query | solver-query | catalog, library | nothing | everything else |

Everything is revoked from public first: no usage on the public schema, no connect or temp on the database, and no table grant, so a role holds exactly what the table lists. No ALTER DEFAULT PRIVILEGES is used; a table added by a later migration starts with no grants and that migration states its own, which keeps every privilege visible next to the table it covers.

The user tables are app_user, auth_session, drill, practice_session, attempt, track, rating, rating_history, schedule_card, mastery, leak_stat, leak_history, holdout_item, holdout_result, streak_day, cosmetic_unlock, explanation and llm_spend. The catalog is stake, sizing_convention and game_config. The library is solution, scenario, build_job, builder_setting and storage_ledger.

Two consequences of the capture grant set that the private repo must plan for: a capture connection cannot use RETURNING or ON CONFLICT, since both need SELECT, so the capture tooling generates its own ids (uuidv7 or uuid4 are both fine) and keeps its own record of what it inserted; and a schema named capture is created by the private repo's migrations, not here. The test for app's lack of access to that schema creates a scratch schema inside a transaction, checks has_schema_privilege, and rolls back.

## The capture trigger

A table-level INSERT grant cannot restrict one column to one value, and a CHECK constraint cannot see who is inserting. The migration 20261020000900_capture_solution_guard.sql therefore installs a BEFORE INSERT row trigger on solution that:

1. Reads current_user, which under SET ROLE or a login user that inherits from capture is the role whose privileges apply.
2. Asks pg_roles whether that role is a superuser. Superusers are exempt, because pg_has_role() reports a superuser as a member of every role and a superuser bypasses privilege checks in any case.
3. Asks pg_has_role(current_user, 'capture', 'member') whether the actor is capture or a member of it.
4. Raises insufficient_privilege (SQLSTATE 42501) when the actor is a capture member and new.source is not reference.

capture holds no TRIGGER or ownership right on solution, so it cannot disable or replace the trigger, and it has no UPDATE grant, so a row's source cannot be flipped after the insert. The role tests cover both the allowed reference insert and the refused own insert.

## uuidv7

Primary keys default to uuidv7(), which is native in Postgres 18 (A4 section 1 asks for time-ordered keys). The first migration raises if the server is older, so the error names the real cause instead of an unknown function later in the run. The Compose image is postgres:18-alpine. No extension is needed for uuidv7; pgcrypto is installed only for digest(), which the seed uses to compute sizing_convention.spec_hash as sha256 of spec::text, the canonical jsonb rendering.

## The seed

The seed (01 product spec section 3, ADR 0014, O-72) inserts:

- Three stakes. live 1/3 at 300 cents a big blind, 10 percent rake capped at 500 cents (1.67 big blinds). live 2/5 at 500 cents, same rake, capped at 500 cents (1.00 big blinds), with note "cap unverified, O-2 and O-66" (O-71 puts the flag in the nullable note column). online at 50 cents a big blind with 5 percent capped at 150 cents, note "placeholder rake pending O-7".
- One placeholder sizing convention per configuration, source manual, so the not-null constraint on game_config.sizing_convention_id holds before Phase 1 data lands. Each spec names the configuration it stands in for, which keeps spec_hash unique.
- Eleven game_config rows: cfg_6_online_100, cfg_6_online_150, cfg_6_online_200, cfg_9_live_13_100 to cfg_9_live_13_300 and cfg_9_live_25_100 to cfg_9_live_25_300, straddle false and ante_cbb 0.

## Credential rule

The repo root .env.example lists every variable with a comment and placeholder values. The local .env is gitignored and holds dev-only values generated by the Compose agent. Migrations never contain a password: roles are created NOLOGIN here and the login users with their passwords come from the Compose init script, which reads POSTGRES_PASSWORD, APP_DB_PASSWORD, BUILDER_DB_PASSWORD, CAPTURE_DB_PASSWORD and QUERY_DB_PASSWORD from .env. Tests and dbmate use the superuser DATABASE_URL; services use their own role's URL. Never commit .env, never print a real credential in a log or a test name, and never write a value from .env into a file under version control.
