// R0.4: a denylisted identifier used as a file name, a directory name or inside
// a commit message is caught, not only one inside a file's lines.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { CLI, PLANTED_PREFIX, PLANTED_TOKEN, TEST_SALT, commitAll, guardEnv, initRepo, makeTempDir, removeDir, runGit, runNode, writeDenylist, writeFile } from './helpers.mjs';

let env;
let scratch;

before(() => {
  scratch = makeTempDir('guard-names');
  const denylistPath = writeDenylist(makeTempDir('guard-names-denylist'), [PLANTED_TOKEN]);
  env = guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath });
});

after(() => removeDir(scratch));

test('r0_4 paths mode flags a planted identifier in a file name and in a directory name', () => {
  const dir = makeTempDir('guard-names-paths');
  try {
    writeFile(dir, `fixtures/${PLANTED_TOKEN}_response.json`, '{"clean": true}\n');
    writeFile(dir, `${PLANTED_TOKEN}/clean.txt`, 'clean content\n');
    writeFile(dir, 'clean/clean.txt', 'clean content\n');
    const result = runNode([CLI, 'paths', dir], { cwd: dir, env });
    assert.equal(result.status, 1, result.output);
    const hits = result.stdout.match(new RegExp(`guard: identifier in the path .* hash ${PLANTED_PREFIX}`, 'g')) ?? [];
    assert.equal(hits.length, 2, result.stdout);
    assert.match(result.stdout, /guard: paths checked 3 files and 3 added lines; 2 findings/);
  } finally {
    removeDir(dir);
  }
});

test('r0_4 staged mode flags a planted identifier in an added path', () => {
  const repo = makeTempDir('guard-names-staged');
  try {
    initRepo(repo);
    writeFile(repo, 'README.md', 'clean start\n');
    commitAll(repo, 'chore: clean start');
    writeFile(repo, `data/${PLANTED_TOKEN}.json`, '{}\n');
    runGit(['add', '-A'], repo);
    const result = runNode([CLI, 'staged'], { cwd: repo, env });
    assert.equal(result.status, 1, result.output);
    assert.match(result.stdout, new RegExp(`guard: identifier in the path data/${PLANTED_TOKEN}\\.json hash ${PLANTED_PREFIX}`));
    assert.match(result.stdout, /guard: staged checked 1 files and 1 added lines; 1 findings/);
  } finally {
    removeDir(repo);
  }
});

test('r0_4 message mode flags a planted identifier in a commit message and ignores comment lines', () => {
  const planted = writeFile(scratch, 'msg-planted.txt', `feat: parse ${PLANTED_TOKEN} from the response\n\nbody\n`);
  const hit = runNode([CLI, 'message', planted], { cwd: scratch, env });
  assert.equal(hit.status, 1, hit.output);
  assert.match(hit.stdout, new RegExp(`guard: identifier at <commit message>:1 hash ${PLANTED_PREFIX}`));
  assert.match(hit.stdout, /guard: message checked 0 files and 3 added lines; 1 findings/);

  const commented = writeFile(scratch, 'msg-comment.txt', `feat: clean subject\n# ${PLANTED_TOKEN} only in a comment git strips\n`);
  const clean = runNode([CLI, 'message', commented], { cwd: scratch, env });
  assert.equal(clean.status, 0, clean.output);
  assert.match(clean.stdout, /0 findings/);
});

test('r0_4 ci and history modes flag a planted identifier in a commit message', () => {
  const repo = makeTempDir('guard-names-history');
  try {
    initRepo(repo);
    writeFile(repo, 'README.md', 'clean start\n');
    const firstSha = commitAll(repo, 'chore: clean start');
    writeFile(repo, 'src/clean.txt', 'clean line\n');
    commitAll(repo, `feat: add ${PLANTED_TOKEN} fixtures`);
    const ci = runNode([CLI, 'ci', '--base', firstSha], { cwd: repo, env });
    assert.equal(ci.status, 1, ci.output);
    assert.match(ci.stdout, new RegExp(`guard: identifier at <commit message>:1 hash ${PLANTED_PREFIX}`));
    assert.match(ci.stdout, /guard: ci checked 1 files and 1 added lines; 1 findings/);
    const history = runNode([CLI, 'history'], { cwd: repo, env });
    assert.equal(history.status, 1, history.output);
    assert.match(history.stdout, new RegExp(`guard: identifier at <commit message>:1 hash ${PLANTED_PREFIX} is on the denylist \\(commit [0-9a-f]{8}\\)`));
    assert.match(history.stdout, /guard: history checked 2 files and 2 added lines; 1 findings/);
  } finally {
    removeDir(repo);
  }
});

test('r0_4 ci with the zero sha on a feature branch scans back to the merge base with main', () => {
  const repo = makeTempDir('guard-names-branch');
  try {
    initRepo(repo);
    writeFile(repo, 'README.md', 'clean start\n');
    commitAll(repo, 'chore: clean start');
    runGit(['switch', '-q', '-c', 'p9/feature'], repo);
    writeFile(repo, 'first.txt', `first commit mentions ${PLANTED_TOKEN}\n`);
    commitAll(repo, 'feat: first');
    writeFile(repo, 'second.txt', 'clean second commit\n');
    commitAll(repo, 'feat: second');
    const result = runNode([CLI, 'ci', '--base', '0'.repeat(40)], { cwd: repo, env });
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /zero sha; comparing main\.\.\.HEAD/);
    assert.match(result.stdout, new RegExp(`guard: identifier at first\\.txt:1 hash ${PLANTED_PREFIX}`));
    assert.match(result.stdout, /guard: ci checked 2 files and 2 added lines; 1 findings/);
  } finally {
    removeDir(repo);
  }
});

test('r0_4 a path with a quote in its name still matches a private pattern', () => {
  if (process.platform === 'win32') return; // Windows forbids quotes in file names
  const repo = makeTempDir('guard-names-quote');
  try {
    initRepo(repo);
    writeFile(repo, 'README.md', 'clean start\n');
    commitAll(repo, 'chore: clean start');
    writeFile(repo, 'screenshots/a"b.png', 'x');
    runGit(['add', '-A'], repo);
    const result = runNode([CLI, 'staged'], { cwd: repo, env });
    assert.equal(result.status, 1, result.output);
    assert.match(result.stdout, /guard: path screenshots\/a"b\.png matches private pattern/);
  } finally {
    removeDir(repo);
  }
});
