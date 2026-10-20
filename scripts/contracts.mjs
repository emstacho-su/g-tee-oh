#!/usr/bin/env node
// Contracts pipeline (R0.7, A1 section 3, O-115, O-116, O-119): regenerate every committed
// contract artifact in order and stop at the first failure.
//
// Mechanism: five steps, each writing under an output root. `just contracts` writes into the
// repository; `just contracts-check` runs the same steps into a temporary directory and
// compares each committed target with its fresh copy, so the contracts job fails on any drift
// between a route, a migration or a schema and what is committed (a contract change is always
// a visible diff). Line endings are LF everywhere: a tool's output is normalized after it
// runs, and both sides of a comparison are normalized, so a CRLF checkout never counts.
//
//   1. cargo run -q -p solver-query -- openapi --out packages/contracts/solver-query.openapi.json
//   2. pnpm --filter @g-tee-oh/api run build, then
//      node services/api/dist/openapi-export.js --out packages/contracts/api.openapi.json
//   3. pnpm exec openapi-typescript <document> -o packages/contracts/src/<service>.generated.ts --alphabetize
//   4. node scripts/codegen.mjs (Kysely types; needs DATABASE_URL: just dev-up and just db-migrate first).
//      In --check mode codegen's own --check runs, which already regenerates into a temporary
//      file and compares with the same normalization.
//   5. packages/contracts/schemas/*.schema.json copied to crates/gto-library/schemas/ (O-119: the
//      Docker build context excludes packages/, so the crate reads its own copy with include_str!).
//      A copy whose source is gone is removed (or reported stale under --check).
//
// cargo and node are spawned without a shell. pnpm is a .cmd shim on Windows, which Node refuses
// to spawn without a shell, so that call goes through the shell as one validated command string,
// the way scripts/codegen.mjs does.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SOLVER_QUERY_DOCUMENT = "packages/contracts/solver-query.openapi.json";
export const API_DOCUMENT = "packages/contracts/api.openapi.json";
export const SOLVER_QUERY_TYPES = "packages/contracts/src/solver-query.generated.ts";
export const API_TYPES = "packages/contracts/src/api.generated.ts";
export const DB_TYPES = "packages/contracts/src/db.generated.ts";
export const SCHEMA_SOURCE_DIR = "packages/contracts/schemas";
export const SCHEMA_COPY_DIR = "crates/gto-library/schemas";
export const SCHEMA_SUFFIX = ".schema.json";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const SOLVER_QUERY_CRATE = "solver-query";
const API_PACKAGE = "@g-tee-oh/api";
const API_EXPORT_SCRIPT = "services/api/dist/openapi-export.js";
const CODEGEN_SCRIPT = "scripts/codegen.mjs";
const TYPED_DOCUMENTS = [
  [SOLVER_QUERY_DOCUMENT, SOLVER_QUERY_TYPES],
  [API_DOCUMENT, API_TYPES],
];
const USAGE = "usage: node scripts/contracts.mjs [--check]";
const BOM = "﻿";
// Characters cmd.exe or sh would interpret inside the one pnpm command string.
const UNSAFE_ARGUMENT = /["'\r\n&|<>^$`;()!%*?]/;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class ContractsError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractsError";
  }
}

/** The text with a leading byte order mark removed and CRLF turned into LF. */
export function normalize(text) {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return withoutBom.replace(/\r\n/g, "\n");
}

/** The schema files to copy, sorted by name, each with its source and copy path relative to the root. */
export function listSchemaCopies(root) {
  const sourceDir = join(root, SCHEMA_SOURCE_DIR);
  if (!existsSync(sourceDir)) throw new ContractsError(`${SCHEMA_SOURCE_DIR} is missing under ${root}`);
  const names = readdirSync(sourceDir)
    .filter((name) => name.endsWith(SCHEMA_SUFFIX))
    .sort();
  if (names.length === 0) throw new ContractsError(`${SCHEMA_SOURCE_DIR} holds no *${SCHEMA_SUFFIX} file`);
  return names.map((name) => ({ name, source: `${SCHEMA_SOURCE_DIR}/${name}`, copy: `${SCHEMA_COPY_DIR}/${name}` }));
}

/** Every committed target, relative to the root, in pipeline order. */
export function targets(root) {
  return [SOLVER_QUERY_DOCUMENT, API_DOCUMENT, SOLVER_QUERY_TYPES, API_TYPES, DB_TYPES, ...listSchemaCopies(root).map((schema) => schema.copy)];
}

