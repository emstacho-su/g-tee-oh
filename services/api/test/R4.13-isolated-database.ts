/**
 * A database of its own for the holdout integration tests (R4.13, O-276). Holdout items are global:
 * every drill and automated deal on the server's database holds them back. Test files run in
 * parallel against one database, so items drawn there would redeal hands in other files (S23's
 * replay golden among them). These tests therefore create a second database on the same test
 * container, migrated with the same dbmate migrations (the role migration is idempotent across
 * databases), seeded with the fixture solutions, and connected as the same app login, then drop it.
 * The fixture solver-query is unaffected: it reads the library from files.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { resolveBinary } from "dbmate";
import pg from "pg";
import { inject } from "vitest";

import { createDatabaseFromUrl, type Database } from "../src/db.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const FIXTURE_SOLUTIONS_SCRIPT = fileURLToPath(new URL("../../../scripts/fixture-solutions.mjs", import.meta.url));
const NAME_BYTES = 4;

export interface IsolatedDatabase {
  /** The app role's handle, as the api connects. */
  database: Database;
  /** A superuser pool on the same database, for assertions. */
  admin: pg.Pool;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function adminQuery(sqlText: string): Promise<void> {
  const client = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
  await client.connect();
  try {
    await client.query(sqlText);
  } finally {
    await client.end();
  }
}

/** Creates, migrates and seeds a database named after `prefix` (a lowercase letter, then lowercase letters, digits and underscores). */
export async function isolatedDatabase(prefix: string): Promise<IsolatedDatabase> {
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) {
    throw new RangeError(`database prefix ${prefix} must start with a lowercase letter and hold only lowercase letters, digits and underscores`);
  }
  const name = `${prefix}_${randomBytes(NAME_BYTES).toString("hex")}`;
  // The name is checked above and random hex, so quoting it into DDL (which takes no parameters) is safe.
  await adminQuery(`create database ${name}`);
  const adminUrl = withDatabase(inject("adminDatabaseUrl"), name);
  execFileSync(resolveBinary(), ["--migrations-dir", MIGRATIONS_DIR, "--no-dump-schema", "up"], {
    env: { ...process.env, DATABASE_URL: adminUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync(process.execPath, [FIXTURE_SOLUTIONS_SCRIPT, "--dev"], {
    env: { ...process.env, DATABASE_URL: adminUrl, FIXTURE_LIBRARY_PATH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const database = createDatabaseFromUrl(withDatabase(inject("appDatabaseUrl"), name));
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  return {
    database,
    admin,
    async drop() {
      await database.destroy();
      await admin.end();
      await adminQuery(`drop database if exists ${name} with (force)`);
    },
  };
}
