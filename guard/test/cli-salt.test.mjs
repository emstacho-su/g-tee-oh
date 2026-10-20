// R0.4: the salt rule. No salt means fail closed, unless the run is a fork or
// asks for the path check only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { CLI, guardEnv, makeTempDir, removeDir, runNode, writeFile } from './helpers.mjs';

const MESSAGE = 'guard: GUARD_SALT is not set and .guard-private/salt is missing; the identifier check cannot run (fail closed, O-58)';

let cleanDir;
let plantedDir;

before(() => {
  cleanDir = makeTempDir('guard-nosalt-clean');
  writeFile(cleanDir, 'docs/a.md', 'hello\n');
  plantedDir = makeTempDir('guard-nosalt-planted');
  writeFile(plantedDir, 'data/x.har', '{}\n');
});

after(() => {
  removeDir(cleanDir);
  removeDir(plantedDir);
});

test('r0_4 cli fails closed with exit 2 when no salt is available', () => {
  const result = runNode([CLI, 'paths', cleanDir], { cwd: cleanDir, env: guardEnv() });
  assert.equal(result.status, 2, result.output);
  assert.ok(result.stderr.includes(MESSAGE), result.output);
});

test('r0_4 cli --patterns-only runs the path check and exits 0 on a clean tree', () => {
  const result = runNode([CLI, 'paths', cleanDir, '--patterns-only'], { cwd: cleanDir, env: guardEnv() });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stderr, /running the path check only/);
  assert.match(result.stdout, /guard: paths checked 1 files and 0 added lines; 0 findings/);
});

test('r0_4 cli --patterns-only still rejects a planted path', () => {
  const result = runNode([CLI, 'paths', plantedDir, '--patterns-only'], { cwd: plantedDir, env: guardEnv() });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /guard: path data\/x\.har matches/);
});

test('r0_4 cli treats GUARD_FORK=true like --patterns-only', () => {
  const result = runNode([CLI, 'paths', cleanDir], { cwd: cleanDir, env: guardEnv({ GUARD_FORK: 'true' }) });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stderr, /GUARD_FORK is true/);
});

test('r0_4 cli rejects an unknown mode with exit 2', () => {
  const result = runNode([CLI, 'bogus'], { cwd: cleanDir, env: guardEnv({ GUARD_SALT: 'x' }) });
  assert.equal(result.status, 2, result.output);
  assert.match(result.stderr, /usage:/);
});
