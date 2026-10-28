#!/usr/bin/env node
// Solution rows for the fixture library on the dev and test databases (R3.7, O-53, O-62, O-60).
//
// Why: solver-query serves the fixture library from files it scans at startup (O-144), so the
// fixture solutions have no row in the solution table, while every graded decision stores an
// attempt whose solution_id is a foreign key to that table (A4 section 2). On the Mac the rows
// come from capture and the builder; on the dev stack, in CI and in the api tests this script
// writes them, so a decision graded against a fixture solution can be stored.
//
// Mechanism: every preflop/<config_id>/<solution_id>/manifest.json under the library root becomes
// one published preflop row with the manifest's id, source, config, pair and engine label, and a
// fixture: manifest_uri naming the file. A manifest whose config is not in the catalog (the G6a
// heads-up configurations, O-30) is skipped and counted, since game_config_id is a foreign key
// too; nothing in the trainer can select such a config. Inserts are idempotent (on conflict do
// nothing), run as the superuser of DATABASE_URL (the app role cannot write the library, A4
// section 3), and never touch a row that already exists.
//
// Usage: node scripts/fixture-solutions.mjs   (DATABASE_URL from the environment or .env;
// FIXTURE_LIBRARY_PATH defaults to validation/fixtures/library)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pg from 'pg';

export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_LIBRARY = join(REPO_ROOT, 'validation', 'fixtures', 'library');
const PREFLOP_DIR = 'preflop';
const MANIFEST = 'manifest.json';
const URI_SCHEME = 'fixture:';
const ALLOWED_SOURCES = new Set(['own', 'reference']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Raised for a manifest that cannot become a row; the message names the file. */
export class FixtureManifestError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'FixtureManifestError';
  }
}

function directories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The row one parsed preflop manifest becomes; `uriPath` is the manifest path under the root. */
export function toSolutionRow(manifest, uriPath) {
  const fail = (reason) => {
    throw new FixtureManifestError(uriPath, reason);
  };
  if (manifest?.kind !== 'preflop') fail(`kind ${JSON.stringify(manifest?.kind)} is not preflop`);
  if (typeof manifest.id !== 'string' || !UUID.test(manifest.id)) fail('id is not a lowercase UUID');
  if (!ALLOWED_SOURCES.has(manifest.source)) fail(`source ${JSON.stringify(manifest.source)} is not own or reference`);
  if (typeof manifest.config_id !== 'string' || manifest.config_id === '') fail('config_id is missing');
  if (typeof manifest.pair !== 'string' || manifest.pair === '') fail('pair is missing');
  return Object.freeze({
    id: manifest.id,
    source: manifest.source,
    game_config_id: manifest.config_id,
    position_pair: manifest.pair,
    engine_version: typeof manifest.engine_version === 'string' ? manifest.engine_version : null,
    manifest_uri: `${URI_SCHEME}${uriPath}`,
  });
}

/** Every preflop manifest under `root` as a row, in path order. */
export function listFixtureSolutions(root) {
  const preflop = join(root, PREFLOP_DIR);
  if (!existsSync(preflop)) return [];
  return directories(preflop).flatMap((config) =>
    directories(join(preflop, config)).map((solution) => {
      const path = join(preflop, config, solution, MANIFEST);
      const uriPath = relative(root, path).split('\\').join('/');
      return toSolutionRow(JSON.parse(readFileSync(path, 'utf8')), uriPath);
    }),
  );
}

/**
 * Inserts the rows whose config the catalog holds; returns how many were inserted, already
 * present, and skipped for a config outside the catalog.
 */
export async function seedFixtureSolutions(client, rows) {
  const catalog = await client.query('select id from game_config');
  const known = new Set(catalog.rows.map((row) => row.id));
  const counts = { inserted: 0, present: 0, skipped: 0 };
  for (const row of rows) {
    if (!known.has(row.game_config_id)) {
      counts.skipped += 1;
      continue;
    }
    const result = await client.query(
      `insert into solution (id, kind, source, game_config_id, position_pair, engine_version, manifest_uri, status)
       values ($1, 'preflop', $2, $3, $4, $5, $6, 'published')
       on conflict (id) do nothing`,
      [row.id, row.source, row.game_config_id, row.position_pair, row.engine_version, row.manifest_uri],
    );
    if (result.rowCount === 1) counts.inserted += 1;
    else counts.present += 1;
  }
  return counts;
}

function databaseUrl(env) {
  if (!env.DATABASE_URL) {
    try {
      process.loadEnvFile(join(REPO_ROOT, '.env'));
    } catch (error) {
      throw new Error(`DATABASE_URL is not set and .env could not be read: ${error.message}`);
    }
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in the environment or .env');
  return process.env.DATABASE_URL;
}

export async function main(env = process.env) {
  const root = env.FIXTURE_LIBRARY_PATH ? resolve(env.FIXTURE_LIBRARY_PATH) : DEFAULT_LIBRARY;
  const rows = listFixtureSolutions(root);
  const client = new pg.Client({ connectionString: databaseUrl(env) });
  await client.connect();
  try {
    const counts = await seedFixtureSolutions(client, rows);
    console.log(
      `fixture-solutions: ${counts.inserted} inserted, ${counts.present} already present, ` +
        `${counts.skipped} skipped (config outside the catalog) from ${rows.length} manifests`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`fixture-solutions: ${error.message}`);
    process.exit(1);
  });
}
