// Shared helpers for the guard tests. Synthetic data only: the salt and the
// tokens here are made up and never touch guard/denylist.sha256 or
// .guard-private/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashToken } from '../src/guard.mjs';

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const GUARD_DIR = resolve(TEST_DIR, '..');
export const REPO_ROOT = resolve(GUARD_DIR, '..');
export const CLI = join(GUARD_DIR, 'src', 'cli.mjs');
export const COMMIT_MSG = join(GUARD_DIR, 'src', 'commit-msg.mjs');
export const HASH_DENYLIST = join(GUARD_DIR, 'src', 'hash-denylist.mjs');

export const TEST_SALT = 'synthetic-test-salt-not-the-real-one';
export const PLANTED_TOKEN = 'plantedtoken7q';
export const PLANTED_HASH = hashToken(TEST_SALT, PLANTED_TOKEN);
export const PLANTED_PREFIX = PLANTED_HASH.slice(0, 8);

const GUARD_VARS = ['GUARD_SALT', 'GUARD_DENYLIST_PATH', 'GUARD_FORK', 'GUARD_BASE', 'GUARD_PRIVATE_DIR'];

export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function writeFile(dir, relativePath, content) {
  const full = join(dir, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

export function writeDenylist(dir, tokens, salt = TEST_SALT) {
  const body = tokens.map((token) => hashToken(salt, token)).join('\n');
  return writeFile(dir, 'denylist.sha256', `# synthetic denylist for tests\n${body}\n`);
}

// A copy of the environment without any guard variable, plus the ones a test sets.
export function guardEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of GUARD_VARS) delete env[name];
  return { ...env, ...extra };
}

export function envWithout(names, extra = {}) {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return { ...env, ...extra };
}

export function runNode(args, { cwd = REPO_ROOT, env = process.env } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

export function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// A throwaway repository with an identity, no signing and no hooks.
export function initRepo(dir) {
  runGit(['init', '-q', '-b', 'main'], dir);
  runGit(['config', 'user.name', 'guard-test'], dir);
  runGit(['config', 'user.email', 'guard-test@example.invalid'], dir);
  runGit(['config', 'commit.gpgsign', 'false'], dir);
  runGit(['config', 'core.hooksPath', join(dir, 'no-hooks')], dir);
}

export function commitAll(dir, message) {
  runGit(['add', '-A'], dir);
  runGit(['commit', '-q', '--no-verify', '-m', message], dir);
  return runGit(['rev-parse', 'HEAD'], dir);
}
