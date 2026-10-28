/**
 * The fixture solver-query for the api integration tests (R3.3 to R3.7, O-53, O-244, A9 section 1):
 * the real binary over the committed fixture library, never a mock.
 *
 * Mechanism: SOLVER_QUERY_URL, when set, names a running instance (the compose dev stack, for
 * example) and is used as is. Otherwise cargo builds the solver-query debug binary (a no-op when it
 * is fresh), cargo metadata names the target directory, and the binary starts on a free loopback
 * port with FIXTURE_LIBRARY_PATH pointed at validation/fixtures/library and QUERY_DB_* pointed at
 * the test container through a query_test_login role, so /v1/coverage reads the queue the tests
 * write. The setup waits for /healthz. Any failure is recorded, never thrown here: tests that need
 * solver-query call fixtureSolverQueryUrl(), which fails them with the recorded cause (never a
 * skip), while the S21 suites that never touch solver-query keep running.
 *
 * The spawn lives in test support only; scripts/check-api-boundary.mjs scans services/api/src,
 * where no child process may ever start (R2.15, ADR 0018).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE_LIBRARY = join(REPO_ROOT, "validation", "fixtures", "library");
const QUERY_TEST_LOGIN = "query_test_login";
const CARGO_BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 250;
const LOOPBACK = "127.0.0.1";

export interface FixtureDatabase {
  adminUrl: string;
  host: string;
  port: number;
  database: string;
}

export interface FixtureSolverQuery {
  /** The base URL, or "" when it could not start. */
  url: string;
  /** Why it could not start, or "". */
  error: string;
  stop(): Promise<void>;
}

const NOTHING_TO_STOP = async (): Promise<void> => {};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createQueryLogin(adminUrl: string, password: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // The password is hex from randomBytes, so quoting it into DDL (which takes no parameters) is safe.
    await client.query(`create role ${QUERY_TEST_LOGIN} login password '${password}'`);
    await client.query(`grant query to ${QUERY_TEST_LOGIN}`);
  } finally {
    await client.end();
  }
}

function buildBinary(): string {
  execFileSync("cargo", ["build", "-q", "-p", "solver-query"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: CARGO_BUILD_TIMEOUT_MS,
  });
  const metadata = execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const targetDirectory = (JSON.parse(metadata) as { target_directory: string }).target_directory;
  const name = process.platform === "win32" ? "solver-query.exe" : "solver-query";
  const binary = join(targetDirectory, "debug", name);
  if (!existsSync(binary)) {
    throw new Error(`cargo built solver-query but ${binary} does not exist`);
  }
  return binary;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("no port was assigned"));
        }
      });
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`solver-query exited with code ${child.exitCode} before answering /healthz`);
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet; poll again.
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  throw new Error(`solver-query did not answer /healthz within ${HEALTH_TIMEOUT_MS} ms`);
}

function stopper(child: ChildProcess): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.kill();
    });
}

export async function startFixtureSolverQuery(database: FixtureDatabase): Promise<FixtureSolverQuery> {
  const given = process.env.SOLVER_QUERY_URL?.trim();
  if (given !== undefined && given !== "") {
    return { url: given.replace(/\/$/, ""), error: "", stop: NOTHING_TO_STOP };
  }
  let child: ChildProcess | undefined;
  try {
    const password = randomBytes(16).toString("hex");
    await createQueryLogin(database.adminUrl, password);
    const binary = buildBinary();
    const port = await freePort();
    const url = `http://${LOOPBACK}:${port}`;
    child = spawn(binary, [], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        SOLVER_QUERY_BIND: `${LOOPBACK}:${port}`,
        FIXTURE_LIBRARY_PATH: FIXTURE_LIBRARY,
        QUERY_DB_HOST: database.host,
        QUERY_DB_PORT: String(database.port),
        QUERY_DB_NAME: database.database,
        QUERY_DB_USER: QUERY_TEST_LOGIN,
        QUERY_DB_PASSWORD: password,
        QUERY_DB_SSLMODE: "disable",
      },
    });
    await waitForHealth(url, child);
    return { url, error: "", stop: stopper(child) };
  } catch (error: unknown) {
    child?.kill();
    return { url: "", error: `the fixture solver-query did not start: ${describe(error)}`, stop: NOTHING_TO_STOP };
  }
}
