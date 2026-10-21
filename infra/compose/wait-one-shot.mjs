#!/usr/bin/env node
// Waits for a one-shot Compose service (bucket-init) to finish and exits with its exit code
// (R0.5). docker compose wait exits 1 when the container has already exited before it
// attaches, which a fast one-shot does on a quick machine: on the e2e job of PR #12 the
// buckets were created and the container exited 0, yet the wait failed. Reading the state
// from compose ps instead works whether the container finished before or after this starts.

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const COMPOSE_ARGS = [
  'compose', '--project-directory', '.', '-f', 'infra/compose/compose.yaml', '--profile', 'dev',
];
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 120_000;
const EXIT_USAGE = 2;

// compose ps --format json prints one JSON object per line, or a JSON array on older
// releases. Returns the row for the service, or null when there is none yet.
export function findRow(stdout, service) {
  const text = stdout.trim();
  if (text === '') return null;
  const rows = text.startsWith('[')
    ? JSON.parse(text)
    : text.split('\n').map((line) => JSON.parse(line));
  return rows.find((row) => row.Service === service) ?? null;
}

function compose(args, stdio = 'pipe') {
  return spawnSync('docker', [...COMPOSE_ARGS, ...args], {
    encoding: 'utf8', shell: false, windowsHide: true, stdio,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function report(service, exitCode) {
  if (exitCode === 0) {
    console.log(`wait-one-shot: ${service} exited 0`);
    return;
  }
  console.error(`wait-one-shot: ${service} exited ${exitCode}; its log follows`);
  compose(['logs', '--no-color', service], 'inherit');
}

export function main(service) {
  if (!service) {
    console.error('usage: node infra/compose/wait-one-shot.mjs <service>');
    return EXIT_USAGE;
  }
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = compose(['ps', '-a', '--format', 'json', service]);
    if (result.error || result.status !== 0) {
      const reason = result.error?.message ?? result.stderr.trim();
      console.error(`wait-one-shot: docker compose ps failed: ${reason}`);
      return 1;
    }
    const row = findRow(result.stdout, service);
    if (row?.State === 'exited') {
      report(service, row.ExitCode);
      return row.ExitCode;
    }
    sleep(POLL_INTERVAL_MS);
  }
  console.error(`wait-one-shot: ${service} did not exit within ${TIMEOUT_MS / 1000} s`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2]);
}
