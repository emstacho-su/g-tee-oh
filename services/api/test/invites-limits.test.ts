/**
 * Invite rate limits (S42, R3.1, O-428, O-429): per client IP on create (10 per minute), inspect
 * (10 per minute) and join (5 per minute), each a 429 problem with Retry-After; and the per-invite
 * cap on failed attempts (10 per 15 minutes per invite id, shared by inspect and join), so one
 * link cannot be hammered from many addresses. Every test builds its own app, so the in-memory
 * counters start empty.
 */
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { formatInviteToken, newInviteSecret } from "../src/auth/invite-token.js";
import type { Database } from "../src/db.js";
import {
  INVITE_ATTEMPT_MAX,
  INVITE_CREATE_RATE_LIMIT_MAX,
  INVITE_INSPECT_RATE_LIMIT_MAX,
  JOIN_RATE_LIMIT_MAX,
} from "../src/http/rate-limits.js";
import { buildTestApp } from "./support/app.js";
import { adminPool, appDatabase, uniqueEmail } from "./support/database.js";
import { createInvite, createTestAdmin, insertInvite, inspectInvite, joinWith, nextClientAddress, type TestAdmin } from "./invites-kit.js";

const TOO_MANY = 429;

describe("R3.1 invite rate limits", () => {
  let database: Database;
  let pool: pg.Pool;
  let admin: TestAdmin;
  let app: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    admin = await createTestAdmin(database, "limits-admin");
  });

  afterAll(async () => {
    await database.destroy();
    await pool.end();
  });

  async function freshApp(): Promise<ApiApp> {
    app = buildTestApp(database);
    await app.ready();
    return app;
  }

  afterEach(async () => {
    await app.close();
  });

  function expectLimited(response: Awaited<ReturnType<typeof inspectInvite>>): void {
    expect(response.statusCode).toBe(TOO_MANY);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  }

  it("R3.1 the 11th invite create in a minute from one IP is 429", async () => {
    await freshApp();
    const address = nextClientAddress();
    for (let index = 0; index < INVITE_CREATE_RATE_LIMIT_MAX; index += 1) {
      expect((await createInvite(app, admin, uniqueEmail("burst"), address)).statusCode).toBe(201);
    }
    expectLimited(await createInvite(app, admin, uniqueEmail("burst"), address));
    expect((await createInvite(app, admin, uniqueEmail("burst"), nextClientAddress())).statusCode).toBe(201);
  });

  it("R3.1 the 11th inspect in a minute from one IP is 429", async () => {
    await freshApp();
    const address = nextClientAddress();
    const invite = await insertInvite(pool, { createdBy: admin.id });
    for (let index = 0; index < INVITE_INSPECT_RATE_LIMIT_MAX; index += 1) {
      expect((await inspectInvite(app, invite.token, address)).statusCode).toBe(200);
    }
    expectLimited(await inspectInvite(app, invite.token, address));
  });

  it("R3.1 the 6th join in a minute from one IP is 429", async () => {
    await freshApp();
    const address = nextClientAddress();
    for (let index = 0; index < JOIN_RATE_LIMIT_MAX; index += 1) {
      const invite = await insertInvite(pool, { createdBy: admin.id });
      expect((await joinWith(app, invite.token, { remoteAddress: address })).statusCode).toBe(200);
    }
    const invite = await insertInvite(pool, { createdBy: admin.id });
    expectLimited(await joinWith(app, invite.token, { remoteAddress: address }));
  });

  it("R3.1 O-429 after 10 failed attempts on one invite id from many addresses, even the right token is 429", async () => {
    await freshApp();
    const invite = await insertInvite(pool, { createdBy: admin.id });
    for (let index = 0; index < INVITE_ATTEMPT_MAX; index += 1) {
      const wrong = formatInviteToken(invite.id, newInviteSecret().secret);
      const attempt = index % 2 === 0 ? await inspectInvite(app, wrong) : await joinWith(app, wrong);
      expect(attempt.statusCode).toBe(410);
    }

    expectLimited(await inspectInvite(app, invite.token));
    expectLimited(await joinWith(app, invite.token));
    const untouched = await insertInvite(pool, { createdBy: admin.id });
    expect((await inspectInvite(app, untouched.token)).statusCode).toBe(200);
  });

  it("R3.1 O-429 an unknown invite id is capped the same way, so the cap reveals nothing", async () => {
    await freshApp();
    const unknownId = "01890a5d-ac96-774b-bcce-b302099a8099";
    for (let index = 0; index < INVITE_ATTEMPT_MAX; index += 1) {
      expect((await inspectInvite(app, formatInviteToken(unknownId, newInviteSecret().secret))).statusCode).toBe(410);
    }
    expectLimited(await inspectInvite(app, formatInviteToken(unknownId, newInviteSecret().secret)));
  });
});
