// R0.4: the hash-denylist script rebuilds guard/denylist.sha256 from the plain
// list and prints counts only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { hashToken } from '../src/guard.mjs';
import { buildDenylist } from '../src/hash-denylist.mjs';
import { HASH_DENYLIST, PLANTED_HASH, PLANTED_TOKEN, TEST_SALT, guardEnv, makeTempDir, removeDir, runNode, writeFile } from './helpers.mjs';

let privateDir;
let outputPath;

before(() => {
  privateDir = makeTempDir('guard-private');
  outputPath = join(makeTempDir('guard-out'), 'denylist.sha256');
  writeFile(privateDir, 'salt', `${TEST_SALT}\n`);
  writeFile(privateDir, 'denylist.txt', ['# synthetic plain list', '', PLANTED_TOKEN.toUpperCase(), 'short', 'has-hyphen99', 'second_token_x', ''].join('\n'));
});

after(() => removeDir(privateDir));

test('r0_4 buildDenylist lowercases entries, skips unusable lines by number and sorts the hashes', () => {
  const { hashes, skipped } = buildDenylist(TEST_SALT, 'Alpha_Beta9\n# c\n\nshort\nsecond_token_x\nalpha_beta9\n');
  assert.deepEqual(skipped, [4]);
  assert.deepEqual(hashes, [hashToken(TEST_SALT, 'alpha_beta9'), hashToken(TEST_SALT, 'second_token_x')].sort());
});

test('r0_4 hash-denylist writes salted hashes and never prints a token', () => {
  const result = runNode([HASH_DENYLIST], { env: guardEnv({ GUARD_PRIVATE_DIR: privateDir, GUARD_DENYLIST_PATH: outputPath }) });
  assert.equal(result.status, 0, result.output);
  const written = readFileSync(outputPath, 'utf8');
  assert.ok(written.includes(PLANTED_HASH));
  assert.ok(written.includes(hashToken(TEST_SALT, 'second_token_x')));
  assert.match(result.stdout, /wrote 2 hashes/);
  assert.match(result.stderr, /line 4 skipped/);
  assert.match(result.stderr, /line 5 skipped/);
  for (const secret of [PLANTED_TOKEN, 'second_token_x', 'has-hyphen99', TEST_SALT]) {
    assert.doesNotMatch(result.output.toLowerCase(), new RegExp(secret.toLowerCase()));
    assert.doesNotMatch(written.toLowerCase(), new RegExp(secret.toLowerCase()));
  }
});

test('r0_4 hash-denylist exits 2 when the private inputs are missing', () => {
  const empty = makeTempDir('guard-private-empty');
  try {
    const result = runNode([HASH_DENYLIST], { env: guardEnv({ GUARD_PRIVATE_DIR: empty, GUARD_DENYLIST_PATH: outputPath }) });
    assert.equal(result.status, 2, result.output);
    assert.match(result.stderr, /is missing/);
  } finally {
    removeDir(empty);
  }
});
