// R3.3, O-40, O-87: the perf-zenbook.json report just perf writes. The report is validated
// through the same Ajv 2020 schema compile check-reports uses, and the written file is then run
// through scripts/check-reports.mjs itself, so the report and the checker cannot drift apart.
// node:test, run by `pnpm run test:scripts`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PERF_PATHS,
  R_IDS,
  REPORT_KIND,
  buildPerfReport,
  reportFileName,
  reportSchemaErrors,
  writePerfReport,
} from "../perf/report.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK_REPORTS = join(REPO_ROOT, "scripts", "check-reports.mjs");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const DATE = "2026-10-27T18:00:00.000Z";
const MACHINE = { name: "zenbook", os: "win32 10.0.26200", cpu: "test cpu", cores: 20, memory_gb: 32 };
const SAMPLES = 200;
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
/** The O-40 limits in milliseconds, twice the A9 section 6 budgets. */
const O40 = { "study-node": 300, grade: 60, "decision-feedback": 500 };

/** 200 samples whose nearest-rank p95 (rank 190) is exactly `p95`. */
function samplesWithP95(p95) {
  return Array.from({ length: SAMPLES }, (_, index) => (index < 190 ? p95 * ((index + 1) / 190) : p95 + index));
}

function timings({ study = 120, grade = 20, decision = 200 } = {}) {
  return {
    "study-node": samplesWithP95(study),
    grade: samplesWithP95(grade),
    "decision-feedback": samplesWithP95(decision),
  };
}

const RUN = {
  base_url: "https://localhost",
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  warmup_per_path: 20,
  samples_per_path: SAMPLES,
  study_targets: 15,
};

function report(timingOverrides) {
  return buildPerfReport({ machine: MACHINE, commit: COMMIT, date: DATE, timings: timings(timingOverrides), run: RUN });
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "perf-report-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("R3.3 the paths and their thresholds are the three O-40 limits", () => {
  assert.deepEqual(Object.fromEntries(PERF_PATHS.map((path) => [path.id, path.thresholdMs])), O40);
});

test("R3.3 buildPerfReport: envelope, judged p95 per path, thresholds, pass", () => {
  const built = report();
  assert.equal(built.report, REPORT_KIND);
  assert.equal(REPORT_KIND, "perf");
  assert.deepEqual(built.r_ids, R_IDS);
  assert.deepEqual(R_IDS, ["R3.3"]);
  assert.deepEqual(built.machine, MACHINE);
  assert.equal(built.commit, COMMIT);
  assert.equal(built.date, DATE);
  assert.equal(built.pass, true);
  for (const [id, limit] of Object.entries(O40)) {
    const p95 = built.measurements.find((entry) => entry.id === `${id}/p95`);
    assert.equal(p95.unit, "ms");
    assert.equal(p95.pass, true);
    assert.deepEqual(p95.threshold, { max: limit, unit: "ms" });
    assert.deepEqual(built.thresholds[`${id}/p95`], { max: limit, unit: "ms" });
    assert.equal(p95.samples, SAMPLES);
    for (const informational of ["p50", "max"]) {
      const entry = built.measurements.find((candidate) => candidate.id === `${id}/${informational}`);
      assert.equal(entry.unit, "ms");
      assert.equal("pass" in entry, false);
    }
  }
  assert.equal(built.measurements.find((entry) => entry.id === "grade/p95").value, 20);
  assert.equal(built.samples_per_path, SAMPLES);
  assert.equal(built.warmup_per_path, 20);
  assert.equal(built.timings_ms.grade.length, SAMPLES);
  assert.match(built.notes, /nearest rank/);
  assert.deepEqual(reportSchemaErrors(built), []);
});

test("R3.3 a p95 at its limit passes, one above fails and so does the report", () => {
  assert.equal(report({ grade: 60 }).pass, true);
  const over = report({ grade: 60.5 });
  assert.equal(over.pass, false);
  assert.equal(over.measurements.find((entry) => entry.id === "grade/p95").pass, false);
  assert.equal(over.measurements.find((entry) => entry.id === "study-node/p95").pass, true);
  assert.deepEqual(reportSchemaErrors(over), []);
});

test("R3.3 buildPerfReport refuses a path with no samples", () => {
  assert.throws(
    () => buildPerfReport({ machine: MACHINE, commit: COMMIT, date: DATE, timings: { ...timings(), grade: [] }, run: RUN }),
    /grade/,
  );
});

test("R3.3 reportSchemaErrors names the broken field of an invalid report", () => {
  const built = report();
  assert.match(reportSchemaErrors({ ...built, commit: "abc" }).join("\n"), /commit/);
  assert.match(reportSchemaErrors({ ...built, date: "yesterday" }).join("\n"), /date/);
  const withoutThresholds = Object.fromEntries(Object.entries(built).filter(([key]) => key !== "thresholds"));
  assert.match(reportSchemaErrors(withoutThresholds).join("\n"), /thresholds/);
});

test("R3.3 the written report passes scripts/check-reports.mjs; a failing one is rejected", () => {
  const path = writePerfReport(report(), dir);
  assert.equal(path, join(dir, reportFileName(MACHINE.name)));
  assert.equal(reportFileName("zenbook"), "perf-zenbook.json");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).measurements.length, 9);
  const ok = spawnSync(process.execPath, [CHECK_REPORTS, dir], { encoding: "utf8" });
  assert.equal(ok.status, EXIT_OK, ok.stderr);

  writePerfReport(report({ decision: 900 }), dir);
  const failed = spawnSync(process.execPath, [CHECK_REPORTS, dir], { encoding: "utf8" });
  assert.equal(failed.status, EXIT_FINDINGS);
  assert.match(failed.stderr, /pass is not true/);
});
