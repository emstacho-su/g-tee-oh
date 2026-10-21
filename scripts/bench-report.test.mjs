// Tests for scripts/bench-report.mjs (R0.10, R2.7): the report is assembled from a synthetic
// target/criterion tree in a temporary directory, so no benchmark has to run. node:test,
// run by `pnpm run test:scripts` (just ts-test).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  EXPECTED_IDS,
  R_IDS,
  ReportError,
  buildReport,
  collectMeasurements,
  findEstimateFiles,
  formatDuration,
  machineInfo,
  readMeasurement,
} from "./bench-report.mjs";

/** The five v1 ids with made-up times; a full run writes every one of them. */
const FULL_RUN = {
  "chunk_decode/postflop_1326_sparse": { mean: 9800.5, median: 9700 },
  "chunk_decode/preflop_169": { mean: 1500.25, median: 1480 },
  "node_read/cold_cache": { mean: 2200, median: 2100 },
  "node_read/warm_cache": { mean: 95.5, median: 95 },
  "solve_iteration/simple_tree_flop": { mean: 21_500_000.5, median: 21_000_000 },
};

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-report-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Writes one criterion result directory:
 * <root>/<group>/<function>/<run>/{estimates,benchmark}.json.
 */
function writeResult(id, { mean, median, run = "new", withBenchmarkJson = true }) {
  const dir = join(root, ...id.split("/"), run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "estimates.json"),
    JSON.stringify({
      mean: { confidence_interval: {}, point_estimate: mean, standard_error: 1 },
      median: { confidence_interval: {}, point_estimate: median, standard_error: 1 },
    }),
  );
  if (withBenchmarkJson) {
    const [group, fn] = id.split("/");
    writeFileSync(
      join(dir, "benchmark.json"),
      JSON.stringify({ group_id: group, function_id: fn, full_id: id, directory_name: id }),
    );
  }
}

/** Writes every id of FULL_RUN except those in `except`. */
function writeFullRun(except = []) {
  for (const [id, times] of Object.entries(FULL_RUN)) {
    if (!except.includes(id)) {
      writeResult(id, times);
    }
  }
}

test("R0.10 bench-report reads the latest run only and sorts measurements by id", () => {
  writeFullRun();
  // A previous run and criterion's own report directory must be ignored.
  writeResult("node_read/warm_cache", { mean: 99, median: 99, run: "base" });
  mkdirSync(join(root, "report"), { recursive: true });
  writeFileSync(join(root, "report", "index.html"), "<html></html>");

  const files = findEstimateFiles(root);
  assert.equal(files.length, 5);
  assert.ok(files.every((file) => file.endsWith(join("new", "estimates.json"))));

  const measurements = collectMeasurements(root);
  assert.deepEqual(
    measurements.map((m) => m.id),
    EXPECTED_IDS,
  );
  assert.deepEqual(measurements[4], {
    id: "solve_iteration/simple_tree_flop",
    mean_ns: 21_500_000.5,
    median_ns: 21_000_000,
    unit: "ns",
    stub: false,
  });
  assert.deepEqual(measurements[3], {
    id: "node_read/warm_cache",
    mean_ns: 95.5,
    median_ns: 95,
    unit: "ns",
    stub: false,
  });
});

test("R2.7 bench-report expects the S14 chunk decode and node read ids, sorted, no stub", () => {
  assert.deepEqual(EXPECTED_IDS, [
    "chunk_decode/postflop_1326_sparse",
    "chunk_decode/preflop_169",
    "node_read/cold_cache",
    "node_read/warm_cache",
    "solve_iteration/simple_tree_flop",
  ]);
  assert.deepEqual([...EXPECTED_IDS].sort(), EXPECTED_IDS);
  assert.ok(EXPECTED_IDS.every((id) => !id.endsWith("/stub")));
});

test("R0.10 bench-report marks every id ending in /stub and nothing else", () => {
  writeFullRun();
  writeResult("later_target/stub", { mean: 12.5, median: 12 });
  const byId = new Map(collectMeasurements(root).map((m) => [m.id, m.stub]));
  assert.equal(byId.get("later_target/stub"), true);
  for (const id of EXPECTED_IDS) {
    assert.equal(byId.get(id), false, id);
  }
});

test("R0.10 bench-report refuses to report when no estimate exists", () => {
  assert.throws(() => collectMeasurements(root), (error) => {
    assert.ok(error instanceof ReportError);
    assert.match(error.message, /run cargo bench first, nothing written/);
    return true;
  });
  assert.deepEqual(findEstimateFiles(join(root, "absent")), []);
});

test("R0.10 bench-report refuses a partial run and names every missing target", () => {
  writeFullRun(["solve_iteration/simple_tree_flop"]);
  assert.throws(() => collectMeasurements(root), (error) => {
    assert.ok(error instanceof ReportError);
    assert.match(error.message, /missing bench ids solve_iteration\/simple_tree_flop/);
    return true;
  });
  rmSync(join(root, "node_read"), { recursive: true, force: true });
  assert.throws(() => collectMeasurements(root), (error) => {
    assert.match(error.message, /^missing bench ids node_read\/cold_cache, /);
    assert.ok(EXPECTED_IDS.slice(2).every((id) => error.message.includes(id)), error.message);
    return true;
  });
  assert.equal(EXPECTED_IDS.length, 5);
});

test("R0.10 bench-report rejects an estimate that is not a positive number", () => {
  writeFullRun();
  writeResult("chunk_decode/preflop_169", { mean: 0, median: 1480 });
  assert.throws(() => collectMeasurements(root), /mean\.point_estimate is not a positive number/);
});

test("R0.10 bench-report derives the id from the path when benchmark.json is absent", () => {
  writeResult("node_read/warm_cache", { mean: 12, median: 12, withBenchmarkJson: false });
  const [file] = findEstimateFiles(root);
  assert.equal(readMeasurement(file, root).id, "node_read/warm_cache");
});

test("R0.10 bench-report prints durations at a readable scale", () => {
  assert.equal(formatDuration(21), "21.0 ns");
  assert.equal(formatDuration(4581.6), "4.582 us");
  assert.equal(formatDuration(42_333_000), "42.333 ms");
});

test("R0.10 bench-report builds the documented envelope in field order", () => {
  const machine = machineInfo("zenbook");
  assert.equal(machine.name, "zenbook");
  assert.ok(machine.cores >= 1);
  assert.ok(machine.memory_gb >= 1);
  assert.equal(typeof machine.cpu, "string");
  assert.match(machine.os, /^\S+ \S+/);

  const report = buildReport({
    machine,
    commit: "0123456789abcdef0123456789abcdef01234567",
    date: "2026-10-20T12:00:00.000Z",
    toolchain: "rustc 1.99.1",
    measurements: [],
  });
  const fieldOrder = ["report", "r_ids", "machine", "commit", "date", "toolchain", "measurements"];
  assert.deepEqual(Object.keys(report), fieldOrder);
  assert.equal(report.report, "bench");
  assert.deepEqual(report.r_ids, R_IDS);
  assert.deepEqual(R_IDS, ["R0.10"]);
});
