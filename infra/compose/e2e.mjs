#!/usr/bin/env node
// The end-to-end chain for the Compose dev stack (R0.3, R0.5, R0.6, R3.13), in order:
//   1. dev-up        builds the solver-query, api and web images and waits for health
//   2. db-migrate    applies the migrations
//   3. db-test       migration, role and seed tests (each in a rolled-back transaction)
//   4. create-owner  a fresh owner account with a random per-run password (O-263)
//   5. smoke         health of every service through Caddy
//   6. e2e-web       the Playwright stack project, with the owner in its environment only
//   and always dev-down.
// A plain just dependency chain stops at the first failing step and leaves the stack and its
// volumes running, so this runner keeps the teardown in a finally block and exits with the
// status of the first step that failed.
//
// create-owner (infra/compose/e2e-owner.mjs) runs the bundled create-user command inside the
// api container with the password on its standard input. The password is never an argument,
// never printed and never written to .env or disk; only the e2e-web child gets it, through
// E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD in its own environment.

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  createOwnerArgs,
  createOwnerInput,
  e2eWebEnv,
  generateOwnerPassword,
  ownerEmail,
} from './e2e-owner.mjs';

export const OWNER_STEP = 'create-owner';
const E2E_WEB_STEP = 'e2e-web';
export const STEPS = ['dev-up', 'db-migrate', 'db-test', OWNER_STEP, 'smoke', E2E_WEB_STEP];

// The same project arguments as the justfile's compose recipes.
export const COMPOSE_ARGS = [
  'compose', '--project-directory', '.', '-f', 'infra/compose/compose.yaml', '--profile', 'dev',
];
const LOG_TAIL_LINES = '80';
const EXIT_COULD_NOT_RUN = 2;
const SPAWN_DEFAULTS = { shell: false, windowsHide: true };

function just(recipe, env = process.env) {
  const command = process.platform === 'win32' ? 'just.exe' : 'just';
  const result = spawnSync(command, [recipe], { ...SPAWN_DEFAULTS, stdio: 'inherit', env });
  if (result.error) {
    console.error(`e2e: could not run just ${recipe}: ${result.error.message}`);
    return EXIT_COULD_NOT_RUN;
  }
  return result.status ?? 1;
}

// The api container's create-user command reads the password as the first line of stdin;
// its stdout (the new user id) and stderr (one redacted line on failure) go to the log.
function createOwner(owner) {
  const args = createOwnerArgs(COMPOSE_ARGS, owner.email);
  const result = spawnSync('docker', args, {
    ...SPAWN_DEFAULTS,
    input: createOwnerInput(owner.password),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) {
    console.error(`e2e: could not run docker compose exec: ${result.error.message}`);
    return EXIT_COULD_NOT_RUN;
  }
  return result.status ?? 1;
}

// After a failed step, the container states and the last log lines of every service are
// printed before teardown removes them, so a failure in CI shows its cause in the job log.
function printDiagnostics() {
  for (const args of [['ps', '-a'], ['logs', '--no-color', '--tail', LOG_TAIL_LINES]]) {
    console.error(`e2e: docker ${[...COMPOSE_ARGS, ...args].join(' ')}`);
    const result = spawnSync('docker', [...COMPOSE_ARGS, ...args], { ...SPAWN_DEFAULTS, stdio: 'inherit' });
    if (result.error) console.error(`e2e: could not collect diagnostics: ${result.error.message}`);
  }
}

function runStep(step, owner) {
  if (step === OWNER_STEP) {
    console.log(`e2e: create the owner ${owner.email} through create-user in the api container`);
    return createOwner(owner);
  }
  console.log(`e2e: just ${step}`);
  return step === E2E_WEB_STEP ? just(step, e2eWebEnv(process.env, owner)) : just(step);
}

export function main() {
  let status = 0;
  try {
    // Resolved before anything starts, so a bad E2E_OWNER_EMAIL fails before the stack builds.
    const owner = { email: ownerEmail(process.env), password: generateOwnerPassword() };
    for (const step of STEPS) {
      status = runStep(step, owner);
      if (status !== 0) {
        console.error(`e2e: ${step} failed with exit ${status}`);
        printDiagnostics();
        break;
      }
    }
  } catch (error) {
    console.error(`e2e: ${error instanceof Error ? error.message : String(error)}`);
    status = 1;
  } finally {
    console.log('e2e: just dev-down');
    const down = just('dev-down');
    if (status === 0 && down !== 0) status = down;
  }
  return status;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main();
}
