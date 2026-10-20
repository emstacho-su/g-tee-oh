-- Postgres first-run init for the Compose profiles (R0.5, O-28). The official image runs every file in
-- /docker-entrypoint-initdb.d once, when the data volume is empty, against POSTGRES_DB and with the
-- container environment, before any migration can run.
--
-- Mechanism: the group roles app, builder, capture and query are NOLOGIN roles that the dbmate migrations
-- (R0.6, architecture decision record (ADR) 0005) also create and then grant privileges to. On an empty
-- database this file runs first, so it creates each group role only when it is missing; the migrations
-- find it present and own every grant. The login users app_login, builder_login, capture_login and
-- query_login carry the passwords from the environment through psql's \getenv, so no password is written
-- into SQL (Structured Query Language) text or a shell command line.
-- A plain .sql file runs the same way whether or not the bind mount carries an executable bit, which a
-- .sh file would need to avoid being sourced into the entrypoint shell.

\set ON_ERROR_STOP on

\getenv app_pw APP_DB_PASSWORD
\getenv builder_pw BUILDER_DB_PASSWORD
\getenv capture_pw CAPTURE_DB_PASSWORD
\getenv query_pw QUERY_DB_PASSWORD

-- Fail the init loudly when a password is missing; a silent init would leave the logins unusable.
\if :{?app_pw}
\else
do $$ begin raise exception 'postgres-init: APP_DB_PASSWORD is not set; the Compose file passes it from .env'; end $$;
\endif
\if :{?builder_pw}
\else
do $$ begin raise exception 'postgres-init: BUILDER_DB_PASSWORD is not set; the Compose file passes it from .env'; end $$;
\endif
\if :{?capture_pw}
\else
do $$ begin raise exception 'postgres-init: CAPTURE_DB_PASSWORD is not set; the Compose file passes it from .env'; end $$;
\endif
\if :{?query_pw}
\else
do $$ begin raise exception 'postgres-init: QUERY_DB_PASSWORD is not set; the Compose file passes it from .env'; end $$;
\endif

-- Group roles (O-28): NOLOGIN, created only when missing. \gexec runs each generated statement.
select format('create role %I nologin', r.name)
from (values ('app'), ('builder'), ('capture'), ('query')) as r (name)
where not exists (select 1 from pg_roles where rolname = r.name)
\gexec

-- Login users, one per group role, with the password from the environment; %L quotes it as a literal.
select format('create role %I login password %L', u.login, u.pw)
from (values ('app_login', :'app_pw'), ('builder_login', :'builder_pw'),
             ('capture_login', :'capture_pw'), ('query_login', :'query_pw')) as u (login, pw)
where not exists (select 1 from pg_roles where rolname = u.login)
\gexec

-- Membership: each login inherits the privileges the migrations grant to its group role.
grant app to app_login;
grant builder to builder_login;
grant capture to capture_login;
grant query to query_login;
