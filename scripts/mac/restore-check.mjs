#!/usr/bin/env node
// The restore check of Deploy 1 (S20, R2.22: "the first backup present with one solution restored
// from it"): `just mac-restore-check` proves the newest backup restores, without touching the live
// database or bucket.
//
// Mechanism: the newest dump under <BACKUP_DRIVE_PATH>/g-tee-oh/pg is checked against its receipt's
// sha256 first. It is restored with pg_restore (stdin from the file) into a scratch database
// gto_restore inside the Postgres container, created fresh and dropped at the end whatever happens.
// From the restored copy the newest published own flop build is read (id and manifest_uri); its
// manifest and every file it lists (the lines' flop files, the runouts' files, the chunks, the
// builder's own manifest_files rule in services/library-builder/src/store.rs) are read from the
// mirror under <drive>/g-tee-oh/s3/library and hashed against the manifest. Prints one JSON line
// with the verdict; exits 1 on any mismatch.
// Usage: node scripts/mac/restore-check.mjs [--profile mac|dev]
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DRIVE_VARIABLE, ROOT_DIR, checkDrivePath } from './backup.mjs';
import { DEFAULT_PROFILE, MacScriptError, SUPERUSER, checkProfile, composeArgs, envValue, parseFlags, postgresService, psqlArgs, run, runMain } from './lib.mjs';

export const SCRATCH_DATABASE = 'gto_restore';
export const LATEST_BUILD_SQL = `select id::text || '|' || manifest_uri from solution
  where kind = 'flop_build' and source = 'own' and status = 'published'
  order by created_at desc limit 1;
`;

/** The newest dump name in `names`, or null. */
export function newestDump(names) {
  const dumps = names.filter((name) => /^gto-\d{8}T\d{6}Z\.dump$/.test(name)).sort();
  return dumps.at(-1) ?? null;
}

/** Every (path, sha256) a build manifest lists, relative to the build's prefix. */
export function manifestFiles(manifest) {
  const lines = (manifest.lines ?? []).map((line) => [line.flop_file, line.sha256]);
  const runouts = (manifest.runouts ?? []).flatMap((runout) => Object.values(runout.files ?? {}).map((file) => [file.path, file.sha256]));
  const chunks = (manifest.chunks ?? []).map((chunk) => [chunk.path, chunk.sha256]);
  return [...lines, ...runouts, ...chunks];
}

/** The verdict of a build's files against its manifest; `read` returns a file's bytes or null. */
export function verifyBuild(manifest, read) {
  const files = manifestFiles(manifest);
  const problems = [];
  for (const [path, sha256] of files) {
    const bytes = read(path);
    if (bytes === null) problems.push(`${path} is missing from the mirror`);
    else if (createHash('sha256').update(bytes).digest('hex') !== sha256) problems.push(`${path} does not match its sha256`);
  }
  return { files: files.length, problems };
}

/** The solution id and the build prefix (the manifest_uri without /manifest.json). */
export function parseLatest(stdout) {
  const line = stdout.trim();
  if (line === '') throw new MacScriptError('the restored database holds no published own flop build');
  const [id, uri] = line.split('|');
  if (!uri?.endsWith('/manifest.json')) throw new MacScriptError(`unexpected manifest_uri ${JSON.stringify(uri)}`);
  return { id, prefix: uri.slice(0, -'/manifest.json'.length) };
}

function within(root, relative) {
  if (relative.split('/').some((part) => part === '..' || part === '')) {
    throw new MacScriptError(`refusing the path ${JSON.stringify(relative)}`);
  }
  return join(root, ...relative.split('/'));
}

export function main(argv, { env = process.env, dotenv = '.env', runner = run } = {}) {
  const flags = parseFlags(argv, { values: ['profile'] });
  const profile = checkProfile(flags.profile ?? DEFAULT_PROFILE);
  const drive = checkDrivePath(envValue(DRIVE_VARIABLE, env, dotenv));
  const pgDir = join(drive, ROOT_DIR, 'pg');
  const name = existsSync(pgDir) ? newestDump(readdirSync(pgDir)) : null;
  if (name === null) throw new MacScriptError('no dump on the drive; run just mac-backup first');
  const dumpPath = join(pgDir, name);
  const receipt = JSON.parse(readFileSync(`${dumpPath}.json`, 'utf8'));
  const dumpSha = createHash('sha256').update(readFileSync(dumpPath)).digest('hex');
  if (dumpSha !== receipt.sha256) throw new MacScriptError(`${name} does not match its receipt's sha256`);

  const admin = (sql) => runner('docker', psqlArgs(profile, { database: 'postgres' }), { input: sql });
  admin(`drop database if exists ${SCRATCH_DATABASE};\ncreate database ${SCRATCH_DATABASE};\n`);
  let latest;
  try {
    const fd = openSync(dumpPath, 'r');
    try {
      runner('docker', composeArgs([profile], ['exec', '-T', postgresService(profile), 'pg_restore', '-U', SUPERUSER, '-d', SCRATCH_DATABASE, '--no-owner', '--no-acl', '--exit-on-error']), { stdin: fd });
    } finally {
      closeSync(fd);
    }
    latest = parseLatest(runner('docker', psqlArgs(profile, { database: SCRATCH_DATABASE }), { input: LATEST_BUILD_SQL }));
  } finally {
    admin(`drop database if exists ${SCRATCH_DATABASE};\n`);
  }

  const buildRoot = within(join(drive, ROOT_DIR, 's3', 'library'), latest.prefix);
  const manifestPath = join(buildRoot, 'manifest.json');
  if (!existsSync(manifestPath)) throw new MacScriptError(`the mirror has no manifest for ${latest.prefix}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const result = verifyBuild(manifest, (relative) => {
    const path = within(buildRoot, relative);
    return existsSync(path) ? readFileSync(path) : null;
  });
  const verdict = result.problems.length === 0 ? 'restored' : 'failed';
  console.log(JSON.stringify({ verdict, dump: name, dump_sha256: dumpSha, solution_id: latest.id, prefix: latest.prefix, files: result.files, problems: result.problems }));
  return verdict === 'restored' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-restore-check', main);
}
