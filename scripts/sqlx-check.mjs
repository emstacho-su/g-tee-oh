#!/usr/bin/env node
// sqlx offline metadata check (R0.6, ADR 0005, O-147).
//
// Mechanism: sqlx's query!, query_as!, query_scalar! and query_file* macros verify queries
// against the database at compile time and store the result under .sqlx so CI can build
// without a database; `cargo sqlx prepare --check` proves the stored metadata is current.
// Runtime-checked sqlx::query (solver-query since S16) needs no metadata, so the check only
// means something once a crate calls one of the macros. Until then this script says so and
// exits 0, and the first macro use starts enforcing it (O-147). The dependency line alone
// never triggers the check, so a crate can carry sqlx without sqlx-cli on the runner.
//
// Usage: node scripts/sqlx-check.mjs [root]   (root defaults to the repository)

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOTS = ['crates', 'services', 'tools'];
// The source directories of a crate, relative to its manifest.
export const SOURCE_DIRS = ['src', 'tests', 'benches', 'examples'];
// A query macro call, qualified or not: query!(, query_as!(, query_file_scalar!( and so on.
const MACRO_SUFFIXES = [
  '', '_as', '_scalar', '_file', '_file_as', '_file_scalar',
  '_unchecked', '_as_unchecked', '_scalar_unchecked',
];
export const MACRO_USE = new RegExp(`\\b(?:sqlx::)?query(?:${MACRO_SUFFIXES.join('|')})!\\s*\\(`);

export const EXIT_OK = 0;
export const EXIT_MISSING_TOOL = 2;

function manifests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'target' || entry.name === 'vendor') continue;
      manifests(full, out);
    } else if (entry.name === 'Cargo.toml') {
      out.push(full);
    }
  }
  return out;
}

function rustFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) rustFiles(full, out);
    else if (entry.name.endsWith('.rs')) out.push(full);
  }
  return out;
}

// A char literal at the regex's lastIndex: one character or one escape between quotes.
// Rust also writes lifetimes and labels with a quote ('a, 'static), which this never
// matches, so such a quote is plain text.
const CHAR_LITERAL = /'(?:\\(?:u\{[0-9A-Fa-f]{1,6}\}|.)|[^'\\\n])'/y;

// The index just past the string literal that opens at `start`, or the text's end when it
// never closes; a backslash escapes the character after it, and a newline is kept inside,
// as a Rust string may span lines.
function stringEnd(text, start) {
  let at = start + 1;
  while (at < text.length) {
    if (text[at] === '\\') at += 2;
    else if (text[at] === '"') return at + 1;
    else at += 1;
  }
  return text.length;
}

// The text without its line comments, so a macro named in a comment never counts. A small
// tokenizer walks the characters, so a `//` inside a string literal ("https://x") or a char
// literal ('/') never starts a comment, which a line-wise cut would turn into a check that
// stays silently off. A comment is dropped up to its newline, which stays, so lines keep
// their numbers. A raw string's hashes are plain text, so a raw string is read as a string.
export function withoutLineComments(text) {
  let kept = '';
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === '"') {
      const end = stringEnd(text, at);
      kept += text.slice(at, end);
      at = end;
    } else if (char === "'") {
      CHAR_LITERAL.lastIndex = at;
      const literal = CHAR_LITERAL.exec(text);
      const end = literal === null ? at + 1 : at + literal[0].length;
      kept += text.slice(at, end);
      at = end;
    } else if (char === '/' && text[at + 1] === '/') {
      const newline = text.indexOf('\n', at);
      at = newline === -1 ? text.length : newline;
    } else {
      kept += char;
      at += 1;
    }
  }
  return kept;
}

// Every Rust source under `root` that calls a sqlx query macro, as absolute paths.
export function findMacroUses(root) {
  const found = [];
  for (const top of ROOTS) {
    const dir = join(root, top);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const manifest of manifests(dir)) {
      for (const source of SOURCE_DIRS) {
        const sourceDir = join(dirname(manifest), source);
        if (!existsSync(sourceDir)) continue;
        for (const file of rustFiles(sourceDir)) {
          if (MACRO_USE.test(withoutLineComments(readFileSync(file, 'utf8')))) found.push(file);
        }
      }
    }
  }
  return found.sort();
}

export function main(argv) {
  const root = argv.length === 1 ? resolve(argv[0]) : repoRoot;
  const users = findMacroUses(root);
  if (users.length === 0) {
    console.log(
      'sqlx-check: no crate calls a sqlx query macro; ' +
        'runtime-checked sqlx::query needs no offline metadata (O-147)',
    );
    return EXIT_OK;
  }
  console.log(`sqlx-check: query macros in ${users.length} file(s); checking the offline metadata`);
  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const result = spawnSync(cargo, ['sqlx', 'prepare', '--check', '--workspace'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  // Only the missing-subcommand message means the tool is absent; cargo also exits 101 for a
  // compile error or a stale query, and those must be shown, not hidden behind an install hint.
  if (result.error || /no such command/i.test(result.stderr ?? '')) {
    console.error(
      'sqlx-check: cargo sqlx is missing; install it with: ' +
        'cargo install sqlx-cli --no-default-features --features postgres,rustls',
    );
    return EXIT_MISSING_TOOL;
  }
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result.status ?? 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
