// Tests for scripts/lib/spawn.mjs (R0.7): the one argument policy behind every pnpm call the
// root scripts make, and one real pnpm run. node:test, run by `pnpm run test:scripts`.

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXIT_FAILED,
  SpawnError,
  UNSAFE_ARGUMENT,
  pnpmCommand,
  runPnpm,
  shellArgument,
} from "./spawn.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UNSAFE_CHARACTERS = [
  '"', "'", "\r", "\n", "&", "|", "<", ">", "^", "$", "`", ";", "(", ")", "!", "%", "*", "?",
];

test("r0_7 shellArgument passes a plain argument through and quotes one holding a space", () => {
  assert.equal(shellArgument("--filter"), "--filter");
  assert.equal(shellArgument("@g-tee-oh/api"), "@g-tee-oh/api");
  assert.equal(shellArgument("C:\\Users\\stack\\out.json"), "C:\\Users\\stack\\out.json");
  assert.equal(shellArgument("/tmp/contracts-x/out.json"), "/tmp/contracts-x/out.json");
  assert.equal(shellArgument("C:\\Program Files\\out.json"), '"C:\\Program Files\\out.json"');
});

test("r0_7 shellArgument refuses every character cmd.exe or sh would interpret", () => {
  for (const unsafe of UNSAFE_CHARACTERS) {
    const shown = JSON.stringify(unsafe);
    assert.ok(UNSAFE_ARGUMENT.test(unsafe), `${shown} is not in the unsafe set`);
    assert.throws(() => shellArgument(`out${unsafe}file`), SpawnError, shown);
  }
});

test("r0_7 pnpmCommand is one command string of the policed arguments", () => {
  const plain = pnpmCommand(["--filter", "@g-tee-oh/api", "run", "build"]);
  assert.equal(plain, "pnpm --filter @g-tee-oh/api run build");
  assert.equal(pnpmCommand(["exec", "tool", "-o", "a dir/out.ts"]), 'pnpm exec tool -o "a dir/out.ts"');
  assert.throws(() => pnpmCommand(["exec", "tool; rm -rf /"]), SpawnError);
});

test("r0_7 runPnpm runs pnpm through its shim and returns the status with captured output", () => {
  const result = runPnpm(["--version"], { cwd: REPO_ROOT, stdio: "pipe" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("r0_7 runPnpm reports a failing pnpm command by status, not by throwing", () => {
  const result = runPnpm(["run", "no-such-script-r0-7"], { cwd: REPO_ROOT, stdio: "pipe" });
  assert.notEqual(result.status, 0);
  assert.equal(typeof result.stderr, "string");
  assert.equal(EXIT_FAILED, 1);
});
