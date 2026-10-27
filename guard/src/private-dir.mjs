// Where the guard looks for .guard-private/ (R0.4, O-58).
//
// .guard-private/ is gitignored, so it exists only in the main working tree.
// A linked worktree (git worktree add) has its own top level without it, so
// the main working tree's directory is the fallback. The callers keep their
// own precedence for GUARD_SALT and GUARD_PRIVATE_DIR ahead of these.

import { join, resolve } from 'node:path';

import { mainWorkTree } from './git.mjs';

export const PRIVATE_DIR_NAME = '.guard-private';

// The candidate directories in order: the repository root's own, then the
// main working tree's when the root is a linked worktree of a non-bare repo.
export function privateDirCandidates(repoRoot) {
  const own = join(repoRoot, PRIVATE_DIR_NAME);
  const main = mainWorkTree({ cwd: repoRoot });
  if (main === null || samePath(main, repoRoot)) return [own];
  return [own, join(main, PRIVATE_DIR_NAME)];
}

// Windows paths compare case-insensitively; git and node may differ in drive letter case.
function samePath(a, b) {
  const normalize = (path) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
  return normalize(a) === normalize(b);
}
