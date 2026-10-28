/**
 * Invite races (S42 review round 1, A and C, R3.1, R3.5, O-423): the per-email advisory lock that
 * create and join share, the one-open-invite-per-email index behind it, create revoking expired but
 * open rows, and join hashing the password before it takes any lock.
 *
 * Mechanism: the races run several rounds of truly concurrent requests against one app over the
 * pooled app connection, so the database decides the interleaving. The hashing test mocks
 * password.ts with a gate: while a join waits inside hashPassword, a revoke of the same invite must
 * finish at once (it needs the invite's row lock, which the join must not hold yet), and the join
 * must then see the revocation and answer 410.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  hold: false,
  reached: (): void => undefined,
  release: (): void => undefined,
}));

vi.mock("../src/auth/password.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/password.js")>();
  return {
    ...actual,
    hashPassword: async (password: string) => {
      if (gate.hold) {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
          gate.reached();
        });
      }
      return actual.hashPassword(password);
    },
  };
});

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { buildTestApp, mutatingHeaders } from "./support/app.js";
import { adminPool, appDatabase, uniqueEmail } from "./support/database.js";
import {
  createInvite,
  createTestAdmin,
  DAY_MS,
  insertInvite,
  inspectInvite,
  joinWith,
  revokeUrl,
  tokenOfLink,
  type TestAdmin,
} from "./invites-kit.js";

const ROUNDS = 5;
const PARALLEL_CREATES = 3;
const REVOKE_DEADLINE_MS = 3_000;
/** How long the test holds the email lock while it checks that create and join are waiting. */
const HELD_LOCK_MS = 1_500;

describe("R3.1 invite races", () => {
  let database: Database;
  let pool: pg.Pool;
  let app: ApiApp;
  let admin: TestAdmin;

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    app = buildTestApp(database);
    await app.ready();
    admin = await createTestAdmin(database, "races-admin");
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
    await pool.end();
  });

  async function openInvites(email: string): Promise<number> {
    const result = await pool.query("select 1 from invite where email = $1 and used_at is null and revoked_at is null", [email]);
    return result.rowCount ?? 0;
  }

  async function accounts(email: string): Promise<number> {
    return (await pool.query("select 1 from app_user where email = $1", [email])).rowCount ?? 0;
  }

  it("R3.5 simultaneous creates for one email leave exactly one working link (O-423)", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const email = uniqueEmail(`race-create-${round}`);
      const answers = await Promise.all(Array.from({ length: PARALLEL_CREATES }, () => createInvite(app, admin, email)));
      expect(answers.map((answer) => answer.statusCode)).toEqual(Array<number>(PARALLEL_CREATES).fill(201));

      const tokens = answers.map((answer) => tokenOfLink(answer.json<{ link: string }>().link));
      const inspected = await Promise.all(tokens.map((token) => inspectInvite(app, token)));
      expect(inspected.filter((answer) => answer.statusCode === 200)).toHaveLength(1);
      expect(await openInvites(email)).toBe(1);
    }
  });

  it("R3.1 a join racing a create never leaves an open invite for an existing account", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const email = uniqueEmail(`race-join-${round}`);
      const invite = await insertInvite(pool, { createdBy: admin.id, email });

      const [joined, created] = await Promise.all([joinWith(app, invite.token), createInvite(app, admin, email)]);

      expect([200, 410]).toContain(joined.statusCode);
      expect([201, 409]).toContain(created.statusCode);
      const hasAccount = (await accounts(email)) === 1;
      if (hasAccount) expect(await openInvites(email)).toBe(0);
      // Exactly one side won: an account and a 409, or a fresh invite and a 410.
      expect(hasAccount).toBe(joined.statusCode === 200);
      expect(created.statusCode).toBe(hasAccount ? 409 : 201);
    }
  });

  it("R3.1 create and join both wait on the same per-email lock (one key derivation)", async () => {
    const email = uniqueEmail("held-lock");
    const invite = await insertInvite(pool, { createdBy: admin.id, email });
    const holder = await pool.connect();
    const pending = (request: Promise<{ statusCode: number }>) => {
      let settled = false;
      void request.then(() => {
        settled = true;
      });
      return () => settled;
    };
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtext(lower($1)))", [email.toUpperCase()]);
      const create = createInvite(app, admin, email);
      const join = joinWith(app, invite.token);
      const createDone = pending(create);
      const joinDone = pending(join);
      await new Promise((resolve) => {
        setTimeout(resolve, HELD_LOCK_MS);
      });
      expect(createDone()).toBe(false);
      expect(joinDone()).toBe(false);
      await holder.query("commit");
      const [created, joined] = await Promise.all([create, join]);
      expect([created.statusCode, joined.statusCode].sort()).toEqual(created.statusCode === 201 ? [201, 410] : [200, 409]);
    } finally {
      holder.release();
    }
  });

  it("R3.5 create revokes an expired but still open invite for the email", async () => {
    const email = uniqueEmail("expired-open");
    const now = Date.now();
    const expired = await insertInvite(pool, {
      createdBy: admin.id,
      email,
      createdAt: new Date(now - 9 * DAY_MS),
      expiresAt: new Date(now - DAY_MS),
    });

    expect((await createInvite(app, admin, email)).statusCode).toBe(201);

    const row = await pool.query<{ revoked_at: Date | null }>("select revoked_at from invite where id = $1", [expired.id]);
    expect(row.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(await openInvites(email)).toBe(1);
  });

  it("R3.1 the database refuses a second open invite for one email (the backstop index)", async () => {
    const email = uniqueEmail("backstop");
    await insertInvite(pool, { createdBy: admin.id, email });
    await expect(insertInvite(pool, { createdBy: admin.id, email })).rejects.toMatchObject({ code: "23505" });
    await expect(insertInvite(pool, { createdBy: admin.id, email, revokedAt: new Date() })).resolves.toBeDefined();
  });

  it("R3.1 join hashes before it locks anything: a revoke during the hash finishes at once, then the join gets 410", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    const reached = new Promise<void>((resolve) => {
      gate.reached = resolve;
    });
    gate.hold = true;
    const joining = joinWith(app, invite.token);
    try {
      await reached;
      const revoke = app.inject({ method: "POST", url: revokeUrl(invite.id), headers: mutatingHeaders(admin.session), payload: {} });
      const deadline = new Promise<"blocked">((resolve) => {
        setTimeout(() => resolve("blocked"), REVOKE_DEADLINE_MS);
      });
      const revoked = await Promise.race([revoke, deadline]);
      expect(revoked).not.toBe("blocked");
      expect(revoked === "blocked" ? 0 : revoked.statusCode).toBe(200);
    } finally {
      gate.hold = false;
      gate.release();
    }

    const joined = await joining;
    expect(joined.statusCode).toBe(410);
    expect(await accounts(invite.email)).toBe(0);
  });
});
