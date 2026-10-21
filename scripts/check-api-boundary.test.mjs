// Tests for scripts/check-api-boundary.mjs (R2.15, O-157): the api service never invokes the
// builder. node:test, run by `pnpm run test:scripts` (just ts-test). Written red in S16 step 2;
// the integrator lands the script against this contract:
//
//   export const FORBIDDEN_PACKAGES = ["library-builder", "gto-solve", "solver-worker"];
//   export const BUILDER_NAME_PATTERN = /builder/;
//   export function dependencyFindings(packageJson) -> string[]
//     one finding per dependency, devDependency, optionalDependency or peerDependency whose
//     name is in FORBIDDEN_PACKAGES or matches BUILDER_NAME_PATTERN, naming the package.
//   export function sourceFindings(dir) -> string[]
//     one finding per source file under dir (recursive, .ts .tsx .js .mjs .cjs) whose text
//     holds child_process, execa or library-builder, naming the file and the token.
//   CLI: node scripts/check-api-boundary.mjs
//     runs pnpm --filter @g-tee-oh/api why <name> for every FORBIDDEN_PACKAGES entry (a
//     resolution is a finding), dependencyFindings over services/api/package.json and
//     sourceFindings over services/api/src; exit 0 when clean with one "boundary:" line on
//     stdout, 1 with the findings on stderr, 2 when it cannot run.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-api-boundary.mjs");
const REPO_ROOT = resolve(dirname(SCRIPT), "..");
const EXIT_OK = 0;

/** The script's exports, loaded per test so a missing script fails each test on its own. */
async function boundary() {
  return import("./check-api-boundary.mjs");
}

/** The real api manifest's shape with no builder anywhere. */
const CLEAN_MANIFEST = {
  name: "@g-tee-oh/api",
  dependencies: { fastify: "^5.0.0", "@g-tee-oh/contracts": "workspace:*" },
  devDependencies: { esbuild: "^0.28.0" },
};

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "api-boundary-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(relativePath, text) {
  const path = join(dir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

test("R2.15 the forbidden package list names the builder, the solver and the worker", async () => {
  const { BUILDER_NAME_PATTERN, FORBIDDEN_PACKAGES } = await boundary();
  assert.deepEqual(FORBIDDEN_PACKAGES, ["library-builder", "gto-solve", "solver-worker"]);
  assert.ok(BUILDER_NAME_PATTERN.test("library-builder"));
  assert.ok(BUILDER_NAME_PATTERN.test("some-builder-kit"));
  assert.ok(!BUILDER_NAME_PATTERN.test("fastify"));
});

test("R2.15 a package.json with a dependency named library-builder fails", async () => {
  const { dependencyFindings } = await boundary();
  const planted = { ...CLEAN_MANIFEST, dependencies: { ...CLEAN_MANIFEST.dependencies, "library-builder": "workspace:*" } };
  const findings = dependencyFindings(planted);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0], /library-builder/);

  const devPlanted = { ...CLEAN_MANIFEST, devDependencies: { "some-builder-kit": "1.0.0" } };
  assert.equal(dependencyFindings(devPlanted).length, 1);
  assert.match(dependencyFindings(devPlanted)[0], /some-builder-kit/);

  const solver = { ...CLEAN_MANIFEST, peerDependencies: { "gto-solve": "0.1.0" } };
  assert.match(dependencyFindings(solver)[0], /gto-solve/);

  assert.deepEqual(dependencyFindings(CLEAN_MANIFEST), []);
});

test("R2.15 a planted child_process spawn of library-builder under services/api/src fails", async () => {
  const { sourceFindings } = await boundary();
  writeSource("src/routes/healthz.ts", 'export const healthz = () => ({ status: "ok" });\n');
  assert.deepEqual(sourceFindings(join(dir, "src")), [], "a clean tree has no finding");

  const planted = writeSource(
    "src/jobs/pack.ts",
    'import { spawn } from "node:child_process";\n\nexport function pack(): void {\n  spawn("library-builder", ["pack"]);\n}\n',
  );
  const findings = sourceFindings(join(dir, "src"));
  assert.ok(findings.length >= 1, JSON.stringify(findings));
  assert.ok(findings.every((finding) => finding.includes("pack.ts")), JSON.stringify(findings));
  assert.ok(findings.some((finding) => /child_process|library-builder/.test(finding)), JSON.stringify(findings));
  assert.ok(planted.endsWith("pack.ts"));

  writeSource("src/jobs/pack.ts", 'import { execa } from "execa";\nexport const run = () => execa("ls");\n');
  assert.match(sourceFindings(join(dir, "src"))[0], /execa/);
});

test("R2.15 the real tree passes", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.error, undefined, "the script starts");
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.stdout, /^boundary: /m);
});
