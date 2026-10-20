// R0.4: fixes from the S01 code review. Recorded commit messages keep their "#" lines in
// ci and history modes, UTF-16 text is scanned in paths and staged modes, underscored
// identifiers match inside longer runs, an empty denylist fails closed, and the trailer
// check accepts only the documented trailer.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { messageLines, parseDenylist, tokenize } from '../src/guard.mjs';
import { CLI, COMMIT_MSG, PLANTED_PREFIX, PLANTED_TOKEN, TEST_SALT, commitAll, guardEnv, initRepo, makeTempDir, removeDir, runGit, runNode, writeDenylist, writeFile } from './helpers.mjs';

test('r0_4 messageLines keeps "#" lines unless asked to strip them', () => {
  const text = 'feat: x\n\n# notes: keep me\n';
  assert.equal(messageLines(text).length, 3);
  assert.equal(messageLines(text, { stripComments: true }).length, 2);
});

test('r0_4 tokenize emits every contiguous underscore window', () => {
  assert.deepEqual(tokenize('second_token_x_response'), ['second_token_x_response', 'second', 'second_token', 'second_token_x', 'token_x', 'token_x_response', 'x_response', 'response']);
});

test('r0_4 an empty denylist fails closed', () => {
  assert.throws(() => parseDenylist('# header only\n'), /holds no hashes/);
});

test('r0_4 ci and history modes flag an identifier on a "#" line of a recorded message', () => {
  const repo = makeTempDir('guard-hash-line');
  try {
    initRepo(repo);
    const denylistPath = writeDenylist(makeTempDir('guard-hash-line-denylist'), [PLANTED_TOKEN]);
    const env = guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath });
    writeFile(repo, 'README.md', 'clean\n');
    const first = commitAll(repo, 'chore: clean');
    writeFile(repo, 'a.txt', 'clean\n');
    commitAll(repo, `feat: x\n\n# notes: ${PLANTED_TOKEN}`);
    const ci = runNode([CLI, 'ci', '--base', first], { cwd: repo, env });
    assert.equal(ci.status, 1, ci.output);
    assert.match(ci.stdout, new RegExp(`<commit message>:3 hash ${PLANTED_PREFIX}`));
  } finally {
    removeDir(repo);
  }
});

test('r0_4 a UTF-16 text file is scanned in paths mode and when staged', () => {
  const repo = makeTempDir('guard-utf16');
  try {
    initRepo(repo);
    const denylistPath = writeDenylist(makeTempDir('guard-utf16-denylist'), [PLANTED_TOKEN]);
    const env = guardEnv({ GUARD_SALT: TEST_SALT, GUARD_DENYLIST_PATH: denylistPath });
    const bom = Buffer.from([0xff, 0xfe]);
    writeFileSync(join(repo, 'notes.txt'), Buffer.concat([bom, Buffer.from(`${PLANTED_TOKEN}\n`, 'utf16le')]));
    const paths = runNode([CLI, 'paths', repo], { cwd: repo, env });
    assert.equal(paths.status, 1, paths.output);
    assert.match(paths.stdout, new RegExp(`notes\\.txt:1 hash ${PLANTED_PREFIX}`));
    runGit(['add', '-A'], repo);
    const staged = runNode([CLI, 'staged'], { cwd: repo, env });
    assert.equal(staged.status, 1, staged.output);
    assert.match(staged.stdout, new RegExp(`notes\\.txt:1 hash ${PLANTED_PREFIX}`));
  } finally {
    removeDir(repo);
  }
});

test('r0_1 the trailer check accepts only the documented trailer', () => {
  const dir = makeTempDir('guard-trailer');
  try {
    const env = { ...process.env, CLAUDECODE: '1' };
    const other = writeFile(dir, 'other.txt', 'feat: x\n\nCo-Authored-By: Claude Someone Else <noreply@anthropic.com>\n');
    assert.equal(runNode([COMMIT_MSG, other], { env }).status, 1);
    const exact = writeFile(dir, 'exact.txt', 'feat: x\n\nco-authored-by: claude fable 5.1 <noreply@anthropic.com>\n');
    assert.equal(runNode([COMMIT_MSG, exact], { env }).status, 0);
  } finally {
    removeDir(dir);
  }
});
