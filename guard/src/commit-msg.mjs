#!/usr/bin/env node
// commit-msg hook helper (R0.1, O-29).
//
// Claude Code sets CLAUDECODE=1 in the shells it runs, and git passes the
// environment on to hooks. When that variable is set, the commit message must
// carry the co-author trailer; otherwise the hook stays out of the way.

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_TRAILER = 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>';
// The exact documented trailer, compared case-insensitively on a trimmed line, so a
// different model name or a stale template does not pass as the required attribution.
const TRAILER_PATTERN = new RegExp(`^${REQUIRED_TRAILER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

export function isClaudeSession(env) {
  const value = env.CLAUDECODE;
  return value !== undefined && value.trim() !== '';
}

const SCISSORS = /^# -+ >8 -+$/;

// Comment lines (leading "#") are what git strips before committing, so a
// trailer inside one does not count, and nothing below the scissors line
// counts either: "git commit -v" appends the diff there, and a diff context
// line that happens to contain the trailer text is not a trailer.
export function hasClaudeTrailer(message) {
  const lines = String(message).split(/\r?\n/);
  const cut = lines.findIndex((line) => SCISSORS.test(line.trim()));
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  return kept.some((line) => !line.startsWith('#') && TRAILER_PATTERN.test(line.trim()));
}

export function check(message, env) {
  if (!isClaudeSession(env)) return { ok: true };
  if (hasClaudeTrailer(message)) return { ok: true };
  return {
    ok: false,
    message: [
      'commit-msg: this commit comes from a Claude Code session (CLAUDECODE is set) and has no co-author trailer (O-29).',
      'Add this line at the end of the commit message:',
      `  ${REQUIRED_TRAILER}`,
    ].join('\n'),
  };
}

function main(argv) {
  const path = argv[0];
  if (!path) {
    console.error('usage: node guard/src/commit-msg.mjs <commit message file>');
    return 2;
  }
  let message;
  try {
    message = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`commit-msg: cannot read ${path}: ${error.message}`);
    return 2;
  }
  const result = check(message, process.env);
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
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
  process.exitCode = main(process.argv.slice(2));
}
