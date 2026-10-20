-- Game catalog: stake, sizing_convention and game_config (R0.6).
-- Source: A4 data model section 2 (game catalog); ADR 0014 (rake models are online and live, the dollar cap
-- converts to big blinds at the selected stake, solutions are keyed by stake); O-33 (game_config gains
-- ante_cbb, ante in centi-big-blinds, default 0, stored but not served in v1); O-71 (the unverified flag on
-- the 2/5 stake row lives in a nullable note column on stake, carrying the O-66 text, rendered as a banner
-- later); 01 product spec section 3 (the v1 configurations).
-- Mechanism: money is integer cents and chips are integer centi-big-blinds (A4 section 1), so rake_cap_cents
-- divided by bb_cents gives the cap in big blinds without floating point in the catalog. sizing_convention
-- stores the size menu as jsonb and keys it by spec_hash, the sha256 of the canonical jsonb text, so two
-- configurations that share a convention can share one row and an accidental duplicate is rejected.

-- migrate:up

create table stake (
  id uuid primary key default uuidv7(),
  format game_format not null,
  label text not null,
  bb_cents int not null,
  rake_percent_bp int not null,
  rake_cap_cents int not null,
  no_flop_no_drop bool not null,
  -- O-71: free text such as the O-66 unverified note on the 2/5 row; null when nothing is flagged.
  note text,
  unique (format, label)
);

comment on column stake.rake_percent_bp is 'rake percentage in basis points: 1000 is 10 percent (ADR 0014)';
comment on column stake.rake_cap_cents is 'rake cap in cents; divided by bb_cents it is the cap in big blinds (ADR 0014)';
comment on column stake.note is 'nullable free text for flags such as the unverified 2/5 cap (O-66, O-71)';

create table sizing_convention (
  id uuid primary key default uuidv7(),
  source text not null check (source in ('reference', 'manual')),
  spec jsonb not null,
  spec_hash bytea not null unique
);

comment on column sizing_convention.spec_hash is 'sha256 of spec::text, the canonical jsonb rendering, computed with pgcrypto digest()';

create table game_config (
  id text primary key,
  format game_format not null,
  table_size smallint not null check (table_size between 2 and 9),
  stake_id uuid not null references stake (id),
  depth_cbb int not null,
  straddle bool not null,
  sizing_convention_id uuid not null references sizing_convention (id),
  -- O-33: ante in centi-big-blinds, default 0; ante variants are stored but not served in v1.
  ante_cbb int not null default 0
);

comment on column game_config.id is 'readable key such as cfg_9_live_13_100: table size, format, stake code, depth in big blinds';
comment on column game_config.depth_cbb is 'effective stack depth in centi-big-blinds (A4 section 1)';
comment on column game_config.ante_cbb is 'ante in centi-big-blinds, default 0, stored but not served in v1 (O-33)';

create index game_config_stake_id_idx on game_config (stake_id);
create index game_config_sizing_convention_id_idx on game_config (sizing_convention_id);

-- migrate:down

drop table if exists game_config;
drop table if exists sizing_convention;
drop table if exists stake;
