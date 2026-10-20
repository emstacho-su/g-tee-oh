// Tests for scripts/check-test-tags.mjs (R0.11): the scanners run over synthetic sources and
// the walk and the command run over a temporary tree holding tagged and untagged samples.
// node:test, run by `pnpm run test:scripts` (just ts-test). The samples below sit in template
// literals, which the scanner reads as strings, so this file itself never counts as pending.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  findPendingTests,
  formatReport,
  listSourceFiles,
  rIdOf,
  scanJavaScript,
  scanRust,
  summarize,
  tokenize,
} from "./check-test-tags.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-test-tags.mjs");

const TAGGED_VITEST = `
import { describe, it } from "vitest";

describe("glicko-2 worked example (A6 section 6, ADR 0011)", () => {
  it.todo("R4.1 rates the worked example within one point");
  it("R0.1 already green", () => {
    const division = 4 / 2;
    return division;
  });
});

describe("R4.6 ts-fsrs published vectors through the empty adapter (O-35, ADR 0012)", () => {
  it.todo("replays vector 1");
  it.skip("replays vector 2", () => {});
  describe("nested without a tag", () => {
    test.todo("inherits the outer tag");
  });
});

describe.todo("R4.7 BKT hand-computed sequences");
`;

const TAGGED_NODE_TEST = `
import test from "node:test";

test("R2.4 Kuhn gate through tools/validate (O-30)", { todo: "pending S13" }, () => {});
test("R3.10 chi-square over 10,000 seeded rolls", { skip: true });
test("R0.1 green test", () => {});
test("R3.20 planted number rejected", { timeout: 1000, skip }, () => {});
`;

const NOISE_JS = `
// it.todo("a line comment is not a test")
/* test.skip("a block comment is not a test") */
const text = 'it.todo("a single-quoted string is not a test")';
const other = "test.todo(\\"a double-quoted string is not a test\\")";
const tpl = \`describe.todo("a template literal is not a test")\`;
const re = /it\\.todo\\("a regex is not a test"/;
const ratio = 6 / 3 / 2;
it.each([1, 2])("each %s is left alone", () => {});
`;

const UNTAGGED_VITEST = `
describe("worked example without a tag", () => {
  it.todo("rates the worked example");
  test("skipped without a tag", { skip: true }, () => {});
});
`;

const TAGGED_RUST = `
//! #[ignore] in a doc comment is not a test (G1 to G3 pass rules, 04 section 6).

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "R2.4 pending S13: Kuhn exploitability under the 04 section 6 bound"]
    fn kuhn_gate() {
        assert!(false, "skeleton");
    }

    #[test]
    #[ignore]
    fn r2_5_akq_gate() {}

    #[test]
    fn green() {
        let s = "#[ignore] inside a string";
        let raw = r#"#[ignore] inside a raw string"#;
        let c = '"';
        let _lifetime: &'static str = "x";
        assert!(!s.is_empty() && !raw.is_empty() && c == '"');
    }

    /* #[ignore] in a block /* nested */ comment */
}
`;

