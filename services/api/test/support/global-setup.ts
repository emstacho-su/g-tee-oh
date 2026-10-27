/**
 * Vitest global setup (R3.1, A9 section 1): one Postgres 18 test container per test run, on a
 * random host port, so the suite never touches the compose stack's fixed ports.
 *
 * Mechanism: the container starts from the same image the contracts job and compose use
 * (postgres:18-alpine, O-104); dbmate, pinned to the version CI installs, applies db/migrations
 * exactly as production does; then a login user that is a member of the app group role is
 * created, so the integration tests run with the api's real privileges (O-28) and a missing
 * grant fails a test. The superuser URL is provided too, for fixtures the app role may not write
 * (solution rows). Docker must be running; if it is not, the run fails here with the cause.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { resolveBinary } from "dbmate";
import pg from "pg";
import type { TestProject } from "vitest/node";

import { startFixtureSolverQuery } from "./fixture-solver-query.js";

const POSTGRES_IMAGE = "postgres:18-alpine";
const DATABASE_NAME = "gto";
const APP_TEST_LOGIN = "app_test_login";
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../db/migrations", import.meta.url));

declare module "vitest" {
  export interface ProvidedContext {
    /** Superuser connection string: fixtures and assertions only. */
    adminDatabaseUrl: string;
    /** app_test_login, a member of app: what the api under test connects as. */
    appDatabaseUrl: string;
    /** The fixture solver-query's base URL, or "" when it could not start (O-244). */
    solverQueryUrl: string;
    /** Why the fixture solver-query is missing, or "" when it runs. */
    solverQueryError: string;
  }
}

function migrate(databaseUrl: string): void {
  execFileSync(resolveBinary(), ["--migrations-dir", MIGRATIONS_DIR, "--no-dump-schema", "up"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function createAppLogin(adminUrl: string, password: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // The password is hex from randomBytes, so quoting it into DDL (which takes no parameters) is safe.
    await client.query(`create role ${APP_TEST_LOGIN} login password '${password}'`);
    await client.query(`grant app to ${APP_TEST_LOGIN}`);
  } finally {
    await client.end();
  }
}

function withCredentials(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase(DATABASE_NAME).start();
  const adminUrl = `${container.getConnectionUri()}?sslmode=disable`;
  migrate(adminUrl);
  const appPassword = randomBytes(16).toString("hex");
  await createAppLogin(adminUrl, appPassword);

  project.provide("adminDatabaseUrl", adminUrl);
  project.provide("appDatabaseUrl", withCredentials(adminUrl, APP_TEST_LOGIN, appPassword));

  // O-53, O-244: the real solver-query binary over the fixture library, as the query role.
  const fixture = await startFixtureSolverQuery({
    adminUrl,
    host: container.getHost(),
    port: container.getPort(),
    database: DATABASE_NAME,
  });
  project.provide("solverQueryUrl", fixture.url);
  project.provide("solverQueryError", fixture.error);

  return async () => {
    await fixture.stop();
    await container?.stop();
  };
}
