// R0.4: ci mode compares base...HEAD with fallbacks, history mode walks every commit.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { CLI, PLANTED_PREFIX, PLANTED_TOKEN, TEST_SALT, commitAll, guardEnv, initRepo, makeTempDir, removeDir, runNode, writeDenylist, writeFile } from './helpers.mjs';

let repo;
let denylistPath;
let firstSha;
let env;

before(() => {
  repo = makeTempDir('guard-ci');
  initRepo(repo);
  denylistPath = writeDenylist(makeTempDir('guard-ci-denylist'), [PLANTED_TOKEN]);
  env = guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath });
  writeFile(repo, 'README.md', 'clean start\n');
  firstSha = commitAll(repo, 'chore: clean start');
  writeFile(repo, 'src/notes.txt', `line one\nline two mentions ${PLANTED_TOKEN}\n`);
  writeFile(repo, 'data/x.har', '{}\n');
  commitAll(repo, 'feat: planted change');
});

after(() => removeDir(repo));

test('r0_4 cli ci --base <sha> reports the planted path and identifier from the range', () => {
  const result = runNode([CLI, 'ci', '--base', firstSha], { cwd: repo, env });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /guard: path data\/x\.har matches private pattern/);
  assert.match(result.stdout, new RegExp(`guard: identifier at src/notes\\.txt:2 hash ${PLANTED_PREFIX}`));
  assert.match(result.stdout, /guard: ci checked 2 files and 3 added lines; 2 findings/);
});

test('r0_4 cli ci with the zero sha falls back to HEAD~1', () => {
  const result = runNode([CLI, 'ci', '--base', '0'.repeat(40)], { cwd: repo, env });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stderr, /zero sha; comparing HEAD~1\.\.\.HEAD/);
  assert.match(result.stdout, /2 findings/);
});

test('r0_4 cli ci with no base reads GUARD_BASE or falls back to HEAD~1', () => {
  const viaEnv = runNode([CLI, 'ci'], { cwd: repo, env: { ...env, GUARD_BASE: 'HEAD' } });
  assert.equal(viaEnv.status, 0, viaEnv.output);
  assert.match(viaEnv.stdout, /guard: ci checked 0 files and 0 added lines; 0 findings/);
  const fallback = runNode([CLI, 'ci'], { cwd: repo, env });
  assert.equal(fallback.status, 1, fallback.output);
  assert.match(fallback.stderr, /no base was given; comparing HEAD~1\.\.\.HEAD/);
});

test('r0_4 cli history scans every commit and tags findings with the commit', () => {
  const result = runNode([CLI, 'history'], { cwd: repo, env });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /guard: identifier at src\/notes\.txt:2 hash [0-9a-f]{8} is on the denylist \(commit [0-9a-f]{8}\)/);
  assert.match(result.stdout, /guard: history checked 3 files and 4 added lines; 2 findings/);
});

test('r0_4 cli staged on a root commit scans against the empty tree', () => {
  const fresh = makeTempDir('guard-root');
  try {
    initRepo(fresh);
    writeFile(fresh, 'a.txt', 'clean\n');
    commitAll(fresh, 'chore: root');
    const result = runNode([CLI, 'ci', '--base', ''], { cwd: fresh, env });
    assert.equal(result.status, 0, result.output);
    assert.match(result.stderr, /HEAD has no parent; comparing the empty tree to HEAD/);
    assert.match(result.stdout, /guard: ci checked 1 files and 1 added lines; 0 findings/);
  } finally {
    removeDir(fresh);
  }
});
