// The dev stack side of just perf (R3.3, O-248, O-263): Caddy's root certificate, the health
// check that the stack is up, and the per-run owner.
//
// The caller brings the stack up (just dev-up, just db-migrate); perf never starts or stops it.
// Caddy's internal certificate authority keeps its root at CADDY_ROOT_PATH in the caddy_data
// volume, and `docker compose exec -T caddy cat` copies it out, so the requests can trust it
// (scripts/perf/http.mjs). The owner is made the way the e2e chain makes its own
// (infra/compose/e2e-owner.mjs): the api container's bundled create-user with the password on its
// standard input, never as an argument, never printed and never written to disk. The address is
// fresh per run, so a second run on the same database never meets the first run's account.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOwnerArgs, createOwnerInput } from "../../infra/compose/e2e-owner.mjs";
import { COMPOSE_ARGS } from "../../infra/compose/e2e.mjs";
import { PerfError } from "./errors.mjs";

export const CADDY_SERVICE = "caddy";
export const CADDY_ROOT_PATH = "/data/caddy/pki/authorities/local/root.crt";
export const HEALTHZ_PATH = "/api/v1/healthz";
const HTTP_OK = 200;
const PEM_HEADER = "-----BEGIN CERTIFICATE-----";
const OWNER_SUFFIX_BYTES = 8;
const OWNER_DOMAIN = "example.com";
const STACK_HINT = "Bring it up first: just dev-up, then just db-migrate (perf never starts the stack).";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPAWN_DEFAULTS = { cwd: repoRoot, encoding: "utf8", shell: false, windowsHide: true };

function stackNotUp(reason) {
  return new PerfError(`the dev stack is not up: ${reason}. ${STACK_HINT}`);
}

function firstLine(text) {
  return String(text ?? "").trim().split("\n")[0];
}

export function caddyRootArgs(composeArgs) {
  return [...composeArgs, "exec", "-T", CADDY_SERVICE, "cat", CADDY_ROOT_PATH];
}

/** Caddy's root certificate (PEM) from the running caddy container. */
export function readCaddyRoot({ run = spawnSync, composeArgs = COMPOSE_ARGS } = {}) {
  const result = run("docker", caddyRootArgs(composeArgs), SPAWN_DEFAULTS);
  if (result.error) throw new PerfError(`cannot run docker: ${result.error.message}`);
  if (result.status !== 0) {
    throw stackNotUp(`docker compose exec ${CADDY_SERVICE} exited ${result.status}: ${firstLine(result.stderr)}`);
  }
  if (!String(result.stdout).includes(PEM_HEADER)) {
    throw new PerfError(`${CADDY_ROOT_PATH} in the ${CADDY_SERVICE} container is not a PEM certificate`);
  }
  return result.stdout;
}

/** A PEM root from a file given with --ca-file. */
export function readCaFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new PerfError(`cannot read --ca-file ${path}: ${error.message}`);
  }
  if (!text.includes(PEM_HEADER)) throw new PerfError(`--ca-file ${path} is not a PEM certificate`);
  return text;
}

/** Resolves when GET /api/v1/healthz answers 200 through Caddy; otherwise says the stack is not up. */
export async function checkStack(client, baseUrl) {
  let response;
  try {
    response = await client.request("GET", HEALTHZ_PATH);
  } catch (error) {
    throw stackNotUp(`${baseUrl}${HEALTHZ_PATH} did not answer (${error.message})`);
  }
  if (response.status !== HTTP_OK) {
    throw stackNotUp(`${baseUrl}${HEALTHZ_PATH} answered ${response.status}`);
  }
}

/** A fresh owner address for this run, perf-<16 hex digits>@example.com. */
export function perfOwnerEmail(random = randomBytes) {
  return `perf-${random(OWNER_SUFFIX_BYTES).toString("hex")}@${OWNER_DOMAIN}`;
}

/** Creates the owner through create-user in the api container, the password on stdin only. */
export function createPerfOwner(owner, { run = spawnSync, composeArgs = COMPOSE_ARGS } = {}) {
  const result = run("docker", createOwnerArgs(composeArgs, owner.email), {
    ...SPAWN_DEFAULTS,
    input: createOwnerInput(owner.password),
  });
  if (result.error) throw new PerfError(`cannot run docker: ${result.error.message}`);
  if (result.status !== 0) {
    // create-user prints one redacted line on failure (services/api/src/cli/create-user-args.ts).
    throw new PerfError(`create-user in the api container exited ${result.status}: ${firstLine(result.stderr)}`);
  }
}
