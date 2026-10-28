-- Invites and member names (S42, R3.1, R3.5, O-349, O-420 to O-429).
-- Source: O-349 (no public sign-up: new members join by a time-limited, single-use invite link the
-- owner makes, then give a name and a password); A9 section 3 (argon2id, least-privilege roles);
-- ADR 0001 (multi-user-ready schema). O-349 narrows O-233's "no sign-up route" to "no public sign-up".
-- Mechanism: an invite link carries "<invite id>.<secret>"; the table keeps only the sha256 of the
-- secret (secret_hash), so a copy of the table cannot be turned into a working link. The api looks the
-- row up by id and compares digests in constant time. expires_at is fixed at creation (O-420); used_at
-- and used_by are set together, inside the join transaction that creates the user (single use);
-- revoked_at is set by an admin or when a newer invite for the same email replaces this one (O-423).
-- Rows are never deleted, so the list doubles as an audit trail: the app role may read and insert,
-- and may update only the three state columns, each only from null to a value (a trigger). A partial
-- unique index keeps at most one open invite per email. app_user gains display_name (O-426), 1 to 60
-- characters, null for an account made by the create-user command; the api also rejects control and
-- invisible formatting characters before a value gets here.

-- migrate:up

alter table app_user
  add column display_name text check (display_name is null or char_length(display_name) between 1 and 60);

comment on column app_user.display_name is 'the name a member gave when joining by invite (O-426); null for the owner made by create-user';

grant insert (display_name), update (display_name) on app_user to app;

create table invite (
  id uuid primary key default uuidv7(),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  secret_hash bytea not null check (octet_length(secret_hash) = 32),
  created_by uuid not null references app_user (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references app_user (id),
  revoked_at timestamptz,
  constraint invite_expires_after_created check (expires_at > created_at),
  constraint invite_used_together check ((used_at is null) = (used_by is null)),
  constraint invite_used_or_revoked check (used_at is null or revoked_at is null)
);

comment on table invite is 'single-use, time-limited join links an admin makes (O-349); only the sha256 of each secret is kept';
comment on column invite.secret_hash is 'sha256 of the secret half of the link; the link itself is shown once and never stored';

create index invite_email_idx on invite (email);

-- At most one open (neither used nor revoked) invite per email: the backstop behind the api's
-- per-email advisory lock (S42 review round 1, A). Create revokes every open row for the email,
-- expired ones included, before it inserts; join revokes the others when it uses one.
create unique index invite_one_open_per_email_idx on invite (email) where used_at is null and revoked_at is null;

-- used_at, used_by and revoked_at only ever go from null to a value, never back and never to another
-- value, so the app role's column grant cannot make a used or revoked invite work again (S42 review
-- round 1, E). Every other column is outside the app role's update grant.
create function invite_state_is_final() returns trigger
language plpgsql
as $$
begin
  if (old.used_at is not null and new.used_at is distinct from old.used_at)
    or (old.used_by is not null and new.used_by is distinct from old.used_by)
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'an invite''s used and revoked state cannot be changed once set'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger invite_state_is_final
  before update on invite
  for each row execute function invite_state_is_final();

grant select, insert on invite to app;
grant update (used_at, used_by, revoked_at) on invite to app;

-- migrate:down

revoke all privileges on invite from app;
drop trigger if exists invite_state_is_final on invite;
drop function if exists invite_state_is_final();
drop table if exists invite;
revoke insert (display_name), update (display_name) on app_user from app;
alter table app_user drop column if exists display_name;
