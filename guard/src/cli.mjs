#!/usr/bin/env node
// Entry point of the private-data guard (R0.4, O-58). See guard/README.md.
//
// Modes: staged, ci [--base <sha>], history, paths <dir>, message <file>.
// Exit 0 when clean, 1 on findings, 2 on a configuration error. The guard
// reports the file and line of an identifier hit with the first characters of
// its hash and never prints the token. Added file paths and commit messages
// go through the identifier check as well as added lines.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as git from './git.mjs';
import {
  GuardConfigError,
  MAX_FILE_BYTES,
  binaryAddedPaths,
  checkLines,
  checkPaths,
  compilePatterns,
  decodeText,
  formatFinding,
  formatSummary,
  isBinary,
  linesOfFile,
  messageLines,
  normalizePath,
  parseDenylist,
  parseUnifiedDiff,
  pathLines,
} from './guard.mjs';
import { findSalt } from './private-dir.mjs';

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_CONFIG = 2;
const PROGRESS_EVERY = 50;
const MODES = ['staged', 'ci', 'history', 'paths', 'message'];

const GUARD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATTERNS_PATH = join(GUARD_DIR, 'patterns.json');
const DEFAULT_DENYLIST_PATH = join(GUARD_DIR, 'denylist.sha256');

export const MISSING_SALT_MESSAGE =
  'guard: GUARD_SALT is not set and .guard-private/salt is missing; the identifier check cannot run (fail closed, O-58)';
const USAGE =
  'usage: node guard/src/cli.mjs <staged | ci [--base <sha>] | history | paths <dir> | message <file>> [--patterns-only]';

function parseArgs(argv) {
  const parsed = { mode: null, dir: null, base: process.env.GUARD_BASE ?? '', patternsOnly: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--patterns-only') {
      parsed.patternsOnly = true;
    } else if (arg === '--base') {
      parsed.base = argv[i + 1] ?? '';
      i += 1;
    } else if (arg.startsWith('--base=')) {
      parsed.base = arg.slice('--base='.length);
    } else if (arg.startsWith('--')) {
      throw new GuardConfigError(`unknown flag ${arg}\n${USAGE}`);
    } else {
      rest.push(arg);
    }
  }
  parsed.mode = rest[0] ?? null;
  parsed.dir = rest[1] ?? null;
  if (!MODES.includes(parsed.mode)) throw new GuardConfigError(USAGE);
  if ((parsed.mode === 'paths' || parsed.mode === 'message') && parsed.dir === null) throw new GuardConfigError(USAGE);
  return parsed;
}

function loadPatterns() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(PATTERNS_PATH, 'utf8'));
  } catch (error) {
    throw new GuardConfigError(`cannot read ${PATTERNS_PATH}: ${error.message}`);
  }
  return compilePatterns(parsed.patterns);
}

function loadDenylist() {
  const path = process.env.GUARD_DENYLIST_PATH || DEFAULT_DENYLIST_PATH;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new GuardConfigError(`cannot read denylist ${path}: ${error.message}`);
  }
  return parseDenylist(text);
}

// GUARD_SALT wins; otherwise the first non-empty .guard-private/salt, at the
// repo root and then, in a linked worktree, at the main working tree. The salt
// is used in memory only and never printed.
function resolveSalt(repoRoot) {
  const fromEnv = process.env.GUARD_SALT;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  return findSalt(repoRoot)?.salt ?? null;
}

// Files git calls binary are read back as blobs: a UTF-16 file (PowerShell's default
// output encoding) is text and is scanned; a real binary file is skipped.
function binaryAddedLines(binaryAdded, rev) {
  const lines = [];
  for (const file of binaryAdded) {
    const buffer = git.blob(rev, file);
    if (buffer === null) continue;
    const text = decodeText(buffer);
    if (text !== null) lines.push(...linesOfFile(file, text));
  }
  return lines;
}

function addedLines(diffText, rev) {
  return [...parseUnifiedDiff(diffText), ...binaryAddedLines(binaryAddedPaths(diffText), rev)];
}

function runStaged(context) {
  const paths = git.stagedPaths();
  return scanChange(context, paths, addedLines(git.stagedDiff(), ''));
}

function runCi(context, base) {
  const { rangeArgs, note } = git.resolveRange(base);
  if (note) console.error(note);
  const paths = git.rangePaths(rangeArgs);
  const messages = git.rangeMessages(rangeArgs).flatMap((message) => messageLines(message));
  return scanChange(context, paths, addedLines(git.rangeDiff(rangeArgs), 'HEAD'), messages);
}

function runHistory(context) {
  const commits = git.allCommits();
  const totals = { files: 0, lines: 0, findings: [] };
  commits.forEach((sha, index) => {
    const result = scanChange(
      context,
      git.commitPaths(sha),
      addedLines(git.commitDiff(sha), sha),
      messageLines(git.commitMessage(sha)),
    );
    totals.files += result.files;
    totals.lines += result.lines;
    totals.findings.push(...result.findings.map((finding) => ({ ...finding, commit: sha.slice(0, 8) })));
    if ((index + 1) % PROGRESS_EVERY === 0) {
      console.error(`guard: history scanned ${index + 1} of ${commits.length} commits`);
    }
  });
  return totals;
}

