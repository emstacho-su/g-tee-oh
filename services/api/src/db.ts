/**
 * The Kysely database handle (R3.1, ADR 0005, O-56). Queries are typed by the committed Kysely
 * types (packages/contracts/src/db.generated.ts), which the contracts job regenerates from the
 * migrations, so a column the api reads that a migration dropped fails the type check.
 *
 * The api connects as app_login, a member of the app group role (O-28), which can read the
 * catalog and library and write only user, training, learning-state and explanation tables; the
 * pool is small because one process serves one owner.
 */
import type { DB } from "@g-tee-oh/contracts";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { DatabaseConfig } from "./config.js";

export type Database = Kysely<DB>;

export const DB_POOL_MAX = 10;
export const DB_CONNECTION_TIMEOUT_MS = 5000;
export const DB_IDLE_TIMEOUT_MS = 30000;

export function createDatabase(config: DatabaseConfig): Database {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: DB_POOL_MAX,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/** A Kysely handle over an existing connection string (tests use it with the test container). */
export function createDatabaseFromUrl(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: DB_POOL_MAX });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
