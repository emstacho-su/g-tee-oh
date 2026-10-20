#!/usr/bin/env node
// Report schema check (R0.11): validates every JSON (JavaScript Object Notation) report
// under validation/reports/ against validation/reports/report.schema.json with ajv (draft
// 2020-12) and requires pass: true on every report other than the bench baseline.
// `just report-check` runs it locally and in the ts job; scripts/check-reports.test.mjs
// covers it under `pnpm run test:scripts`.
//
// Contract the tests fix (S13 plan, task 7 fills the body):
//   node scripts/check-reports.mjs [DIR]
// DIR defaults to validation/reports; every *.json file directly under it is a report
// (report.schema.json itself is not one and is left out). On success one line is printed
// to standard output, "check-reports: <n> reports valid (R0.11)", and the exit code is 0.
// Each failure prints "check-reports: <file>: <reason>" to standard error, naming the
// offending field (for example "pass is missing" or "commit does not match
// ^[0-9a-f]{40}$"), and the exit code is 1. A directory that cannot be read exits 2.
//
// Stub: exits 1 with "not implemented" so `just report-check` and the tests stay red
// until the integrator fills it.

const EXIT_NOT_IMPLEMENTED = 1;

console.error("check-reports: not implemented");
process.exitCode = EXIT_NOT_IMPLEMENTED;
