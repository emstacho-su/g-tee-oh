#!/usr/bin/env node
// Removes the O-61 smoke build after the Deploy 1 report (S20, R2.22, O-61): `just mac-smoke-clean JOB`.
//
// Mechanism: the smoke build is the solution whose publish recorded the given build_job id
// (solution.build_job_id). Without --yes the script only previews: it reads that solution, its
// status, its byte count, its scenario count and its build prefix and prints them, then exits 2,
// so whoever runs it sees what would go before anything is deleted (the owner's rule: stop before
// deleting data). With --yes it prints the same preview first, so the prefix is on record even if
// a later step fails, then deletes in one transaction the scenario rows, the solution row and the
// job row. When the solution is still published, the bytes its publish added are given back the
// way the builder writes the ledger (today's row from the latest one, LEDGER_UPSERT in
// services/library-builder/src/queue/pg/tx.rs); a build already marked unavailable had them given
// back then. The SQL refuses when anything else references the solution (an attempt or an
// explanation; Deploy 1 runs no api, so none should) and when the job did not publish exactly one
// solution: the guard divides by a case over the row count, since Postgres folds a constant 1 / 0
// at plan time. Then the build's prefix is purged from the library bucket through the
// backup-mirror one-shot; if that fails, the rows are already gone, so the error names the prefix
// and the purge command to run by hand. The job id reaches psql as a variable, never spliced in.
// Usage: node scripts/mac/smoke-clean.mjs --job <uuid> [--yes] [--profile mac|dev]
import { pathToFileURL } from 'node:url';

import { DEFAULT_PROFILE, MacScriptError, checkProfile, mirrorArgs, parseFlags, psqlArgs, run, runMain } from './lib.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const EXIT_PREVIEW = 2;

export const PREVIEW_SQL = `select s.id::text || '|' || s.status || '|' || coalesce(s.bytes, 0)::text || '|'
  || (select count(*) from scenario where solution_id = s.id)::text || '|' || s.manifest_uri
  from solution s where s.build_job_id = :'job'::uuid;
`;

export const DELETE_SQL = `begin;
create temp table smoke on commit drop as
  select id, manifest_uri, status, coalesce(bytes, 0) as bytes from solution where build_job_id = :'job'::uuid;
select 1 / (case when (select count(*) from smoke) = 1 then 1 else 0 end) as one_smoke_solution;
delete from scenario where solution_id in (select id from smoke);
delete from solution where id in (select id from smoke);
delete from build_job where id = :'job'::uuid;
insert into storage_ledger (day, library_bytes, reference_bytes)
  select (now() at time zone 'utc')::date,
    greatest(0, coalesce((select library_bytes from storage_ledger order by day desc limit 1), 0) - (select bytes from smoke)),
    coalesce((select reference_bytes from storage_ledger order by day desc limit 1), 0)
  where (select status from smoke) = 'published'
  on conflict (day) do update set library_bytes = excluded.library_bytes, reference_bytes = excluded.reference_bytes;
commit;
`;

/** The job id, checked as a lowercase UUID. */
export function checkJob(job) {
  if (!job || !UUID.test(job)) throw new MacScriptError('--job needs the smoke build_job id (a UUID)');
  return job;
}

/** The build prefix of a manifest_uri, checked to be one build directory with no empty, . or .. segment. */
export function prefixOf(uri) {
  const match = /^(builds\/[A-Za-z0-9_./-]+)\/manifest\.json$/.exec(String(uri).trim());
  const bad = (segment) => segment === '' || segment === '.' || segment === '..';
  if (!match || match[1].split('/').some(bad)) throw new MacScriptError(`unexpected manifest_uri ${JSON.stringify(uri)}`);
  return match[1];
}

/** The preview psql printed: exactly one solution, with its status, bytes, scenario count and prefix. */
export function parsePreview(stdout) {
  const rows = stdout.trim().split('\n').filter(Boolean);
  if (rows.length !== 1) throw new MacScriptError(`the job published ${rows.length} solutions, not one; nothing deleted`);
  const [solution, status, bytes, scenarios, uri] = rows[0].split('|');
  return { solution, status, bytes: Number(bytes), scenarios: Number(scenarios), prefix: prefixOf(uri) };
}

export function main(argv, { runner = run } = {}) {
  const flags = parseFlags(argv, { values: ['job', 'profile'], booleans: ['yes'] });
  const profile = checkProfile(flags.profile ?? DEFAULT_PROFILE);
  const job = checkJob(flags.job);
  const preview = parsePreview(runner('docker', psqlArgs(profile, { variables: { job } }), { input: PREVIEW_SQL }));
  console.log(JSON.stringify({ job, ...preview, deletes: flags.yes === true }));
  if (!flags.yes) {
    console.error('mac-smoke-clean: preview only; rerun with --yes to delete these rows and purge the prefix');
    return EXIT_PREVIEW;
  }
  runner('docker', psqlArgs(profile, { variables: { job } }), { input: DELETE_SQL });
  const target = `library:library/${preview.prefix}`;
  try {
    runner('docker', mirrorArgs(profile, ['purge', target]));
  } catch (error) {
    throw new MacScriptError(`the rows are deleted but the purge of ${preview.prefix} failed (${error.message}); run: docker ${mirrorArgs(profile, ['purge', target]).join(' ')}`);
  }
  console.log(JSON.stringify({ deleted_job: job, purged_prefix: preview.prefix }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-smoke-clean', main);
}
