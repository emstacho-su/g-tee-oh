#!/usr/bin/env node
// pnpm license gate (R0.2, ADR 0002): fails when any installed dependency carries a GPL
// (GNU General Public License) or AGPL (GNU Affero General Public License) family license.
//
// Mechanism: runs "pnpm -r licenses list --json" over every workspace project (the root importer alone would miss a package only a workspace member depends on), parses the object it prints
// (license id to list of packages), and asks scripts/license-policy.mjs for a verdict per id.
// Forbidden ids list every offending package and exit 1. Unknown ids print a warning only.
// Zero packages means pnpm install has not run, which would make the gate vacuous, so that
// also fails. ESM (ECMAScript modules), no dependencies, so it runs before any install step
// other than pnpm itself.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateLicenseReport } from "./license-policy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNPM_BIN = "pnpm";
const PNPM_LICENSES_ARGS = Object.freeze(["-r", "licenses", "list", "--json"]);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const EXIT_OK = 0;
const EXIT_FAIL = 1;

// On Windows pnpm is pnpm.cmd, which Node can only start through a shell. The command is a
// constant string with no user input, and passing one string (not an args array) to a shell
// avoids Node's DEP0190 warning about unescaped arguments.
function spawnPnpmLicenses() {
  const options = { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES };
  if (process.platform === "win32") {
    const commandLine = [PNPM_BIN, ...PNPM_LICENSES_ARGS].join(" ");
    return spawnSync(commandLine, { ...options, shell: true });
  }
  return spawnSync(PNPM_BIN, [...PNPM_LICENSES_ARGS], { ...options, shell: false });
}

function runPnpmLicenses() {
  const result = spawnPnpmLicenses();
  if (result.error) {
    throw new Error(`could not start pnpm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(`pnpm ${PNPM_LICENSES_ARGS.join(" ")} exited ${result.status}: ${stderr}`);
  }
  return result.stdout ?? "";
}

function parseLicenseReport(stdout) {
  const text = stdout.trim();
  if (text === "") {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`pnpm licenses output is not JSON: ${reason}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("pnpm licenses output is not an object keyed by license id");
  }
  for (const [licenseId, packages] of Object.entries(parsed)) {
    if (!Array.isArray(packages)) {
      throw new Error(`pnpm licenses entry for "${licenseId}" is not a list of packages`);
    }
  }
  return parsed;
}

function formatFinding(finding) {
  const versions = finding.versions.length > 0 ? `@${finding.versions.join(", ")}` : "";
  return `${finding.name}${versions} (${finding.licenseId})`;
}

function main() {
  const evaluation = evaluateLicenseReport(parseLicenseReport(runPnpmLicenses()));

  for (const finding of evaluation.unknown) {
    console.warn(`licenses: warning, license not identified for ${formatFinding(finding)}`);
  }
  if (evaluation.packageCount === 0) {
    console.error("licenses: no packages reported; run pnpm install before this check");
    return EXIT_FAIL;
  }
  if (evaluation.forbidden.length > 0) {
    console.error("licenses: forbidden GPL or AGPL family license found (ADR 0002):");
    for (const finding of evaluation.forbidden) {
      console.error(`  ${formatFinding(finding)}`);
    }
    return EXIT_FAIL;
  }
  console.log(
    `licenses: ${evaluation.packageCount} packages across ${evaluation.licenseCount} license ids checked, 0 forbidden`,
  );
  return EXIT_OK;
}

try {
  process.exitCode = main();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`licenses: ${reason}`);
  process.exitCode = EXIT_FAIL;
}
