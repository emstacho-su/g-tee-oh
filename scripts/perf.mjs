#!/usr/bin/env node
// just perf (R3.3, O-40, O-91, O-248, O-87): the 95th percentile latency (p95) of the three
// trainer paths on the running Compose dev stack, written to validation/reports/perf-<machine>.json.
//
//   node scripts/perf.mjs [--base-url URL] [--ca-file PATH] [--out-dir DIR]
//
// In order: Caddy's root certificate is copied out of the caddy container (or read from
// --ca-file) and trusted for these requests only; GET /api/v1/healthz must answer 200, else the
// run stops and says the stack is not up; a per-run owner is created through create-user in the
// api container with a random password on stdin; the flow of scripts/perf/flow.mjs logs in and
// takes 20 warm-up and 200 timed samples per path; the report is built, checked against
// report.schema.json, written, and scripts/check-reports.mjs runs on the output directory. The
// report is written even when a p95 is over its limit, so the miss is on record, and the exit
// code is then check-reports' 1. The caller brings the stack up and down (just dev-up,
// just db-migrate, just dev-down) and takes the bench lock: other heavy work moves the numbers.
// BENCH_MACHINE names the machine (default zenbook). Exit 0 on a passing report, 1 otherwise.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateOwnerPassword } from "../infra/compose/e2e-owner.mjs";
import { gitCommit, machineInfo, ReportError } from "./bench-report.mjs";
import { parsePerfArgs } from "./perf/args.mjs";
import { PerfError } from "./perf/errors.mjs";
import { DEFAULT_COUNTS, runPerf } from "./perf/flow.mjs";
import { createApiClient, httpsTransport } from "./perf/http.mjs";
import { buildPerfReport, reportSchemaErrors, writePerfReport } from "./perf/report.mjs";
import { checkStack, createPerfOwner, perfOwnerEmail, readCaddyRoot, readCaFile } from "./perf/stack.mjs";

const PREFIX = "perf:";
const EXIT_FAILED = 1;
const CHECK_REPORTS = join(dirname(fileURLToPath(import.meta.url)), "check-reports.mjs");
const LOG_DECIMALS = 1;

function log(message) {
  process.stdout.write(`${PREFIX} ${message}\n`);
}

function logMeasurements(report) {
  for (const entry of report.measurements.filter((candidate) => typeof candidate.pass === "boolean")) {
    const verdict = entry.pass ? "pass" : "FAIL";
    log(`${entry.id} ${entry.value.toFixed(LOG_DECIMALS)} ms (limit ${entry.threshold.max} ms) ${verdict}`);
  }
}

async function measure(args) {
  const ca = args.caFile === null ? readCaddyRoot() : readCaFile(args.caFile);
  const client = createApiClient({ baseUrl: args.baseUrl, transport: httpsTransport(ca) });
  await checkStack(client, args.baseUrl);
  const owner = { email: perfOwnerEmail(), password: generateOwnerPassword() };
  log(`create the owner ${owner.email} through create-user in the api container`);
  createPerfOwner(owner);
  log(`${DEFAULT_COUNTS.warmup} warm-up and ${DEFAULT_COUNTS.samples} timed samples per path through ${args.baseUrl}`);
  return runPerf(client, { owner, counts: DEFAULT_COUNTS, baseUrl: args.baseUrl });
}

async function main() {
  const args = parsePerfArgs(process.argv.slice(2), process.env);
  const { timings, run } = await measure(args);
  const report = buildPerfReport({
    machine: machineInfo(args.machine),
    commit: gitCommit(),
    date: new Date().toISOString(),
    timings,
    run,
  });
  const errors = reportSchemaErrors(report);
  if (errors.length > 0) throw new PerfError(`the report does not match report.schema.json: ${errors.join("; ")}`);
  const path = writePerfReport(report, args.outDir);
  logMeasurements(report);
  log(`wrote ${path} at ${report.commit.slice(0, 7)} (R3.3)`);
  const check = spawnSync(process.execPath, [CHECK_REPORTS, args.outDir], { stdio: "inherit", windowsHide: true });
  if (check.error) throw new PerfError(`cannot run check-reports: ${check.error.message}`);
  return check.status ?? EXIT_FAILED;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      if (error instanceof PerfError || error instanceof ReportError) {
        process.stderr.write(`${PREFIX} ${error.message}\n`);
        process.exitCode = EXIT_FAILED;
        return;
      }
      throw error;
    },
  );
}
