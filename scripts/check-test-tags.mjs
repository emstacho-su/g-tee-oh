#!/usr/bin/env node
// Pending-test tag check (R0.11): every pending test carries the requirement identifier (R ID)
// it will later close, so the red half of test-driven development stays traceable to the
// requirement tables (09 section 6; A1 section 4 tags tests by name). `just test-tags` runs it
// locally and in CI; node:test covers it from scripts/check-test-tags.test.mjs.
//
// Mechanism: the script walks every TypeScript, JavaScript and Rust source under the repo
// (packages/**/test and src, guard/test, scripts, db/test, infra, web, crates/**/tests and src,
// services/**/tests and src, tools/**/tests and src), skipping node_modules, target, dist,
// coverage, .vitest, .next, .git, docs, .guard-private and the vendored engine under
// crates/vendor, whose ignored tests are upstream's, and any file over 2 MB. A file whose text
// holds none of the markers ".todo", ".skip", "skip:", "todo:" and "#[ignore" has nothing to
// find and is not tokenized. A small tokenizer drops comments and reads string literals
// (JavaScript quoted strings end at a newline; template literals and Rust strings span lines),
// so a call inside a comment, a string or a regex never counts; a pass over the tokens then
// finds
//   - Vitest and node:test calls with a .todo or .skip modifier: it.todo("..."), test.skip("..."),
//     describe.todo("..."), and the table forms it.skip.each(...)("...", fn) and
//     describe.todo.each(...)("...", fn), which are pending for every row; skipIf(...), runIf(...)
//     and todoIf(...) chains decide at run time and are left alone;
//   - node:test and Vitest calls whose second argument is an options object setting skip or todo
//     to the literal true or a string literal: test("...", { skip: true }, fn),
//     it("...", { todo: "reason" }, fn); a computed value such as { skip: !process.env.DOCKER }
//     is conditional, so the test is not pending and needs no tag;
//   - Rust #[ignore] and #[ignore = "reason"] attributes and the fn they annotate.
// A pending test is tagged when its title, the title of an enclosing describe or suite, its
// #[ignore] reason or its Rust fn name carries an R ID in either of the repo's two forms:
// R<phase>.<n> ("R4.1 rates the worked example") or the identifier form r<phase>_<n> ("r0_4 cli
// history", fn r2_4_kuhn_gate; a Rust identifier cannot carry a dot), which is reported as
// R<phase>.<n>. The first R ID found is the one counted. Untagged pending tests are printed
// with file and line and the exit code is 1; otherwise the count per R ID is printed and the
// exit code is 0. A directory or file that cannot be read stops the check with a one-line
// message and exit code 2. No npm packages.
//
// Usage: node scripts/check-test-tags.mjs [root]   (root defaults to the repository)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Both tag forms: R<phase>.<n> in groups 1 and 2, and the identifier form r<phase>_<n> in groups
// 3 and 4, at the start or after a non-alphanumeric character (a space in a title, an underscore
// in a snake_case fn name) and not followed by one. The leftmost match wins.
const R_ID_FORMS = /R(\d+)\.(\d+)|(?:^|[^A-Za-z0-9])[rR](\d+)_(\d+)(?![A-Za-z0-9])/;
export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".rs"]);
export const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "target", "dist", "coverage", ".vitest", ".next", ".git", ".guard-private", "docs"]);
// Repo-relative, forward slashes: the vendored engine is upstream code (CLAUDE.md, ADR 0002).
export const SKIPPED_PATHS = new Set(["crates/vendor"]);
// A larger source is generated or vendored, never a test file.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
// A file holding none of these cannot hold a pending test this check reads, so it is not tokenized.
export const PENDING_MARKERS = Object.freeze([".todo", ".skip", "skip:", "todo:", "#[ignore"]);

