#!/usr/bin/env node
// Rebuild guard/denylist.sha256 from the plain identifiers and the salt (O-58).
//
// Inputs: .guard-private/salt and .guard-private/denylist.txt at the repo root
// (one identifier per line, blank lines and "#" comments ignored). Each
// identifier is lowercased, because the guard lowercases diff tokens before
// hashing, and must be a single run of six or more word characters, because
// that is what the tokenizer extracts. The script prints counts and line
// numbers only; it never prints a token, a hash input or the salt.

import { existsSync, readFileSync, writeFileSync , realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { topLevel } from './git.mjs';
import { hashToken } from './guard.mjs';
import { PRIVATE_DIR_NAME, SALT_FILE_NAME, findSalt } from './private-dir.mjs';

const GUARD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_SHAPE = /^[a-z0-9_]{6,}$/;
const HEADER = [
  '# Salted sha256 hashes of private identifiers (O-58). One lowercase hex digest per line.',
  '# Regenerate with: node guard/src/hash-denylist.mjs',
].join('\n');

function readRequired(path, label) {
  if (!existsSync(path)) {
    console.error(`hash-denylist: ${label} is missing at ${path}`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

export function buildDenylist(salt, plainText) {
  const hashes = new Set();
  const skipped = [];
  const lines = String(plainText).split(/\r?\n/);
  lines.forEach((raw, index) => {
    const entry = raw.trim().toLowerCase();
    if (entry === '' || entry.startsWith('#')) return;
    if (!TOKEN_SHAPE.test(entry)) {
      skipped.push(index + 1);
      return;
    }
    hashes.add(hashToken(salt, entry));
  });
  return { hashes: [...hashes].sort(), skipped };
}

// GUARD_PRIVATE_DIR wins; otherwise the directory the guard takes its salt
// from (the repo root's, then the main working tree's in a linked worktree),
// or the repo root's so a missing input is reported where it belongs.
function resolvePrivateDir() {
  if (process.env.GUARD_PRIVATE_DIR !== undefined) return process.env.GUARD_PRIVATE_DIR;
  const repoRoot = topLevel() ?? process.cwd();
  return findSalt(repoRoot)?.dir ?? join(repoRoot, PRIVATE_DIR_NAME);
}

function main() {
  const privateDir = resolvePrivateDir();
  const outputPath = process.env.GUARD_DENYLIST_PATH ?? join(GUARD_DIR, 'denylist.sha256');

  const salt = readRequired(join(privateDir, SALT_FILE_NAME), 'the salt');
  const plain = readRequired(join(privateDir, 'denylist.txt'), 'the plain denylist');
  if (salt === null || plain === null) return 2;
  if (salt.trim() === '') {
    console.error('hash-denylist: the salt file is empty');
    return 2;
  }

  const { hashes, skipped } = buildDenylist(salt.trim(), plain);
  for (const lineNumber of skipped) {
    console.error(
      `hash-denylist: line ${lineNumber} skipped; an entry must be one run of six or more letters, digits or underscores, or the tokenizer can never match it`,
    );
  }
  writeFileSync(outputPath, `${HEADER}\n${hashes.join('\n')}\n`, 'utf8');
  console.log(`hash-denylist: wrote ${hashes.length} hashes to ${outputPath} (${skipped.length} lines skipped)`);
  return 0;
}

// Real paths on both sides: node resolves symlinks for the main module while
// process.argv[1] keeps the path as typed, and a mismatch would skip main().
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  process.exitCode = main();
}
