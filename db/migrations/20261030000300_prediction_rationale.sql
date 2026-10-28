-- The quiz answer's typed reason and the answer it explains (R3.16, S41).
-- Source: screen review row 55 (every quiz answer forces a typed rationale to collect insight on the
-- user), O-350 (saved to the account as prediction_answer.rationale, never graded by a model), O-412
-- (3 to 1,000 characters after the api cleans control and invisible characters; the PM's change from
-- 500), O-413 (the validated answer is kept beside its reason).
-- Mechanism: prediction_answer gains rationale and answer, written by POST /prediction/{session}/answer in
-- the same idempotent transaction as the row itself. Both are nullable so rows written before S41 stay
-- valid; the api always writes both. A check bounds the reason at 1 to 1,000 characters as a second line
-- behind the api's own 3 to 1,000. Grants are unchanged: app keeps select and insert only, so a reason can
-- never be edited or deleted by the app.

-- migrate:up
alter table prediction_answer
  add column rationale text,
  add column answer jsonb,
  add constraint prediction_answer_rationale_length check (rationale is null or char_length(rationale) between 1 and 1000);

comment on column prediction_answer.rationale is 'the typed reason, cleaned at the api boundary; never graded (O-350, O-412)';
comment on column prediction_answer.answer is 'the validated answer the reason explains (O-413)';

-- migrate:down
alter table prediction_answer
  drop constraint if exists prediction_answer_rationale_length,
  drop column if exists answer,
  drop column if exists rationale;
