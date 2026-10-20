// Tests for scripts/contracts.mjs (R0.7): the pipeline's pure helpers, a write run and a
// --check run over a temporary tree with the external tools replaced by fakes that write what
// the real ones would, and the committed schema copies compared with their sources. node:test,
// run by `pnpm run test:scripts` (just ts-test). The end-to-end --check on the real tree is a
// manual step (it needs cargo, the api build and a migrated database), not a test here.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  API_DOCUMENT,
  API_TYPES,
  ContractsError,
  DB_TYPES,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  SCHEMA_COPY_DIR,
  SCHEMA_SOURCE_DIR,
  SOLVER_QUERY_DOCUMENT,
  SOLVER_QUERY_TYPES,
  compareTarget,
  listSchemaCopies,
  normalize,
  parseArgs,
  runPipeline,
  targets,
} from "./contracts.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts", "contracts.mjs");
const BOM = "﻿";
const TOOL_FAILURE_STATUS = 101;

/** Two synthetic schemas, LF only, standing in for packages/contracts/schemas/*.schema.json. */
const SCHEMA_SOURCES = {
  "manifest.schema.json": '{\n  "$id": "manifest"\n}\n',
  "node-dump.schema.json": '{\n  "$id": "node-dump"\n}\n',
};

/** What the fake tools emit before the script normalizes it: CRLF everywhere and one BOM on purpose. */
const EMITTED = {
  [SOLVER_QUERY_DOCUMENT]: `${BOM}{\r\n  "openapi": "3.1.0",\r\n  "info": { "title": "solver-query" }\r\n}\r\n`,
  [API_DOCUMENT]: '{\r\n  "openapi": "3.1.0",\r\n  "info": { "title": "g-tee-oh api" }\r\n}\r\n',
  [DB_TYPES]: "export interface DB {}\n",
};

/** The value after a flag in an argument list. */
function argAfter(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} missing from ${args.join(" ")}`);
  return args[index + 1];
}

function writeTree(root, relativePath, content) {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

/** The fake openapi-typescript output for one document: a header plus the document it was given. */
function typesFor(documentPath, documentText) {
  return `// types of ${basename(documentPath)}\r\n${documentText}`;
}

/** The content every target holds after a clean run, keyed by relative path. */
function expectedTargets() {
  const solverDocument = normalize(EMITTED[SOLVER_QUERY_DOCUMENT]);
  const apiDocument = normalize(EMITTED[API_DOCUMENT]);
  return {
    [SOLVER_QUERY_DOCUMENT]: solverDocument,
    [API_DOCUMENT]: apiDocument,
    [SOLVER_QUERY_TYPES]: normalize(typesFor(SOLVER_QUERY_DOCUMENT, solverDocument)),
    [API_TYPES]: normalize(typesFor(API_DOCUMENT, apiDocument)),
    [DB_TYPES]: EMITTED[DB_TYPES],
    ...Object.fromEntries(
      Object.entries(SCHEMA_SOURCES).map(([name, text]) => [`${SCHEMA_COPY_DIR}/${name}`, text]),
    ),
  };
}

/**
 * A stand-in for the external tools. It records every call and writes the files the real
 * tools would, reading the document it is handed so the test can tell which copy was used.
 */
function fakeExec(tree, { codegenCheckStatus = EXIT_OK, failing = null } = {}) {
  const calls = [];
  const exec = (call) => {
    calls.push(call);
    const { program, args } = call;
    if (program === failing) return TOOL_FAILURE_STATUS;
    if (program === "cargo") {
      writeFileSync(argAfter(args, "--out"), EMITTED[SOLVER_QUERY_DOCUMENT], "utf8");
      return EXIT_OK;
    }
    if (program === "pnpm" && args[0] === "exec") {
      const document = args[2];
      writeFileSync(argAfter(args, "-o"), typesFor(document, readFileSync(document, "utf8")), "utf8");
      return EXIT_OK;
    }
    if (program === "pnpm") return EXIT_OK; // the api build
    if (program === "node" && args[0].endsWith("openapi-export.js")) {
      writeFileSync(argAfter(args, "--out"), EMITTED[API_DOCUMENT], "utf8");
      return EXIT_OK;
    }
    if (program === "node" && args[0].endsWith("codegen.mjs")) {
      if (args.includes("--check")) return codegenCheckStatus;
      writeTree(tree, DB_TYPES, EMITTED[DB_TYPES]);
      return EXIT_OK;
    }
    throw new Error(`unexpected command: ${program} ${args.join(" ")}`);
  };
  return { exec, calls };
}

function captureLog() {
  const info = [];
  const error = [];
  return { info, error, log: { info: (line) => info.push(line), error: (line) => error.push(line) } };
}

