#!/usr/bin/env node
// Benchmark report (R0.10): folds the latest criterion run into one JSON (JavaScript Object
// Notation) baseline, validation/reports/bench-<machine>.json, in the format
// validation/reports/README.md describes.
//
// Mechanism: criterion writes target/criterion/<group>/<function>/new/estimates.json after
// every run, with the mean and the median of the measured time as point estimates in
// nanoseconds, and benchmark.json beside it carrying the full bench id "<group>/<function>".
// This script walks target/criterion for every new/estimates.json, reads both files, adds
// the machine, the commit and the toolchain, and writes the report. It refuses to write when
// no estimate exists, so `just bench` cannot produce an empty report, and when one of the
// three R0.10 targets is missing, so a partial run cannot overwrite a complete baseline.
// `just bench` runs it after `cargo bench -p gto-solve -p gto-library`; Node only, no npm
// packages.
//
// BENCH_MACHINE=<name> changes the machine name and the output file name; the default is
// zenbook (the Mac baseline from S20 onward uses another name).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPORT_KIND = "bench";
export const R_IDS = ["R0.10"];
export const DEFAULT_MACHINE = "zenbook";
// The three targets A9 section 1 names, by criterion id; the two stubs are replaced in S14.
export const EXPECTED_IDS = ["chunk_decode/stub", "node_read/stub", "solve_iteration/simple_tree_flop"];
const STUB_SUFFIX = "/stub";
const ESTIMATES_FILE = "estimates.json";
const BENCHMARK_FILE = "benchmark.json";
const LATEST_RUN_DIR = "new";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const BYTES_PER_GIB = 2 ** 30;
const NS_PER_US = 1e3;
const NS_PER_MS = 1e6;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A report that must not be written; main prints the message and exits 1. */
export class ReportError extends Error {}

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ReportError(`cannot read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ReportError(`${path} is not valid JSON: ${error.message}`);
  }
}

/** Every <...>/new/estimates.json under root, sorted; an absent root yields none. */
export function findEstimateFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name === ESTIMATES_FILE && basename(dir) === LATEST_RUN_DIR) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort();
}

/** The bench id from the directory path when benchmark.json is absent. */
function idFromPath(estimatesPath, root) {
  const benchDir = dirname(dirname(estimatesPath));
  return relative(root, benchDir).split(sep).join("/");
}

function pointEstimate(estimates, field, path) {
  const value = estimates?.[field]?.point_estimate;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ReportError(`${path}: ${field}.point_estimate is not a positive number`);
  }
  return value;
}

/** One measurement from an estimates.json and the benchmark.json beside it. */
export function readMeasurement(estimatesPath, root) {
  const estimates = readJson(estimatesPath);
  const benchmarkPath = join(dirname(estimatesPath), BENCHMARK_FILE);
  const id = existsSync(benchmarkPath)
    ? readJson(benchmarkPath).full_id
    : idFromPath(estimatesPath, root);
  if (typeof id !== "string" || id.length === 0) {
    throw new ReportError(`${benchmarkPath}: full_id is missing`);
  }
  return {
    id,
    mean_ns: pointEstimate(estimates, "mean", estimatesPath),
    median_ns: pointEstimate(estimates, "median", estimatesPath),
    unit: "ns",
    stub: id.endsWith(STUB_SUFFIX),
  };
}

/**
 * Every measurement under root, sorted by id. Throws when there is none, when an id
 * appears twice (a stale directory from a renamed bench) or when an expected id is absent.
 */
export function collectMeasurements(root, expectedIds = EXPECTED_IDS) {
  const files = findEstimateFiles(root);
  if (files.length === 0) {
    throw new ReportError(`no ${LATEST_RUN_DIR}/${ESTIMATES_FILE} under ${root}; run cargo bench first, nothing written`);
  }
  const measurements = files.map((file) => readMeasurement(file, root));
  measurements.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set();
  for (const { id } of measurements) {
    if (seen.has(id)) {
      throw new ReportError(`bench id ${id} appears twice under ${root}; delete the stale directory`);
    }
    seen.add(id);
  }
  const missing = expectedIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new ReportError(`missing bench ids ${missing.join(", ")}; run every target before reporting, nothing written`);
  }
  return measurements;
}

/** The machine block: name, operating system, first CPU model, logical cores, memory. */
export function machineInfo(name) {
  const cpus = os.cpus();
  return {
    name,
    os: `${os.platform()} ${os.release()}`,
    cpu: cpus[0]?.model?.trim() ?? "unknown",
    cores: cpus.length,
    memory_gb: Math.round(os.totalmem() / BYTES_PER_GIB),
  };
}

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", shell: false });
  if (result.error) {
    throw new ReportError(`cannot run ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new ReportError(`${label} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function gitCommit() {
  const commit = run("git", ["rev-parse", "HEAD"], "git rev-parse HEAD");
  if (!COMMIT_PATTERN.test(commit)) {
    throw new ReportError(`git rev-parse HEAD returned ${JSON.stringify(commit)}, not a commit hash`);
  }
  return commit;
}

/** rustc from PATH, or from ~/.cargo/bin when a shell has not added it to PATH. */
export function rustcVersion() {
  const onPath = process.platform === "win32" ? "rustc.exe" : "rustc";
  const inHome = join(os.homedir(), ".cargo", "bin", onPath);
  let lastError = null;
  for (const rustc of [onPath, inHome]) {
    try {
      return run(rustc, ["--version"], `${rustc} --version`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** The report envelope, field order as documented in validation/reports/README.md. */
export function buildReport({ machine, commit, date, toolchain, measurements }) {
  return {
    report: REPORT_KIND,
    r_ids: R_IDS,
    machine,
    commit,
    date,
    toolchain,
    measurements,
  };
}

/** A duration in nanoseconds at a readable scale (ns, us or ms) for the log line. */
export function formatDuration(ns) {
  if (ns < NS_PER_US) {
    return `${ns.toFixed(1)} ns`;
  }
  if (ns < NS_PER_MS) {
    return `${(ns / NS_PER_US).toFixed(3)} us`;
  }
  return `${(ns / NS_PER_MS).toFixed(3)} ms`;
}

/** A repo-relative path with forward slashes on every platform, for the log line. */
function displayPath(path) {
  return relative(repoRoot, path).split(sep).join("/");
}

function main() {
  const machineName = process.env.BENCH_MACHINE?.trim() || DEFAULT_MACHINE;
  const criterionRoot = join(repoRoot, "target", "criterion");
  const outPath = join(repoRoot, "validation", "reports", `bench-${machineName}.json`);

  const measurements = collectMeasurements(criterionRoot);
  const report = buildReport({
    machine: machineInfo(machineName),
    commit: gitCommit(),
    date: new Date().toISOString(),
    toolchain: rustcVersion(),
    measurements,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const m of measurements) {
    const tag = m.stub ? " (stub)" : "";
    console.log(`bench-report: ${m.id}${tag} mean ${formatDuration(m.mean_ns)} median ${formatDuration(m.median_ns)}`);
  }
  console.log(`bench-report: wrote ${displayPath(outPath)} at ${report.commit.slice(0, 7)} (${R_IDS.join(", ")})`);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    if (error instanceof ReportError) {
      console.error(`bench-report: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
