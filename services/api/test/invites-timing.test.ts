/**
 * The timing-safe token compare (S42, R3.1, O-422). node:crypto is mocked with a pass-through spy
 * on timingSafeEqual, so the test sees every constant-time comparison the api makes while the real
 * comparison still decides. Inspect and join must each compare the secret's digest exactly once,
 * with two 32-byte buffers: for a known invite id and for an unknown one (the dummy-digest path),
 * so an unknown id and a wrong secret do the same work.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, default: actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from "node:crypto";

import type { ApiApp } from "../src/app.js";
import { formatInviteToken, newInviteSecret } from "../src/auth/invite-token.js";
import type { Database } from "../src/db.js";
import { buildTestApp } from "./support/app.js";
import { adminPool, appDatabase } from "./support/database.js";
import { createTestAdmin, insertInvite, inspectInvite, joinWith, type TestAdmin } from "./invites-kit.js";

const DIGEST_BYTES = 32;
const spy = vi.mocked(timingSafeEqual);

describe("R3.1 timing-safe invite compare", () => {
  let database: Database;
  let pool: pg.Pool;
  let app: ApiApp;
  let admin: TestAdmin;

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    app = buildTestApp(database);
    await app.ready();
    admin = await createTestAdmin(database, "timing-admin");
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
    await pool.end();
  });

  beforeEach(() => {
    spy.mockClear();
  });

  function digestCalls(): Array<[Buffer, Buffer]> {
    return spy.mock.calls
      .map(([left, right]) => [Buffer.from(left as Uint8Array), Buffer.from(right as Uint8Array)] as [Buffer, Buffer])
      .filter(([left, right]) => left.length === DIGEST_BYTES && right.length === DIGEST_BYTES);
  }

  it("R3.1 inspect with the right token compares the digests once in constant time", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    expect((await inspectInvite(app, invite.token)).statusCode).toBe(200);
    expect(digestCalls()).toHaveLength(1);
  });

  it("R3.1 inspect with a wrong secret for a known id compares once", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    expect((await inspectInvite(app, formatInviteToken(invite.id, newInviteSecret().secret))).statusCode).toBe(410);
    expect(digestCalls()).toHaveLength(1);
  });

  it("R3.1 inspect with an unknown id still compares once, against the dummy digest", async () => {
    const unknown = formatInviteToken("01890a5d-ac96-774b-bcce-b302099a8011", newInviteSecret().secret);
    expect((await inspectInvite(app, unknown)).statusCode).toBe(410);
    expect(digestCalls()).toHaveLength(1);
  });

  it("R3.1 join compares once for a known id and once for an unknown id", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    expect((await joinWith(app, invite.token)).statusCode).toBe(200);
    expect(digestCalls()).toHaveLength(1);

    spy.mockClear();
    const unknown = formatInviteToken("01890a5d-ac96-774b-bcce-b302099a8012", newInviteSecret().secret);
    expect((await joinWith(app, unknown)).statusCode).toBe(410);
    expect(digestCalls()).toHaveLength(1);
  });
});
