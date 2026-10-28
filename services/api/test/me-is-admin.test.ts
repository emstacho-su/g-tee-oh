/**
 * GET /me and login report app_user.is_admin as user.is_admin (O-290, O-242, R3.5). The web shows
 * the builder controls from it; it is read only: the admin routes still answer 403 to a member,
 * whatever a client claims, and no route writes the column (the app role has no grant on it).
 *
 * Mechanism: an admin is created through the owner connection, as create-user --admin does, and
 * a member through the app role; both sign in, and /me is read with each session cookie. A member
 * that sends is_admin in a login body is refused by the strict body schema, so the flag cannot be
 * set from a request.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { createUser } from "../src/auth/users.js";
import { createDatabaseFromUrl, type Database } from "../src/db.js";
import { sessionInfoSchema } from "../src/schemas/auth.js";
import { APP_ORIGIN, buildTestApp, readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, TEST_PASSWORD, uniqueEmail } from "./support/database.js";

const LOGIN_URL = "/api/v1/auth/login";
const ME_URL = "/api/v1/me";
const ADMIN_URL = "/api/v1/admin/builder";
const STATUS = { ok: 200, badRequest: 400, forbidden: 403 } as const;

describe("O-290 is_admin on GET /me", () => {
  let database: Database;
  let app: ApiApp;
  let adminId: string;
  let adminEmail: string;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
    // The app role cannot set is_admin (O-242); the owner connection does, as create-user --admin.
    const ownerDatabase = createDatabaseFromUrl(inject("adminDatabaseUrl"));
    try {
      adminEmail = uniqueEmail("me-admin");
      adminId = (await createUser(ownerDatabase, { email: adminEmail, password: TEST_PASSWORD, isAdmin: true })).id;
    } finally {
      await ownerDatabase.destroy();
    }
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function readMe(token: string) {
    const response = await app.inject({ method: "GET", url: ME_URL, headers: readHeaders({ token }) });
    expect(response.statusCode, response.body).toBe(STATUS.ok);
    return sessionInfoSchema.parse(response.json());
  }

  it("R3.5 O-290 GET /me answers is_admin true for an admin and false for a member", async () => {
    const adminSession = await createTestSession(database, adminId);
    const member = await createTestUser(database);
    const memberSession = await createTestSession(database, member.id);

    expect((await readMe(adminSession.token)).user.is_admin).toBe(true);
    expect((await readMe(memberSession.token)).user.is_admin).toBe(false);
  });

  it("R3.5 O-290 login answers the same is_admin as GET /me", async () => {
    const response = await app.inject({
      method: "POST",
      url: LOGIN_URL,
      headers: { origin: APP_ORIGIN },
      remoteAddress: "10.41.0.1",
      payload: { email: adminEmail, password: TEST_PASSWORD },
    });
    expect(response.statusCode, response.body).toBe(STATUS.ok);
    expect(sessionInfoSchema.parse(response.json()).user.is_admin).toBe(true);
  });

  it("R3.5 O-290 is_admin cannot be claimed: a login body naming it is refused and a member still gets 403 from the admin routes", async () => {
    const member = await createTestUser(database);
    const claimed = await app.inject({
      method: "POST",
      url: LOGIN_URL,
      headers: { origin: APP_ORIGIN },
      remoteAddress: "10.41.0.2",
      payload: { email: member.email, password: member.password, is_admin: true },
    });
    expect(claimed.statusCode).toBe(STATUS.badRequest);

    const memberSession = await createTestSession(database, member.id);
    const admin = await app.inject({ method: "GET", url: ADMIN_URL, headers: readHeaders(memberSession) });
    expect(admin.statusCode).toBe(STATUS.forbidden);
    expect((await readMe(memberSession.token)).user.is_admin).toBe(false);
  });
});
