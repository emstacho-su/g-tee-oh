// R0.4: a planted identifier is reported by file and line, never by token.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { checkLines, formatFinding, hashToken, parseDenylist, parseUnifiedDiff } from '../src/guard.mjs';
import {
  CLI,
  PLANTED_PREFIX,
  PLANTED_TOKEN,
  TEST_SALT,
  guardEnv,
  initRepo,
  makeTempDir,
  removeDir,
  runGit,
  runNode,
  writeDenylist,
  writeFile,
} from './helpers.mjs';

const diff = [
  'diff --git a/notes/planted.txt b/notes/planted.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/notes/planted.txt',
  '@@ -0,0 +1,3 @@',
  '+first line',
  '+second line',
  `+third line with ${PLANTED_TOKEN.toUpperCase()} in it`,
  '',
].join('\n');

test('r0_4 checkLines finds the planted token at its line and formats it without the token', () => {
  const dir = makeTempDir('guard-denylist');
  let denylist;
  try {
    denylist = parseDenylist(readFileSync(writeDenylist(dir, [PLANTED_TOKEN]), 'utf8'));
  } finally {
    removeDir(dir);
  }
  const findings = checkLines(parseUnifiedDiff(diff), TEST_SALT, denylist);
  assert.deepEqual(findings, [{ kind: 'identifier', file: 'notes/planted.txt', line: 3, hashPrefix: PLANTED_PREFIX }]);
  const printed = formatFinding(findings[0]);
  assert.match(printed, /notes\/planted\.txt:3/);
  assert.ok(printed.includes(PLANTED_PREFIX));
  assert.doesNotMatch(printed.toLowerCase(), new RegExp(PLANTED_TOKEN));
});

test('r0_4 checkLines stays quiet for another token or another salt', () => {
  const otherToken = parseDenylist(`${hashToken(TEST_SALT, 'unrelatedtoken')}\n`);
  assert.deepEqual(checkLines(parseUnifiedDiff(diff), TEST_SALT, otherToken), []);
  const planted = parseDenylist(`${hashToken(TEST_SALT, PLANTED_TOKEN)}\n`);
  assert.deepEqual(checkLines(parseUnifiedDiff(diff), 'another-salt', planted), []);
});

// End to end through cli.mjs in staged mode inside a throwaway repository.
let repo;
let denylistPath;

before(() => {
  repo = makeTempDir('guard-staged');
  initRepo(repo);
  denylistPath = writeDenylist(makeTempDir('guard-staged-denylist'), [PLANTED_TOKEN]);
  writeFile(repo, 'notes/planted.txt', `first line\nsecond line\nthird line with ${PLANTED_TOKEN} in it\n`);
  writeFile(repo, 'notes/clean.txt', 'nothing to see here\n');
  runGit(['add', 'notes'], repo);
});

after(() => removeDir(repo));

test('r0_4 cli staged reports the planted identifier with its line number and exits 1', () => {
  const result = runNode([CLI, 'staged'], {
    cwd: repo,
    env: guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /guard: identifier at notes\/planted\.txt:3 hash [0-9a-f]{8} is on the denylist/);
  assert.match(result.stdout, /guard: staged checked 2 files and 4 added lines; 1 findings/);
  assert.doesNotMatch(result.output.toLowerCase(), new RegExp(PLANTED_TOKEN));
});

test('r0_4 cli staged is clean when the planted file is not staged', () => {
  runGit(['reset', '-q', '--', 'notes/planted.txt'], repo);
  const result = runNode([CLI, 'staged'], {
    cwd: repo,
    env: guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath }),
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /guard: staged checked 1 files and 1 added lines; 0 findings/);
});
