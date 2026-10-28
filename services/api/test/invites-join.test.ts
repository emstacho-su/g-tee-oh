/**
 * Inspect and join (S42, R3.1, O-349, O-421, O-422, O-426) against the Postgres test container:
 * the invite preview, the one-transaction join (user, used_at and used_by, session), single use
 * under concurrency, expiry, every bad token answering the identical 410 problem, the browser's
 * previous session deleted server-side (no session fixation), and the joined member's name and
 * plain (non-admin) role.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { formatInviteToken, newInviteSecret } from "../src/auth/invite-token.js";
import type { Database } from "../src/db.js";
import { SESSION_COOKIE_NAME } from "../src/http/openapi.js";
import { APP_ORIGIN, buildTestApp, readHeaders } from "./support/app.js";
import { adminPool, appDatabase, createTestSession, createTestUser, uniqueEmail } from "./support/database.js";
import {
  createTestAdmin,
  DAY_MS,
  insertInvite,
  inspectInvite,
  INVITE_INVALID_TYPE,
  joinWith,
  ME_URL,
  NEW_PASSWORD,
  type TestAdmin,
} from "./invites-kit.js";

interface ProblemBody {
  type: string;
  status: number;
  detail?: string;
}

interface SessionInfoBody {
  user: { id: string; email: string; is_admin: boolean; display_name: string | null };
  csrf_token: string;
}

describe("R3.1 inspect and join", () => {
  let database: Database;
  let app: ApiApp;
  let pool: pg.Pool;
  let admin: TestAdmin;

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    app = buildTestApp(database);
    await app.ready();
    admin = await createTestAdmin(database, "join-admin");
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
    await pool.end();
  });

  async function userCount(email: string): Promise<number> {
    return (await pool.query("select 1 from app_user where email = $1", [email])).rowCount ?? 0;
  }

  async function inviteState(id: string) {
    const result = await pool.query<{ used_at: Date | null; used_by: string | null }>(
      "select used_at, used_by from invite where id = $1",
      [id],
    );
    return result.rows[0];
  }

  function sessionCookieValue(response: Awaited<ReturnType<typeof joinWith>>): string {
    const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE_NAME);
    if (cookie === undefined) throw new Error("no session cookie was set");
    return cookie.value;
  }

  it("R3.1 inspect answers the invite's email and expiry", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const response = await inspectInvite(app, invite.token);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ email: invite.email, expires_at: expect.any(String) as unknown });
  });

  it("R3.1 join creates the member, signs them in and marks the invite used, in one go", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const response = await joinWith(app, invite.token, { displayName: "  Sam Rivera " });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<SessionInfoBody>();
    expect(body.user).toMatchObject({ email: invite.email, is_admin: false, display_name: "Sam Rivera" });
    const state = await inviteState(invite.id);
    expect(state?.used_at).toBeInstanceOf(Date);
    expect(state?.used_by).toBe(body.user.id);

    const me = await app.inject({ method: "GET", url: ME_URL, headers: readHeaders({ token: sessionCookieValue(response) }) });
    expect(me.statusCode).toBe(200);
    expect(me.json<SessionInfoBody>().user).toMatchObject({ id: body.user.id, display_name: "Sam Rivera", is_admin: false });
  });

  it("R3.1 reuse: the same token after a join gets 410 and creates nothing", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    expect((await joinWith(app, invite.token)).statusCode).toBe(200);

    const again = await joinWith(app, invite.token, { password: "another long passphrase" });
    const inspect = await inspectInvite(app, invite.token);

    expect(again.statusCode).toBe(410);
    expect(again.json<ProblemBody>().type).toBe(INVITE_INVALID_TYPE);
    expect(inspect.statusCode).toBe(410);
    expect(await userCount(invite.email)).toBe(1);
  });

  it("R3.1 two concurrent joins with one token make exactly one member", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const answers = await Promise.all([joinWith(app, invite.token), joinWith(app, invite.token), joinWith(app, invite.token)]);

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 410, 410]);
    expect(await userCount(invite.email)).toBe(1);
  });

  it("R3.1 expiry: an invite past expires_at gets 410 on inspect and join and creates nothing", async () => {
    const now = Date.now();
    const invite = await insertInvite(pool, {
      createdBy: admin.id,
      createdAt: new Date(now - 8 * DAY_MS),
      expiresAt: new Date(now - 1000),
    });

    expect((await inspectInvite(app, invite.token)).statusCode).toBe(410);
    expect((await joinWith(app, invite.token)).statusCode).toBe(410);
    expect(await userCount(invite.email)).toBe(0);
    expect((await inviteState(invite.id))?.used_at).toBeNull();
  });

  it("R3.1 every bad token answers the identical 410 body (O-422)", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    const revoked = await insertInvite(pool, { createdBy: admin.id, revokedAt: new Date() });
    const lastFlipped = `${invite.secret.slice(0, -1)}${invite.secret.endsWith("A") ? "B" : "A"}`;
    const badTokens = [
      formatInviteToken("01890a5d-ac96-774b-bcce-b302099a8057", newInviteSecret().secret),
      formatInviteToken(invite.id, newInviteSecret().secret),
      formatInviteToken(invite.id, lastFlipped),
      invite.id,
      "garbage",
      `${invite.token}x`,
      revoked.token,
    ];

    const bodies = new Set<string>();
    for (const token of badTokens) {
      for (const response of [await inspectInvite(app, token), await joinWith(app, token)]) {
        expect(response.statusCode, token).toBe(410);
        const { type, status, detail, title } = response.json<ProblemBody & { title: string }>();
        bodies.add(JSON.stringify({ type, status, detail, title }));
      }
    }
    expect(bodies.size).toBe(1);
    expect(await userCount(invite.email)).toBe(0);
    expect(await userCount(revoked.email)).toBe(0);
  });

  it("R3.1 join replaces the browser's session: the old one is deleted server-side, not just overwritten", async () => {
    const other = await createTestUser(database);
    const oldSession = await createTestSession(database, other.id);
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const response = await joinWith(app, invite.token, { cookie: oldSession.token });

    expect(response.statusCode).toBe(200);
    const row = await pool.query("select 1 from auth_session where id = $1", [oldSession.sessionId]);
    expect(row.rowCount).toBe(0);
    const oldMe = await app.inject({ method: "GET", url: ME_URL, headers: readHeaders(oldSession) });
    expect(oldMe.statusCode).toBe(401);
    expect(sessionCookieValue(response)).not.toBe(oldSession.token);
  });

  it("R3.1 a password under 12 characters is 400 and leaves the invite unused", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const response = await joinWith(app, invite.token, { password: "short pass" });

    expect(response.statusCode).toBe(400);
    expect((await inviteState(invite.id))?.used_at).toBeNull();
    expect(await userCount(invite.email)).toBe(0);
  });

  it.each([
    ["empty after trim", "   "],
    ["a right-to-left override", "Sam‮Rivera"],
    ["a control character", "Sam\u0007"],
    ["61 characters", "a".repeat(61)],
  ])("R3.1 a display name that is %s is 400 and leaves the invite unused", async (_label, displayName) => {
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const response = await joinWith(app, invite.token, { displayName });

    expect(response.statusCode).toBe(400);
    expect((await inviteState(invite.id))?.used_at).toBeNull();
  });

  it("R3.1 an account made for the email meanwhile is 409, rolls back, and leaves the invite unused", async () => {
    const email = uniqueEmail("meanwhile");
    const invite = await insertInvite(pool, { createdBy: admin.id, email });
    await createTestUser(database, { email });

    const response = await joinWith(app, invite.token);

    expect(response.statusCode).toBe(409);
    expect((await inviteState(invite.id))?.used_at).toBeNull();
    expect(await userCount(email)).toBe(1);
  });

  it("R3.1 a joined member can sign in with the new password and is not an admin", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });
    expect((await joinWith(app, invite.token)).statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: APP_ORIGIN },
      remoteAddress: "10.43.0.1",
      payload: { email: invite.email, password: NEW_PASSWORD },
    });

    expect(login.statusCode, login.body).toBe(200);
    expect(login.json<SessionInfoBody>().user.is_admin).toBe(false);
  });

  it("R3.1 join from a foreign Origin is 403 and writes nothing", async () => {
    const invite = await insertInvite(pool, { createdBy: admin.id });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/join",
      headers: { origin: "https://evil.example" },
      payload: { token: invite.token, display_name: "Sam", password: NEW_PASSWORD },
    });

    expect(response.statusCode).toBe(403);
    expect((await inviteState(invite.id))?.used_at).toBeNull();
  });
});
