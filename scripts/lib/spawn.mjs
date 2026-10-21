// Process spawning shared by the root scripts (R0.7). scripts/contracts.mjs and
// scripts/codegen.mjs both call pnpm and each used to carry its own copy of the rule below with
// different escaping; this is the one place the rule lives.
//
// Mechanism: pnpm is a .cmd shim on Windows, which Node refuses to spawn without a shell, and
// Node's own quoting of an argument list under shell: true follows rules that differ between
// cmd.exe and sh. So pnpm runs as one command string under the platform shell, and every
// argument passes one policy first: it is refused when it holds a character either shell would
// interpret (quotes, newlines, redirections, pipes, variable and command substitution, globs and
// cmd.exe's percent expansion) and wrapped in double quotes when it holds a space, which both
// shells read as one argument. cargo and node are spawned without a shell by the callers.

import { spawnSync } from "node:child_process";
import process from "node:process";

/** The status reported when the shell gave none (the process died of a signal). */
export const EXIT_FAILED = 1;

/** Characters cmd.exe or sh would interpret inside the one pnpm command string. */
export const UNSAFE_ARGUMENT = /["'\r\n&|<>^$`;()!%*?]/;

const PNPM = "pnpm";

/** An argument the policy refused, or a shell that could not start. */
export class SpawnError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpawnError";
  }
}

/** The argument as it goes into the command string: refused when unsafe, quoted on a space. */
export function shellArgument(value) {
  if (UNSAFE_ARGUMENT.test(value)) {
    const shown = JSON.stringify(value);
    throw new SpawnError(`argument ${shown} holds a character the shell would interpret`);
  }
  return value.includes(" ") ? `"${value}"` : value;
}

/** The one pnpm command line for `args`. */
export function pnpmCommand(args) {
  return [PNPM, ...args.map(shellArgument)].join(" ");
}

/**
 * Runs pnpm with `args` from `cwd` through the shell. `env` defaults to the process environment;
 * `stdio` defaults to "inherit", and "pipe" captures stdout and stderr as strings. Returns
 * { status, stdout, stderr }, the captured text empty when nothing was captured. Throws
 * SpawnError when an argument fails the policy or the shell cannot start; a non-zero exit is
 * reported through status, never thrown.
 */
export function runPnpm(args, { cwd, env = process.env, stdio = "inherit" } = {}) {
  const command = pnpmCommand(args);
  const options = { cwd, env, stdio, shell: true, windowsHide: true, encoding: "utf8" };
  const result = spawnSync(command, options);
  if (result.error) throw new SpawnError(`could not run pnpm: ${result.error.message}`);
  return {
    status: result.status ?? EXIT_FAILED,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
