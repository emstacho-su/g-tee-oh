// The Deploy 1 scripts (R2.22, S20, O-509 to O-512): argument checks, the compose command lines each
// script runs, and the pure parts of the backup, the restore check, the peaks and the launchd job.
// The runner is injected, so these need no Docker. Run with: pnpm run test:scripts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as backup from './backup.mjs';
import * as checkEnv from './check-env.mjs';
import * as launchd from './launchd.mjs';
import { MacScriptError, composeArgs, envValue, mirrorArgs, parseFlags, postgresService, psqlArgs, utcStamp } from './lib.mjs';
import * as peaks from './peaks.mjs';
import * as restore from './restore-check.mjs';
import * as setting from './setting.mjs';
import * as smoke from './smoke-clean.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** A runner that records each call and answers from `answers` by the first matching substring. */
function recorder(answers = {}) {
  const calls = [];
  const runner = (command, args, options = {}) => {
    calls.push({ command, args, options });
    const line = args.join(' ');
    const key = Object.keys(answers).find((part) => line.includes(part));
    const answer = key === undefined ? '' : answers[key];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(options) : answer;
  };
  return { calls, runner };
}

function quiet(fn) {
  const log = console.log;
  const out = [];
  console.log = (...parts) => out.push(parts.join(' '));
  try {
    return { result: fn(), out };
  } finally {
    console.log = log;
  }
}

