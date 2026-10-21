// R0.1: "just --list" shows the whole task surface.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { REPO_ROOT } from './helpers.mjs';

const CONTRACT_RECIPES = [
  'default',
  'rust-fmt',
  'rust-clippy',
  'rust-test',
  'rust-boundary',
  'ts-lint',
  'ts-typecheck',
  'ts-test',
  'contracts',
  'contracts-check',
  'e2e',
  'e2e-web',
  'licenses',
  'security',
  'guard',
  'guard-ci',
  'guard-history',
  'guard-paths',
  'guard-test',
  'test-tags',
  'images',
  'docs-mirror',
  'hooks',
  'bench',
  'gates',
  'gates-check',
  'equity-table',
  'report-check',
  'ci',
];

function listRecipes() {
  const result = spawnSync('just', ['--list'], { cwd: REPO_ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error) throw new Error(`just is not installed or not on PATH: ${result.error.message}`);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name !== '');
}

test('r0_1 just --list shows every contract recipe', () => {
  const names = new Set(listRecipes());
  for (const recipe of CONTRACT_RECIPES) {
    assert.ok(names.has(recipe), `recipe ${recipe} is missing from just --list`);
  }
});
