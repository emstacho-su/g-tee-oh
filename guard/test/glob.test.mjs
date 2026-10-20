// R0.4: glob-to-regex translation used by the path check.
import assert from 'node:assert/strict';
import test from 'node:test';

import { compilePatterns, globToRegExp, matchPath, normalizePath } from '../src/guard.mjs';

const table = [
  ['**/*.har', 'data/x.har', true],
  ['**/*.har', 'x.har', true],
  ['**/*.har', 'DATA/X.HAR', true],
  ['**/*.har', 'deep/er/path/x.har', true],
  ['**/*.har', 'data/x.harx', false],
  ['**/*.har', 'data/x.har.txt', false],
  ['**/*.harx', 'x/y.harx', true],
  ['**/reference/**', 'reference/foo.json', true],
  ['**/reference/**', 'a/b/reference/c/d.txt', true],
  ['**/reference/**', 'references/foo.json', false],
  ['**/reference/**', 'a/myreference/x', false],
  ['**/reference/**', 'web/src/reference-table.tsx', false],
  ['**/capture/**', 'tools/capture/run.ts', true],
  ['**/capture/**', 'research/capture-notes.md', false],
  ['**/screenshots/**', 'docs/screenshots/a.png', true],
  ['.guard-private/**', '.guard-private/salt', true],
  ['.guard-private/**', 'x/.guard-private/salt', false],
  ['src/*.rs', 'src/b.rs', true],
  ['src/*.rs', 'src/a/b.rs', false],
  ['a?c', 'abc', true],
  ['a?c', 'a/c', false],
  ['a.b', 'aXb', false],
  ['**', 'anything/at/all', true],
];

for (const [pattern, path, expected] of table) {
  test(`r0_4 glob ${pattern} against ${path} is ${expected}`, () => {
    assert.equal(globToRegExp(pattern).test(path), expected);
  });
}

test('r0_4 normalizePath turns backslashes and a leading ./ into a repo-relative forward-slash path', () => {
  assert.equal(normalizePath('data\\x.har'), 'data/x.har');
  assert.equal(normalizePath('./docs/a.md'), 'docs/a.md');
  assert.equal(normalizePath('/abs/x'), 'abs/x');
});

test('r0_4 matchPath returns the first matching pattern or null', () => {
  const compiled = compilePatterns(['**/*.har', '**/reference/**']);
  assert.equal(matchPath('data\\x.har', compiled), '**/*.har');
  assert.equal(matchPath('reference/foo.json', compiled), '**/reference/**');
  assert.equal(matchPath('docs/security.md', compiled), null);
});

test('r0_4 compilePatterns rejects a malformed patterns list', () => {
  assert.throws(() => compilePatterns(['', 1]));
  assert.throws(() => compilePatterns('**/*.har'));
});
