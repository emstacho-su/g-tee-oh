-- Guard: the capture role may insert solution rows with source = 'reference' only (R0.6).
-- Source: A4 data model section 3 (capture inserts solution rows with source = 'reference', nothing else);
-- O-28 (the private capture repo connects under the capture role); A9 section 3 (least privilege).
-- Mechanism: a table-level INSERT grant cannot restrict a column to one value, and a CHECK constraint
-- cannot see who is inserting, so a BEFORE INSERT row trigger does both. It reads current_user, which under
-- SET ROLE or a login user that inherits from capture is the role whose privileges apply, asks the catalog
-- whether that role is capture or a member of it, and raises insufficient_privilege when the row's source
-- is anything but reference. Superusers are exempt because pg_has_role() reports a superuser as a member of
-- every role, and a superuser bypasses privilege checks anyway. The trigger function is owned by the
-- migration user, capture holds no TRIGGER or ownership rights on solution, so capture cannot disable or
-- replace it, and capture has no UPDATE grant, so the source cannot be flipped after the insert.

-- migrate:up

create function solution_capture_source_guard() returns trigger
language plpgsql
as $$
declare
  actor_is_superuser bool;
begin
  select rolsuper into actor_is_superuser from pg_roles where rolname = current_user;
  if new.source <> 'reference'
     and not coalesce(actor_is_superuser, false)
     and pg_has_role(current_user, 'capture', 'member') then
    raise exception 'role capture may insert solution rows with source reference only, got %', new.source
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

comment on function solution_capture_source_guard() is 'raises when a member of the capture role inserts a solution whose source is not reference (A4 section 3, O-28)';

create trigger solution_capture_source_guard
  before insert on solution
  for each row
  execute function solution_capture_source_guard();

-- migrate:down

drop trigger if exists solution_capture_source_guard on solution;
drop function if exists solution_capture_source_guard();
