// Where the guard finds its salt under .guard-private/ (R0.4, O-58).
//
// .guard-private/ is gitignored, so it exists only in the main working tree.
// A linked worktree (git worktree add) has its own top level without it, so
// the main working tree's directory is the fallback. The callers keep their
// own precedence for GUARD_SALT and GUARD_PRIVATE_DIR ahead of this lookup.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { mainWorkTree } from './git.mjs';

export const PRIVATE_DIR_NAME = '.guard-private';
export const SALT_FILE_NAME = 'salt';

// The trimmed salt in dir, or null when the file is missing or empty.
export function readSalt(dir) {
  const saltPath = join(dir, SALT_FILE_NAME);
  if (!existsSync(saltPath)) return null;
  const salt = readFileSync(saltPath, 'utf8').trim();
  return salt === '' ? null : salt;
}

// The first private directory holding a non-empty salt, as { dir, salt }: the
// repo root's own, then the main working tree's when the root is a linked
// worktree of a non-bare repository. Null when neither has one. Git is only
// asked for the main tree when the root's own salt is missing, so a commit in
// the main clone spawns no extra process. The salt is never printed.
export function findSalt(repoRoot) {
  const ownDir = join(repoRoot, PRIVATE_DIR_NAME);
  const ownSalt = readSalt(ownDir);
  if (ownSalt !== null) return { dir: ownDir, salt: ownSalt };
  const main = mainWorkTree({ cwd: repoRoot });
  if (main === null || samePath(main, repoRoot)) return null;
  const mainDir = join(main, PRIVATE_DIR_NAME);
  const mainSalt = readSalt(mainDir);
  return mainSalt === null ? null : { dir: mainDir, salt: mainSalt };
}

// Windows paths compare case-insensitively; git and node may differ in drive letter case.
function samePath(a, b) {
  const normalize = (path) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
  return normalize(a) === normalize(b);
}