const UNTAGGED_RUST = `
#[test]
#[ignore]
fn leduc_gate() {}

#[test]
#[ignore = "waiting on the curve fixture"]
fn leduc_curve() {}
`;

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-test-tags-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relPath, text) {
  const path = join(root, ...relPath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function writeTaggedTree() {
  write("packages/learning/test/glicko.test.ts", TAGGED_VITEST);
  write("guard/test/node.test.mjs", TAGGED_NODE_TEST);
  write("scripts/noise.mjs", NOISE_JS);
  write("tools/validate/tests/gates.rs", TAGGED_RUST);
  // Skipped trees: their pending tests are not this repository's.
  write("node_modules/dep/test/dep.test.ts", UNTAGGED_VITEST);
  write("crates/vendor/engine/tests/upstream.rs", UNTAGGED_RUST);
  write("target/debug/build/out.rs", UNTAGGED_RUST);
  write("docs/handoffs/note.mjs", UNTAGGED_VITEST);
}

function runCommand(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", windowsHide: true });
}

test("R0.11 scanJavaScript finds todo and skip modifiers and reads the R ID from the title or the enclosing describe", () => {
  const entries = scanJavaScript(TAGGED_VITEST).map((entry) => ({ ...entry, rId: rIdOf(entry) }));
  assert.deepEqual(
    entries.map(({ line, kind, title, rId }) => ({ line, kind, title, rId })),
    [
      { line: 5, kind: "it.todo", title: "R4.1 rates the worked example within one point", rId: "R4.1" },
      { line: 13, kind: "it.todo", title: "replays vector 1", rId: "R4.6" },
      { line: 14, kind: "it.skip", title: "replays vector 2", rId: "R4.6" },
      { line: 16, kind: "test.todo", title: "inherits the outer tag", rId: "R4.6" },
      { line: 20, kind: "describe.todo", title: "R4.7 BKT hand-computed sequences", rId: "R4.7" },
    ],
  );
  assert.deepEqual(entries[3].context, [
    "R4.6 ts-fsrs published vectors through the empty adapter (O-35, ADR 0012)",
    "nested without a tag",
  ]);
});

test("R0.11 scanJavaScript finds node:test skip and todo options as the second argument", () => {
  const entries = scanJavaScript(TAGGED_NODE_TEST);
  assert.deepEqual(
    entries.map(({ line, kind, title }) => ({ line, kind, title })),
    [
      { line: 4, kind: "test { todo }", title: "R2.4 Kuhn gate through tools/validate (O-30)" },
      { line: 5, kind: "test { skip }", title: "R3.10 chi-square over 10,000 seeded rolls" },
      { line: 7, kind: "test { skip }", title: "R3.20 planted number rejected" },
    ],
  );
  assert.deepEqual(entries.map(rIdOf), ["R2.4", "R3.10", "R3.20"]);
});

test("R0.11 scanJavaScript ignores calls inside comments, strings, template literals and regex literals", () => {
  assert.deepEqual(scanJavaScript(NOISE_JS), []);
  // The tokenizer keeps the regex and the division apart: "6 / 3 / 2" is two divisions, not a regex.
  const tokens = tokenize("const ratio = 6 / 3 / 2; const re = /x/g;", { singleQuoteStrings: true, templateStrings: true, regexLiterals: true, nestedBlockComments: false, rustLiterals: false });
  assert.equal(tokens.filter((token) => token.type === "regex").length, 1);
  assert.equal(tokens.filter((token) => token.type === "punct" && token.value === "/").length, 2);
});

test("R0.11 scanJavaScript reports an untagged it.todo and an untagged skip option as untagged", () => {
  const entries = scanJavaScript(UNTAGGED_VITEST);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(rIdOf), [null, null]);
  assert.deepEqual(entries[0].context, ["worked example without a tag"]);
});

test("R0.11 scanRust reads the R ID from the ignore reason or the r<phase>_<n> fn name", () => {
  const entries = scanRust(TAGGED_RUST);
  assert.deepEqual(
    entries.map(({ line, kind, title, name }) => ({ line, kind, title, name })),
    [
      { line: 7, kind: '#[ignore = "..."]', title: "R2.4 pending S13: Kuhn exploitability under the 04 section 6 bound", name: "kuhn_gate" },
      { line: 13, kind: "#[ignore]", title: "", name: "r2_5_akq_gate" },
    ],
  );
  assert.deepEqual(entries.map(rIdOf), ["R2.4", "R2.5"]);
});

test("R0.11 scanRust reports a bare #[ignore] and a reason without an R ID as untagged", () => {
  const entries = scanRust(UNTAGGED_RUST);
  assert.deepEqual(entries.map((entry) => entry.name), ["leduc_gate", "leduc_curve"]);
  assert.deepEqual(entries.map(rIdOf), [null, null]);
});

test("R0.11 listSourceFiles walks the tree and skips node_modules, target, dist, docs and crates/vendor", () => {
  writeTaggedTree();
  write("packages/learning/src/index.ts", "export const x = 1;");
  write("validation/fixtures/kuhn.json", "{}");
  assert.deepEqual(listSourceFiles(root), [
    "guard/test/node.test.mjs",
    "packages/learning/src/index.ts",
    "packages/learning/test/glicko.test.ts",
    "scripts/noise.mjs",
    "tools/validate/tests/gates.rs",
  ]);
});

test("R0.11 findPendingTests and summarize count every tagged pending test per R ID in phase order", () => {
  writeTaggedTree();
  const summary = summarize(findPendingTests(root));
  assert.equal(summary.total, 10);
  assert.deepEqual(summary.untagged, []);
  assert.deepEqual(summary.counts, [
    ["R2.4", 2],
    ["R2.5", 1],
    ["R3.10", 1],
    ["R3.20", 1],
    ["R4.1", 1],
    ["R4.6", 3],
    ["R4.7", 1],
  ]);
  const { lines, exitCode } = formatReport(summary);
  assert.equal(exitCode, 0);
  assert.equal(lines[0], "check-test-tags: 10 pending tests, all tagged (R0.11)");
  assert.equal(lines.length, 8);
});

test("R0.11 formatReport names every untagged pending test with file and line and exits 1", () => {
  writeTaggedTree();
  write("packages/learning/test/untagged.test.ts", UNTAGGED_VITEST);
  write("crates/gto-model/src/lib.rs", UNTAGGED_RUST);
  const summary = summarize(findPendingTests(root));
  const { lines, exitCode } = formatReport(summary);
  assert.equal(exitCode, 1);
  assert.deepEqual(lines, [
    'check-test-tags: crates/gto-model/src/lib.rs:3: #[ignore] "" has no R ID',
    'check-test-tags: crates/gto-model/src/lib.rs:7: #[ignore = "..."] "waiting on the curve fixture" has no R ID',
    'check-test-tags: packages/learning/test/untagged.test.ts:3: it.todo "rates the worked example" has no R ID',
    'check-test-tags: packages/learning/test/untagged.test.ts:4: test { skip } "skipped without a tag" has no R ID',
    "check-test-tags: 4 of 14 pending tests untagged; put the R ID (R<phase>.<n>) in the title, the enclosing describe or the ignore reason (R0.11)",
  ]);
});

test("R0.11 the command exits 0 with the counts over a tagged tree", () => {
  writeTaggedTree();
  const result = runCommand([root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^check-test-tags: 10 pending tests, all tagged \(R0\.11\)/);
  assert.match(result.stdout, /^ {2}R4\.6 {4}3$/m);
});

test("R0.11 the command exits 1 and names file and line over an untagged tree", () => {
  writeTaggedTree();
  write("tools/validate/tests/leduc.rs", UNTAGGED_RUST);
  const result = runCommand([root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tools\/validate\/tests\/leduc\.rs:3: #\[ignore\] "" has no R ID/);
  assert.match(result.stderr, /2 of 12 pending tests untagged/);
});

test("R0.11 the command exits 2 when the root is not a directory", () => {
  const result = runCommand([join(root, "absent")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not a directory/);
});