let tree;

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "contracts-test-"));
  for (const [name, text] of Object.entries(SCHEMA_SOURCES)) writeTree(tree, `${SCHEMA_SOURCE_DIR}/${name}`, text);
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

test("r0_7 normalize strips a leading BOM and turns CRLF into LF", () => {
  assert.equal(normalize(`${BOM}a\r\nb\r\n`), "a\nb\n");
  assert.equal(normalize("already\nfine\n"), "already\nfine\n");
});

test("r0_7 the target list names the committed artifacts in pipeline order, schema copies last", () => {
  assert.deepEqual(targets(tree), [
    SOLVER_QUERY_DOCUMENT,
    API_DOCUMENT,
    SOLVER_QUERY_TYPES,
    API_TYPES,
    DB_TYPES,
    `${SCHEMA_COPY_DIR}/manifest.schema.json`,
    `${SCHEMA_COPY_DIR}/node-dump.schema.json`,
  ]);
  assert.deepEqual(listSchemaCopies(tree), [
    { name: "manifest.schema.json", source: `${SCHEMA_SOURCE_DIR}/manifest.schema.json`, copy: `${SCHEMA_COPY_DIR}/manifest.schema.json` },
    { name: "node-dump.schema.json", source: `${SCHEMA_SOURCE_DIR}/node-dump.schema.json`, copy: `${SCHEMA_COPY_DIR}/node-dump.schema.json` },
  ]);
});

test("r0_7 compareTarget treats CRLF as LF and reports a differing or missing committed file", () => {
  writeTree(tree, "committed.txt", "one\r\ntwo\r\n");
  writeTree(tree, "generated.txt", "one\ntwo\n");
  writeTree(tree, "other.txt", "one\nthree\n");
  assert.deepEqual(compareTarget(join(tree, "committed.txt"), join(tree, "generated.txt")), { stale: false, reason: null });
  assert.deepEqual(compareTarget(join(tree, "other.txt"), join(tree, "generated.txt")), { stale: true, reason: "differs" });
  assert.deepEqual(compareTarget(join(tree, "absent.txt"), join(tree, "generated.txt")), { stale: true, reason: "missing" });
  assert.throws(() => compareTarget(join(tree, "committed.txt"), join(tree, "absent.txt")), ContractsError);
});

test("r0_7 a run writes every target with LF endings and no BOM, in the documented tool order", () => {
  const { exec, calls } = fakeExec(tree);
  const { log, info } = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: false, exec, log }), EXIT_OK);

  const expected = expectedTargets();
  for (const target of targets(tree)) {
    const text = readFileSync(join(tree, target), "utf8");
    assert.ok(!text.startsWith(BOM), `${target} starts with a BOM`);
    assert.ok(!text.includes("\r"), `${target} contains a carriage return`);
    assert.equal(text, expected[target], `${target} content`);
    assert.ok(info.some((line) => line.includes(target)), `the run did not report ${target}`);
  }
  for (const { name, source, copy } of listSchemaCopies(tree)) {
    assert.ok(readFileSync(join(tree, copy)).equals(readFileSync(join(tree, source))), `${name} copy differs from its source`);
  }
  assert.deepEqual(calls.map((call) => call.program), ["cargo", "pnpm", "node", "pnpm", "pnpm", "node"]);
  assert.deepEqual(calls[0].args, ["run", "-q", "-p", "solver-query", "--", "openapi", "--out", join(tree, SOLVER_QUERY_DOCUMENT)]);
  assert.deepEqual(calls[1].args, ["--filter", "@g-tee-oh/api", "run", "build"]);
  assert.deepEqual(calls[2].args, [join(tree, "services", "api", "dist", "openapi-export.js"), "--out", join(tree, API_DOCUMENT)]);
  assert.deepEqual(calls[3].args, ["exec", "openapi-typescript", join(tree, SOLVER_QUERY_DOCUMENT), "-o", join(tree, SOLVER_QUERY_TYPES), "--alphabetize"]);
  assert.deepEqual(calls[4].args, ["exec", "openapi-typescript", join(tree, API_DOCUMENT), "-o", join(tree, API_TYPES), "--alphabetize"]);
  assert.deepEqual(calls[5].args, [join(tree, "scripts", "codegen.mjs")]);
  assert.ok(calls.every((call) => call.cwd === tree), "every tool runs from the repository root");
});

