// R0.4: tokenizer, hashing, denylist parsing and diff parsing.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GuardConfigError, hashToken, parseDenylist, parseUnifiedDiff, tokenize } from '../src/guard.mjs';
import { PLANTED_TOKEN } from './helpers.mjs';

test('r0_4 tokenizer keeps runs of six or more word characters, lowercased', () => {
  assert.deepEqual(tokenize('Foo abc12 PlantedToken7Q  x_y_z12 short'), ['plantedtoken7q', 'x_y_z12']);
});

test('r0_4 tokenizer splits on punctuation and drops short pieces', () => {
  assert.deepEqual(tokenize('alpha-bravo12, "charlie_9" (d)'), ['bravo12', 'charlie_9']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('a b c'), []);
});

test('r0_4 hashToken is sha256 over salt immediately followed by token', () => {
  assert.equal(hashToken('', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hashToken('ab', 'c'), hashToken('a', 'bc'));
  assert.notEqual(hashToken('salt1', PLANTED_TOKEN), hashToken('salt2', PLANTED_TOKEN));
});

test('r0_4 parseDenylist ignores blanks and comments and accepts uppercase hex', () => {
  const upper = hashToken('s', 't').toUpperCase();
  const set = parseDenylist(`# comment\n\n${hashToken('s', 't')}\n  ${upper}  \n`);
  assert.equal(set.size, 1);
  assert.ok(set.has(hashToken('s', 't')));
});

test('r0_4 parseDenylist rejects a malformed line without printing it', () => {
  assert.throws(() => parseDenylist('not-a-hash\n'), (error) => {
    assert.ok(error instanceof GuardConfigError);
    assert.match(error.message, /line 1/);
    assert.doesNotMatch(error.message, /not-a-hash/);
    return true;
  });
});

const sampleDiff = [
  'diff --git a/notes/planted.txt b/notes/planted.txt',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/notes/planted.txt',
  '@@ -0,0 +1,3 @@',
  '+first line of a note',
  '+second line, nothing here',
  `+third line mentions ${PLANTED_TOKEN} in passing`,
  'diff --git a/src/lib.rs b/src/lib.rs',
  'index 2222222..3333333 100644',
  '--- a/src/lib.rs',
  '+++ b/src/lib.rs',
  '@@ -10,0 +11,2 @@ fn existing() {}',
  '+fn added_one() {}',
  '+fn added_two() {}',
  '@@ -20 +22 @@',
  '-fn removed() {}',
  '+fn replaced() {}',
  '\\ No newline at end of file',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-was here',
  'diff --git a/pic.png b/pic.png',
  'Binary files a/pic.png and b/pic.png differ',
  '',
].join('\n');

test('r0_4 parseUnifiedDiff returns added lines with their new line numbers', () => {
  const added = parseUnifiedDiff(sampleDiff);
  assert.deepEqual(
    added.map(({ file, line }) => `${file}:${line}`),
    ['notes/planted.txt:1', 'notes/planted.txt:2', 'notes/planted.txt:3', 'src/lib.rs:11', 'src/lib.rs:12', 'src/lib.rs:22'],
  );
  assert.equal(added[2].text, `third line mentions ${PLANTED_TOKEN} in passing`);
});

test('r0_4 parseUnifiedDiff reads combined diffs of merge commits', () => {
  const combined = [
    'diff --cc merged.txt',
    'index 1111111,2222222..3333333',
    '--- a/merged.txt',
    '+++ b/merged.txt',
    '@@@ -1,2 -1,2 +1,3 @@@',
    '  shared line',
    ' +from the second parent',
    `++resolved ${PLANTED_TOKEN} here`,
    '',
  ].join('\n');
  const added = parseUnifiedDiff(combined);
  assert.deepEqual(
    added.map(({ file, line, text }) => [file, line, text]),
    [
      ['merged.txt', 2, 'from the second parent'],
      ['merged.txt', 3, `resolved ${PLANTED_TOKEN} here`],
    ],
  );
});

test('r0_4 parseUnifiedDiff treats a removed line that looks like a header as content', () => {
  const tricky = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '--- not a header', '+++ not a header either', ''].join('\n');
  const added = parseUnifiedDiff(tricky);
  assert.deepEqual(added, [{ file: 'f', line: 1, text: '++ not a header either' }]);
});