const TEST_CALLEES = new Set(["it", "test", "describe", "suite"]);
const GROUP_CALLEES = new Set(["describe", "suite"]);
const PENDING_MODIFIERS = new Set(["todo", "skip"]);
// Modifiers that take a table and return the function called with the title: it.each([...])("...").
const TABLE_MODIFIERS = new Set(["each", "for"]);
// Modifiers whose argument decides at run time, or that build a fixture; such calls are left alone.
const CONDITIONAL_MODIFIERS = new Set(["skipIf", "runIf", "todoIf", "extend"]);
const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const DIVISION_PREDECESSORS = new Set([")", "]", "}"]);
const OPENING_BRACKETS = new Set(["(", "[", "{"]);
const CLOSING_BRACKETS = new Set([")", "]", "}"]);
const RUST_STRING_PREFIX = /^(b|c|br|cr|r)$/;
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const MAX_TOKENS_TO_FN = 64;

export const JS_LANGUAGE = Object.freeze({ singleQuoteStrings: true, multilineStrings: false, templateStrings: true, regexLiterals: true, nestedBlockComments: false, rustLiterals: false });
export const RUST_LANGUAGE = Object.freeze({ singleQuoteStrings: false, multilineStrings: true, templateStrings: false, regexLiterals: false, nestedBlockComments: true, rustLiterals: true });

const EXIT_OK = 0;
const EXIT_UNTAGGED = 1;
const EXIT_USAGE = 2;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A problem that stops the check before any verdict; main prints it and exits 2. */
export class CheckError extends Error {}

// ---------------------------------------------------------------------------------------------
// Tokenizer: comments dropped, strings kept with their text, everything else as ident, number
// or punct. Good enough for test files; it is not a parser.

function countNewlines(text, from, to) {
  let count = 0;
  for (let i = from; i < to; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

function lineCommentEnd(text, start) {
  const end = text.indexOf("\n", start);
  return end === -1 ? text.length : end;
}

function blockCommentEnd(text, start, nested) {
  let depth = 1;
  let i = start + 2;
  while (i < text.length) {
    if (nested && text[i] === "/" && text[i + 1] === "*") {
      depth++;
      i += 2;
    } else if (text[i] === "*" && text[i + 1] === "/") {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return text.length;
}

/** A '...' or "..." literal; it stops at the end of its line unless multiline, as Rust strings are. */
function readQuoted(text, start, quote, multiline) {
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      value += text[i + 1] ?? "";
      i += 2;
    } else if (ch === quote) {
      return { value, end: i + 1 };
    } else if (ch === "\n" && !multiline) {
      return { value, end: i };
    } else {
      value += ch;
      i++;
    }
  }
  return { value, end: i };
}

/** The end of a ${...} expression inside a template; nested literals and comments are skipped. */
function templateExpressionEnd(text, start) {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = readQuoted(text, i, ch, false).end;
    } else if (ch === "`") {
      i = readTemplate(text, i).end;
    } else if (ch === "/" && text[i + 1] === "/") {
      i = lineCommentEnd(text, i);
    } else if (ch === "/" && text[i + 1] === "*") {
      i = blockCommentEnd(text, i, false);
    } else {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
  }
  return i;
}

/** A `...` literal; expression contents are dropped from the value. */
function readTemplate(text, start) {
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      value += text[i + 1] ?? "";
      i += 2;
    } else if (ch === "`") {
      return { value, end: i + 1 };
    } else if (ch === "$" && text[i + 1] === "{") {
      i = templateExpressionEnd(text, i + 2);
    } else {
      value += ch;
      i++;
    }
  }
  return { value, end: i };
}

/** The end of a /.../flags literal, or null when the slash is not one (unterminated on its line). */
function regexEnd(text, start) {
  let inClass = false;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") return null;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return identEnd(text, i + 1);
    i++;
  }
  return null;
}

/** Whether a slash after the previous token starts a regex rather than a division. */
function regexAllowed(prev) {
  if (prev === undefined) return true;
  if (prev.type === "punct") return !DIVISION_PREDECESSORS.has(prev.value);
  if (prev.type === "ident") return KEYWORDS_BEFORE_REGEX.has(prev.value);
  return false;
}

