#!/usr/bin/env node
// Byte comparison of selected directories of two trees (R2.20, O-225): what `just fixtures-check`
// runs after fixture-gen regenerated the synthetic sets into target/fixtures-check, to prove the
// committed sets under validation/fixtures/library are exactly what the generator writes today.
//
// Usage: node scripts/compare-trees.mjs ACTUAL EXPECTED SELECT...
//
// Mechanism: each SELECT is a path relative to both roots whose last segment may end in one `*`,
// for example `preflop/cfg_6_online_*`. The directories that match it are listed under both roots
// and their names must agree. Every matched directory is then walked recursively on both sides:
// the relative file lists must be equal, and every file present on both sides must hold the same
// bytes. Directories outside the selection (the G6a solutions beside the synthetic sets) are never
// read. Every difference is printed, one line each, before the exit, so one run names all of them.
// A selection that matches nothing under EXPECTED is itself a finding, since an empty comparison
// proves nothing. Exit 0 when the trees agree, 1 on any difference, 2 on a usage error.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EXIT_OK = 0;
const EXIT_DIFFERENT = 1;
const EXIT_USAGE = 2;
const WILDCARD = "*";
const USAGE = "usage: node scripts/compare-trees.mjs ACTUAL EXPECTED SELECT... (SELECT such as preflop/cfg_6_online_*)";

// Splits a selection into its parent path and the name pattern of its last segment.
export function parseSelection(selection) {
  const segments = selection.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) {
    throw new Error(`selection "${selection}" is empty`);
  }
  const pattern = segments[segments.length - 1];
  const wildcards = pattern.split(WILDCARD).length - 1;
  const leading = segments.slice(0, -1);
  if (wildcards > 1 || (wildcards === 1 && !pattern.endsWith(WILDCARD)) || leading.some((s) => s.includes(WILDCARD))) {
    throw new Error(`selection "${selection}" may hold one ${WILDCARD}, at the end of its last segment`);
  }
  return { parent: leading.join("/"), pattern };
}

function matchesPattern(name, pattern) {
  return pattern.endsWith(WILDCARD) ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

// The names of the directories directly under root/parent that match the pattern, sorted.
function matchingDirectories(root, { parent, pattern }) {
  const directory = join(root, parent);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && matchesPattern(entry.name, pattern))
    .map((entry) => entry.name)
    .sort();
}

// Every file under root/relative as a sorted list of slash-separated paths relative to root.
function listFiles(root, relative) {
  return readdirSync(join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const child = posix.join(relative, entry.name);
      return entry.isDirectory() ? listFiles(root, child) : [child];
    })
    .sort();
}

function difference(left, right) {
  const other = new Set(right);
  return left.filter((item) => !other.has(item));
}

function compareDirectory(actualRoot, expectedRoot, relative) {
  const actualFiles = listFiles(actualRoot, relative);
  const expectedFiles = listFiles(expectedRoot, relative);
  const missing = difference(expectedFiles, actualFiles).map((file) => `missing from the actual tree: ${file}`);
  const extra = difference(actualFiles, expectedFiles).map((file) => `extra in the actual tree: ${file}`);
  const changed = expectedFiles
    .filter((file) => actualFiles.includes(file))
    .filter((file) => !readFileSync(join(actualRoot, file)).equals(readFileSync(join(expectedRoot, file))))
    .map((file) => `bytes differ: ${file}`);
  return { findings: [...missing, ...extra, ...changed], files: expectedFiles.length };
}

function compareSelection(actualRoot, expectedRoot, selection) {
  const parsed = parseSelection(selection);
  const actualDirs = matchingDirectories(actualRoot, parsed);
  const expectedDirs = matchingDirectories(expectedRoot, parsed);
  const prefix = (name) => (parsed.parent === "" ? name : `${parsed.parent}/${name}`);
  const findings = [
    ...(expectedDirs.length === 0 ? [`selection ${selection} matches no directory in the expected tree`] : []),
    ...difference(expectedDirs, actualDirs).map((name) => `missing from the actual tree: ${prefix(name)}/`),
    ...difference(actualDirs, expectedDirs).map((name) => `extra in the actual tree: ${prefix(name)}/`),
  ];
  const shared = expectedDirs.filter((name) => actualDirs.includes(name));
  const results = shared.map((name) => compareDirectory(actualRoot, expectedRoot, prefix(name)));
  return {
    findings: [...findings, ...results.flatMap((result) => result.findings)],
    directories: shared.length,
    files: results.reduce((sum, result) => sum + result.files, 0),
  };
}

// Compares the selected directories of two trees; returns every finding and what was compared.
export function compareTrees(actualRoot, expectedRoot, selections) {
  for (const root of [actualRoot, expectedRoot]) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(`${root} is not a directory`);
    }
  }
  const results = selections.map((selection) => compareSelection(actualRoot, expectedRoot, selection));
  return {
    findings: results.flatMap((result) => result.findings),
    directories: results.reduce((sum, result) => sum + result.directories, 0),
    files: results.reduce((sum, result) => sum + result.files, 0),
  };
}

function main(args) {
  if (args.length < 3) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const [actualRoot, expectedRoot, ...selections] = args;
  let result;
  try {
    result = compareTrees(actualRoot, expectedRoot, selections);
  } catch (error) {
    console.error(`compare-trees: ${error.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  for (const finding of result.findings) {
    console.log(finding);
  }
  if (result.findings.length > 0) {
    console.log(`compare-trees: ${result.findings.length} difference(s) between ${actualRoot} and ${expectedRoot}`);
    return EXIT_DIFFERENT;
  }
  console.log(`compare-trees: ${result.directories} directories and ${result.files} files identical (${selections.join(", ")})`);
  return EXIT_OK;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