// The commit-msg hook: the message file itself, comment lines excluded.
function runMessage(context, file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new GuardConfigError(`cannot read commit message ${file}: ${error.message}`);
  }
  const lines = messageLines(text, { stripComments: true });
  const findings = context.identifierCheck ? checkLines(lines, context.salt, context.denylist) : [];
  return { files: 0, lines: lines.length, findings };
}

// Added paths are checked against the patterns and, as text, against the
// denylist; added lines and commit messages go through the denylist too.
function scanChange(context, paths, added, messages = []) {
  const pathFindings = checkPaths(paths, context.patterns);
  const identifierFindings = context.identifierCheck
    ? checkLines([...pathLines(paths), ...added, ...messages], context.salt, context.denylist)
    : [];
  return { files: paths.length, lines: added.length, findings: [...pathFindings, ...identifierFindings] };
}

function readFirstBytes(path, count = 8192) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(count);
    const read = readSync(fd, buffer, 0, count, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

// Build output and dependency trees are never source and are skipped by name.
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist']);

function walkFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Paths are reported relative to the repo root when the directory sits in a
// work tree, so they look the same as in a diff; otherwise relative to the
// directory itself. A file whose path already matches a pattern is not opened.
function runPaths(context, dir) {
  const target = resolve(dir);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new GuardConfigError(`${dir} is not a directory`);
  }
  const root = git.topLevel({ cwd: target }) ?? target;
  const files = walkFiles(target, []);
  const findings = [];
  const skipped = [];
  let lineCount = 0;
  for (const full of files) {
    const relativePath = normalizePath(relative(root, full));
    const pathFindings = checkPaths([relativePath], context.patterns);
    if (pathFindings.length > 0) {
      findings.push(...pathFindings);
      continue;
    }
    if (!context.identifierCheck) continue;
    findings.push(...checkLines(pathLines([relativePath]), context.salt, context.denylist));
    if (statSync(full).size > MAX_FILE_BYTES) {
      // Only a text file over the limit fails closed; a large binary is skipped like any binary.
      if (!isBinary(readFirstBytes(full))) skipped.push(relativePath);
      continue;
    }
    const text = decodeText(readFileSync(full));
    if (text === null) continue;
    const lines = linesOfFile(relativePath, text);
    lineCount += lines.length;
    findings.push(...checkLines(lines, context.salt, context.denylist));
  }
  if (skipped.length > 0) {
    // A text file the guard did not open cannot be called clean (fail closed).
    throw new GuardConfigError(
      `guard: ${skipped.length} text file(s) over ${MAX_FILE_BYTES} bytes were not scanned: ${skipped.join(', ')}; split them or exclude them`,
    );
  }
  return { files: files.length, lines: lineCount, findings };
}

function buildContext(args) {
  const repoRoot = git.topLevel() ?? process.cwd();
  const patterns = loadPatterns();
  const salt = resolveSalt(repoRoot);
  if (salt !== null) {
    return { patterns, salt, denylist: loadDenylist(), identifierCheck: true };
  }
  const isFork = process.env.GUARD_FORK === 'true';
  if (args.patternsOnly || isFork) {
    const why = isFork ? 'GUARD_FORK is true' : '--patterns-only was given';
    console.error(`guard: no salt is available and ${why}; running the path check only`);
    return { patterns, salt: null, denylist: new Set(), identifierCheck: false };
  }
  throw new GuardConfigError(MISSING_SALT_MESSAGE);
}

function run(args) {
  const context = buildContext(args);
  switch (args.mode) {
    case 'staged':
      return runStaged(context);
    case 'ci':
      return runCi(context, args.base);
    case 'history':
      return runHistory(context);
    case 'message':
      return runMessage(context, args.dir);
    default:
      return runPaths(context, args.dir);
  }
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
    const result = run(args);
    for (const finding of result.findings) {
      const where = finding.commit ? ` (commit ${finding.commit})` : '';
      console.log(`${formatFinding(finding)}${where}`);
    }
    console.log(formatSummary(args.mode, result.files, result.lines, result.findings.length));
    return result.findings.length === 0 ? EXIT_CLEAN : EXIT_FINDINGS;
  } catch (error) {
    if (error instanceof GuardConfigError || error instanceof git.GitError) {
      console.error(error.message.startsWith('guard:') ? error.message : `guard: ${error.message}`);
      return EXIT_CONFIG;
    }
    throw error;
  }
}

// Real paths on both sides, because node resolves symlinks for the main module while
// process.argv[1] keeps the path as typed; a mismatch would skip main() and exit 0.
function invokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
