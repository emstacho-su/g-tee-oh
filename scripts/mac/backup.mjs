#!/usr/bin/env node
// The nightly backup (S20, R2.22, A9 section 5, O-512): `just mac-backup` dumps the database and
// mirrors both buckets to the external drive named by BACKUP_DRIVE_PATH (gitignored .env, never a
// report).
//
// Mechanism: the drive path is checked first (absolute, an existing directory, writable), so a
// missing drive fails before anything runs. `pg_dump -Fc` of the gto database runs inside the
// Postgres container through `docker compose exec -T` with its stdout sent straight to
// <drive>/g-tee-oh/pg/gto-<UTC stamp>.dump.partial, renamed on success, so a failed dump never
// looks finished; a receipt <dump>.json beside it records the bytes and sha256 (the
// cross-device rule: no hash, no acceptance) and the drive's path is left out of it. Only the
// newest KEEP_DUMPS dumps and receipts stay. Then the backup-mirror one-shot runs `rclone sync`
// once per bucket into <drive>/g-tee-oh/s3/<bucket>, each under that bucket's own credentials
// (compose.yaml). The library is rebuildable; reference-private is the copy that matters
// (02 section 6.4). Prints one JSON line: the dump, its bytes and sha256, the pruned names.
// Usage: node scripts/mac/backup.mjs [--profile mac|dev] [--dry-run]
import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DATABASE, DEFAULT_PROFILE, MacScriptError, SUPERUSER, checkProfile, composeArgs, envValue, mirrorArgs, parseFlags, postgresService, run, runMain, utcStamp } from './lib.mjs';

export const DRIVE_VARIABLE = 'BACKUP_DRIVE_PATH';
export const KEEP_DUMPS = 14;
export const ROOT_DIR = 'g-tee-oh';
export const BUCKETS = [
  { remote: 'library', bucket: 'library' },
  { remote: 'reference', bucket: 'reference-private' },
];
const DUMP_NAME = /^gto-\d{8}T\d{6}Z\.dump$/;

/** The drive path from the environment, checked; `fs` is injectable for the tests. */
export function checkDrivePath(path, fs = { statSync, accessSync }) {
  if (!path || !path.trim()) throw new MacScriptError(`${DRIVE_VARIABLE} is not set; put the external drive's mount path in .env`);
  if (!isAbsolute(path)) throw new MacScriptError(`${DRIVE_VARIABLE} must be an absolute path`);
  let stats;
  try {
    stats = fs.statSync(path);
  } catch {
    throw new MacScriptError(`${DRIVE_VARIABLE} does not exist; is the drive attached?`);
  }
  if (!stats.isDirectory()) throw new MacScriptError(`${DRIVE_VARIABLE} is not a directory`);
  try {
    fs.accessSync(path, constants.W_OK);
  } catch {
    throw new MacScriptError(`${DRIVE_VARIABLE} is not writable`);
  }
  return path;
}

/** The dump file names to delete so only the newest `keep` remain; stamps sort by name. */
export function dumpsToPrune(names, keep = KEEP_DUMPS) {
  const dumps = names.filter((name) => DUMP_NAME.test(name)).sort();
  return dumps.slice(0, Math.max(0, dumps.length - keep));
}

/** The commands of one backup, in order, as [command, args] pairs; the dump's stdout is the file. */
export function backupPlan(profile) {
  const dump = ['docker', composeArgs([profile], ['exec', '-T', postgresService(profile), 'pg_dump', '-U', SUPERUSER, '-Fc', DATABASE])];
  const mirrors = BUCKETS.map(({ remote, bucket }) => ['docker', mirrorArgs(profile, ['sync', `${remote}:${bucket}`, `/backup/${bucket}`])]);
  return { dump, mirrors };
}

/** The receipt of one dump: name, bytes, sha256 and when, never the drive path. */
export function receiptOf(name, bytes, sha256, stamp) {
  return { file: `${ROOT_DIR}/pg/${name}`, bytes, sha256, stamp };
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function main(argv, { env = process.env, dotenv = '.env', now = new Date(), runner = run } = {}) {
  const flags = parseFlags(argv, { values: ['profile'], booleans: ['dry-run'] });
  const profile = checkProfile(flags.profile ?? DEFAULT_PROFILE);
  const plan = backupPlan(profile);
  if (flags['dry-run']) {
    console.log(JSON.stringify({ dump: plan.dump[1].join(' '), mirrors: plan.mirrors.map(([, args]) => args.join(' ')) }));
    return 0;
  }
  const drive = checkDrivePath(envValue(DRIVE_VARIABLE, env, dotenv));
  const pgDir = join(drive, ROOT_DIR, 'pg');
  mkdirSync(pgDir, { recursive: true });
  for (const { bucket } of BUCKETS) mkdirSync(join(drive, ROOT_DIR, 's3', bucket), { recursive: true });

  const stamp = utcStamp(now);
  const name = `gto-${stamp}.dump`;
  const partial = join(pgDir, `${name}.partial`);
  const fd = openSync(partial, 'w', 0o600);
  try {
    runner(plan.dump[0], plan.dump[1], { stdout: fd });
  } catch (error) {
    closeSync(fd);
    rmSync(partial, { force: true });
    throw error;
  }
  closeSync(fd);
  const bytes = statSync(partial).size;
  if (bytes === 0) {
    rmSync(partial, { force: true });
    throw new MacScriptError('pg_dump wrote nothing');
  }
  const target = join(pgDir, name);
  renameSync(partial, target);
  const receipt = receiptOf(name, bytes, sha256File(target), stamp);
  writeFileSync(`${target}.json`, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

  const pruned = dumpsToPrune(readdirSync(pgDir));
  for (const old of pruned) {
    rmSync(join(pgDir, old), { force: true });
    rmSync(join(pgDir, `${old}.json`), { force: true });
  }
  for (const [command, args] of plan.mirrors) runner(command, args);
  console.log(JSON.stringify({ ...receipt, pruned, mirrored: BUCKETS.map(({ bucket }) => bucket) }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-backup', main);
}
