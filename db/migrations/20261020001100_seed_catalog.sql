-- Catalog seed: three stakes, one placeholder sizing convention per configuration, eleven game_config rows
-- (R0.6).
-- Source: 01 product spec section 3 (online 6-max at 100, 150 and 200 big blinds (bb) on one online rake
-- profile; live 9-handed at 100, 150, 200 and 300bb at the 1/3 and 2/5 stakes); ADR 0014 (live rake is
-- 10 percent up to the stake's cap, no flop no drop; the cap converts to bb at the stake); O-2 and O-66
-- (the 2/5 cap is the $5 default until the owner verifies it, the row is flagged unverified); O-71 (the flag
-- is the nullable note column); O-7 (the online rake profile is unsettled, so its row is a placeholder);
-- O-72 (straddle-off rows only, eleven game_config rows; straddle-on rows come with R1.6); O-33 (ante_cbb 0);
-- ADR 0021 and 01 section 3 (real sizing conventions come from Phase 1 data, so these are source manual).
-- Mechanism: every configuration needs a not-null sizing_convention_id before Phase 1 data lands, so each
-- gets its own placeholder row whose spec names the configuration it stands in for, which keeps spec_hash
-- unique. The hash is digest(spec::text, 'sha256') from pgcrypto, where spec::text is the canonical jsonb
-- rendering (keys sorted, fixed spacing), so the same spec always hashes the same way. Placeholder sizes:
-- open_bb and straddle_bb are in big blinds, iso_rule is a base plus an amount per limper in big blinds,
-- threebet and fourbet are multiples of the raise they answer, postflop lists bet sizes per street as
-- fractions of the pot. The online values follow common 6-max defaults (2.5bb open, 3x and 4x three-bets)
-- and the live values follow common 9-handed room defaults (4bb open); Phase 1 replaces them.

-- migrate:up

-- Stakes (ADR 0014). bb_cents 50 on the online row is a placeholder: O-7 settles which online rake set
-- defines the online profile, and with it the stake the profile is keyed at.
insert into stake (format, label, bb_cents, rake_percent_bp, rake_cap_cents, no_flop_no_drop, note) values
  ('online', 'online', 50, 500, 150, false, 'placeholder rake pending O-7'),
  ('live', '1/3', 300, 1000, 500, true, null),
  ('live', '2/5', 500, 1000, 500, true, 'cap unverified, O-2 and O-66');

with base (format, open_bb, iso_rule, threebet_ip, threebet_oop, fourbet, postflop) as (
  values
    ('online'::game_format, 2.5, '{"base_bb": 3.0, "per_limper_bb": 1.0}'::jsonb, 3.0, 4.0, 2.2,
      '{"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}'::jsonb),
    ('live'::game_format, 4.0, '{"base_bb": 4.0, "per_limper_bb": 1.0}'::jsonb, 3.0, 3.5, 2.3,
      '{"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}'::jsonb)
),
cfg (id, format, table_size, stake_label, depth_cbb) as (
  values
    ('cfg_6_online_100', 'online'::game_format, 6::smallint, 'online', 10000),
    ('cfg_6_online_150', 'online'::game_format, 6::smallint, 'online', 15000),
    ('cfg_6_online_200', 'online'::game_format, 6::smallint, 'online', 20000),
    ('cfg_9_live_13_100', 'live'::game_format, 9::smallint, '1/3', 10000),
    ('cfg_9_live_13_150', 'live'::game_format, 9::smallint, '1/3', 15000),
    ('cfg_9_live_13_200', 'live'::game_format, 9::smallint, '1/3', 20000),
    ('cfg_9_live_13_300', 'live'::game_format, 9::smallint, '1/3', 30000),
    ('cfg_9_live_25_100', 'live'::game_format, 9::smallint, '2/5', 10000),
    ('cfg_9_live_25_150', 'live'::game_format, 9::smallint, '2/5', 15000),
    ('cfg_9_live_25_200', 'live'::game_format, 9::smallint, '2/5', 20000),
    ('cfg_9_live_25_300', 'live'::game_format, 9::smallint, '2/5', 30000)
),
spec as (
  select
    cfg.id,
    cfg.format,
    cfg.table_size,
    cfg.stake_label,
    cfg.depth_cbb,
    jsonb_build_object(
      'placeholder_for', cfg.id,
      'open_bb', base.open_bb,
      'iso_rule', base.iso_rule,
      'threebet_ip', base.threebet_ip,
      'threebet_oop', base.threebet_oop,
      'fourbet', base.fourbet,
      'straddle_bb', null,
      'postflop', base.postflop
    ) as spec
  from cfg
  join base on base.format = cfg.format
),
conv as (
  insert into sizing_convention (source, spec, spec_hash)
  select 'manual', spec.spec, digest(spec.spec::text, 'sha256')
  from spec
  returning id, spec
)
insert into game_config (id, format, table_size, stake_id, depth_cbb, straddle, sizing_convention_id, ante_cbb)
select
  spec.id,
  spec.format,
  spec.table_size,
  stake.id,
  spec.depth_cbb,
  false,
  conv.id,
  0
from spec
join stake on stake.format = spec.format and stake.label = spec.stake_label
join conv on conv.spec ->> 'placeholder_for' = spec.id;

-- migrate:down

delete from game_config where id in (
  'cfg_6_online_100', 'cfg_6_online_150', 'cfg_6_online_200',
  'cfg_9_live_13_100', 'cfg_9_live_13_150', 'cfg_9_live_13_200', 'cfg_9_live_13_300',
  'cfg_9_live_25_100', 'cfg_9_live_25_150', 'cfg_9_live_25_200', 'cfg_9_live_25_300'
);
delete from sizing_convention where source = 'manual' and spec ? 'placeholder_for';
delete from stake where (format, label) in (('online', 'online'), ('live', '1/3'), ('live', '2/5'));
