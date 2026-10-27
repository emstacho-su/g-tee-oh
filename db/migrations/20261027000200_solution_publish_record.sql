-- What the builder recorded when it published an own flop build: its job, tree hash and bytes (R2.17).
-- Source: O-186 (a published build the verify pass finds broken is marked unavailable, its own job is
-- re-queued and its bytes leave the storage ledger); PR #22 re-review HIGH 1 (the verify pass took the job's
-- tree hash and the build's bytes from the build's own manifest, so a build whose prefix or manifest was
-- gone re-queued nothing and gave back no bytes: the done job row kept the spot planned, the spot was lost
-- for good and its bytes stayed on the ledger); A4 data model section 2 (library), whose status is
-- proposed; A4 gets an errata line at the next planning revision.
-- Mechanism: three nullable columns on solution, written by the publish transaction (T2) from the build_job
-- row it marks done and the bytes it adds to the ledger. Marking a solution unavailable then reads them
-- from the database, never from the store: it re-queues exactly the row build_job_id names and subtracts
-- exactly bytes, so a lost manifest, a lost prefix or a partial loss behave alike. build_job_id is set null
-- if its job row is ever deleted, and the unavailable mark then falls back to the job key (configuration,
-- pair, flop and tree_config_hash). Rows published before this migration, and reference rows, keep null in
-- all three. The table-level grants of 20261020001000_grants.sql cover the new columns.

-- migrate:up

alter table solution
  add column build_job_id uuid references build_job (id) on delete set null,
  add column tree_config_hash bytea,
  add column bytes bigint check (bytes >= 0);

comment on column solution.build_job_id is 'the build_job row whose publish wrote this solution; null for reference rows and rows published before 20261027000200';
comment on column solution.tree_config_hash is 'the tree hash of that job''s key, recorded at publish';
comment on column solution.bytes is 'the bytes the publish added to storage_ledger, given back when the build is marked unavailable';

-- migrate:down

alter table solution
  drop column if exists bytes,
  drop column if exists tree_config_hash,
  drop column if exists build_job_id;