/** Whether the committed file differs from the generated one once both are normalized. */
export function compareTarget(committedPath, generatedPath) {
  if (!existsSync(generatedPath)) throw new ContractsError(`${generatedPath} was not generated`);
  if (!existsSync(committedPath)) return { stale: true, reason: "missing" };
  const same = normalize(readFileSync(committedPath, "utf8")) === normalize(readFileSync(generatedPath, "utf8"));
  return same ? { stale: false, reason: null } : { stale: true, reason: "differs" };
}

export function parseArgs(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === "--check") return { check: true };
  throw new ContractsError(USAGE);
}

/** Writes UTF-8 with LF endings and no byte order mark, creating the directory. */
function writeLf(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalize(text), "utf8");
}

/** Rewrites a file a tool just produced so it holds LF only and no byte order mark. */
function settle(path) {
  if (!existsSync(path)) throw new ContractsError(`${path} was not written`);
  const text = readFileSync(path, "utf8");
  const clean = normalize(text);
  if (clean !== text) writeFileSync(path, clean, "utf8");
}

/** Runs one tool from the repository root and fails on a non-zero exit. */
function tool(context, program, args) {
  const status = context.exec({ program, args, cwd: context.repoRoot });
  if (status !== EXIT_OK) throw new ContractsError(`${program} ${args.join(" ")} exited ${status}`);
}

function solverQueryDocument(context) {
  const out = context.output(SOLVER_QUERY_DOCUMENT);
  tool(context, "cargo", ["run", "-q", "-p", SOLVER_QUERY_CRATE, "--", "openapi", "--out", out]);
  settle(out);
  return [];
}

function apiDocument(context) {
  const out = context.output(API_DOCUMENT);
  tool(context, "pnpm", ["--filter", API_PACKAGE, "run", "build"]);
  tool(context, "node", [join(context.repoRoot, API_EXPORT_SCRIPT), "--out", out]);
  settle(out);
  return [];
}

function typescriptTypes(context) {
  for (const [document, types] of TYPED_DOCUMENTS) {
    const out = context.output(types);
    tool(context, "pnpm", ["exec", "openapi-typescript", context.output(document), "-o", out, "--alphabetize"]);
    settle(out);
  }
  return [];
}

function kyselyTypes(context) {
  const script = join(context.repoRoot, CODEGEN_SCRIPT);
  if (!context.check) {
    tool(context, "node", [script]);
    return [];
  }
  const status = context.exec({ program: "node", args: [script, "--check"], cwd: context.repoRoot });
  if (status === EXIT_OK) return [];
  if (status === EXIT_FAILED) return [{ path: DB_TYPES, reason: "codegen --check" }];
  throw new ContractsError(`node ${CODEGEN_SCRIPT} --check exited ${status}`);
}

/** Copies in crates/gto-library/schemas with no source: removed on a run, stale under --check. */
function orphanCopies(context, copies) {
  const copyDir = join(context.repoRoot, SCHEMA_COPY_DIR);
  if (!existsSync(copyDir)) return [];
  const known = new Set(copies.map((schema) => schema.name));
  const orphans = readdirSync(copyDir).filter((name) => name.endsWith(SCHEMA_SUFFIX) && !known.has(name));
  if (context.check) return orphans.map((name) => ({ path: `${SCHEMA_COPY_DIR}/${name}`, reason: `no source under ${SCHEMA_SOURCE_DIR}` }));
  for (const name of orphans) {
    unlinkSync(join(copyDir, name));
    context.log.info(`contracts: removed ${SCHEMA_COPY_DIR}/${name}`);
  }
  return [];
}

function schemaCopies(context) {
  const copies = listSchemaCopies(context.repoRoot);
  for (const { source, copy } of copies) writeLf(context.output(copy), readFileSync(join(context.repoRoot, source), "utf8"));
  return orphanCopies(context, copies);
}

const STEPS = [
  { name: "solver-query openapi document", run: solverQueryDocument },
  { name: "api openapi document", run: apiDocument },
  { name: "openapi-typescript types", run: typescriptTypes },
  { name: "kysely types", run: kyselyTypes },
  { name: "schema copies", run: schemaCopies },
];

/** Runs one step; a ContractsError is rethrown with the step name in front. */
function runStep(step, context) {
  context.log.info(`contracts: ${step.name}`);
  try {
    return step.run(context);
  } catch (error) {
    if (error instanceof ContractsError) throw new ContractsError(`${step.name}: ${error.message}`);
    throw error;
  }
}