describe('lib: compose command lines', () => {
  it('r2_22 names Postgres per profile and refuses an unknown profile', () => {
    assert.equal(postgresService('mac'), 'postgres-mac');
    assert.equal(postgresService('dev'), 'postgres');
    assert.throws(() => postgresService('prod'), MacScriptError);
  });

  it('r2_22 runs psql in the Postgres container with variables and ON_ERROR_STOP', () => {
    const args = psqlArgs('mac', { variables: { key: 'k' } });
    assert.deepEqual(args.slice(0, 7), ['compose', '--project-directory', '.', '-f', 'infra/compose/compose.yaml', '--profile', 'mac']);
    assert.ok(args.includes('postgres-mac'));
    assert.ok(args.includes('ON_ERROR_STOP=1'));
    assert.deepEqual(args.slice(-2), ['-v', 'key=k']);
  });

  it('r2_22 runs the mirror under the backup profile with no dependencies started', () => {
    const args = mirrorArgs('dev', ['sync', 'a', 'b']);
    assert.deepEqual(args.slice(5, 12), ['--profile', 'dev', '--profile', 'backup', 'run', '--rm', '--no-deps']);
    assert.deepEqual(args.slice(-4), ['backup-mirror', 'sync', 'a', 'b']);
    assert.deepEqual(composeArgs([], ['ps']).at(-1), 'ps');
  });

  it('r2_22 parses flags and refuses unknown, repeated and valueless ones', () => {
    assert.deepEqual(parseFlags(['--profile', 'dev', '--yes'], { values: ['profile'], booleans: ['yes'] }), { profile: 'dev', yes: true });
    assert.throws(() => parseFlags(['--bogus'], { values: [] }), /unknown argument/);
    assert.throws(() => parseFlags(['--profile', 'a', '--profile', 'b'], { values: ['profile'] }), /twice/);
    assert.throws(() => parseFlags(['--profile'], { values: ['profile'] }), /needs a value/);
    assert.equal(utcStamp(new Date('2026-11-05T03:30:00.123Z')), '20261105T033000Z');
  });

  it('r2_22 takes a variable from the environment first, else only that key from the .env file', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'mac-env-'));
    try {
      const dotenv = join(dir, '.env');
      writeFileSync(dotenv, 'BACKUP_DRIVE_PATH=/Volumes/Drive\nPOSTGRES_PASSWORD=secret\n');
      assert.equal(envValue('BACKUP_DRIVE_PATH', {}, dotenv), '/Volumes/Drive');
      assert.equal(envValue('BACKUP_DRIVE_PATH', { BACKUP_DRIVE_PATH: '/x' }, dotenv), '/x');
      assert.equal(envValue('BACKUP_DRIVE_PATH', {}, join(dir, 'missing')), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('setting: one builder_setting row (O-509)', () => {
  it('r2_22 writes a known key with a JSON value through psql variables, never in the SQL text', () => {
    const { calls, runner } = recorder({ psql: 'plan_configs = []\n' });
    const { out } = quiet(() => setting.main(['plan_configs', '[]', '--profile', 'dev'], { runner }));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('key=plan_configs'));
    assert.ok(calls[0].args.includes('value=[]'));
    assert.equal(calls[0].options.input, setting.UPSERT_SQL);
    assert.ok(!setting.UPSERT_SQL.includes('plan_configs'));
    assert.deepEqual(out, ['plan_configs = []']);
  });

  it('r2_22 refuses a key the builder does not read and a value that is not JSON', () => {
    assert.throws(() => setting.checkSetting('k_runout', '20'), /not a key the builder reads/);
    assert.throws(() => setting.checkSetting('plan_configs', '[cfg]'), /not JSON/);
    assert.equal(setting.checkSetting('plan_configs', '[ "cfg_6_online_100" ]'), '["cfg_6_online_100"]');
    assert.throws(() => setting.main(['k_runouts']), /usage/);
  });
});

describe('backup: dump, receipt, prune and mirror (O-512)', () => {
  it('r2_22 refuses a drive path that is unset, relative, missing or not a directory', () => {
    assert.throws(() => backup.checkDrivePath(''), /not set/);
    assert.throws(() => backup.checkDrivePath('drive'), /absolute/);
    assert.throws(() => backup.checkDrivePath(join(os.tmpdir(), 'no-such-drive-g-tee-oh')), /does not exist/);
    const dir = mkdtempSync(join(os.tmpdir(), 'mac-backup-'));
    try {
      writeFileSync(join(dir, 'f'), 'x');
      assert.throws(() => backup.checkDrivePath(join(dir, 'f')), /not a directory/);
      assert.equal(backup.checkDrivePath(dir), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('r2_22 keeps the newest fourteen dumps and ignores other files', () => {
    const names = Array.from({ length: 16 }, (_, i) => `gto-202611${String(i + 1).padStart(2, '0')}T033000Z.dump`);
    const pruned = backup.dumpsToPrune([...names.reverse(), 'gto-x.dump', 'notes.txt', `${names[0]}.json`]);
    assert.deepEqual(pruned, ['gto-20261101T033000Z.dump', 'gto-20261102T033000Z.dump']);
    assert.deepEqual(backup.dumpsToPrune(names.slice(0, 3)), []);
  });

  it('r2_22 dumps with pg_dump -Fc and mirrors each bucket under its own remote', () => {
    const plan = backup.backupPlan('mac');
    assert.ok(plan.dump[1].join(' ').endsWith('exec -T postgres-mac pg_dump -U postgres -Fc gto'));
    assert.deepEqual(plan.mirrors.map(([, args]) => args.slice(-3)), [
      ['sync', 'library:library', '/backup/library'],
      ['sync', 'reference:reference-private', '/backup/reference-private'],
    ]);
  });

  it('r2_22 writes the dump, a receipt without the drive path, and mirrors after the dump', () => {
    const drive = mkdtempSync(join(os.tmpdir(), 'mac-backup-run-'));
    try {
      const { calls, runner } = recorder({
        pg_dump: ({ stdout }) => {
          writeFileSync(stdout, 'PGDMP fake dump');
          return '';
        },
      });
      const { out } = quiet(() => backup.main(['--profile', 'dev'], { env: { BACKUP_DRIVE_PATH: drive }, now: new Date('2026-11-05T03:30:00Z'), runner }));
      const pgDir = join(drive, 'g-tee-oh', 'pg');
      assert.deepEqual(readdirSync(pgDir).sort(), ['gto-20261105T033000Z.dump', 'gto-20261105T033000Z.dump.json']);
      const receipt = JSON.parse(readFileSync(join(pgDir, 'gto-20261105T033000Z.dump.json'), 'utf8'));
      assert.deepEqual(receipt, { file: 'g-tee-oh/pg/gto-20261105T033000Z.dump', bytes: 15, sha256: sha('PGDMP fake dump'), stamp: '20261105T033000Z' });
      assert.ok(!JSON.stringify(receipt).includes(drive));
      assert.equal(calls.length, 3);
      assert.ok(calls[1].args.includes('library:library'));
      assert.ok(calls[2].args.includes('reference:reference-private'));
      assert.match(out.at(-1), /"mirrored":\["library","reference-private"\]/);
    } finally {
      rmSync(drive, { recursive: true, force: true });
    }
  });

  it('r2_22 leaves no file behind when the dump fails or is empty', () => {
    const drive = mkdtempSync(join(os.tmpdir(), 'mac-backup-fail-'));
    try {
      const failing = recorder({ pg_dump: new MacScriptError('pg_dump exited 1') });
      assert.throws(() => backup.main([], { env: { BACKUP_DRIVE_PATH: drive }, runner: failing.runner }), /exited 1/);
      const empty = recorder({ pg_dump: '' });
      assert.throws(() => backup.main([], { env: { BACKUP_DRIVE_PATH: drive }, runner: empty.runner }), /wrote nothing/);
      assert.deepEqual(readdirSync(join(drive, 'g-tee-oh', 'pg')), []);
      assert.equal(failing.calls.length + empty.calls.length, 2, 'no mirror ran');
    } finally {
      rmSync(drive, { recursive: true, force: true });
    }
  });
});

describe('restore-check: the newest dump restores and its build matches the mirror', () => {
  const manifest = {
    lines: [{ flop_file: 'flop/r250.c.bin.zst', sha256: sha('flop') }],
    runouts: [{ turn: 'As', river: '2d', files: { 'r250.c': { path: 'runouts/As2d/r250.c.bin.zst', sha256: sha('runout') } } }],
    chunks: [{ path: 'chunks/0.bin', sha256: sha('chunk') }],
  };

  it('r2_22 lists the files a manifest names, as the builder does', () => {
    assert.deepEqual(restore.manifestFiles(manifest).map(([path]) => path), ['flop/r250.c.bin.zst', 'runouts/As2d/r250.c.bin.zst', 'chunks/0.bin']);
    assert.deepEqual(restore.manifestFiles({}), []);
  });

  it('r2_22 reports a missing file and a changed file', () => {
    const files = { 'flop/r250.c.bin.zst': 'flop', 'runouts/As2d/r250.c.bin.zst': 'changed' };
    const result = restore.verifyBuild(manifest, (path) => (path in files ? Buffer.from(files[path]) : null));
    assert.equal(result.files, 3);
    assert.deepEqual(result.problems, ['runouts/As2d/r250.c.bin.zst does not match its sha256', 'chunks/0.bin is missing from the mirror']);
  });

  it('r2_22 picks the newest dump and parses the published build', () => {
    assert.equal(restore.newestDump(['gto-20261104T033000Z.dump', 'gto-20261105T033000Z.dump', 'gto-20261106T033000Z.dump.json']), 'gto-20261105T033000Z.dump');
    assert.equal(restore.newestDump([]), null);
    assert.deepEqual(restore.parseLatest('0192-a|builds/cfg/BB-BTN/x/manifest.json\n'), { id: '0192-a', prefix: 'builds/cfg/BB-BTN/x' });
    assert.throws(() => restore.parseLatest(''), /no published own flop build/);
    assert.throws(() => restore.parseLatest('id|builds/x'), /unexpected manifest_uri/);
  });

  it('r2_22 restores into a scratch database, checks the mirror and always drops the scratch database', () => {
    const drive = mkdtempSync(join(os.tmpdir(), 'mac-restore-'));
    try {
      const pgDir = join(drive, 'g-tee-oh', 'pg');
      const buildDir = join(drive, 'g-tee-oh', 's3', 'library', 'builds', 'x');
      for (const dir of [pgDir, join(buildDir, 'flop'), join(buildDir, 'runouts', 'As2d'), join(buildDir, 'chunks')]) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(join(pgDir, 'gto-20261105T033000Z.dump'), 'dump');
      writeFileSync(join(pgDir, 'gto-20261105T033000Z.dump.json'), JSON.stringify({ sha256: sha('dump') }));
      writeFileSync(join(buildDir, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(buildDir, 'flop', 'r250.c.bin.zst'), 'flop');
      writeFileSync(join(buildDir, 'runouts', 'As2d', 'r250.c.bin.zst'), 'runout');
      writeFileSync(join(buildDir, 'chunks', '0.bin'), 'chunk');
      const env = { BACKUP_DRIVE_PATH: drive };

      const { calls, runner } = recorder({ [`-d ${restore.SCRATCH_DATABASE} -v`]: 'sol-1|builds/x/manifest.json\n' });
      const { result, out } = quiet(() => restore.main(['--profile', 'dev'], { env, runner }));
      assert.equal(result, 0);
      assert.match(out[0], /"verdict":"restored"/);
      assert.match(out[0], /"files":3/);
      assert.match(calls[0].options.input, /create database gto_restore/);
      assert.ok(calls[1].args.includes('pg_restore'));
      assert.match(calls.at(-1).options.input, /drop database if exists gto_restore/);

      writeFileSync(join(buildDir, 'chunks', '0.bin'), 'changed');
      const changed = recorder({ [`-d ${restore.SCRATCH_DATABASE} -v`]: 'sol-1|builds/x/manifest.json\n' });
      const second = quiet(() => restore.main(['--profile', 'dev'], { env, runner: changed.runner }));
      assert.equal(second.result, 1);
      assert.match(second.out[0], /"verdict":"failed"/);

      const failing = recorder({ pg_restore: new MacScriptError('pg_restore exited 1') });
      assert.throws(() => restore.main(['--profile', 'dev'], { env, runner: failing.runner }), /pg_restore/);
      assert.match(failing.calls.at(-1).options.input, /drop database if exists gto_restore/, 'dropped after a failed restore');

      writeFileSync(join(pgDir, 'gto-20261105T033000Z.dump'), 'tampered');
      assert.throws(() => restore.main(['--profile', 'dev'], { env, runner }), /does not match its receipt/);
    } finally {
      rmSync(drive, { recursive: true, force: true });
    }
  });
});

describe('peaks: per-container cgroup peaks against the budget', () => {
  it('r2_22 reads running containers from both compose ps shapes', () => {
    const rows = [{ Service: 'postgres-mac', Name: 'g-pg', State: 'running' }, { Service: 'migrate-mac', Name: 'g-m', State: 'exited' }];
    const expected = [{ service: 'postgres-mac', container: 'g-pg' }];
    assert.deepEqual(peaks.runningContainers(rows.map((row) => JSON.stringify(row)).join('\n')), expected);
    assert.deepEqual(peaks.runningContainers(JSON.stringify(rows)), expected);
    assert.deepEqual(peaks.runningContainers(''), []);
  });

  it('r2_22 renders the peak against the 02 section 6.2 budget and marks an unreadable peak', () => {
    assert.equal(peaks.parsePeak('123456\n'), 123456);
    assert.equal(peaks.parsePeak('max'), null);
    const table = peaks.renderTable([
      { service: 'postgres-mac', peak: 100, budget: peaks.BUDGETS['postgres-mac'] },
      { service: 'library-builder', peak: null, budget: peaks.BUDGETS['library-builder'] },
    ]);
    assert.match(table, /\| postgres-mac \| 100 \| 1073741824 \| yes \|/);
    assert.match(table, /\| library-builder \| unavailable \| 5368709120 \| n\/a \|/);
  });

  it('r2_22 lists the builder under the dev profile too, and claims no budget for the unlimited dev services', () => {
    const { calls, runner } = recorder({ ps: '' });
    quiet(() => peaks.main(['--profile', 'dev'], { runner }));
    assert.deepEqual(calls[0].args.slice(5, 9), ['--profile', 'dev', '--profile', 'builder']);
    assert.equal(peaks.budgetOf('dev', 'postgres'), null);
    assert.equal(peaks.budgetOf('dev', 'library-builder'), 5 * 1024 ** 3);
    assert.equal(peaks.budgetOf('mac', 'postgres-mac'), 1024 ** 3);
  });
});

describe('launchd: the nightly LaunchAgent', () => {
  it('r2_22 runs just mac-backup in the checkout at 03:30 with the installer PATH, escaped', () => {
    const plist = launchd.renderPlist({ repo: '/Users/o/projects/g-tee-oh', home: '/Users/o', path: '/opt/homebrew/bin:/usr/bin&x' });
    assert.match(plist, /<string>com\.g-tee-oh\.backup<\/string>/);
    assert.match(plist, /<string>just<\/string>\n\s+<string>mac-backup<\/string>/);
    assert.match(plist, /<key>WorkingDirectory<\/key>\n\s+<string>\/Users\/o\/projects\/g-tee-oh<\/string>/);
    assert.match(plist, /<key>Hour<\/key>\n\s+<integer>3<\/integer>\n\s+<key>Minute<\/key>\n\s+<integer>30<\/integer>/);
    assert.match(plist, /\/usr\/bin&amp;x/);
    assert.ok(!plist.includes('__'));
    assert.throws(() => launchd.renderPlist({ repo: '', home: '/h', path: '/p' }), /needs repo/);
  });

  it('r2_22 installs only on the Mac and replaces an earlier copy', () => {
    assert.throws(() => launchd.main([], { platform: 'win32', env: { PATH: '/p' }, home: '/h', repo: '/r' }), /Mac only/);
    const home = mkdtempSync(join(os.tmpdir(), 'mac-launchd-'));
    try {
      const { calls, runner } = recorder({ bootout: new MacScriptError('not loaded') });
      quiet(() => launchd.main([], { runner, platform: 'darwin', env: { PATH: '/p' }, home, repo: '/r', uid: 501 }));
      assert.deepEqual(calls.map((call) => call.args[0]), ['bootout', 'bootstrap']);
      assert.deepEqual(calls[1].args.slice(0, 2), ['bootstrap', 'gui/501']);
      assert.ok(readFileSync(join(home, 'Library', 'LaunchAgents', 'com.g-tee-oh.backup.plist'), 'utf8').includes('<string>/r</string>'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('smoke-clean: the O-61 smoke build goes after the report', () => {
  const JOB = '0192f000-0000-7000-8000-000000000001';
  const PREVIEW = 'sol-1|published|7429888|20|builds/cfg_6_online_100/BB-BTN/Kc7d2h/b1/manifest.json\n';

  it('r2_22 refuses a bad job id and checks the prefix and the preview', () => {
    assert.throws(() => smoke.main(['--yes']), /UUID/);
    assert.throws(() => smoke.main(['--job', 'nope', '--yes']), /UUID/);
    assert.equal(smoke.prefixOf('builds/cfg_6_online_100/BB-BTN/abc/manifest.json'), 'builds/cfg_6_online_100/BB-BTN/abc');
    for (const uri of ['other/x/manifest.json', 'builds/../x/manifest.json', 'builds/./manifest.json', 'builds//x/manifest.json']) {
      assert.throws(() => smoke.prefixOf(uri), /unexpected manifest_uri/, uri);
    }
    assert.deepEqual(smoke.parsePreview(PREVIEW), { solution: 'sol-1', status: 'published', bytes: 7429888, scenarios: 20, prefix: 'builds/cfg_6_online_100/BB-BTN/Kc7d2h/b1' });
    assert.throws(() => smoke.parsePreview(''), /0 solutions/);
    assert.throws(() => smoke.parsePreview(`${PREVIEW}${PREVIEW}`), /2 solutions/);
  });

  it('r2_22 without --yes only previews and deletes nothing', () => {
    const { calls, runner } = recorder({ psql: PREVIEW });
    const error = console.error;
    console.error = () => {};
    try {
      const { result, out } = quiet(() => smoke.main(['--job', JOB, '--profile', 'dev'], { runner }));
      assert.equal(result, smoke.EXIT_PREVIEW);
      assert.match(out[0], /"deletes":false/);
    } finally {
      console.error = error;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.input, smoke.PREVIEW_SQL);
  });

  it('r2_22 with --yes previews, deletes in one transaction through a psql variable, then purges', () => {
    const { calls, runner } = recorder({ psql: (options) => (options.input === smoke.PREVIEW_SQL ? PREVIEW : '') });
    const { out } = quiet(() => smoke.main(['--job', JOB, '--yes', '--profile', 'dev'], { runner }));
    assert.match(out[0], /"prefix":"builds\/cfg_6_online_100\/BB-BTN\/Kc7d2h\/b1"/);
    assert.equal(calls[1].options.input, smoke.DELETE_SQL);
    assert.ok(calls[1].args.includes(`job=${JOB}`));
    assert.ok(!smoke.DELETE_SQL.includes(JOB));
    assert.match(smoke.DELETE_SQL, /^begin;[\s\S]*commit;\n$/);
    // Postgres folds a constant 1 / 0 at plan time, so the guard must divide by the row count's case.
    assert.doesNotMatch(smoke.DELETE_SQL, /\b1 \/ 0\b/);
    assert.match(smoke.DELETE_SQL, /1 \/ \(case when \(select count\(\*\) from smoke\) = 1 then 1 else 0 end\)/);
    assert.deepEqual(calls[2].args.slice(-2), ['purge', 'library:library/builds/cfg_6_online_100/BB-BTN/Kc7d2h/b1']);
  });

  it('r2_22 gives the bytes back to today\'s ledger row only for a published build', () => {
    assert.match(smoke.DELETE_SQL, /insert into storage_ledger \(day, library_bytes, reference_bytes\)/);
    assert.match(smoke.DELETE_SQL, /\(now\(\) at time zone 'utc'\)::date/);
    assert.match(smoke.DELETE_SQL, /where \(select status from smoke\) = 'published'/);
    assert.doesNotMatch(smoke.DELETE_SQL, /max\(day\)/);
  });

  it('r2_22 names the prefix and the command when the purge fails after the delete', () => {
    const { runner } = recorder({ psql: (options) => (options.input === smoke.PREVIEW_SQL ? PREVIEW : ''), purge: new MacScriptError('rclone exited 1') });
    assert.throws(() => quiet(() => smoke.main(['--job', JOB, '--yes'], { runner })), /rows are deleted but the purge of builds\/cfg_6_online_100\/BB-BTN\/Kc7d2h\/b1 failed[\s\S]*run: docker compose/);
  });
});

describe('check-env: mac-up refuses a password migrate-mac cannot put in a URL (O-511)', () => {
  it('r2_22 accepts letters, digits, - and _ and refuses anything else without printing it', () => {
    assert.equal(checkEnv.checkPostgresPassword('Abc-123_x'), true);
    assert.throws(() => checkEnv.checkPostgresPassword(''), /not set/);
    for (const bad of ['a@b', 'a/b', 'a#b', 'a%b', 'a b']) {
      assert.throws(() => checkEnv.checkPostgresPassword(bad), (error) => /letters, digits/.test(error.message) && !error.message.includes(bad));
    }
  });
});
