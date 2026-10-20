-- Explanations, the monthly LLM (large language model) spend and the empty v2 opponent_profile table (R0.6).
-- Source: A4 data model section 2 (explanations, opponent profiles); ADR 0016 (explanations are cached per
-- node, hand and question so the same question is never paid for twice); A5 section 5 (the monthly cap in
-- llm_spend guards the only external call); ADR 0010 (opponent profiles are v2, created empty so
-- attempt.reference_strategy has a target later).
-- Mechanism: the unique key on (solution_id, node_key, hand, question_hash) is the cache key, and
-- validated records whether the response validator accepted the text before it is shown.

-- migrate:up

create table explanation (
  id uuid primary key default uuidv7(),
  solution_id uuid references solution (id),
  node_key text,
  hand text,
  question_hash bytea,
  model text,
  text text not null,
  validated bool not null,
  cost_cents int not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (solution_id, node_key, hand, question_hash)
);

create table llm_spend (
  month date primary key,
  cents int not null
);

-- v2, created empty so attempt.reference_strategy has a target later (A4 section 2, ADR 0010).
create table opponent_profile (
  id uuid primary key default uuidv7(),
  style text not null,
  deviation_strength real not null,
  parameters jsonb not null
);

-- migrate:down

drop table if exists opponent_profile;
drop table if exists llm_spend;
drop table if exists explanation;
