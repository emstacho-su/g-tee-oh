#!/usr/bin/env node
// Per-container peak memory against the 02 section 6.2 budget (S20, R2.22): `just mac-peaks`.
//
// Mechanism: `docker compose ps --format json` lists the running containers of the profile; for each,
// `docker exec <container> cat /sys/fs/cgroup/memory.peak` reads the cgroup v2 high-water mark of
// that container since it started (exact, no sampling; the kernel inside Docker Desktop's virtual
// machine provides it). A container whose reading cannot be had is listed as unavailable rather
// than as zero. Prints a Markdown table for the report, then one JSON line.
// Usage: node scripts/mac/peaks.mjs [--profile mac|dev]
import { pathToFileURL } from 'node:url';

import { DEFAULT_PROFILE, checkProfile, composeArgs, parseFlags, run, runMain } from './lib.mjs';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/**
 * The 02 section 6.2 budget per service, the compose limit each one runs under. The dev profile's
 * Postgres and SeaweedFS run without limits, so none is claimed for them; the builder carries its
 * 5 GB cap under both profiles.
 */
export const BUDGETS = {
  'postgres-mac': GIB,
  'seaweedfs-mac': 512 * MIB,
  'library-builder': 5 * GIB,
};

/** The budget of a service under a profile, or null when it runs without a limit there. */
export function budgetOf(_profile, service) {
  return BUDGETS[service] ?? null;
}

/** The profiles whose running containers are measured: dev adds builder, where the builder lives on the Zenbook. */
function profilesOf(profile) {
  return profile === 'dev' ? ['dev', 'builder'] : [profile];
}

/** Running containers from `compose ps --format json` (one object per line, or an array). */
export function runningContainers(stdout) {
  const text = stdout.trim();
  if (text === '') return [];
  const rows = text.startsWith('[') ? JSON.parse(text) : text.split('\n').map((line) => JSON.parse(line));
  return rows.filter((row) => row.State === 'running').map((row) => ({ service: row.Service, container: row.Name }));
}

/** A memory.peak reading as bytes, or null when it is not a whole number. */
export function parsePeak(text) {
  const value = String(text).trim();
  return /^\d+$/.test(value) ? Number(value) : null;
}

/** The Markdown table: service, peak, budget and whether the peak is under it. */
export function renderTable(rows) {
  const lines = ['| Service | Peak bytes | Budget bytes | Under budget |', '|---|---|---|---|'];
  for (const { service, peak, budget } of rows) {
    const under = peak === null || budget === null ? 'n/a' : peak < budget ? 'yes' : 'no';
    lines.push(`| ${service} | ${peak ?? 'unavailable'} | ${budget ?? 'none'} | ${under} |`);
  }
  return lines.join('\n');
}

export function main(argv, { runner = run } = {}) {
  const flags = parseFlags(argv, { values: ['profile'] });
  const profile = checkProfile(flags.profile ?? DEFAULT_PROFILE);
  const containers = runningContainers(runner('docker', composeArgs(profilesOf(profile), ['ps', '--format', 'json'])));
  const rows = containers.map(({ service, container }) => {
    let peak = null;
    try {
      peak = parsePeak(runner('docker', ['exec', container, 'cat', '/sys/fs/cgroup/memory.peak']));
    } catch {
      peak = null;
    }
    return { service, container, peak, budget: budgetOf(profile, service) };
  });
  console.log(renderTable(rows));
  console.log(JSON.stringify({ profile, peaks: rows }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-peaks', main);
}
