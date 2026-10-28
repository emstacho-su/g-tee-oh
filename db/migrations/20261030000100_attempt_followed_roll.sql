-- The followed-the-roll mark of Mixed-frequency mode (R3.10, S37).
-- Source: ADR 0024 rule 2 (the roll never changes the label; the feedback adds a separate mark, followed the
-- roll or did not), O-344 (the mode), O-371 (the mark is stored with the attempt, so the feedback renders
-- from the row alone, O-92), O-345 and O-373 (the confidence tap is retired; attempt.confidence stays,
-- nullable, and is no longer written).
-- Mechanism: attempt gains followed_roll, set from learning's grade() followedRoll when the decision was
-- made with a roll (rng_roll not null) and null otherwise. Rows written before this migration have no mark
-- and keep null, which the feedback reports as "no mark". A check keeps the mark and the roll together.

-- migrate:up
alter table attempt
  add column followed_roll boolean,
  add constraint attempt_followed_roll_needs_roll check (followed_roll is null or rng_roll is not null);

comment on column attempt.followed_roll is 'Mixed-frequency mode: the chosen group holds the roll-selected action (ADR 0024, O-371); null without a roll';
comment on column attempt.confidence is 'retired with the confidence tap (O-345, O-373): no longer written; rows before S37 keep their value';

-- migrate:down
comment on column attempt.confidence is null;
alter table attempt
  drop constraint if exists attempt_followed_roll_needs_roll,
  drop column if exists followed_roll;
