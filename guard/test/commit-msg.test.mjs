// R0.1: the commit-msg hook requires the co-author trailer on Claude commits (O-29).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { REQUIRED_TRAILER, check, hasClaudeTrailer } from '../src/commit-msg.mjs';
import { COMMIT_MSG, envWithout, makeTempDir, removeDir, runNode, writeFile } from './helpers.mjs';

let dir;
let withoutTrailer;
let withTrailer;
let trailerInComment;

before(() => {
  dir = makeTempDir('commit-msg');
  withoutTrailer = writeFile(dir, 'plain.txt', 'feat: add thing\n\nBody text.\n');
  withTrailer = writeFile(dir, 'trailer.txt', `feat: add thing\n\nBody text.\n\n${REQUIRED_TRAILER}\n`);
  trailerInComment = writeFile(dir, 'comment.txt', `feat: add thing\n# ${REQUIRED_TRAILER}\n`);
});

after(() => removeDir(dir));

test('r0_1 hasClaudeTrailer ignores comment lines and is case-insensitive on the key', () => {
  assert.equal(hasClaudeTrailer(`x\n\n${REQUIRED_TRAILER}`), true);
  assert.equal(hasClaudeTrailer(`x\n\n${REQUIRED_TRAILER.toLowerCase()}`), true);
  assert.equal(hasClaudeTrailer('x\n\nco-authored-by: Claude <noreply@anthropic.com>'), false);
  assert.equal(hasClaudeTrailer(`x\n# ${REQUIRED_TRAILER}`), false);
  assert.equal(hasClaudeTrailer('x\n\nCo-Authored-By: Someone Else <a@b.c>'), false);
});

test('r0_1 check passes any message outside a Claude session', () => {
  assert.deepEqual(check('feat: x', {}), { ok: true });
  assert.deepEqual(check('feat: x', { CLAUDECODE: '' }), { ok: true });
});

test('r0_1 hook exits 1 with CLAUDECODE set and no trailer, quoting the required line', () => {
  const result = runNode([COMMIT_MSG, withoutTrailer], { env: envWithout(['CLAUDECODE'], { CLAUDECODE: '1' }) });
  assert.equal(result.status, 1, result.output);
  assert.ok(result.stderr.includes(REQUIRED_TRAILER), result.output);
});

test('r0_1 hook exits 1 when the trailer only appears in a comment line', () => {
  const result = runNode([COMMIT_MSG, trailerInComment], { env: envWithout(['CLAUDECODE'], { CLAUDECODE: '1' }) });
  assert.equal(result.status, 1, result.output);
});

test('r0_1 hook exits 0 with CLAUDECODE set and the trailer present', () => {
  const result = runNode([COMMIT_MSG, withTrailer], { env: envWithout(['CLAUDECODE'], { CLAUDECODE: '1' }) });
  assert.equal(result.status, 0, result.output);
});

test('r0_1 hook exits 0 without CLAUDECODE even when the trailer is missing', () => {
  const result = runNode([COMMIT_MSG, withoutTrailer], { env: envWithout(['CLAUDECODE']) });
  assert.equal(result.status, 0, result.output);
});

test('r0_1 hook exits 2 without a message file argument', () => {
  const result = runNode([COMMIT_MSG], { env: envWithout(['CLAUDECODE']) });
  assert.equal(result.status, 2, result.output);
});
