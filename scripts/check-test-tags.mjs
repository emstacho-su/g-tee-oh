#!/usr/bin/env node
// Pending-test tag check (R0.11): every pending test carries the requirement identifier (R ID)
// it will later close, so the red half of test-driven development stays traceable to the
// requirement tables (09 section 6; A1 section 4 tags tests by name). `just test-tags` runs it
// locally and in CI; node:test covers it from scripts/check-test-tags.test.mjs.
//
// Mechanism: the script walks every TypeScript, JavaScript and Rust source under the repo
// (packages/**/test and src, guard/test, scripts, db/test, infra, web, crates/**/tests and src,
// services/**/tests and src, tools/**/tests and src), skipping node_modules, target, dist, docs,
// .guard-private and the vendored engine under crates/vendor, whose ignored tests are upstream's.
// A small tokenizer drops comments and reads string literals, so a call inside a comment, a
// string or a regex never counts; a pass over the tokens then finds
//   - Vitest and node:test calls with a .todo or .skip modifier: it.todo("..."), test.skip("..."),
//     describe.todo("...");
//   - node:test and Vitest calls whose second argument is an options object with a skip or todo
//     key: test("...", { skip: true }, fn), it("...", { todo: "reason" }, fn);
//   - Rust #[ignore] and #[ignore = "reason"] attributes and the fn they annotate.
// A pending test is tagged when /R\d+\.\d+/ matches its title, the title of an enclosing
// describe or suite, its #[ignore] reason, or (Rust only, because an identifier cannot carry a
// dot) its fn name in the r<phase>_<n> form, for example r2_4_kuhn_gate. The first R ID found
// is the one counted. Untagged pending tests are printed with file and line and the exit code
// is 1; otherwise the count per R ID is printed and the exit code is 0. No npm packages.
//
// Usage: node scripts/check-test-tags.mjs [root]   (root defaults to the repository)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const R_ID_PATTERN = /R\d+\.\d+/;
// Rust fn names are snake_case, so the tag is r<phase>_<n> at the start or after an underscore.
const RUST_NAME_R_ID = /(?:^|_)r(\d+)_(\d+)(?=_|$)/i;
export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".rs"]);
export const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "target", "dist", ".git", ".guard-private", "docs"]);
// Repo-relative, forward slashes: the vendored engine is upstream code (CLAUDE.md, ADR 0002).
export const SKIPPED_PATHS = new Set(["crates/vendor"]);

const TEST_CALLEES = new Set(["it", "test", "describe", "suite"]);
const GROUP_CALLEES = new Set(["describe", "suite"]);
const PENDING_MODIFIERS = new Set(["todo", "skip"]);
// Modifiers that take their own arguments before the title; such calls are left alone.
const ARGUMENT_MODIFIERS = new Set(["each", "for", "skipIf", "runIf", "todoIf", "extend"]);
const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const DIVISION_PREDECESSORS = new Set([")", "]", "}"]);
const RUST_STRING_PREFIX = /^(b|c|br|cr|r)$/;
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const MAX_TOKENS_TO_FN = 64;

const JS_LANGUAGE = Object.freeze({ singleQuoteStrings: true, templateStrings: true, regexLiterals: true, nestedBlockComments: false, rustLiterals: false });
const RUST_LANGUAGE = Object.freeze({ singleQuoteStrings: false, templateStrings: false, regexLiterals: false, nestedBlockComments: true, rustLiterals: true });

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

/** A '...' or "..." literal; an unterminated one stops at the end of its line. */
function readQuoted(text, start, quote) {
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      value += text[i + 1] ?? "";
      i += 2;
    } else if (ch === quote) {
      return { value, end: i + 1 };
    } else if (ch === "\n") {
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
      i = readQuoted(text, i, ch).end;
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
    else if (ch === "/" && !inClass) {
      i++;
      while (i < text.length && IDENT_PART.test(text[i])) i++;
      return i;
    }
    i++;
  }
  return null;
}

