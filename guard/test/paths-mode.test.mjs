// R0.4: paths mode walks a directory, skips large and binary files and .git,
// and scans the rest line by line.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { CLI, PLANTED_PREFIX, PLANTED_TOKEN, TEST_SALT, guardEnv, makeTempDir, removeDir, runNode, writeDenylist, writeFile } from './helpers.mjs';

let dir;
let denylistPath;

before(() => {
  dir = makeTempDir('guard-paths');
  denylistPath = writeDenylist(makeTempDir('guard-paths-denylist'), [PLANTED_TOKEN]);
  writeFile(dir, 'ok/readme.txt', 'line one\nline two\n');
  writeFile(dir, 'big.txt', `${PLANTED_TOKEN}\n`.padEnd(2 * 1024 * 1024 + 1, 'x'));
  writeFile(dir, 'blob.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(PLANTED_TOKEN)]));
  writeFile(dir, 'notes/planted.txt', `clean first line\nsecond line has ${PLANTED_TOKEN}\n`);
  writeFile(dir, '.git/config', `[core]\n\tplanted = ${PLANTED_TOKEN}\n`);
});

after(() => removeDir(dir));

test('r0_4 cli paths scans text files and reports the planted line', () => {
  const result = runNode([CLI, 'paths', dir], {
    cwd: dir,
    env: guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath }),
  });
  assert.equal(result.status, 1, result.output);
  const findings = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('guard: identifier'));
  assert.deepEqual(findings, [`guard: identifier at notes/planted.txt:2 hash ${PLANTED_PREFIX} is on the denylist`]);
  assert.match(result.stdout, /guard: paths checked 4 files and 4 added lines; 1 findings/);
  assert.doesNotMatch(result.output.toLowerCase(), new RegExp(`identifier.*${PLANTED_TOKEN}`));
});

test('r0_4 cli paths uses a relative directory from the current directory', () => {
  const result = runNode([CLI, 'paths', 'ok'], {
    cwd: dir,
    env: guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath }),
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /guard: paths checked 1 files and 2 added lines; 0 findings/);
});

test('r0_4 cli paths rejects a missing directory with exit 2', () => {
  const result = runNode([CLI, 'paths', 'does-not-exist'], {
    cwd: dir,
    env: guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath }),
  });
  assert.equal(result.status, 2, result.output);
  assert.match(result.stderr, /is not a directory/);
});
