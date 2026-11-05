#!/usr/bin/env node
// Removes the O-61 smoke build after the Deploy 1 report (S20, R2.22, O-61): `just mac-smoke-clean JOB`.
//
// Mechanism: the smoke build is the solution whose publish recorded the given build_job id
// (solution.build_job_id). In one transaction its scenario rows, the solution row and the job row are
// deleted, and the bytes its publish added are given back to today's storage_ledger row (the
// recorded solution.bytes), so the ledger does not keep counting a build that is gone. The SQL
// refuses when anything else references the solution (an attempt or an explanation; Deploy 1 runs no
// api, so none should), and when the job did not publish exactly one solution: the guard divides by a
// case over the row count, since Postgres folds a constant 1 / 0 at plan time and would always fail.
// Then the build's prefix is purged from the library bucket through the backup-mirror one-shot. The job id reaches psql as a variable, never spliced into the SQL.
// `--yes` is required, since this deletes data.
// Usage: node scripts/mac/smoke-clean.mjs --job <uuid> --yes [--profile mac|dev]
import { pathToFileURL } from 'node:url';

import { DEFAULT_PROFILE, MacScriptError, checkProfile, mirrorArgs, parseFlags, psqlArgs, run, runMain } from './lib.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DELETE_SQL = `begin;
create temp table smoke on commit drop as
  select id, manifest_uri, coalesce(bytes, 0) as bytes from solution where build_job_id = :'job'::uuid;
select 1 / (case when (select count(*) from smoke) = 1 then 1 else 0 end) as one_smoke_solution;
delete from scenario where solution_id in (select id from smoke);
delete from solution where id in (select id from smoke);
delete from build_job where id = :'job'::uuid;
update storage_ledger set library_bytes = greatest(0, library_bytes - (select bytes from smoke))
  where day = (select max(day) from storage_ledger);
select manifest_uri from smoke;
commit;
`;

/** The job id, checked as a lowercase UUID. */
export function checkJob(job) {
  if (!job || !UUID.test(job)) throw new MacScriptError('--job needs the smoke build_job id (a UUID)');
  return job;
}

/** The build prefix from the manifest_uri psql printed, checked to be one build directory. */
export function prefixOf(stdout) {
  const uri = stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
  const match = /^(builds\/[A-Za-z0-9_./-]+)\/manifest\.json$/.exec(uri);
  if (!match || match[1].split('/').includes('..')) throw new MacScriptError(`unexpected manifest_uri ${JSON.stringify(uri)}`);
  return match[1];
}

export function main(argv, { runner = run } = {}) {
  const flags = parseFlags(argv, { values: ['job', 'profile'], booleans: ['yes'] });
  const profile = checkProfile(flags.profile ?? DEFAULT_PROFILE);
  const job = checkJob(flags.job);
  if (!flags.yes) throw new MacScriptError('this deletes the smoke build; pass --yes');
  const stdout = runner('docker', psqlArgs(profile, { variables: { job } }), { input: DELETE_SQL });
  const prefix = prefixOf(stdout);
  runner('docker', mirrorArgs(profile, ['purge', `library:library/${prefix}`]));
  console.log(JSON.stringify({ deleted_job: job, purged_prefix: prefix }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-smoke-clean', main);
}
