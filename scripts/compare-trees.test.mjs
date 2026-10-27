// Tests for scripts/compare-trees.mjs (R2.20, O-225): the byte comparison `just fixtures-check`
// runs between a fresh fixture-gen run and the committed library. node:test, run by
// `pnpm run test:scripts` (just ts-test). The trees are small temporary directories built here,
// so every finding kind (missing, extra, changed bytes, an empty selection) is pinned, and the
// command line is checked through a child process for its exit codes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { compareTrees, parseSelection } from "./compare-trees.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "compare-trees.mjs");
const EXIT_OK = 0;
const EXIT_DIFFERENT = 1;
const EXIT_USAGE = 2;
const SELECTIONS = ["preflop/cfg_6_online_*", "preflop/cfg_9_live_*"];

/** Files of one tree, relative path to content; the G6a directory sits outside the selection. */
const TREE = {
  "preflop/cfg_6_online_100/aaa/manifest.json": '{"synthetic": true}',
  "preflop/cfg_6_online_100/aaa/chunks/0000.bin.zst": "\u0000\u0001chunk",
  "preflop/cfg_9_live_13_100/bbb/manifest.json": '{"synthetic": true}',
  "preflop/cfg_9_live_13_100/bbb/chunks/0000.bin.zst": "chunk",
  "preflop/cfg_2_online_norake_10/ccc/manifest.json": '{"synthetic": false}',
};

let scratch;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "compare-trees-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeTree(name, files) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function withoutKey(files, key) {
  return Object.fromEntries(Object.entries(files).filter(([relative]) => relative !== key));
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

test("r2_20 parseSelection splits the parent from a trailing wildcard and refuses others", () => {
  assert.deepEqual(parseSelection("preflop/cfg_6_online_*"), { parent: "preflop", pattern: "cfg_6_online_*" });
  assert.deepEqual(parseSelection("preflop"), { parent: "", pattern: "preflop" });
  assert.throws(() => parseSelection("preflop/*_100"), /one \*/);
  assert.throws(() => parseSelection("pre*/cfg_6_online_*"), /one \*/);
  assert.throws(() => parseSelection("/"), /empty/);
});

test("r2_20 identical selected trees have no findings and count what they compared", () => {
  const actual = writeTree("actual", withoutKey(TREE, "preflop/cfg_2_online_norake_10/ccc/manifest.json"));
  const expected = writeTree("expected", TREE);
  const result = compareTrees(actual, expected, SELECTIONS);
  assert.deepEqual(result.findings, []);
  assert.equal(result.directories, 2);
  assert.equal(result.files, 4);
});

test("r2_20 changed bytes, a missing file and an extra file are each named", () => {
  const expected = writeTree("expected", TREE);
  const actual = writeTree("actual", {
    ...withoutKey(TREE, "preflop/cfg_9_live_13_100/bbb/manifest.json"),
    "preflop/cfg_6_online_100/aaa/chunks/0000.bin.zst": "\u0000\u0002chunk",
    "preflop/cfg_6_online_100/aaa/stray.json": "{}",
  });
  const result = compareTrees(actual, expected, SELECTIONS);
  assert.deepEqual(result.findings.sort(), [
    "bytes differ: preflop/cfg_6_online_100/aaa/chunks/0000.bin.zst",
    "extra in the actual tree: preflop/cfg_6_online_100/aaa/stray.json",
    "missing from the actual tree: preflop/cfg_9_live_13_100/bbb/manifest.json",
  ]);
});

test("r2_20 a selected directory on one side only is named, and an empty selection is a finding", () => {
  const expected = writeTree("expected", TREE);
  const live = Object.keys(TREE).filter((relative) => relative.startsWith("preflop/cfg_9_live_13_100/"));
  const actual = writeTree("actual", {
    ...Object.fromEntries(Object.entries(TREE).filter(([relative]) => !live.includes(relative))),
    "preflop/cfg_6_online_150/ddd/manifest.json": "{}",
  });
  const result = compareTrees(actual, expected, [...SELECTIONS, "preflop/cfg_9_live_25_*"]);
  assert.deepEqual(result.findings.sort(), [
    "extra in the actual tree: preflop/cfg_6_online_150/",
    "missing from the actual tree: preflop/cfg_9_live_13_100/",
    "selection preflop/cfg_9_live_25_* matches no directory in the expected tree",
  ]);
});

test("r2_20 the command exits 0 on agreement, 1 on a difference and 2 on a usage error", () => {
  const expected = writeTree("expected", TREE);
  const same = writeTree("same", TREE);
  const changed = writeTree("changed", { ...TREE, "preflop/cfg_6_online_100/aaa/manifest.json": "{}" });

  const ok = run([same, expected, ...SELECTIONS]);
  assert.equal(ok.status, EXIT_OK, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /2 directories and 4 files identical/);

  const different = run([changed, expected, ...SELECTIONS]);
  assert.equal(different.status, EXIT_DIFFERENT);
  assert.match(different.stdout, /bytes differ: preflop\/cfg_6_online_100\/aaa\/manifest.json/);

  assert.equal(run([same]).status, EXIT_USAGE);
  assert.equal(run([join(scratch, "absent"), expected, ...SELECTIONS]).status, EXIT_USAGE);
});