test("r0_7 --check against a tree whose api.openapi.json is stale exits 1 and names only that path", () => {
  for (const [target, text] of Object.entries(expectedTargets())) writeTree(tree, target, text);
  writeTree(tree, API_DOCUMENT, '{\n  "openapi": "3.1.0",\n  "info": { "title": "g-tee-oh api", "version": "stale" }\n}\n');
  const { exec, calls } = fakeExec(tree);
  const { log, error } = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: true, exec, log }), EXIT_FAILED);

  assert.deepEqual(
    error.filter((line) => line.startsWith("contracts: stale ")),
    [`contracts: stale ${API_DOCUMENT} (differs)`],
  );
  assert.ok(error.at(-1).includes("1 stale"), `summary line: ${error.at(-1)}`);
  // --check never touches the committed tree: the generated files went to a temporary directory.
  assert.ok(!argAfter(calls[0].args, "--out").startsWith(tree), "--check generated into the committed tree");
  assert.ok(!argAfter(calls[3].args, "-o").startsWith(tree), "--check generated into the committed tree");
  assert.deepEqual(calls[5].args, [join(tree, "scripts", "codegen.mjs"), "--check"]);
  assert.ok(readFileSync(join(tree, API_DOCUMENT), "utf8").includes('"stale"'), "the stale committed document was overwritten");
});

test("r0_7 --check on an up-to-date tree exits 0", () => {
  for (const [target, text] of Object.entries(expectedTargets())) writeTree(tree, target, text);
  const { exec } = fakeExec(tree);
  const { log, error } = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: true, exec, log }), EXIT_OK);
  assert.deepEqual(error, []);
});

test("r0_7 --check reports the Kysely types stale when codegen --check exits 1", () => {
  for (const [target, text] of Object.entries(expectedTargets())) writeTree(tree, target, text);
  const { exec } = fakeExec(tree, { codegenCheckStatus: EXIT_FAILED });
  const { log, error } = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: true, exec, log }), EXIT_FAILED);
  assert.deepEqual(
    error.filter((line) => line.startsWith("contracts: stale ")),
    [`contracts: stale ${DB_TYPES} (codegen --check)`],
  );
});

test("r0_7 --check flags a schema copy whose source is gone and a run removes it", () => {
  for (const [target, text] of Object.entries(expectedTargets())) writeTree(tree, target, text);
  const orphan = `${SCHEMA_COPY_DIR}/retired.schema.json`;
  writeTree(tree, orphan, "{}\n");
  const checkLog = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: true, exec: fakeExec(tree).exec, log: checkLog.log }), EXIT_FAILED);
  assert.deepEqual(
    checkLog.error.filter((line) => line.startsWith("contracts: stale ")),
    [`contracts: stale ${orphan} (no source under ${SCHEMA_SOURCE_DIR})`],
  );

  assert.equal(runPipeline({ repoRoot: tree, check: false, exec: fakeExec(tree).exec, log: captureLog().log }), EXIT_OK);
  assert.ok(!existsSync(join(tree, orphan)), "the orphan copy survived the run");
});

test("r0_7 the pipeline stops at the first failing step with a named error and exit 1", () => {
  const { exec, calls } = fakeExec(tree, { failing: "cargo" });
  const { log, error } = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: false, exec, log }), EXIT_FAILED);
  assert.equal(calls.length, 1, "later steps ran after the failure");
  assert.equal(error.length, 1);
  assert.match(error[0], /^contracts: ContractsError: solver-query openapi document: cargo .* exited 101/);
  assert.ok(!existsSync(join(tree, API_DOCUMENT)), "the api document was written after the failure");
});

test("r0_7 a tool that cannot be spawned is a named failure, not a crash", () => {
  const exec = () => {
    throw new ContractsError("cargo not found on PATH");
  };
  const { log, error } = captureLog();

  assert.equal(runPipeline({ repoRoot: tree, check: false, exec, log }), EXIT_FAILED);
  assert.deepEqual(error, ["contracts: ContractsError: solver-query openapi document: cargo not found on PATH"]);
});

test("r0_7 parseArgs accepts --check and rejects anything else", () => {
  assert.deepEqual(parseArgs([]), { check: false });
  assert.deepEqual(parseArgs(["--check"]), { check: true });
  assert.throws(() => parseArgs(["--bogus"]), ContractsError);
  assert.throws(() => parseArgs(["--check", "extra"]), ContractsError);
});

test("r0_7 the command line rejects an unknown flag with usage and exit 2", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--bogus"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /usage: node scripts\/contracts\.mjs \[--check\]/);
});

test("r0_7 the committed schema copies under crates/gto-library/schemas equal their sources byte for byte", () => {
  const copies = listSchemaCopies(REPO_ROOT);
  assert.ok(copies.length >= 2, "the manifest and node dump schemas are expected");
  for (const { name, source, copy } of copies) {
    assert.ok(existsSync(join(REPO_ROOT, copy)), `${copy} is missing; run just contracts`);
    assert.ok(readFileSync(join(REPO_ROOT, copy)).equals(readFileSync(join(REPO_ROOT, source))), `${name} copy differs from its source`);
  }
});