function regexAllowed(tokens) {
  const prev = tokens[tokens.length - 1];
  if (prev === undefined) return true;
  if (prev.type === "punct") return !DIVISION_PREDECESSORS.has(prev.value);
  if (prev.type === "ident") return KEYWORDS_BEFORE_REGEX.has(prev.value);
  return false;
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

export function tokenize(text, language) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const push = (type, value) => tokens.push({ type, value, line });
  const consume = (end) => {
    line += countNewlines(text, i, end);
    i = end;
  };

  while (i < text.length) {
    const ch = text[i];
    const slashStartsCode = ch === "/" && text[i + 1] !== "/" && text[i + 1] !== "*";
    const regexStop = slashStartsCode && language.regexLiterals && regexAllowed(tokens) ? regexEnd(text, i) : null;
    if (ch === "\n") {
      line++;
      i++;
    } else if (ch <= " ") {
      i++;
    } else if (ch === "/" && text[i + 1] === "/") {
      consume(lineCommentEnd(text, i));
    } else if (ch === "/" && text[i + 1] === "*") {
      consume(blockCommentEnd(text, i, language.nestedBlockComments));
    } else if (ch === '"' || (ch === "'" && language.singleQuoteStrings)) {
      const { value, end } = readQuoted(text, i, ch);
      push("string", value);
      consume(end);
    } else if (ch === "'") {
      consume(rustQuoteEnd(text, i));
    } else if (ch === "`" && language.templateStrings) {
      const { value, end } = readTemplate(text, i);
      push("string", value);
      consume(end);
    } else if (regexStop !== null) {
      push("regex", "");
      consume(regexStop);
    } else if (IDENT_START.test(ch)) {
      let end = i + 1;
      while (end < text.length && IDENT_PART.test(text[end])) end++;
      const ident = text.slice(i, end);
      const raw = language.rustLiterals && RUST_STRING_PREFIX.test(ident) && (text[end] === '"' || (text[end] === "#" && ident.endsWith("r")))
        ? (ident.endsWith("r") ? readRawString(text, end) : readQuoted(text, end, '"'))
        : null;
      if (raw !== null) {
        push("string", raw.value);
        consume(raw.end);
      } else {
        push("ident", ident);
        consume(end);
      }
    } else if (ch >= "0" && ch <= "9") {
      let end = i + 1;
      while (end < text.length && (IDENT_PART.test(text[end]) || text[end] === ".")) end++;
      push("number", text.slice(i, end));
      consume(end);
    } else if (ch === "=" && text[i + 1] === ">") {
      push("punct", "=>");
      i += 2;
    } else {
      push("punct", ch);
      i++;
    }
  }
  return tokens;
}

const isPunct = (token, value) => token !== undefined && token.type === "punct" && token.value === value;
const isIdent = (token, value) => token !== undefined && token.type === "ident" && (value === undefined || token.value === value);

// ---------------------------------------------------------------------------------------------
// JavaScript and TypeScript: Vitest and node:test calls.

/** The top-level keys of an object literal starting at tokens[start] ({), and the index after it. */
function readObjectLiteral(tokens, start) {
  const keys = new Set();
  let depth = 0;
  let i = start;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, "{") || isPunct(token, "[") || isPunct(token, "(")) depth++;
    else if (isPunct(token, "}") || isPunct(token, "]") || isPunct(token, ")")) {
      depth--;
      if (depth === 0) return { keys, next: i + 1 };
    } else if (depth === 1 && (token.type === "ident" || token.type === "string")) {
      const next = tokens[i + 1];
      if (isPunct(next, ":") || isPunct(next, ",") || isPunct(next, "}")) keys.add(token.value);
    }
  }
  return { keys, next: i };
}

/** it("title" ...) style call at tokens[start], or null when it is not one this check reads. */
function readTestCall(tokens, start) {
  const callee = tokens[start].value;
  const modifiers = [];
  let i = start + 1;
  while (isPunct(tokens[i], ".") && isIdent(tokens[i + 1])) {
    const modifier = tokens[i + 1].value;
    if (ARGUMENT_MODIFIERS.has(modifier)) return null;
    modifiers.push(modifier);
    i += 2;
  }
  if (!isPunct(tokens[i], "(") || tokens[i + 1]?.type !== "string") return null;
  const title = tokens[i + 1].value;
  i += 2;
  let optionKind = null;
  if (isPunct(tokens[i], ",") && isPunct(tokens[i + 1], "{")) {
    const options = readObjectLiteral(tokens, i + 1);
    optionKind = options.keys.has("todo") ? "todo" : options.keys.has("skip") ? "skip" : null;
    i = options.next;
  }
  const modifierKind = modifiers.find((modifier) => PENDING_MODIFIERS.has(modifier)) ?? null;
  const kind = modifierKind !== null ? `${callee}.${modifierKind}` : optionKind !== null ? `${callee} { ${optionKind} }` : null;
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

/** The R ID a pending test carries, from its title, its enclosing groups or its Rust fn name; null when untagged. */
export function rIdOf(entry) {
  const fromTitle = R_ID_PATTERN.exec(entry.title ?? "");
  if (fromTitle !== null) return fromTitle[0];
  for (const group of [...(entry.context ?? [])].reverse()) {
    const match = R_ID_PATTERN.exec(group);
    if (match !== null) return match[0];
  }
  const fromName = RUST_NAME_R_ID.exec(entry.name ?? "");
  return fromName === null ? null : `R${fromName[1]}.${fromName[2]}`;
}

/** Every source file under root, repo-relative with forward slashes, sorted; skipped trees left out. */
export function listSourceFiles(root) {
  const files = [];
  const walk = (dir, relDir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name) && !SKIPPED_PATHS.has(relPath)) walk(join(dir, entry.name), relPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(relPath);
      }
    }
  };
  walk(root, "");
  return files;
}

/** Every pending test under root with its file and R ID (null when untagged). */
export function findPendingTests(root) {
  const found = [];
  for (const file of listSourceFiles(root)) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch (error) {
      throw new CheckError(`cannot read ${file}: ${error.message}`);
    }
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
    lines.push(`check-test-tags: ${summary.untagged.length} of ${summary.total} pending tests untagged; put the R ID (R<phase>.<n>) in the title, the enclosing describe or the ignore reason (R0.11)`);
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