/** The index after the identifier characters that run from text[start]. */
function identEnd(text, start) {
  let i = start;
  while (i < text.length && IDENT_PART.test(text[i])) i++;
  return i;
}

/** The index after the number starting at text[start]: digits, then letters, underscores and dots. */
function numberEnd(text, start) {
  let i = start + 1;
  while (i < text.length && (IDENT_PART.test(text[i]) || text[i] === ".")) i++;
  return i;
}

/** A Rust raw string r"...", r#"..."#, br"..."; null when the prefix is a raw identifier (r#type). */
function readRawString(text, start) {
  let hashes = 0;
  let i = start;
  while (text[i] === "#") {
    hashes++;
    i++;
  }
  if (text[i] !== '"') return null;
  const closer = `"${"#".repeat(hashes)}`;
  const close = text.indexOf(closer, i + 1);
  const end = close === -1 ? text.length : close + closer.length;
  return { value: text.slice(i + 1, close === -1 ? text.length : close), end };
}

/** The end of a Rust 'x' or '\n' char literal; a lifetime ('a) is one character long. */
function rustQuoteEnd(text, start) {
  if (text[start + 1] === "\\") {
    const close = text.indexOf("'", start + 3);
    const lineEnd = lineCommentEnd(text, start);
    return close !== -1 && close < lineEnd ? close + 1 : start + 1;
  }
  return text[start + 2] === "'" ? start + 3 : start + 1;
}

/** A Rust b"...", c"...", r"...", r#"..."#, br"..." or cr"..." literal whose prefix starts at text[start]; null when none. */
function readPrefixedString(text, start) {
  const end = identEnd(text, start);
  const prefix = text.slice(start, end);
  if (!RUST_STRING_PREFIX.test(prefix)) return null;
  if (prefix.endsWith("r")) {
    const raw = text[end] === '"' || text[end] === "#" ? readRawString(text, end) : null;
    return raw === null ? null : { type: "string", ...raw };
  }
  return text[end] === '"' ? { type: "string", ...readQuoted(text, end, '"', true) } : null;
}

/** The comment, string, template, Rust raw string or regex literal starting at text[i], with the token
 *  type it yields (null for a comment or a Rust char literal, which yield none); null when none starts there. */
function readLiteral(text, i, language, prev) {
  const ch = text[i];
  const next = text[i + 1];
  if (ch === "/" && next === "/") return { type: null, value: "", end: lineCommentEnd(text, i) };
  if (ch === "/" && next === "*") return { type: null, value: "", end: blockCommentEnd(text, i, language.nestedBlockComments) };
  if (ch === '"' || (ch === "'" && language.singleQuoteStrings)) return { type: "string", ...readQuoted(text, i, ch, language.multilineStrings) };
  if (ch === "'") return { type: null, value: "", end: rustQuoteEnd(text, i) };
  if (ch === "`" && language.templateStrings) return { type: "string", ...readTemplate(text, i) };
  if (ch === "/" && language.regexLiterals && regexAllowed(prev)) {
    const end = regexEnd(text, i);
    if (end !== null) return { type: "regex", value: "", end };
  }
  if (language.rustLiterals && IDENT_START.test(ch)) return readPrefixedString(text, i);
  return null;
}

export function tokenize(text, language) {
  const tokens = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const literal = readLiteral(text, i, language, tokens[tokens.length - 1]);
    let token = null;
    let end;
    if (literal !== null) {
      end = literal.end;
      if (literal.type !== null) token = { type: literal.type, value: literal.value };
    } else if (ch <= " ") {
      end = i + 1;
    } else if (IDENT_START.test(ch)) {
      end = identEnd(text, i + 1);
      token = { type: "ident", value: text.slice(i, end) };
    } else if (ch >= "0" && ch <= "9") {
      end = numberEnd(text, i);
      token = { type: "number", value: text.slice(i, end) };
    } else {
      end = ch === "=" && text[i + 1] === ">" ? i + 2 : i + 1;
      token = { type: "punct", value: text.slice(i, end) };
    }
    if (token !== null) tokens.push({ ...token, line });
    line += countNewlines(text, i, end);
    i = end;
  }
  return tokens;
}

