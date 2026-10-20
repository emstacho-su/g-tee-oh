#!/usr/bin/env node
// commit-msg hook helper (R0.1, O-29).
//
// Claude Code sets CLAUDECODE=1 in the shells it runs, and git passes the
// environment on to hooks. When that variable is set, the commit message must
// carry the co-author trailer; otherwise the hook stays out of the way.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_TRAILER = 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>';
const TRAILER_PATTERN = /^co-authored-by:\s*claude/i;

export function isClaudeSession(env) {
  const value = env.CLAUDECODE;
  return value !== undefined && value.trim() !== '';
}

// Comment lines (leading "#") are what git strips before committing, so a
// trailer inside one does not count.
export function hasClaudeTrailer(message) {
  return String(message)
    .split(/\r?\n/)
    .some((line) => !line.startsWith('#') && TRAILER_PATTERN.test(line.trim()));
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

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
