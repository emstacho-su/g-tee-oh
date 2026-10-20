// Git plumbing for the private-data guard (R0.4).
//
// Every call goes through spawnSync with shell set to false, so arguments are
// never re-parsed by a shell and a path or sha cannot inject a command.

import { spawnSync } from 'node:child_process';

// The sha of git's empty tree, used as a diff base when HEAD has no parent.
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const ZERO_SHA = /^0+$/;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

export class GitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitError';
  }
}

export function git(args, { cwd = process.cwd(), allowFailure = false } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error) {
    throw new GitError(`git could not start: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new GitError(`git ${args.join(' ')} failed with status ${result.status}: ${result.stderr.trim()}`);
  }
  return result;
}

function nonEmptyLines(text) {
  return String(text).split(/\r?\n/).filter((line) => line !== '');
}

export function topLevel(options) {
  const result = git(['rev-parse', '--show-toplevel'], { ...options, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function commitExists(ref, options) {
  const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { ...options, allowFailure: true });
  return result.status === 0;
}

export function stagedPaths(options) {
  return nonEmptyLines(git(['diff', '--cached', '--name-only', '--diff-filter=ACR'], options).stdout);
}

export function stagedDiff(options) {
  return git(['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff'], options).stdout;
}

export function rangePaths(rangeArgs, options) {
  return nonEmptyLines(git(['diff', '--name-only', '--diff-filter=ACR', ...rangeArgs], options).stdout);
}

export function rangeDiff(rangeArgs, options) {
  return git(['diff', '--unified=0', '--no-color', '--no-ext-diff', ...rangeArgs], options).stdout;
}

export function allCommits(options) {
  return nonEmptyLines(git(['rev-list', '--all'], options).stdout);
}

export function commitPaths(sha, options) {
  return nonEmptyLines(git(['show', '--name-only', '--diff-filter=ACR', '--format=', sha], options).stdout);
}

export function commitDiff(sha, options) {
  return git(['show', '--unified=0', '--no-color', '--no-ext-diff', '--format=', sha], options).stdout;
}

// Decide what "ci --base <sha>" compares. A usable base gives base...HEAD.
// An empty, zero or unreachable base falls back to HEAD~1, and a root commit
// falls back to the empty tree so the whole tree is scanned.
export function resolveRange(base, options) {
  const trimmed = String(base ?? '').trim();
  if (trimmed !== '' && !ZERO_SHA.test(trimmed) && commitExists(trimmed, options)) {
    return { rangeArgs: [`${trimmed}...HEAD`], note: null };
  }
  let why;
  if (trimmed === '') {
    why = 'no base was given';
  } else if (ZERO_SHA.test(trimmed)) {
    why = 'the base is the zero sha';
  } else {
    why = `the base ${trimmed.slice(0, 8)} is not a commit in this clone`;
  }
  if (commitExists('HEAD~1', options)) {
    return { rangeArgs: ['HEAD~1...HEAD'], note: `guard: ${why}; comparing HEAD~1...HEAD` };
  }
  return { rangeArgs: [EMPTY_TREE, 'HEAD'], note: `guard: ${why} and HEAD has no parent; comparing the empty tree to HEAD` };
}