const isPunct = (token, value) => token !== undefined && token.type === "punct" && token.value === value;
const isIdent = (token, value) => token !== undefined && token.type === "ident" && (value === undefined || token.value === value);

// ---------------------------------------------------------------------------------------------
// JavaScript and TypeScript: Vitest and node:test calls.

const isOpening = (token) => token !== undefined && token.type === "punct" && OPENING_BRACKETS.has(token.value);
const isClosing = (token) => token !== undefined && token.type === "punct" && CLOSING_BRACKETS.has(token.value);

/** The index after the bracket group opening at tokens[start]; the end of the tokens when it never closes. */
function groupEnd(tokens, start) {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (isOpening(tokens[i])) depth++;
    else if (isClosing(tokens[i])) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return tokens.length;
}

/** Whether tokens[i] is the whole value of an options key and pending: the literal true or a string literal, then , or }. */
function isPendingValue(tokens, i) {
  const value = tokens[i];
  const after = tokens[i + 1];
  return (isIdent(value, "true") || value?.type === "string") && (isPunct(after, ",") || isPunct(after, "}"));
}

/** The options object at tokens[start] ({): "todo" or "skip" when that key holds the literal true or a string
 *  literal (a computed value is conditional, so the test is not pending), else null; and the index after it. */
function readOptions(tokens, start) {
  const end = groupEnd(tokens, start);
  const pendingKeys = new Set();
  let i = start + 1;
  while (i < end) {
    const token = tokens[i];
    if (isOpening(token)) {
      i = groupEnd(tokens, i);
      continue;
    }
    const startsKey = (isPunct(tokens[i - 1], "{") || isPunct(tokens[i - 1], ",")) && (token.type === "ident" || token.type === "string");
    if (startsKey && isPunct(tokens[i + 1], ":") && isPendingValue(tokens, i + 2)) pendingKeys.add(token.value);
    i++;
  }
  const kind = pendingKeys.has("todo") ? "todo" : pendingKeys.has("skip") ? "skip" : null;
  return { kind, next: end };
}

/** The index after the table of an each or for modifier at tokens[i], a (...) argument list or a tagged template; null when neither follows. */
function tableEnd(tokens, i) {
  if (isPunct(tokens[i], "(")) return groupEnd(tokens, i);
  return tokens[i]?.type === "string" ? i + 1 : null;
}

/** it("title" ...) style call at tokens[start], or null when it is not one this check reads. */
function readTestCall(tokens, start) {
  const callee = tokens[start].value;
  const modifiers = [];
  let table = null;
  let i = start + 1;
  while (table === null && isPunct(tokens[i], ".") && isIdent(tokens[i + 1])) {
    const modifier = tokens[i + 1].value;
    if (CONDITIONAL_MODIFIERS.has(modifier)) return null;
    modifiers.push(modifier);
    i += 2;
    if (TABLE_MODIFIERS.has(modifier)) {
      table = modifier;
      i = tableEnd(tokens, i);
      if (i === null) return null;
    }
  }
  if (!isPunct(tokens[i], "(") || tokens[i + 1]?.type !== "string") return null;
  const title = tokens[i + 1].value;
  i += 2;
  let optionKind = null;
  if (isPunct(tokens[i], ",") && isPunct(tokens[i + 1], "{")) {
    const options = readOptions(tokens, i + 1);
    optionKind = options.kind;
    i = options.next;
  }
  const pending = modifiers.find((modifier) => PENDING_MODIFIERS.has(modifier));
  const modifierKind = pending === undefined ? null : [callee, pending, ...(table === null ? [] : [table])].join(".");
  const kind = modifierKind !== null ? modifierKind : optionKind !== null ? `${callee} { ${optionKind} }` : null;
  return { callee, title, kind, next: i };
}

