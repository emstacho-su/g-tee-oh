// Tests for scripts/bench-report.mjs (R0.10, R2.7, R2.13): the report is assembled from a
// synthetic target/criterion tree in a temporary directory, so no benchmark has to run.
// node:test, run by `pnpm run test:scripts` (just ts-test). S16 adds the grade id
// grade/warm_cache (plan D.7, O-154): it joins EXPECTED_IDS so a run without it never
// overwrites the baseline, R_IDS gains R2.13, and a measurement carries p95_ns when
// criterion's new/sample.json sits beside estimates.json (per-iteration times, the nearest-rank
// 95th percentile, exported as p95Ns(sample)).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import * as benchReport from "./bench-report.mjs";
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

/** The eight v1 ids with made-up times; a full run writes every one of them. */
const FULL_RUN = {
  "chunk_decode/postflop_1326_sparse": { mean: 9800.5, median: 9700 },
  "chunk_decode/preflop_169": { mean: 1500.25, median: 1480 },
  "extract/runout_line": { mean: 3_400_000, median: 3_300_000 },
  "grade/warm_cache": { mean: 1_200_000, median: 1_100_000 },
  "node_read/cold_cache": { mean: 2200, median: 2100 },
  "node_read/warm_cache": { mean: 95.5, median: 95 },
  "plan/enumerate_pair": { mean: 8_000_000, median: 7_900_000 },
  "solve_iteration/simple_tree_flop": { mean: 21_500_000.5, median: 21_000_000 },
};
/** The grade bench id (plan D.7). */
const GRADE_ID = "grade/warm_cache";
/** The two library-builder ids S18 added (O-190). */
const BUILDER_IDS = ["extract/runout_line", "plan/enumerate_pair"];
/** Samples in the p95 fixture; the nearest-rank 95th percentile is the 19th smallest of 20. */
const P95_SAMPLES = 20;
const P95_RANK = 19;
const ITERS_PER_SAMPLE = 2;
const NS_PER_ITERATION_STEP = 1000;

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
function writeResult(id, { mean, median, run = "new", withBenchmarkJson = true, sample = null }) {
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
  if (sample !== null) {
    writeFileSync(join(dir, "sample.json"), JSON.stringify(sample));
  }
}

/**
 * A criterion sample.json whose per-iteration times are 1000, 2000, ... 20000 ns: every
 * sample ran ITERS_PER_SAMPLE iterations, so `times` carries the iteration time twice over.
 */
function p95Sample() {
  const iters = Array.from({ length: P95_SAMPLES }, () => ITERS_PER_SAMPLE);
  const iterationNs = (k) => (k + 1) * NS_PER_ITERATION_STEP;
  const times = Array.from({ length: P95_SAMPLES }, (_, k) => iterationNs(k) * ITERS_PER_SAMPLE);
  // Shuffled, so the percentile must sort.
  return { sampling_mode: "Linear", iters, times: [...times].reverse() };
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
  assert.equal(files.length, 8);
  assert.ok(files.every((file) => file.endsWith(join("new", "estimates.json"))));

  const measurements = collectMeasurements(root);
  assert.deepEqual(
    measurements.map((m) => m.id),
    EXPECTED_IDS,
  );
  assert.deepEqual(measurements[7], {
    id: "solve_iteration/simple_tree_flop",
    mean_ns: 21_500_000.5,
    median_ns: 21_000_000,
    unit: "ns",
    stub: false,
  });
  assert.deepEqual(measurements[5], {
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
    "extract/runout_line",
    "grade/warm_cache",
    "node_read/cold_cache",
    "node_read/warm_cache",
    "plan/enumerate_pair",
    "solve_iteration/simple_tree_flop",
  ]);
  assert.deepEqual([...EXPECTED_IDS].sort(), EXPECTED_IDS);
  assert.ok(EXPECTED_IDS.every((id) => !id.endsWith("/stub")));
});

test("R2.18 bench-report expects the planner and extraction ids and refuses a run without them", () => {
  assert.ok(BUILDER_IDS.every((id) => EXPECTED_IDS.includes(id)), EXPECTED_IDS.join(", "));
  writeFullRun(BUILDER_IDS);
  assert.throws(() => collectMeasurements(root), (error) => {
    assert.ok(error instanceof ReportError);
    assert.match(
      error.message,
      /missing bench ids extract\/runout_line, plan\/enumerate_pair; .*nothing written/,
    );
    return true;
  });
});

test("R2.13 bench-report expects grade/warm_cache and tags the report with R2.13", () => {
  assert.ok(EXPECTED_IDS.includes(GRADE_ID), EXPECTED_IDS.join(", "));
  assert.deepEqual(R_IDS, ["R0.10", "R2.13"]);
});

test("R2.13 bench-report reads p95_ns from sample.json beside the estimates", () => {
  const sample = p95Sample();
  // Read through the namespace so a missing export fails this test alone, not the file.
  assert.equal(typeof benchReport.p95Ns, "function", "bench-report.mjs exports p95Ns(sample)");
  assert.equal(benchReport.p95Ns(sample), P95_RANK * NS_PER_ITERATION_STEP);

  writeResult(GRADE_ID, { ...FULL_RUN[GRADE_ID], sample });
  writeResult("node_read/warm_cache", FULL_RUN["node_read/warm_cache"]);
  const [gradeFile, warmFile] = findEstimateFiles(root);
  const grade = readMeasurement(gradeFile, root);
  assert.equal(grade.id, GRADE_ID);
  assert.equal(grade.p95_ns, P95_RANK * NS_PER_ITERATION_STEP);
  assert.equal(grade.unit, "ns");
  const warm = readMeasurement(warmFile, root);
  assert.ok(!Object.hasOwn(warm, "p95_ns"), "no sample.json, no p95_ns");
});

test("R2.13 bench-report refuses a run missing the grade id and writes nothing", () => {
  writeFullRun([GRADE_ID]);
  assert.throws(() => collectMeasurements(root), (error) => {
    assert.ok(error instanceof ReportError);
    assert.match(error.message, /missing bench ids grade\/warm_cache; .*nothing written/);
    return true;
  });
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
    const nodeReadIds = EXPECTED_IDS.filter((id) => id.startsWith("node_read/"));
    assert.ok(nodeReadIds.every((id) => error.message.includes(id)), error.message);
    assert.ok(!error.message.includes(GRADE_ID), "the grade id is present in this run");
    return true;
  });
  assert.equal(EXPECTED_IDS.length, 8);
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
  assert.ok(R_IDS.includes("R0.10"));
});
