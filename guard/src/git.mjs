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

// Pinned so a developer's own diff.noprefix or diff.mnemonicPrefix setting cannot change
// the a/ and b/ headers the diff parser expects.
const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false'];

export function git(args, { cwd = process.cwd(), allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', [...BASE_ARGS, ...args], {
    cwd,
    encoding,
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

// Path listings use -z, so names arrive raw and NUL-separated instead of
// C-quoted when they hold quotes, backslashes or control characters.
function nulSeparated(text) {
  return String(text).split('\0').filter((entry) => entry !== '');
}

// "git log" reads A...B as the symmetric difference, while "git diff" reads it
// as the merge-base diff, so the diff range is translated for log.
function logRange(rangeArgs) {
  if (rangeArgs.length === 2 && rangeArgs[0] === EMPTY_TREE) return [rangeArgs[1]];
  return rangeArgs.map((arg) => arg.replace('...', '..'));
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
  return nulSeparated(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACR'], options).stdout);
}

export function stagedDiff(options) {
  return git(['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff'], options).stdout;
}

export function rangePaths(rangeArgs, options) {
  return nulSeparated(git(['diff', '--name-only', '-z', '--diff-filter=ACR', ...rangeArgs], options).stdout);
}

export function rangeDiff(rangeArgs, options) {
  return git(['diff', '--unified=0', '--no-color', '--no-ext-diff', ...rangeArgs], options).stdout;
}

// Full messages of the commits the range adds, NUL-separated.
export function rangeMessages(rangeArgs, options) {
  return nulSeparated(git(['log', '--format=%B', '-z', ...logRange(rangeArgs)], options).stdout);
}

export function allCommits(options) {
  return nonEmptyLines(git(['rev-list', '--all'], options).stdout);
}

export function commitPaths(sha, options) {
  return nulSeparated(git(['show', '--name-only', '-z', '--diff-filter=ACR', '--format=', sha], options).stdout);
}

export function commitDiff(sha, options) {
  return git(['show', '--unified=0', '--no-color', '--no-ext-diff', '--format=', sha], options).stdout;
}

export function commitMessage(sha, options) {
  return git(['show', '-s', '--format=%B', sha], options).stdout;
}

// The raw bytes of one file at a revision (":path" for the index), as a Buffer.
export function blob(rev, path, options) {
  const result = git(['show', `${rev}:${path}`], { ...options, encoding: 'buffer', allowFailure: true });
  return result.status === 0 ? result.stdout : null;
}

const DEFAULT_BRANCHES = ['main', 'origin/main'];

function revParse(ref, options) {
  const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { ...options, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

// The first default branch that exists and is not HEAD itself, so a branch
// pushed for the first time (zero sha) is still scanned back to where it left
// main instead of only its last commit.
function defaultBranchBehindHead(options) {
  const head = revParse('HEAD', options);
  for (const branch of DEFAULT_BRANCHES) {
    const sha = revParse(branch, options);
    if (sha === null) continue;
    const mergeBase = git(['merge-base', branch, 'HEAD'], { ...options, allowFailure: true });
    if (mergeBase.status !== 0) continue;
    if (mergeBase.stdout.trim() !== head) return branch;
  }
  return null;
}

// Decide what "ci --base <sha>" compares. A usable base gives base...HEAD.
// An empty, zero or unreachable base falls back to the merge base with main
// (every commit the branch adds), then to HEAD~1 when HEAD is main itself,
// and a root commit falls back to the empty tree so the whole tree is scanned.
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
  const branch = defaultBranchBehindHead(options);
  if (branch !== null) {
    return { rangeArgs: [`${branch}...HEAD`], note: `guard: ${why}; comparing ${branch}...HEAD` };
  }
  if (commitExists('HEAD~1', options)) {
    return { rangeArgs: ['HEAD~1...HEAD'], note: `guard: ${why}; comparing HEAD~1...HEAD` };
  }
  return { rangeArgs: [EMPTY_TREE, 'HEAD'], note: `guard: ${why} and HEAD has no parent; comparing the empty tree to HEAD` };
}
