// Pure functions of the private-data guard (R0.4, O-58).
//
// Nothing here touches the file system, git or the process. cli.mjs and
// git.mjs gather paths and diff lines, hand them to these functions and print
// what comes back, so every rule can be tested with synthetic data.

import { createHash } from 'node:crypto';

// A token is a run of six or more word characters. Shorter runs are too common
// to be identifiers worth hashing, and the plain denylist follows the same rule.
export const TOKEN_PATTERN = /[A-Za-z0-9_]{6,}/g;

// A finding prints this many leading characters of the hash, never the token.
export const HASH_PREFIX_LENGTH = 8;

// Files larger than this are skipped in paths mode.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const HUNK_HEADER = /^@@+ (?:-\d+(?:,\d+)? )+\+(\d+)(?:,\d+)? @@/;

export class GuardConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardConfigError';
  }
}

// Translate one glob-like pattern into an anchored, case-insensitive RegExp.
// "**/" matches zero or more whole path segments, a trailing "/**" matches
// anything below a directory, "*" and "?" never cross a slash, and every other
// character is literal.
export function globToRegExp(pattern) {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(REGEX_SPECIALS, '\\$&');
    }
    i += 1;
  }
  return new RegExp(`^${out}$`, 'i');
}

// Git and the patterns both speak forward slashes relative to the repo root.
export function normalizePath(filePath) {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
}

export function compilePatterns(patterns) {
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== 'string' || p === '')) {
    throw new GuardConfigError('patterns.json must hold a non-empty array of pattern strings');
  }
  return patterns.map((pattern) => ({ pattern, regex: globToRegExp(pattern) }));
}

// Returns the first matching pattern string, or null when the path is clean.
export function matchPath(filePath, compiledPatterns) {
  const normalized = normalizePath(filePath);
  const hit = compiledPatterns.find(({ regex }) => regex.test(normalized));
  return hit ? hit.pattern : null;
}

export function tokenize(line) {
  const matches = String(line).match(TOKEN_PATTERN) ?? [];
  return matches.map((token) => token.toLowerCase());
}

// sha256 over the salt immediately followed by the token, no separator.
export function hashToken(salt, token) {
  return createHash('sha256').update(`${salt}${token}`, 'utf8').digest('hex');
}

// One lowercase hex digest per line; blank lines and "#" comments are ignored.
// A malformed line is a configuration error so a broken list cannot pass silently.
export function parseDenylist(text) {
  const hashes = new Set();
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim().toLowerCase();
    if (line === '' || line.startsWith('#')) continue;
    if (!SHA256_HEX.test(line)) {
      throw new GuardConfigError(`denylist line ${index + 1} is not a sha256 hex digest`);
    }
    hashes.add(line);
  }
  return hashes;
}

function headerPath(rest) {
  const trimmed = rest.replace(/\t.*$/, '').trim();
  if (trimmed === '/dev/null') return null;
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return normalizePath(unquoted.replace(/^[ab]\//, ''));
}

// Walk a unified diff (plain or combined, as "git show" prints for merges) and
// return every added line with the path and the line number it has after the
// change. Hunk headers give the first new line number; lines present in the
// result advance it, removed lines do not.
export function parseUnifiedDiff(diffText) {
  const added = [];
  let file = null;
  let inHunk = false;
  let prefixWidth = 1;
  let newLine = 0;
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('diff --')) {
      file = null;
      inHunk = false;
      prefixWidth = 1;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('+++ ')) file = headerPath(line.slice(4));
      const header = HUNK_HEADER.exec(line);
      if (header) {
        inHunk = true;
        prefixWidth = line.indexOf(' ') - 1;
        newLine = Number(header[1]);
      }
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (line.startsWith('\\') || file === null) continue;
    const prefix = line.slice(0, prefixWidth);
    if (prefix.includes('-')) continue;
    if (prefix.includes('+')) {
      added.push({ file, line: newLine, text: line.slice(prefixWidth) });
    }
    newLine += 1;
  }
  return added;
}

// File contents as if every line had been added, for paths mode.
export function linesOfFile(file, text) {
  const normalized = normalizePath(file);
  const lines = String(text).split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((content, index) => ({ file: normalized, line: index + 1, text: content }));
}

export function isBinary(buffer) {
  return buffer.includes(0);
}

export function checkPaths(paths, compiledPatterns) {
  const findings = [];
  for (const filePath of paths) {
    const pattern = matchPath(filePath, compiledPatterns);
    if (pattern !== null) {
      findings.push({ kind: 'path', file: normalizePath(filePath), pattern });
    }
  }
  return findings;
}

export function checkLines(addedLines, salt, denylist) {
  const findings = [];
  if (denylist.size === 0) return findings;
  for (const { file, line, text } of addedLines) {
    const seen = new Set();
    for (const token of tokenize(text)) {
      if (seen.has(token)) continue;
      seen.add(token);
      const hash = hashToken(salt, token);
      if (denylist.has(hash)) {
        findings.push({ kind: 'identifier', file, line, hashPrefix: hash.slice(0, HASH_PREFIX_LENGTH) });
      }
    }
  }
  return findings;
}

export function formatFinding(finding) {
  if (finding.kind === 'path') {
    return `guard: path ${finding.file} matches private pattern ${finding.pattern}`;
  }
  return `guard: identifier at ${finding.file}:${finding.line} hash ${finding.hashPrefix} is on the denylist`;
}

export function formatSummary(mode, fileCount, lineCount, findingCount) {
  return `guard: ${mode} checked ${fileCount} files and ${lineCount} added lines; ${findingCount} findings`;
}