/** The stale targets in pipeline order: the compared files, then what the steps reported themselves. */
function staleTargets(root, outRoot, reported) {
  const all = targets(root);
  const fromSteps = new Map(reported.map((entry) => [entry.path, entry]));
  const compared = all.flatMap((target) => {
    if (fromSteps.has(target)) return [fromSteps.get(target)];
    if (target === DB_TYPES) return []; // codegen --check compared it itself
    const { stale, reason } = compareTarget(join(root, target), join(outRoot, target));
    return stale ? [{ path: target, reason }] : [];
  });
  return [...compared, ...reported.filter((entry) => !all.includes(entry.path))];
}

/**
 * Runs the pipeline. `exec({ program, args, cwd })` runs one tool and returns its exit status
 * (program is cargo, pnpm or node); `log` has info and error. Returns the exit code.
 */
export function runPipeline({ repoRoot: root, check, exec, log }) {
  const outRoot = check ? mkdtempSync(join(tmpdir(), "contracts-")) : root;
  const output = (relativePath) => {
    const path = join(outRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  };
  try {
    const context = { repoRoot: root, outRoot, check, exec, log, output };
    const reported = STEPS.flatMap((step) => runStep(step, context));
    if (!check) {
      for (const target of targets(root)) log.info(`contracts: wrote ${target}`);
      return EXIT_OK;
    }
    const stale = staleTargets(root, outRoot, reported);
    if (stale.length === 0) {
      log.info("contracts: every target is up to date");
      return EXIT_OK;
    }
    for (const { path, reason } of stale) log.error(`contracts: stale ${path} (${reason})`);
    log.error(`contracts: ${stale.length} stale target${stale.length === 1 ? "" : "s"}; run just contracts and commit the result`);
    return EXIT_FAILED;
  } catch (error) {
    if (!(error instanceof ContractsError)) throw error;
    log.error(`contracts: ${error.name}: ${error.message}`);
    return EXIT_FAILED;
  } finally {
    if (check) rmSync(outRoot, { recursive: true, force: true });
  }
}

function spawnOptions(cwd) {
  return { cwd, stdio: "inherit", windowsHide: true, env: process.env };
}

function cargoCandidates() {
  const name = process.platform === "win32" ? "cargo.exe" : "cargo";
  return [name, join(homedir(), ".cargo", "bin", name)];
}

function runCargo(args, cwd) {
  for (const cargo of cargoCandidates()) {
    const result = spawnSync(cargo, args, { ...spawnOptions(cwd), shell: false });
    if (result.error && result.error.code === "ENOENT") continue;
    if (result.error) throw new ContractsError(`could not run ${cargo}: ${result.error.message}`);
    return result.status ?? EXIT_FAILED;
  }
  throw new ContractsError(`cargo not found on PATH or in ${join(homedir(), ".cargo", "bin")}`);
}

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, { ...spawnOptions(cwd), shell: false });
  if (result.error) throw new ContractsError(`could not run node: ${result.error.message}`);
  return result.status ?? EXIT_FAILED;
}

function shellArgument(value) {
  if (UNSAFE_ARGUMENT.test(value)) throw new ContractsError(`argument ${JSON.stringify(value)} holds a character the shell would interpret`);
  return value.includes(" ") ? `"${value}"` : value;
}

function runPnpm(args, cwd) {
  const command = ["pnpm", ...args.map(shellArgument)].join(" ");
  const result = spawnSync(command, { ...spawnOptions(cwd), shell: true });
  if (result.error) throw new ContractsError(`could not run pnpm: ${result.error.message}`);
  return result.status ?? EXIT_FAILED;
}

/** The real tool runner: cargo and node without a shell, pnpm through its shim. */
export function createExec() {
  const runners = { cargo: runCargo, node: runNode, pnpm: runPnpm };
  return ({ program, args, cwd }) => {
    const runner = runners[program];
    if (runner === undefined) throw new ContractsError(`unknown tool ${program}`);
    return runner(args, cwd);
  };
}

function main(argv) {
  const { check } = parseArgs(argv);
  return runPipeline({ repoRoot, check, exec: createExec(), log: { info: console.log, error: console.error } });
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ContractsError) {
      console.error(`contracts: ${error.message}`);
      process.exitCode = EXIT_USAGE;
    } else {
      throw error;
    }
  }
}
