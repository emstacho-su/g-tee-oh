/**
 * Admin invite routes (S42, R3.1, R3.5, O-349, O-420, O-423, O-427) against the Postgres test
 * container: POST /admin/invites, GET /admin/invites and POST /admin/invites/{id}/revoke, with
 * the session, admin, CSRF (cross-site request forgery) and Origin checks, storage of the secret's
 * hash only, the computed status, and the app role's grants on the invite table.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { hashInviteSecret, parseInviteToken } from "../src/auth/invite-token.js";
import type { Database } from "../src/db.js";
import { CSRF_HEADER, IDEMPOTENCY_HEADER } from "../src/http/headers.js";
import { APP_ORIGIN, buildTestApp, mutatingHeaders, sessionCookie, TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestSession, createTestUser, uniqueEmail } from "./support/database.js";
import {
  createInvite,
  createTestAdmin,
  DAY_MS,
  insertInvite,
  INVITES_URL,
  listInvites,
  nextClientAddress,
  revokeUrl,
  tokenOfLink,
  type TestAdmin,
} from "./invites-kit.js";

const EXPIRY_TOLERANCE_MS = 10_000;
const INVITE_TTL_DAYS = 7;

interface SummaryBody {
  id: string;
  email: string;
  created_by_email: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  status: string;
}

interface CreatedBody {
  invite: SummaryBody;
  link: string;
}

interface PageBody {
  items: SummaryBody[];
  next_cursor: string | null;
}

describe("R3.5 admin invite routes", () => {
  let database: Database;
  let app: ApiApp;
  let pool: pg.Pool;
  let admin: TestAdmin;

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    app = buildTestApp(database);
    await app.ready();
    admin = await createTestAdmin(database);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
    await pool.end();
  });

  async function inviteRow(id: string) {
    const result = await pool.query<{ email: string; secret_hash: Buffer; created_by: string; expires_at: Date; revoked_at: Date | null }>(
      "select email, secret_hash, created_by, expires_at, revoked_at from invite where id = $1",
      [id],
    );
    return result.rows[0];
  }

  it("R3.5 an admin creates an invite: 201 with the summary and a /join# link built on the app origin", async () => {
    const email = uniqueEmail("Created");
    const before = Date.now();

    const response = await createInvite(app, admin, `  ${email.toUpperCase()} `);

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<CreatedBody>();
    expect(body.invite).toMatchObject({
      email: email.toLowerCase(),
      created_by_email: admin.email,
      used_at: null,
      revoked_at: null,
      status: "pending",
    });
    expect(body.link.startsWith(`${TEST_CONFIG.appOrigin}/join#`)).toBe(true);
    const parsed = parseInviteToken(tokenOfLink(body.link));
    expect(parsed?.selector).toBe(body.invite.id);
    const expected = before + INVITE_TTL_DAYS * DAY_MS;
    expect(Math.abs(Date.parse(body.invite.expires_at) - expected)).toBeLessThan(EXPIRY_TOLERANCE_MS);
  });

  it("R3.1 the database keeps only sha256 of the secret: never the token or the secret, in invite or idempotency_key", async () => {
    const response = await createInvite(app, admin, uniqueEmail("hash-only"));
    const body = response.json<CreatedBody>();
    const token = tokenOfLink(body.link);
    const secret = parseInviteToken(token)?.secret ?? "";

    const row = await inviteRow(body.invite.id);
    expect(row?.secret_hash.equals(hashInviteSecret(secret))).toBe(true);
    expect(row?.created_by).toBe(admin.id);
    const dump = await pool.query<{ text: string }>(
      "select coalesce((select string_agg(t::text, ' ') from invite t), '') || ' ' || coalesce((select string_agg(k::text, ' ') from idempotency_key k), '') as text",
    );
    expect(dump.rows[0]?.text).not.toContain(secret);
  });

  it("R3.1 create ignores an Idempotency-Key, so no response holding the link is stored (O-427)", async () => {
    const key = `invite-${Date.now()}`;
    const response = await app.inject({
      method: "POST",
      url: INVITES_URL,
      headers: { ...mutatingHeaders(admin.session), [IDEMPOTENCY_HEADER]: key },
      remoteAddress: nextClientAddress(),
      payload: { email: uniqueEmail("idem") },
    });
    expect(response.statusCode).toBe(201);
    const stored = await pool.query("select 1 from idempotency_key where key = $1", [key]);
    expect(stored.rowCount).toBe(0);
  });

  it("R3.5 a second invite for the same email revokes the pending one (O-423)", async () => {
    const email = uniqueEmail("twice");
    const first = (await createInvite(app, admin, email)).json<CreatedBody>();
    const second = await createInvite(app, admin, email);

    expect(second.statusCode).toBe(201);
    expect((await inviteRow(first.invite.id))?.revoked_at).toBeInstanceOf(Date);
    expect((await inviteRow(second.json<CreatedBody>().invite.id))?.revoked_at).toBeNull();
  });

  it("R3.5 an email that already has an account is refused with 409 and no invite", async () => {
    const member = await createTestUser(database);
    const response = await createInvite(app, admin, member.email);

    expect(response.statusCode).toBe(409);
    const rows = await pool.query("select 1 from invite where email = $1", [member.email]);
    expect(rows.rowCount).toBe(0);
  });

  it("R3.1 a malformed email is a 400 validation problem", async () => {
    const response = await createInvite(app, admin, "not-an-email");
    expect(response.statusCode).toBe(400);
  });

  it("R3.1 no session is 401, a member is 403, on every admin invite route", async () => {
    const member = await createTestUser(database);
    const memberSession = await createTestSession(database, member.id);
    const requests = [
      { method: "GET" as const, url: INVITES_URL },
      { method: "POST" as const, url: INVITES_URL, payload: { email: uniqueEmail("x") } },
      { method: "POST" as const, url: revokeUrl("01890a5d-ac96-774b-bcce-b302099a8057"), payload: {} },
    ];
    for (const request of requests) {
      const anonymous = await app.inject({ ...request, headers: { origin: APP_ORIGIN } });
      expect(anonymous.statusCode, `${request.method} ${request.url}`).toBe(401);
      const asMember = await app.inject({ ...request, headers: mutatingHeaders(memberSession) });
      expect(asMember.statusCode, `${request.method} ${request.url}`).toBe(403);
    }
  });

  it("R3.1 create without x-csrf-token, or from a foreign Origin, is 403 and writes nothing", async () => {
    const email = uniqueEmail("csrf");
    const noToken = await app.inject({
      method: "POST",
      url: INVITES_URL,
      headers: { cookie: sessionCookie(admin.session), origin: APP_ORIGIN },
      payload: { email },
    });
    const foreign = await app.inject({
      method: "POST",
      url: INVITES_URL,
      headers: { ...mutatingHeaders(admin.session), origin: "https://evil.example" },
      payload: { email },
    });
    const wrongToken = await app.inject({
      method: "POST",
      url: INVITES_URL,
      headers: { ...mutatingHeaders(admin.session), [CSRF_HEADER]: "x".repeat(43) },
      payload: { email },
    });

    expect([noToken.statusCode, foreign.statusCode, wrongToken.statusCode]).toEqual([403, 403, 403]);
    const rows = await pool.query("select 1 from invite where email = $1", [email]);
    expect(rows.rowCount).toBe(0);
  });

  it("R3.5 the list shows newest first with the computed status of all four states, and never a token", async () => {
    const lister = await createTestAdmin(database, "invite-lister");
    const member = await createTestUser(database);
    const now = Date.now();
    const pending = await insertInvite(pool, { createdBy: lister.id });
    const expired = await insertInvite(pool, {
      createdBy: lister.id,
      createdAt: new Date(now - 9 * DAY_MS),
      expiresAt: new Date(now - 2 * DAY_MS),
    });
    const used = await insertInvite(pool, { createdBy: lister.id, usedBy: member.id });
    const revoked = await insertInvite(pool, { createdBy: lister.id, revokedAt: new Date() });

    const response = await listInvites(app, lister.session, "?limit=200");

    expect(response.statusCode).toBe(200);
    const page = response.json<PageBody>();
    const byId = new Map(page.items.map((item) => [item.id, item]));
    expect(byId.get(pending.id)?.status).toBe("pending");
    expect(byId.get(expired.id)?.status).toBe("expired");
    expect(byId.get(used.id)?.status).toBe("used");
    expect(byId.get(revoked.id)?.status).toBe("revoked");
    expect(byId.get(pending.id)?.created_by_email).toBe(lister.email);
    const ids = page.items.map((item) => item.id);
    expect(ids).toEqual([...ids].sort().reverse());
    for (const seeded of [pending, expired, used, revoked]) {
      expect(response.body).not.toContain(seeded.secret);
    }
  });

  it("R3.5 the list pages with a cursor", async () => {
    const pager = await createTestAdmin(database, "invite-pager");
    await insertInvite(pool, { createdBy: pager.id });
    await insertInvite(pool, { createdBy: pager.id });

    const first = (await listInvites(app, pager.session, "?limit=1")).json<PageBody>();
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).not.toBeNull();
    const second = (await listInvites(app, pager.session, `?limit=1&cursor=${first.next_cursor ?? ""}`)).json<PageBody>();
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect((await listInvites(app, pager.session, "?cursor=bogus")).statusCode).toBe(400);
  });

  it("R3.5 revoke answers 200 revoked, the same again, 409 for a used invite and 404 for an unknown id", async () => {
    const member = await createTestUser(database);
    const pending = await insertInvite(pool, { createdBy: admin.id });
    const used = await insertInvite(pool, { createdBy: admin.id, usedBy: member.id });
    const revoke = (id: string) =>
      app.inject({ method: "POST", url: revokeUrl(id), headers: mutatingHeaders(admin.session), payload: {} });

    const first = await revoke(pending.id);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<SummaryBody>().status).toBe("revoked");
    const again = await revoke(pending.id);
    expect(again.statusCode).toBe(200);
    expect(again.json<SummaryBody>().revoked_at).toBe(first.json<SummaryBody>().revoked_at);
    expect((await revoke(used.id)).statusCode).toBe(409);
    expect((await revoke("01890a5d-ac96-774b-bcce-b302099a8057")).statusCode).toBe(404);
  });

  it("R3.5 revoke replays its answer under the same Idempotency-Key", async () => {
    const pending = await insertInvite(pool, { createdBy: admin.id });
    const headers = { ...mutatingHeaders(admin.session), [IDEMPOTENCY_HEADER]: `revoke-${pending.id}` };
    const first = await app.inject({ method: "POST", url: revokeUrl(pending.id), headers, payload: {} });
    const replay = await app.inject({ method: "POST", url: revokeUrl(pending.id), headers, payload: {} });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
  });
});

describe("R3.1 invite table grants", () => {
  it("R3.1 the app role cannot delete invites, rewrite the hash or email, or set is_admin", async () => {
    const database = appDatabase();
    const pool = adminPool();
    const appPool = new pg.Pool({ connectionString: inject("appDatabaseUrl"), max: 1 });
    try {
      const admin = await createTestAdmin(database, "grants-admin");
      const invite = await insertInvite(pool, { createdBy: admin.id });
      const refused = async (sql: string, values: unknown[]) => {
        await expect(appPool.query(sql, values)).rejects.toMatchObject({ code: "42501" });
      };
      await refused("delete from invite where id = $1", [invite.id]);
      await refused("update invite set secret_hash = $2 where id = $1", [invite.id, Buffer.alloc(32)]);
      await refused("update invite set email = $2 where id = $1", [invite.id, uniqueEmail("swap")]);
      await refused("update invite set expires_at = now() + interval '1 year' where id = $1", [invite.id]);
      await refused("update app_user set is_admin = true where id = $1", [admin.id]);
      const allowed = await appPool.query("update invite set revoked_at = now() where id = $1", [invite.id]);
      expect(allowed.rowCount).toBe(1);
    } finally {
      await appPool.end();
      await pool.end();
      await database.destroy();
    }
  });
});
