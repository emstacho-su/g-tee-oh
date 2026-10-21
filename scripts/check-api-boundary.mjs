#!/usr/bin/env node
// Boundary check for the api service (R2.15, O-157, ADR 0018): api never invokes the
// builder. The Rust side of the library-first rule is `just rust-boundary`
// (scripts/check-boundary.mjs, cargo tree over solver-query); this is the TypeScript side,
// which `just ts-boundary` runs and the ts job calls (A1 section 2, success criterion 10).
//
// Mechanism, three checks in order, every finding collected before the verdict:
//   1. `pnpm --filter @g-tee-oh/api why <name>` for every FORBIDDEN_PACKAGES entry: pnpm why
//      prints the dependency path when the package resolves anywhere under api and nothing
//      when it does not, so any output line naming the package is a finding.
//   2. dependencyFindings(services/api/package.json): a dependency, devDependency,
//      optionalDependency or peerDependency whose name is in FORBIDDEN_PACKAGES or matches
//      BUILDER_NAME_PATTERN.
//   3. sourceFindings(services/api/src): a source file (.ts .tsx .js .mjs .cjs, recursive)
//      whose text holds child_process, execa or library-builder, so api can neither spawn a
//      process nor name the builder.
// Exit 0 with one "boundary:" line on stdout when clean, 1 with the findings on stderr, 2
// when the check cannot run (no manifest, no source directory, pnpm absent). pnpm goes
// through scripts/lib/spawn.mjs, the one place that knows it is a .cmd shim on Windows.
// scripts/check-api-boundary.test.mjs fixes the exports and the command-line contract.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { SpawnError, runPnpm } from "./lib/spawn.mjs";

/** Packages api must never resolve: the builder, the solver and the worker (O-157). */
export const FORBIDDEN_PACKAGES = ["library-builder", "gto-solve", "solver-worker"];
/** A dependency name that smells of a builder, whatever its exact spelling. */
export const BUILDER_NAME_PATTERN = /builder/;
/** The api package as pnpm names it. */
export const API_PACKAGE = "@g-tee-oh/api";
/** Tokens a source file under services/api/src must not hold. */
export const FORBIDDEN_TOKENS = ["child_process", "execa", "library-builder"];
/** Source extensions the scan reads. */
export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
/** The manifest sections a dependency can hide in. */
export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_CANNOT_RUN = 2;

const PREFIX = "boundary:";
const API_MANIFEST = join("services", "api", "package.json");
const API_SOURCE_DIR = join("services", "api", "src");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The check cannot run; main prints the message and exits 2. */
export class BoundaryError extends Error {
  constructor(message) {
    super(message);
    this.name = "BoundaryError";
  }
}

/** True when the dependency name is forbidden outright or matches the builder pattern. */
export function isForbiddenName(name) {
  return FORBIDDEN_PACKAGES.includes(name) || BUILDER_NAME_PATTERN.test(name);
}

/**
 * One finding per forbidden dependency in any section of a parsed package.json, naming the
 * section and the package.
 */
export function dependencyFindings(packageJson) {
  const findings = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = packageJson?.[section];
    if (entries === undefined || entries === null || typeof entries !== "object") continue;
    for (const name of Object.keys(entries).sort()) {
      if (isForbiddenName(name)) {
        findings.push(`${section} names ${name}, which api must never depend on (R2.15)`);
      }
    }
  }
  return findings;
}

/** Every source file under dir, recursive, sorted, as absolute paths. */
export function listSourceFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") walk(path);
      } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        found.push(path);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** A path relative to dir with forward slashes, for a finding line. */
function displayPath(path, dir) {
  return relative(dir, path).split(sep).join("/");
}

/**
 * One finding per forbidden token per source file under dir, naming the file and the token.
 * An absent directory yields no finding: a service with no source cannot spawn anything.
 */
export function sourceFindings(dir) {
  if (!existsSync(dir)) return [];
  const findings = [];
  for (const file of listSourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const token of FORBIDDEN_TOKENS) {
      if (text.includes(token)) {
        findings.push(`${displayPath(file, dir)} holds ${token}; api never spawns the builder`);
      }
    }
  }
  return findings;
}

/**
 * The lines `pnpm --filter @g-tee-oh/api why <name>` prints that name the package. pnpm why
 * exits 0 and prints nothing for a package that does not resolve, so a non-zero exit means
 * pnpm itself could not run the query.
 */
export function whyFindings(name, cwd = repoRoot) {
  let result;
  try {
    result = runPnpm(["--filter", API_PACKAGE, "why", name], { cwd, stdio: "pipe" });
  } catch (error) {
    if (error instanceof SpawnError) throw new BoundaryError(error.message);
    throw error;
  }
  if (result.status !== EXIT_OK) {
    throw new BoundaryError(
      `pnpm --filter ${API_PACKAGE} why ${name} exited ${result.status}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(name))
    .map((line) => `pnpm why resolves ${name} under ${API_PACKAGE}: ${line}`);
}

function readManifest(path) {
  if (!existsSync(path)) {
    throw new BoundaryError(`${displayPath(path, repoRoot)} is missing; run from the checkout`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new BoundaryError(`${displayPath(path, repoRoot)} is not valid JSON: ${error.message}`);
  }
}

export function main() {
  const manifestPath = join(repoRoot, API_MANIFEST);
  const sourceDir = join(repoRoot, API_SOURCE_DIR);
  const manifest = readManifest(manifestPath);
  if (!existsSync(sourceDir)) {
    throw new BoundaryError(`${API_SOURCE_DIR} is missing; run from the checkout`);
  }
  const findings = [
    ...FORBIDDEN_PACKAGES.flatMap((name) => whyFindings(name)),
    ...dependencyFindings(manifest).map((finding) => `${API_MANIFEST}: ${finding}`),
    ...sourceFindings(sourceDir).map((finding) => `${API_SOURCE_DIR}/${finding}`),
  ];
  if (findings.length > 0) {
    for (const finding of findings) console.error(`${PREFIX} ${finding}`);
    return EXIT_FINDINGS;
  }
  const checked = FORBIDDEN_PACKAGES.join(", ");
  console.log(
    `${PREFIX} ${API_PACKAGE} resolves none of ${checked}, names no builder dependency and ` +
      `spawns no process (R2.15, O-157)`,
  );
  return EXIT_OK;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error) {
    if (error instanceof BoundaryError) {
      console.error(`${PREFIX} ${error.message}`);
      process.exitCode = EXIT_CANNOT_RUN;
    } else {
      throw error;
    }
  }
}
