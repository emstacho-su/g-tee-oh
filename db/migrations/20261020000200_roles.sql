-- Group roles app, builder, capture and query (R0.6).
-- Source: A4 data model section 3 (roles), refined by O-28 (the private schema and role are named capture,
-- and solver-query reads under its own read-only query role instead of sharing builder); A9 section 3
-- (least-privilege Postgres roles).
-- Mechanism: the four roles are NOLOGIN group roles. Nobody connects as them. The Compose init script creates
-- the login users (app_login, builder_login, capture_login, query_login) with passwords from the local .env
-- and makes each a member of its group, so the privileges granted here are inherited at connect time and no
-- password ever appears in a migration. Roles are cluster-wide, so each create is guarded by a catalog check:
-- "create role if not exists" does not exist in Postgres, and a DO block gives the same semantics, which lets
-- the same migrations run against a second database on the same server (the empty-database test does that).

-- migrate:up

do $$
declare
  role_name text;
begin
  foreach role_name in array array['app', 'builder', 'capture', 'query'] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin', role_name);
    end if;
  end loop;
end
$$;

comment on role app is 'api service: reads and writes user, training, learning-state and explanation tables; reads catalog and library (A4 section 3, O-28)';
comment on role builder is 'library-builder: reads and writes library tables, reads the catalog (A4 section 3)';
comment on role capture is 'private capture repo: inserts reference solutions and catalog rows only (A4 section 3, O-28)';
comment on role query is 'solver-query: select only on catalog and library tables (O-28)';

-- migrate:down

-- Dropping a group role also drops its memberships. It fails while another database on the same server still
-- grants the role privileges, which is the intended safety: run the down of every later migration first.
drop role if exists query;
drop role if exists capture;
drop role if exists builder;
drop role if exists app;
