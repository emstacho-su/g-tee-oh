/**
 * The raw invite token never reaches a log (S42, R3.1, O-427). The api is built with its real
 * pino options (redaction included) writing into a capture stream; create, inspect, join, a bad
 * join, a join with a too-short password (400 validation) and a join whose database insert fails
 * (500, the error handler logs the error) all run, and the captured lines must not contain the
 * secret anywhere, nor the password.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp, type ApiApp } from "../src/app.js";
import { parseInviteToken } from "../src/auth/invite-token.js";
import type { Database } from "../src/db.js";
import type { LogStream } from "../src/http/server-options.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, uniqueEmail } from "./support/database.js";
import { faultyDatabase, type FaultyDatabase } from "./support/faulty-database.js";
import {
  createInvite,
  createTestAdmin,
  insertInvite,
  inspectInvite,
  joinWith,
  NEW_PASSWORD,
  tokenOfLink,
  type TestAdmin,
} from "./invites-kit.js";

function captureStream(): LogStream & { text: () => string } {
  const lines: string[] = [];
  return {
    write: (message: string) => {
      lines.push(message);
    },
    text: () => lines.join(""),
  };
}

describe("R3.1 invite secrets stay out of the logs", () => {
  let database: Database;
  let faulty: FaultyDatabase;
  let pool: pg.Pool;
  let admin: TestAdmin;
  let app: ApiApp;
  let faultyApp: ApiApp;
  const stream = captureStream();

  beforeAll(async () => {
    database = appDatabase();
    faulty = faultyDatabase();
    pool = adminPool();
    admin = await createTestAdmin(database, "logs-admin");
    app = buildApp({ database, config: TEST_CONFIG, logger: true, logStream: stream });
    faultyApp = buildApp({ database: faulty.database, config: TEST_CONFIG, logger: true, logStream: stream });
    await Promise.all([app.ready(), faultyApp.ready()]);
  });

  afterAll(async () => {
    await Promise.all([app.close(), faultyApp.close()]);
    await database.destroy();
    await faulty.database.destroy();
    await pool.end();
  });

  it("R3.1 create, inspect, join and their failures log no secret and no password", async () => {
    const created = await createInvite(app, admin, uniqueEmail("logged"));
    expect(created.statusCode).toBe(201);
    const token = tokenOfLink(created.json<{ link: string }>().link);
    const secret = parseInviteToken(token)?.secret ?? "missing";

    expect((await inspectInvite(app, token)).statusCode).toBe(200);
    expect((await joinWith(app, token, { password: "too short" })).statusCode).toBe(400);
    expect((await joinWith(app, token)).statusCode).toBe(200);
    expect((await joinWith(app, token)).statusCode).toBe(410);

    const failing = await insertInvite(pool, { createdBy: admin.id });
    faulty.failNext(/insert into "app_user"/i);
    expect((await joinWith(faultyApp, failing.token)).statusCode).toBe(500);
    expect(faulty.fired()).toBe(1);

    const logged = stream.text();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).toContain("request completed");
    expect(logged).toContain("unhandled error");
    for (const forbidden of [secret, token, failing.secret, NEW_PASSWORD]) {
      expect(logged).not.toContain(forbidden);
    }
  });
});
