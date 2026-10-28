// The command line of just perf (R3.3):
//   node scripts/perf.mjs [--base-url URL] [--ca-file PATH] [--out-dir DIR]
// --base-url is the origin Caddy serves (default https://localhost); it is also the Origin header
// of every mutating request, so it must equal the api's APP_ORIGIN. --ca-file names a PEM root to
// trust instead of the one copied out of the caddy container. --out-dir is where
// perf-<machine>.json goes (default validation/reports). BENCH_MACHINE names the machine, as for
// just bench (default zenbook). An unknown flag, a flag without a value or a repeated flag is an
// error rather than ignored, so a typo never runs a different measurement than the one asked for.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PerfError } from "./errors.mjs";

export const DEFAULT_BASE_URL = "https://localhost";
export const DEFAULT_MACHINE = "zenbook";
const MACHINE_VARIABLE = "BENCH_MACHINE";
const MACHINE_NAME = /^[a-z][a-z0-9-]*$/;
const HTTPS_PROTOCOL = "https:";
const FLAG_PREFIX = "--";
const FLAGS = { "--base-url": "baseUrl", "--ca-file": "caFile", "--out-dir": "outDir" };
const ROOT_PATH = "/";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_OUT_DIR = join(repoRoot, "validation", "reports");

function readFlags(argv) {
  const given = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = FLAGS[flag];
    if (key === undefined) throw new PerfError(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith(FLAG_PREFIX)) throw new PerfError(`${flag} needs a value`);
    if (key in given) throw new PerfError(`${flag} is given more than once`);
    given[key] = value;
  }
  return given;
}

function checkBaseUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new PerfError(`--base-url ${JSON.stringify(text)} is not a URL`);
  }
  if (url.protocol !== HTTPS_PROTOCOL) throw new PerfError("--base-url must use https (Caddy serves tls internal)");
  if (url.pathname !== ROOT_PATH || url.search !== "" || url.hash !== "") {
    throw new PerfError("--base-url must be an origin, without a path, query or fragment");
  }
  return url.origin;
}

function machineName(env) {
  const name = env[MACHINE_VARIABLE]?.trim() || DEFAULT_MACHINE;
  if (!MACHINE_NAME.test(name)) throw new PerfError(`${MACHINE_VARIABLE} must match ${MACHINE_NAME.source}`);
  return name;
}

/** The run's options from the arguments and the environment; throws PerfError on a bad one. */
export function parsePerfArgs(argv, env) {
  const given = readFlags(argv);
  return {
    baseUrl: checkBaseUrl(given.baseUrl ?? DEFAULT_BASE_URL),
    caFile: given.caFile === undefined ? null : resolve(given.caFile),
    outDir: given.outDir === undefined ? DEFAULT_OUT_DIR : resolve(given.outDir),
    machine: machineName(env),
  };
}
