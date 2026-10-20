#!/usr/bin/env node
// sqlx offline metadata check (R0.6, ADR 0005).
//
// Mechanism: sqlx verifies queries against the database at compile time and stores the
// result under .sqlx so CI can build without a database. The check only means something
// once a crate carries a sqlx query. Until then this script says so and exits 0, so the
// recipe exists from Phase 0 and starts enforcing with the first query (S16 or S18).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['crates', 'services', 'tools'];

function manifests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'target' || entry.name === 'vendor') continue;
      manifests(full, out);
    } else if (entry.name === 'Cargo.toml') {
      out.push(full);
    }
  }
  return out;
}

function cratesUsingSqlx() {
  const found = [];
  for (const root of ROOTS) {
    const dir = join(repoRoot, root);
    try {
      statSync(dir);
    } catch {
      continue;
    }
    for (const manifest of manifests(dir)) {
      const text = readFileSync(manifest, 'utf8');
      if (/^\s*sqlx\s*=/m.test(text)) found.push(manifest);
    }
  }
  return found;
}

function main() {
  const users = cratesUsingSqlx();
  if (users.length === 0) {
    console.log('sqlx-check: no crate carries a sqlx query yet; the offline metadata check starts with the first query (S16 or S18)');
    return 0;
  }
  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const result = spawnSync(cargo, ['sqlx', 'prepare', '--check', '--workspace'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  // Only the missing-subcommand message means the tool is absent; cargo also exits 101 for a
  // compile error or a stale query, and those must be shown, not hidden behind an install hint.
  if (result.error || /no such command/i.test(result.stderr ?? '')) {
    console.error('sqlx-check: cargo sqlx is missing; install it with: cargo install sqlx-cli --no-default-features --features postgres,rustls');
    return 2;
  }
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result.status ?? 1;
}

process.exitCode = main();
