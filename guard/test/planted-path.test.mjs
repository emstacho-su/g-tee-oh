// R0.4: planted private paths are caught by the shipped patterns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { checkPaths, compilePatterns, matchPath } from '../src/guard.mjs';
import { CLI, GUARD_DIR, PLANTED_TOKEN, TEST_SALT, guardEnv, makeTempDir, removeDir, runNode, writeDenylist, writeFile } from './helpers.mjs';

const shipped = compilePatterns(JSON.parse(readFileSync(join(GUARD_DIR, 'patterns.json'), 'utf8')).patterns);

for (const planted of ['data/x.har', 'reference/foo.json', '.guard-private/salt', 'docs/screenshots/a.png', 'tools/capture/run.ts', 'x/y.harx']) {
  test(`r0_4 shipped patterns catch ${planted}`, () => {
    assert.notEqual(matchPath(planted, shipped), null);
  });
}

for (const clean of ['docs/security.md', 'guard/src/cli.mjs', 'guard/denylist.sha256', 'crates/gto-model/src/lib.rs', 'web/src/reference-table.tsx', 'research/capture-notes.md']) {
  test(`r0_4 shipped patterns leave ${clean} alone`, () => {
    assert.equal(matchPath(clean, shipped), null);
  });
}

test('r0_4 checkPaths lists every hit with its pattern', () => {
  const findings = checkPaths(['data/x.har', 'docs/a.md', 'reference/foo.json'], shipped);
  assert.deepEqual(findings, [
    { kind: 'path', file: 'data/x.har', pattern: '**/*.har' },
    { kind: 'path', file: 'reference/foo.json', pattern: '**/reference/**' },
  ]);
});

// End to end through cli.mjs in paths mode: the three planted paths are
// reported, and a path hit is not opened, so the token inside it stays unseen.
let dir;
let denylistPath;

before(() => {
  dir = makeTempDir('guard-planted-path');
  denylistPath = writeDenylist(makeTempDir('guard-planted-path-denylist'), [PLANTED_TOKEN]);
  writeFile(dir, 'data/x.har', `{"log": "${PLANTED_TOKEN}"}\n`);
  writeFile(dir, 'reference/foo.json', '{}\n');
  writeFile(dir, '.guard-private/salt', 'synthetic\n');
  writeFile(dir, 'docs/clean.md', 'public note\n');
});

after(() => removeDir(dir));

test('r0_4 cli paths reports the planted paths and exits 1', () => {
  const result = runNode([CLI, 'paths', dir], {
    cwd: dir,
    env: guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath }),
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /guard: path data\/x\.har matches private pattern \*\*\/\*\.har/);
  assert.match(result.stdout, /guard: path reference\/foo\.json matches private pattern/);
  assert.match(result.stdout, /guard: path \.guard-private\/salt matches private pattern/);
  assert.doesNotMatch(result.stdout, /identifier at data\/x\.har/);
  assert.match(result.stdout, /guard: paths checked 4 files and 1 added lines; 3 findings/);
});
