// The perf report (R3.3, O-40, O-87): validation/reports/perf-<machine>.json in the envelope of
// validation/reports/report.schema.json, as validation/reports/README.md describes it.
//
// Three judged measurements, one per path, each the nearest-rank p95 of the timed samples in
// milliseconds against its O-40 limit (twice the A9 section 6 budgets): study node read 300 ms,
// grade 60 ms, decision to feedback 500 ms. A p95 at most its limit passes. The median and the
// maximum of each path are informational rows without pass. Every timed sample is kept, sorted,
// under timings_ms so a reader can recompute the percentiles, as the matrix frame report does.
//
// The schema check here compiles report.schema.json exactly as scripts/check-reports.mjs does
// (Ajv2020, strict, strictRequired off, allErrors), so a report that fails here fails there;
// scripts/perf.mjs then runs check-reports.mjs itself on the written file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import { PerfError } from "./errors.mjs";
import { summarize } from "./stats.mjs";

export const REPORT_KIND = "perf";
export const R_IDS = ["R3.3"];
export const UNIT = "ms";
/** The three paths and their O-40 limits in milliseconds. */
export const PERF_PATHS = [
  { id: "study-node", thresholdMs: 300, what: "study node read, client round trip of GET /study/node" },
  { id: "grade", thresholdMs: 60, what: "solver-query grade call, Server-Timing sq-grade of POST /sessions/{id}/decisions" },
  { id: "decision-feedback", thresholdMs: 500, what: "decision to feedback, client round trip of POST /sessions/{id}/decisions" },
];
const VALUE_DECIMALS = 3;
const VALUE_SCALE = 10 ** VALUE_DECIMALS;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaPath = join(repoRoot, "validation", "reports", "report.schema.json");

function round(value) {
  return Math.round(value * VALUE_SCALE) / VALUE_SCALE;
}

function thresholdOf(path) {
  return { max: path.thresholdMs, unit: UNIT };
}

function pathMeasurements(path, samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new PerfError(`path ${path.id} has no timed sample; nothing written`);
  }
  const summary = summarize(samples);
  const p95 = round(summary.p95);
  return [
    { id: `${path.id}/p95`, value: p95, unit: UNIT, threshold: thresholdOf(path), pass: p95 <= path.thresholdMs, samples: summary.samples },
    { id: `${path.id}/p50`, value: round(summary.p50), unit: UNIT },
    { id: `${path.id}/max`, value: round(summary.max), unit: UNIT },
  ];
}

function notesFor(run) {
  return [
    `Measured through Caddy at ${run.base_url} on the dev stack with a per-run owner (O-248, O-263).`,
    `${run.warmup_per_path} untimed warm-up and ${run.samples_per_path} timed samples per path, one request at a time.`,
    `Study reads cycle over ${run.study_targets} distinct nodes of ${run.config_id}; decisions run in one drill session on ${run.pair}.`,
    "Each p95 is the nearest rank, the value at rank ceil(0.95 n) of the samples sorted ascending, and passes at most its O-40 limit.",
  ].join(" ");
}

/** The report value; `timings` maps each path id to its timed samples in milliseconds. */
export function buildPerfReport({ machine, commit, date, timings, run }) {
  const measurements = PERF_PATHS.flatMap((path) => pathMeasurements(path, timings[path.id]));
  const judged = measurements.filter((entry) => typeof entry.pass === "boolean");
  return {
    report: REPORT_KIND,
    r_ids: R_IDS,
    machine,
    commit,
    date,
    pass: judged.every((entry) => entry.pass),
    thresholds: Object.fromEntries(PERF_PATHS.map((path) => [`${path.id}/p95`, thresholdOf(path)])),
    measurements,
    ...run,
    timings_ms: Object.fromEntries(PERF_PATHS.map((path) => [path.id, [...timings[path.id]].sort((a, b) => a - b).map(round)])),
    notes: notesFor(run),
  };
}

let validator = null;

function compiledSchema() {
  if (validator === null) {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    validator = new Ajv2020({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
  }
  return validator;
}

/** The schema errors of `report` as "<path> <message>" lines; empty when it validates. */
export function reportSchemaErrors(report) {
  const validate = compiledSchema();
  if (validate(report)) return [];
  return (validate.errors ?? []).map((error) => {
    const missing = error.keyword === "required" ? ` ${error.params.missingProperty}` : "";
    return `${error.instancePath || "report"} ${error.message}${missing}`;
  });
}

export function reportFileName(machineName) {
  return `${REPORT_KIND}-${machineName}.json`;
}

/** Writes the report into `outDir` as perf-<machine>.json and returns the path. */
export function writePerfReport(report, outDir) {
  const path = join(outDir, reportFileName(report.machine.name));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}
