// Shared helpers for the database tests (R0.6): one pool per test file, transactions that always roll
// back, role probes through SET ROLE, and a dbmate runner. Tests connect with the superuser DATABASE_URL
// so they can SET ROLE to each group role inside a transaction and roll everything back (A4 section 3,
// O-28). The login users and passwords belong to the Compose init script and never appear here.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'db', 'migrations');
export const ENV_FILE = path.join(REPO_ROOT, '.env');

export const PERMISSION_DENIED = '42501';
export const GROUP_ROLES = Object.freeze(['app', 'builder', 'capture', 'query']);
export const CATALOG_TABLES = Object.freeze(['stake', 'sizing_convention', 'game_config']);
export const LIBRARY_TABLES = Object.freeze([
  'solution',
  'scenario',
  'build_job',
  'builder_setting',
  'storage_ledger',
]);
export const USER_TABLES = Object.freeze([
  'app_user',
  'auth_session',
  'drill',
  'practice_session',
  'attempt',
  'track',
  'rating',
  'rating_history',
  'schedule_card',
  'mastery',
  'leak_stat',
  'leak_history',
  'holdout_item',
  'holdout_result',
  'streak_day',
  'cosmetic_unlock',
  'explanation',
  'llm_spend',
]);
export const OTHER_TABLES = Object.freeze(['opponent_profile']);
export const A4_TABLES = Object.freeze([
  ...USER_TABLES,
  ...CATALOG_TABLES,
  ...LIBRARY_TABLES,
  ...OTHER_TABLES,
]);

/**
 * Resolve the superuser DATABASE_URL: the environment first, then the repo root .env (gitignored, written
 * by the Compose agent). process.loadEnvFile never overrides variables already set.
 */
export function loadDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch (err) {
      throw new Error(
        `DATABASE_URL is not set and ${ENV_FILE} could not be read: ${err.message}. ` +
          'Copy .env.example to .env and run just dev-up.',
      );
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`DATABASE_URL is empty after reading ${ENV_FILE}`);
  }
  return url;
}

export function createPool() {
  return new pg.Pool({ connectionString: loadDatabaseUrl(), max: 2 });
}

/**
 * Run fn inside a transaction on one client and roll back whatever it did, success or failure.
 */
export async function withRollback(pool, fn) {
  const client = await pool.connect();
  let rollbackError;
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    try {
      await client.query('rollback');
    } catch (err) {
      rollbackError = err;
    }
    client.release(rollbackError);
    if (rollbackError) {
      throw rollbackError;
    }
  }
}

/**
 * Run one statement as a group role. A savepoint wraps SET ROLE so a failure leaves the enclosing
 * transaction usable and the role reset. Returns the query result.
 */
export async function asRole(client, role, sql, params = []) {
  assert.ok(GROUP_ROLES.includes(role), `unknown role ${role}`);
  await client.query('savepoint role_probe');
  try {
    await client.query(`set role ${role}`);
    const result = await client.query(sql, params);
    await client.query('reset role');
    await client.query('release savepoint role_probe');
    return result;
  } catch (err) {
    await client.query('rollback to savepoint role_probe');
    throw err;
  }
}

/**
 * Assert that a statement fails for a role with the given SQLSTATE (permission denied by default).
 * Returns the error so a caller can check its message.
 */
export async function expectDenied(client, role, sql, params = [], code = PERMISSION_DENIED) {
  let error;
  try {
    await asRole(client, role, sql, params);
  } catch (err) {
    error = err;
  }
  assert.ok(error, `expected ${role} to be denied: ${sql}`);
  assert.equal(
    error.code,
    code,
    `expected SQLSTATE ${code} for ${role} on "${sql}", got ${error.code}: ${error.message}`,
  );
  return error;
}

/**
 * Run dbmate from the repo root with the given arguments and return its stdout. The working directory is
 * the repo root so dbmate's default migrations directory (./db/migrations) and .env resolve; the URL goes
 * through the environment, never the command line, so a generated password needs no shell quoting. On
 * Windows the npm install of dbmate is a .cmd shim, which Node only runs through a shell.
 */
export function runDbmate(args, { databaseUrl = loadDatabaseUrl() } = {}) {
  for (const arg of args) {
    assert.ok(!/\s/.test(arg), `dbmate argument with whitespace is not supported: ${arg}`);
  }
  return execFileSync('dbmate', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

/**
 * Names of every base table in the public schema, sorted.
 */
export async function listPublicTables(client) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  return rows.map((row) => row.table_name);
}

/**
 * The first column of a table, for update probes that need a column name.
 */
export async function firstColumn(client, table) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position limit 1`,
    [table],
  );
  assert.ok(rows.length === 1, `table ${table} has no columns`);
  return rows[0].column_name;
}