/** Pending tests in one JavaScript or TypeScript source: { line, kind, title, context }. */
export function scanJavaScript(text) {
  const tokens = tokenize(text, JS_LANGUAGE);
  const entries = [];
  const groups = [];
  let pendingGroup = null;
  let depth = 0;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (isPunct(token, "{")) {
      depth++;
      const prev = tokens[i - 1];
      if (pendingGroup !== null && (isPunct(prev, "=>") || isPunct(prev, ")"))) {
        groups.push({ title: pendingGroup, bodyDepth: depth });
        pendingGroup = null;
      }
    } else if (isPunct(token, "}")) {
      depth--;
      while (groups.length > 0 && groups[groups.length - 1].bodyDepth > depth) groups.pop();
    } else if (isPunct(token, ";")) {
      pendingGroup = null;
    } else if (token.type === "ident" && TEST_CALLEES.has(token.value)) {
      const call = readTestCall(tokens, i);
      if (call !== null) {
        pendingGroup = GROUP_CALLEES.has(call.callee) ? call.title : null;
        if (call.kind !== null) {
          entries.push({ line: token.line, kind: call.kind, title: call.title, context: groups.map((group) => group.title) });
        }
        i = call.next;
        continue;
      }
    }
    i++;
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Rust: #[ignore] attributes.

/** The name of the fn the attribute at tokens[start] annotates, skipping other attributes. */
function annotatedFnName(tokens, start) {
  const limit = Math.min(tokens.length, start + MAX_TOKENS_TO_FN);
  for (let i = start; i < limit; i++) {
    if (isIdent(tokens[i], "fn") && isIdent(tokens[i + 1])) return tokens[i + 1].value;
    if (isPunct(tokens[i], "{") || isPunct(tokens[i], ";")) return null;
  }
  return null;
}

/** Pending tests in one Rust source: { line, kind, title (the ignore reason), name }. */
export function scanRust(text) {
  const tokens = tokenize(text, RUST_LANGUAGE);
  const entries = [];
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (!(isPunct(tokens[i], "#") && isPunct(tokens[i + 1], "[") && isIdent(tokens[i + 2], "ignore"))) continue;
    let j = i + 3;
    let reason = "";
    if (isPunct(tokens[j], "=") && tokens[j + 1]?.type === "string") {
      reason = tokens[j + 1].value;
      j += 2;
    }
    while (j < tokens.length && !isPunct(tokens[j], "]")) j++;
    entries.push({
      line: tokens[i].line,
      kind: reason === "" ? "#[ignore]" : '#[ignore = "..."]',
      title: reason,
      name: annotatedFnName(tokens, j + 1),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Tags, the walk and the verdict.

/** The first R ID in a title, group name, ignore reason or fn name, as R<phase>.<n>; null when there is none. */
export function rIdIn(text) {
  const match = R_ID_FORMS.exec(text);
  if (match === null) return null;
  return match[1] !== undefined ? `R${match[1]}.${match[2]}` : `R${match[3]}.${match[4]}`;
}

/** The R ID a pending test carries, from its title, its enclosing groups (innermost first) or its Rust fn name; null when untagged. */
export function rIdOf(entry) {
  const sources = [entry.title ?? "", ...[...(entry.context ?? [])].reverse(), entry.name ?? ""];
  for (const source of sources) {
    const rId = rIdIn(source);
    if (rId !== null) return rId;
  }
  return null;
}

const compareNames = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The entries of a directory in name order; one that cannot be listed stops the check. */
function readDirectory(dir, relDir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).toSorted(compareNames);
  } catch (error) {
    throw new CheckError(`cannot read directory ${relDir === "" ? dir : relDir}: ${error.message}`);
  }
}

/** The size of a file in bytes; one that cannot be inspected stops the check. */
function fileSize(path, relPath) {
  try {
    return statSync(path).size;
  } catch (error) {
    throw new CheckError(`cannot read ${relPath}: ${error.message}`);
  }
}

/** The text of a source file; one that cannot be read stops the check. */
function readSource(root, relPath) {
  try {
    return readFileSync(join(root, relPath), "utf8");
  } catch (error) {
    throw new CheckError(`cannot read ${relPath}: ${error.message}`);
  }
}

/** Every source file under root, repo-relative with forward slashes, sorted; skipped trees and files over MAX_FILE_BYTES left out. */
export function listSourceFiles(root) {
  const files = [];
  const walk = (dir, relDir) => {
    for (const entry of readDirectory(dir, relDir)) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name) && !SKIPPED_PATHS.has(relPath)) walk(path, relPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && fileSize(path, relPath) <= MAX_FILE_BYTES) {
        files.push(relPath);
      }
    }
  };
  walk(root, "");
  return files;
}

