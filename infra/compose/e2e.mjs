#!/usr/bin/env node
// The end-to-end chain for the Compose dev stack (R0.3, R0.5, R0.6): up (dev-up builds the
// solver-query, api and web images), migrate, database tests, smoke, the Playwright flow
// through Caddy (e2e-web), and always down. A plain just dependency chain stops at the first
// failing step and leaves the stack and its volumes running, so this runner keeps the
// teardown in a finally block and exits with the status of the first step that failed.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const STEPS = ['dev-up', 'db-migrate', 'db-test', 'smoke', 'e2e-web'];

function just(recipe) {
  const command = process.platform === 'win32' ? 'just.exe' : 'just';
  const result = spawnSync(command, [recipe], { stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) {
    console.error(`e2e: could not run just ${recipe}: ${result.error.message}`);
    return 2;
  }
  return result.status ?? 1;
}

function main() {
  let status = 0;
  try {
    for (const step of STEPS) {
      console.log(`e2e: just ${step}`);
      status = just(step);
      if (status !== 0) {
        console.error(`e2e: just ${step} failed with exit ${status}`);
        break;
      }
    }
  } finally {
    console.log('e2e: just dev-down');
    const down = just('dev-down');
    if (status === 0 && down !== 0) status = down;
  }
  return status;
}

process.exitCode = main();
