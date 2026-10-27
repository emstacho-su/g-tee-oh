// R0.4: the salt in a linked git worktree. .guard-private/ is gitignored, so it
// exists only in the main working tree; a worktree falls back to it after
// GUARD_SALT and its own .guard-private/salt, and still fails closed when no
// location holds a salt. Synthetic salts and tokens only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { hashToken } from '../src/guard.mjs';
import {
  CLI,
  HASH_DENYLIST,
  PLANTED_HASH,
  PLANTED_PREFIX,
  PLANTED_TOKEN,
  TEST_SALT,
  commitAll,
  guardEnv,
  initRepo,
  makeTempDir,
  removeDir,
  runGit,
  runNode,
  writeDenylist,
  writeFile,
} from './helpers.mjs';

const MESSAGE = 'guard: GUARD_SALT is not set and .guard-private/salt is missing; the identifier check cannot run (fail closed, O-58)';
const WORKTREE_SALT = 'synthetic-worktree-own-salt';
const ENV_SALT = 'synthetic-env-salt';

const tempDirs = [];

function tempDir(prefix) {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

after(() => tempDirs.forEach((dir) => removeDir(dir)));

// A main repository with one commit that ignores .guard-private/, and a linked
// worktree of it holding a staged file with the planted token.
function mainWithWorktree({ mainSalt = null } = {}) {
  const main = tempDir('guard-wt-main');
  initRepo(main);
  writeFile(main, '.gitignore', '.guard-private/\n');
  writeFile(main, 'README.md', 'main tree\n');
  commitAll(main, 'chore: initial');
  if (mainSalt !== null) writeFile(main, '.guard-private/salt', `${mainSalt}\n`);
  const worktree = join(tempDir('guard-wt-linked'), 'wt');
  runGit(['worktree', 'add', '-q', '-b', 'wt', worktree], main);
  stagePlanted(worktree);
  return { main, worktree };
}

function stagePlanted(worktree) {
  writeFile(worktree, 'notes/planted.txt', `first line\nwith ${PLANTED_TOKEN} in it\n`);
  runGit(['add', 'notes/planted.txt'], worktree);
}

function denylistFor(salt) {
  return writeDenylist(tempDir('guard-wt-denylist'), [PLANTED_TOKEN], salt);
}

function runStaged(worktree, extraEnv) {
  return runNode([CLI, 'staged'], { cwd: worktree, env: guardEnv(extraEnv) });
}

test('r0_4 cli in a linked worktree falls back to the main working tree salt and rejects a planted identifier', () => {
  const { worktree } = mainWithWorktree({ mainSalt: TEST_SALT });
  const result = runStaged(worktree, { GUARD_DENYLIST_PATH: denylistFor(TEST_SALT) });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /guard: identifier at notes\/planted\.txt:2 hash [0-9a-f]{8} is on the denylist/);
  assert.ok(result.stdout.includes(PLANTED_PREFIX), result.output);
  assert.doesNotMatch(result.output.toLowerCase(), new RegExp(PLANTED_TOKEN));
  assert.doesNotMatch(result.output, new RegExp(TEST_SALT));
});

test('r0_4 cli in a linked worktree still fails closed when neither tree has a salt', () => {
  const { worktree } = mainWithWorktree();
  const result = runStaged(worktree, { GUARD_DENYLIST_PATH: denylistFor(TEST_SALT) });
  assert.equal(result.status, 2, result.output);
  assert.ok(result.stderr.includes(MESSAGE), result.output);
});

test('r0_4 cli in a linked worktree fails closed when the main tree salt file is empty', () => {
  const { worktree } = mainWithWorktree({ mainSalt: '  ' });
  const result = runStaged(worktree, { GUARD_DENYLIST_PATH: denylistFor(TEST_SALT) });
  assert.equal(result.status, 2, result.output);
  assert.ok(result.stderr.includes(MESSAGE), result.output);
});

test('r0_4 cli in a linked worktree prefers its own salt over the main tree salt', () => {
  const { worktree } = mainWithWorktree({ mainSalt: TEST_SALT });
  writeFile(worktree, '.guard-private/salt', `${WORKTREE_SALT}\n`);
  const ownHit = runStaged(worktree, { GUARD_DENYLIST_PATH: denylistFor(WORKTREE_SALT) });
  assert.equal(ownHit.status, 1, ownHit.output);
  assert.ok(ownHit.stdout.includes(hashToken(WORKTREE_SALT, PLANTED_TOKEN).slice(0, 8)), ownHit.output);
  const mainOnly = runStaged(worktree, { GUARD_DENYLIST_PATH: denylistFor(TEST_SALT) });
  assert.equal(mainOnly.status, 0, mainOnly.output);
});

test('r0_4 cli in a linked worktree prefers GUARD_SALT over both salt files', () => {
  const { worktree } = mainWithWorktree({ mainSalt: TEST_SALT });
  writeFile(worktree, '.guard-private/salt', `${WORKTREE_SALT}\n`);
  const result = runStaged(worktree, { GUARD_SALT: ENV_SALT, GUARD_DENYLIST_PATH: denylistFor(ENV_SALT) });
  assert.equal(result.status, 1, result.output);
  assert.ok(result.stdout.includes(hashToken(ENV_SALT, PLANTED_TOKEN).slice(0, 8)), result.output);
});

test('r0_4 cli in a worktree of a bare repository has no main tree to fall back to', () => {
  const source = tempDir('guard-wt-source');
  initRepo(source);
  writeFile(source, 'README.md', 'source\n');
  commitAll(source, 'chore: initial');
  const parent = tempDir('guard-wt-bare-parent');
  const bare = join(parent, 'repo.git');
  runGit(['clone', '-q', '--bare', source, bare], parent);
  // A salt beside the bare directory must not be picked up as a main tree's.
  writeFile(parent, '.guard-private/salt', `${TEST_SALT}\n`);
  const worktree = join(tempDir('guard-wt-bare-linked'), 'wt');
  runGit(['worktree', 'add', '-q', '-b', 'wt', worktree], bare);
  stagePlanted(worktree);
  const result = runStaged(worktree, { GUARD_DENYLIST_PATH: denylistFor(TEST_SALT) });
  assert.equal(result.status, 2, result.output);
  assert.ok(result.stderr.includes(MESSAGE), result.output);
});

test('r0_4 hash-denylist in a linked worktree reads the main working tree private directory', () => {
  const { main, worktree } = mainWithWorktree({ mainSalt: TEST_SALT });
  writeFile(main, '.guard-private/denylist.txt', `${PLANTED_TOKEN}\n`);
  const outputPath = join(tempDir('guard-wt-out'), 'denylist.sha256');
  const result = runNode([HASH_DENYLIST], { cwd: worktree, env: guardEnv({ GUARD_DENYLIST_PATH: outputPath }) });
  assert.equal(result.status, 0, result.output);
  assert.ok(readFileSync(outputPath, 'utf8').includes(PLANTED_HASH));
  assert.doesNotMatch(result.output.toLowerCase(), new RegExp(PLANTED_TOKEN));
});