/** Whether a source can hold a pending test at all: a cheap check that spares the tokenizer. */
export function hasPendingMarker(text) {
  return PENDING_MARKERS.some((marker) => text.includes(marker));
}

/** Every pending test under root with its file and R ID (null when untagged). */
export function findPendingTests(root) {
  const found = [];
  for (const file of listSourceFiles(root)) {
    const text = readSource(root, file);
    if (!hasPendingMarker(text)) continue;
    const entries = extname(file) === ".rs" ? scanRust(text) : scanJavaScript(text);
    for (const entry of entries) {
      found.push({ ...entry, file, rId: rIdOf(entry) });
    }
  }
  return found;
}

function compareRIds(a, b) {
  const [phaseA, numberA] = a.slice(1).split(".").map(Number);
  const [phaseB, numberB] = b.slice(1).split(".").map(Number);
  return phaseA - phaseB || numberA - numberB;
}

/** The verdict: total, the untagged entries, and [rId, count] pairs in phase order. */
export function summarize(entries) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry.rId !== null) counts.set(entry.rId, (counts.get(entry.rId) ?? 0) + 1);
  }
  return {
    total: entries.length,
    untagged: entries.filter((entry) => entry.rId === null),
    counts: [...counts.entries()].sort(([a], [b]) => compareRIds(a, b)),
  };
}

/** The lines main prints, and the exit code. */
export function formatReport(summary) {
  if (summary.untagged.length > 0) {
    const lines = summary.untagged.map((entry) => `check-test-tags: ${entry.file}:${entry.line}: ${entry.kind} ${JSON.stringify(entry.title)} has no R ID`);
    lines.push(`check-test-tags: ${summary.untagged.length} of ${summary.total} pending tests untagged; put the R ID (R<phase>.<n> or r<phase>_<n>) in the title, the enclosing describe or the ignore reason (R0.11)`);
    return { lines, exitCode: EXIT_UNTAGGED };
  }
  const lines = [`check-test-tags: ${summary.total} pending tests, all tagged (R0.11)`];
  for (const [rId, count] of summary.counts) lines.push(`  ${rId.padEnd(7)} ${count}`);
  return { lines, exitCode: EXIT_OK };
}

function main(argv) {
  if (argv.length > 1) throw new CheckError("usage: node scripts/check-test-tags.mjs [root]");
  const root = argv.length === 1 ? resolve(argv[0]) : repoRoot;
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new CheckError(`${root} is not a directory`);
  const { lines, exitCode } = formatReport(summarize(findPendingTests(root)));
  const print = exitCode === EXIT_OK ? console.log : console.error;
  for (const line of lines) print(line);
  return exitCode;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CheckError) {
      console.error(`check-test-tags: ${error.message}`);
      process.exitCode = EXIT_USAGE;
    } else {
      throw error;
    }
  }
}
