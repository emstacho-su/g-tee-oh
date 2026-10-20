#!/usr/bin/env node
// Boundary check for the library-first rule (ADR 0018, success criterion 10): the query
// service must never be able to start a solve, so its dependency tree must not contain
// gto-solve or the vendored engine.
//
// Mechanism: `cargo tree -p solver-query -e normal --prefix none` prints one line per
// crate in the normal (non build, non dev) dependency closure of solver-query, with
// features resolved for that package alone. The first whitespace-delimited token of each
// line is the crate name. If any token is a forbidden crate the check fails with exit 1.
// `just rust-boundary` runs this script; it needs Node only, no npm packages.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE = "solver-query";
const FORBIDDEN = new Set(["gto-solve", "engine"]);
const CARGO_ARGS = ["tree", "-p", SERVICE, "-e", "normal", "--prefix", "none"];
// Second view: who depends on gto-solve when features are unified across the whole
// workspace. A workspace-wide build links whatever this inverse tree shows, so the service
// must not appear in it either (O-101).
const INVERSE_ARGS = ["tree", "--workspace", "-e", "normal", "-i", "gto-solve", "--prefix", "none"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function cargoCandidates() {
  const onPath = process.platform === "win32" ? "cargo.exe" : "cargo";
  const inHome = join(homedir(), ".cargo", "bin", onPath);
  return [onPath, inHome];
}

function runCargoTree(args = CARGO_ARGS) {
  let lastError = null;
  for (const cargo of cargoCandidates()) {
    const result = spawnSync(cargo, args, {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });
    if (result.error && result.error.code === "ENOENT") {
      lastError = result.error;
      continue;
    }
    return { cargo, result };
  }
  return { cargo: null, result: null, lastError };
}

function fail(message) {
  console.error(`boundary: ${message}`);
  process.exit(1);
}

function crateNames(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0]);
}

function main() {
  if (!existsSync(join(repoRoot, "Cargo.toml"))) {
    fail(`no Cargo.toml at ${repoRoot}; run from the repository checkout`);
  }

  const { cargo, result, lastError } = runCargoTree();
  if (result === null) {
    fail(`cargo not found on PATH or in ${join(homedir(), ".cargo", "bin")} (${lastError})`);
  }
  if (result.error) {
    fail(`could not run ${cargo}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${cargo} ${CARGO_ARGS.join(" ")} exited ${result.status}\n${result.stderr}`);
  }

  const names = crateNames(result.stdout);
  if (names.length === 0 || names[0] !== SERVICE) {
    fail(`unexpected cargo tree output, first line should name ${SERVICE}:\n${result.stdout}`);
  }

  const offenders = [...new Set(names.filter((name) => FORBIDDEN.has(name)))];
  if (offenders.length > 0) {
    fail(
      `${SERVICE} depends on ${offenders.join(", ")}; no request path may start a solve ` +
        `(ADR 0018). Full tree:\n${result.stdout}`,
    );
  }

  const inverse = runCargoTree(INVERSE_ARGS);
  if (inverse.result === null || inverse.result.error) {
    fail(`could not run ${cargo} ${INVERSE_ARGS.join(" ")}`);
  }
  if (inverse.result.status !== 0) {
    fail(`${cargo} ${INVERSE_ARGS.join(" ")} exited ${inverse.result.status}\n${inverse.result.stderr}`);
  }
  const dependents = crateNames(inverse.result.stdout);
  if (dependents.includes(SERVICE)) {
    fail(
      `${SERVICE} links gto-solve in a workspace-wide build (feature unification); ` +
        `the edge must not exist in any crate the service depends on (O-101). Inverse tree:\n${inverse.result.stdout}`,
    );
  }

  console.log(`boundary: ${SERVICE} does not depend on gto-solve, alone or in a workspace-wide build (ADR 0018)`);
}

main();
