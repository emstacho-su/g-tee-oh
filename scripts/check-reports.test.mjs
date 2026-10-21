// Tests for scripts/check-reports.mjs (R0.11, R2.13): the command runs over temporary report
// directories built from the committed bench baseline and from a synthetic gate report, so
// the schema rules and the pass rule are checked end to end. node:test, run by
// `pnpm run test:scripts` (just ts-test). The script is called as a child process, so these
// tests fix its command-line contract and not its internals. S16 adds the bench budget
// (plan D.7, O-154, O-86): a bench report whose grade/warm_cache measurement carries a
// p95_ns above 30,000,000 ns fails, naming the id and the field.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-reports.mjs");
const REPO_ROOT = resolve(dirname(SCRIPT), "..");
const BENCH_REPORT = join(REPO_ROOT, "validation", "reports", "bench-zenbook.json");
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
/** The grade bench id and its p95 budget in nanoseconds (A9 section 6: 30 ms warm). */
const GRADE_ID = "grade/warm_cache";
const GRADE_P95_BUDGET_NS = 30_000_000;
const OVER_BUDGET_NS = GRADE_P95_BUDGET_NS + 1_000_000;
const UNDER_BUDGET_NS = GRADE_P95_BUDGET_NS - 5_000_000;

/** The committed bench baseline with one grade/warm_cache measurement at the given p95. */
function benchReportWithGrade(p95Ns) {
  const report = JSON.parse(readFileSync(BENCH_REPORT, "utf8"));
  const grade = { id: GRADE_ID, mean_ns: 20_000_000, median_ns: 19_000_000, p95_ns: p95Ns, unit: "ns", stub: false };
  const measurements = [...report.measurements.filter((entry) => entry.id !== GRADE_ID), grade];
  return { ...report, measurements };
}

/** A gate report that follows every rule of report.schema.json and passes. */
function validGateReport() {
  return {
    report: "g1-kuhn",
    r_ids: ["R2.4"],
    machine: { name: "test-machine", os: "test 1.0", cpu: "test cpu", cores: 4, memory_gb: 8 },
    commit: COMMIT,
    date: "2026-10-20T18:00:00Z",
    toolchain: "rustc 1.99.1 (test)",
    pass: true,
    thresholds: { "kuhn/standard/nash-conv": { max: 0.001, unit: "chips" } },
    measurements: [
      {
        id: "kuhn/standard/nash-conv",
        value: 0.0001,
        unit: "chips",
        threshold: { max: 0.001, unit: "chips" },
        pass: true,
      },
    ],
    notes: "synthetic report for the test",
  };
}

function run(dir) {
  const result = spawnSync(process.execPath, [SCRIPT, dir], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.error, undefined, "the script starts");
  return result;
}

function writeReport(dir, name, report) {
  writeFileSync(join(dir, name), `${JSON.stringify(report, null, 2)}\n`);
}

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-reports-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("R0.11 accepts the committed bench-zenbook.json", () => {
  copyFileSync(BENCH_REPORT, join(dir, "bench-zenbook.json"));
  const result = run(dir);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.stdout, /check-reports: 1 reports? valid/);
});

test("R0.11 accepts a gate report that follows the envelope and passes", () => {
  writeReport(dir, "g1-kuhn.json", validGateReport());
  const result = run(dir);
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("R0.11 rejects a gate report without pass", () => {
  const withoutPass = Object.fromEntries(
    Object.entries(validGateReport()).filter(([key]) => key !== "pass"),
  );
  writeReport(dir, "g1-kuhn.json", withoutPass);
  const result = run(dir);
  assert.equal(result.status, EXIT_FINDINGS);
  assert.match(result.stderr, /g1-kuhn\.json/);
  assert.match(result.stderr, /pass/);
});

test("R0.11 rejects a gate report whose pass is false", () => {
  writeReport(dir, "g1-kuhn.json", { ...validGateReport(), pass: false });
  const result = run(dir);
  assert.equal(result.status, EXIT_FINDINGS);
  assert.match(result.stderr, /g1-kuhn\.json/);
  assert.match(result.stderr, /pass/);
});

test("R0.11 rejects a bad commit", () => {
  writeReport(dir, "g1-kuhn.json", { ...validGateReport(), commit: "abc" });
  const result = run(dir);
  assert.equal(result.status, EXIT_FINDINGS);
  assert.match(result.stderr, /g1-kuhn\.json/);
  assert.match(result.stderr, /commit/);
});

test("R0.11 rejects a report whose pass is true while a measurement carries pass false", () => {
  const report = validGateReport();
  const failing = { ...report.measurements[0], value: 0.01, pass: false };
  writeReport(dir, "g1-kuhn.json", { ...report, measurements: [failing] });
  const result = run(dir);
  assert.equal(result.status, EXIT_FINDINGS);
  assert.match(
    result.stderr,
    /g1-kuhn\.json: pass is true but measurement kuhn\/standard\/nash-conv carries pass false/,
  );
});

test("R0.11 rejects a report whose pass is false while every judged measurement passes", () => {
  writeReport(dir, "g1-kuhn.json", { ...validGateReport(), pass: false });
  const result = run(dir);
  assert.equal(result.status, EXIT_FINDINGS);
  assert.match(result.stderr, /g1-kuhn\.json: pass is false but every judged measurement passes/);
});

test("R2.13 rejects a bench report whose grade/warm_cache p95_ns exceeds the 30 ms budget", () => {
  writeReport(dir, "bench-zenbook.json", benchReportWithGrade(OVER_BUDGET_NS));
  const result = run(dir);
  assert.equal(result.status, EXIT_FINDINGS, result.stdout);
  assert.match(result.stderr, /bench-zenbook\.json/);
  assert.match(result.stderr, /grade\/warm_cache/);
  assert.match(result.stderr, /p95_ns/);
});

test("R2.13 accepts a bench report whose grade/warm_cache p95_ns is under the budget", () => {
  writeReport(dir, "bench-zenbook.json", benchReportWithGrade(UNDER_BUDGET_NS));
  const result = run(dir);
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("R0.11 accepts a passing report whose informational measurements carry no pass", () => {
  const report = validGateReport();
  const informational = { id: "kuhn/standard/iterations", value: 5000, unit: "iterations" };
  writeReport(dir, "g1-kuhn.json", {
    ...report,
    measurements: [...report.measurements, informational],
  });
  const result = run(dir);
  assert.equal(result.status, EXIT_OK, result.stderr);
});
