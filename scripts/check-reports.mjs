#!/usr/bin/env node
// Report schema check (R0.11): validates every JSON (JavaScript Object Notation) report
// under validation/reports/ against validation/reports/report.schema.json with ajv (draft
// 2020-12) and requires pass: true on every report other than the bench baseline.
// `just report-check` runs it locally and in the ts job; scripts/check-reports.test.mjs
// covers it under `pnpm run test:scripts`.
//
// Command-line contract (scripts/check-reports.test.mjs fixes it):
//   node scripts/check-reports.mjs [DIR]
// DIR defaults to validation/reports under the repository root; every *.json file directly
// under it is a report (report.schema.json itself is not one and is left out). On success
// one line is printed to standard output, "check-reports: <n> reports valid (R0.11)", and
// the exit code is 0. Each failure prints "check-reports: <file>: <reason>" to standard
// error, naming the offending field (for example "pass is missing" or "commit does not
// match ^[0-9a-f]{40}$"), and the exit code is 1. A directory that cannot be read, or a
// schema that cannot be read or compiled, exits 2.
//
// Mechanism: the schema is compiled once by Ajv2020 in strict mode with allErrors, so one
// run lists every broken field of every report. strictRequired is the one strict rule
// switched off: it wants every name in a required list defined beside it, and the schema's
// anyOf branches (threshold max or min, measurement value or mean_ns) name properties the
// parent defines, which is valid draft 2020-12. Each file is read, parsed and validated;
// ajv errors are turned into "<field> <problem>" reasons. The if/then/else wrapper error
// is dropped because the error inside the branch already names the field. The schema
// leaves pass optional in type terms, so the pass rule (pass must be true on a gate
// report) is checked here after the schema passes.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_CANNOT_RUN = 2;
const PREFIX = "check-reports:";
const SCHEMA_FILE = "report.schema.json";
const BENCH_REPORT_ID = "bench";
const REPORT_EXTENSION = ".json";
// Keywords whose error only says that a sub-schema failed; the nested error names the field.
const WRAPPER_KEYWORDS = new Set(["if"]);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = join(repoRoot, "validation", "reports");
const schemaPath = join(reportsDir, SCHEMA_FILE);

function compileSchema() {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  return ajv.compile(schema);
}

/** "/measurements/0/value" becomes "measurements[0].value"; the root becomes "report". */
function fieldName(instancePath) {
  if (instancePath === "") return "report";
  return instancePath
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((name, part) => {
      if (/^\d+$/.test(part)) return `${name}[${part}]`;
      return name === "" ? part : `${name}.${part}`;
    }, "");
}

function reasonFor(error) {
  const field = fieldName(error.instancePath);
  if (error.keyword === "required") {
    const missing = error.params.missingProperty;
    return error.instancePath === "" ? `${missing} is missing` : `${field}.${missing} is missing`;
  }
  if (error.keyword === "pattern") return `${field} does not match ${error.params.pattern}`;
  if (error.keyword === "false schema") return `${field} is not allowed here`;
  if (error.keyword === "additionalProperties") {
    return `${field} has an unknown field ${error.params.additionalProperty}`;
  }
  return `${field} ${error.message}`;
}

function schemaReasons(validate, report) {
  if (validate(report)) return [];
  const reasons = (validate.errors ?? [])
    .filter((error) => !WRAPPER_KEYWORDS.has(error.keyword))
    .map(reasonFor);
  return [...new Set(reasons)];
}

function passReasons(report) {
  if (report.report === BENCH_REPORT_ID) return [];
  return report.pass === true ? [] : ["pass is not true: a gate report on record must pass"];
}

function checkReport(validate, path) {
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return [`cannot be read as JSON: ${error.message}`];
  }
  const reasons = schemaReasons(validate, report);
  return reasons.length > 0 ? reasons : passReasons(report);
}

function listReports(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(REPORT_EXTENSION))
    .filter((entry) => entry.name !== SCHEMA_FILE)
    .map((entry) => entry.name)
    .sort();
}

function main() {
  const dir = process.argv[2] ? resolve(process.argv[2]) : reportsDir;
  let names;
  try {
    names = listReports(dir);
  } catch (error) {
    console.error(`${PREFIX} ${dir}: cannot read the directory: ${error.message}`);
    return EXIT_CANNOT_RUN;
  }
  if (names.length === 0) {
    console.error(`${PREFIX} ${dir}: no *.json report to check`);
    return EXIT_FINDINGS;
  }
  let validate;
  try {
    validate = compileSchema();
  } catch (error) {
    console.error(`${PREFIX} ${schemaPath}: cannot compile the schema: ${error.message}`);
    return EXIT_CANNOT_RUN;
  }
  const failures = names.flatMap((name) =>
    checkReport(validate, join(dir, name)).map((reason) => `${PREFIX} ${name}: ${reason}`),
  );
  failures.forEach((line) => console.error(line));
  if (failures.length > 0) return EXIT_FINDINGS;
  console.log(`${PREFIX} ${names.length} reports valid (R0.11)`);
  return EXIT_OK;
}

process.exitCode = main();
