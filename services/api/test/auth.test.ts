/**
 * Integration tests of the auth routes (R3.1, A9 section 3) against the Postgres test container:
 * POST /auth/login, POST /auth/logout and GET /me, with the session cookie rules of O-231 and the
 * CSRF (cross-site request forgery) token handshake of O-230.
 *
 * Mechanism: every mutating request carries the app Origin, and logout carries the session's
 * x-csrf-token, so these tests stay green once the CSRF guard enforces both. Each login comes from
 * its own client address, so the per-IP login rate limit (O-236, tested by its own suite) never
 * trips here. Users are seeded with unique emails, so the file shares the database safely.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth/tokens.js";
import type { AppConfig } from "../src/config.js";
import type { Database } from "../src/db.js";
import { SESSION_COOKIE_NAME } from "../src/http/openapi.js";
import { APP_ORIGIN, buildTestApp, mutatingHeaders, readHeaders, TEST_CONFIG } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestUser } from "./support/database.js";

const LOGIN_URL = "/api/v1/auth/login";
const LOGOUT_URL = "/api/v1/auth/logout";
const ME_URL = "/api/v1/me";
const HOUR_MS = 60 * 60 * 1000;
/** A short lifetime, so the expiry arithmetic is checked against a value that is not the default. */
const SHORT_TTL_HOURS = 3;
/** How far expires_at may drift from the expected instant: request time plus database rounding. */
const EXPIRY_TOLERANCE_MS = 10_000;
const UNAUTHENTICATED_TYPE = "urn:g-tee-oh:problem:unauthenticated";
const SHORT_TTL_CONFIG: AppConfig = { ...TEST_CONFIG, sessionTtlHours: SHORT_TTL_HOURS };

interface SessionInfoBody {
  user: { id: string; email: string; created_at: string };
  csrf_token: string;
  expires_at: string;
}

let clientCounter = 0;
/** A distinct client address per login, so the per-IP login limit never applies across tests. */
function nextClientAddress(): string {
  clientCounter += 1;
  return `10.31.${Math.floor(clientCounter / 250)}.${(clientCounter % 250) + 1}`;
}

function login(app: ApiApp, email: string, password: string) {
  return app.inject({
    method: "POST",
    url: LOGIN_URL,
    headers: { origin: APP_ORIGIN },
    remoteAddress: nextClientAddress(),
    payload: { email, password },
  });
}

function sessionCookieOf(response: Awaited<ReturnType<typeof login>>) {
  const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE_NAME);
  if (cookie === undefined) {
    throw new Error("the response set no session cookie");
  }
  return cookie;
}

function rawSetCookie(response: Awaited<ReturnType<typeof login>>): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [header ?? ""];
  const raw = values.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (raw === undefined) {
    throw new Error("no Set-Cookie header for the session cookie");
  }
  return raw;
}

function expectStrictCookieAttributes(raw: string): void {
  expect(raw).toMatch(/;\s*HttpOnly/i);
  expect(raw).toMatch(/;\s*Secure/i);
  expect(raw).toMatch(/;\s*SameSite=Strict/i);
  expect(raw).toMatch(/;\s*Path=\/(;|$)/);
  expect(raw).not.toMatch(/;\s*Domain=/i);
}

describe("R3.1 auth routes", () => {
  let database: Database;
  let app: ApiApp;
  let shortTtlApp: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    shortTtlApp = buildTestApp(database, SHORT_TTL_CONFIG);
    await Promise.all([app.ready(), shortTtlApp.ready()]);
  });

  afterAll(async () => {
    await Promise.all([app.close(), shortTtlApp.close()]);
    await database.destroy();
  });

  async function sessionRows(user: TestUser) {
    return database
      .selectFrom("auth_session")
      .select(["id", "token_hash", "csrf_token", "expires_at"])
      .where("user_id", "=", user.id)
      .execute();
  }

  it("R3.1 login answers 200 SessionInfo and sets a __Host- cookie that is HttpOnly, Secure, SameSite=Strict, Path=/ with no Domain", async () => {
    const user = await createTestUser(database);

    const response = await login(app, user.email, user.password);

    expect(response.statusCode).toBe(200);
    const body = response.json<SessionInfoBody>();
    expect(body.user).toEqual({ id: user.id, email: user.email, created_at: expect.any(String) as unknown });
    expect(Number.isNaN(Date.parse(body.user.created_at))).toBe(false);
    expect(body.csrf_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(body).sort()).toEqual(["csrf_token", "expires_at", "user"]);

    const cookie = sessionCookieOf(response);
    expect(cookie.name.startsWith("__Host-")).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(cookie.path).toBe("/");
    expect(cookie.domain).toBeUndefined();
    expectStrictCookieAttributes(rawSetCookie(response));
    expect(cookie.expires?.getTime()).toBe(new Date(Math.floor(Date.parse(body.expires_at) / 1000) * 1000).getTime());
  });

  it("R3.1 login sets expires_at to now plus sessionTtlHours, absolute (O-231)", async () => {
    const user = await createTestUser(database);
    const before = Date.now();

    const response = await login(shortTtlApp, user.email, user.password);

    expect(response.statusCode).toBe(200);
    const expiresAt = Date.parse(response.json<SessionInfoBody>().expires_at);
    const expected = before + SHORT_TTL_HOURS * HOUR_MS;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(EXPIRY_TOLERANCE_MS);
    const [row] = await sessionRows(user);
    expect(row?.expires_at.getTime()).toBe(expiresAt);
  });

  it("R3.1 the cookie from a login authenticates GET /me, which answers the same csrf_token", async () => {
    const user = await createTestUser(database);
    const loggedIn = await login(app, user.email, user.password);
    const token = sessionCookieOf(loggedIn).value;

    const me = await app.inject({ method: "GET", url: ME_URL, headers: readHeaders({ token }) });

    expect(me.statusCode).toBe(200);
    expect(me.json<SessionInfoBody>()).toEqual(loggedIn.json<SessionInfoBody>());
  });

  it("R3.1 GET /me without a session cookie answers a 401 problem", async () => {
    const response = await app.inject({ method: "GET", url: ME_URL });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ type: string }>().type).toBe(UNAUTHENTICATED_TYPE);
  });

  it("R3.1 a wrong password and an unknown email answer the same 401 problem and set no cookie", async () => {
    const user = await createTestUser(database);

    const wrongPassword = await login(app, user.email, `${user.password}-wrong`);
    const unknownEmail = await login(app, `nobody-${user.email}`, user.password);

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    // request_id differs per request by design; every other member must match exactly.
    const withoutRequestId = (response: typeof wrongPassword) =>
      Object.fromEntries(Object.entries(response.json<Record<string, unknown>>()).filter(([key]) => key !== "request_id"));
    expect(withoutRequestId(wrongPassword)).toEqual({
      type: UNAUTHENTICATED_TYPE,
      title: "Authentication required",
      status: 401,
      detail: "Invalid email or password.",
      instance: LOGIN_URL,
    });
    expect(withoutRequestId(unknownEmail)).toEqual(withoutRequestId(wrongPassword));
    expect(await sessionRows(user)).toEqual([]);
  });

  it("R3.1 login matches the email case-insensitively", async () => {
    const user = await createTestUser(database);

    const response = await login(app, user.email.toUpperCase(), user.password);

    expect(response.statusCode).toBe(200);
    expect(response.json<SessionInfoBody>().user.email).toBe(user.email);
  });

  it("R3.1 a session whose expires_at has passed is rejected by GET /me with 401 and its row is deleted", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id, { expiresAt: new Date(Date.now() - 1000) });

    const response = await app.inject({ method: "GET", url: ME_URL, headers: readHeaders(session) });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ type: string }>().type).toBe(UNAUTHENTICATED_TYPE);
    expect(await sessionRows(user)).toEqual([]);
  });

  it("R3.1 login deletes the user's expired sessions and keeps the live ones", async () => {
    const user = await createTestUser(database);
    const expired = await createTestSession(database, user.id, { expiresAt: new Date(Date.now() - HOUR_MS) });
    const live = await createTestSession(database, user.id);

    const response = await login(app, user.email, user.password);

    expect(response.statusCode).toBe(200);
    const ids = (await sessionRows(user)).map((row) => row.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(live.sessionId);
    expect(ids).not.toContain(expired.sessionId);
  });

  it("R3.1 the stored token_hash is the sha256 of the cookie value, never the value itself", async () => {
    const user = await createTestUser(database);

    const response = await login(app, user.email, user.password);

    const token = sessionCookieOf(response).value;
    const [row] = await sessionRows(user);
    expect(row?.token_hash.equals(hashSessionToken(token))).toBe(true);
    expect(row?.token_hash.equals(Buffer.from(token, "utf8"))).toBe(false);
    expect(row?.token_hash.toString("utf8")).not.toContain(token);
    expect(row?.csrf_token).toBe(response.json<SessionInfoBody>().csrf_token);
  });

  it("R3.1 logout deletes the row, clears the cookie with the same attributes and a later GET /me is 401", async () => {
    const user = await createTestUser(database);
    const loggedIn = await login(app, user.email, user.password);
    const token = sessionCookieOf(loggedIn).value;
    const csrfToken = loggedIn.json<SessionInfoBody>().csrf_token;

    const logout = await app.inject({ method: "POST", url: LOGOUT_URL, headers: mutatingHeaders({ token, csrfToken }) });

    expect(logout.statusCode).toBe(204);
    expect(logout.body).toBe("");
    const cleared = sessionCookieOf(logout);
    expect(cleared.value).toBe("");
    expect(cleared.expires?.getTime()).toBeLessThan(Date.now());
    expectStrictCookieAttributes(rawSetCookie(logout));
    expect(await sessionRows(user)).toEqual([]);

    const me = await app.inject({ method: "GET", url: ME_URL, headers: readHeaders({ token }) });
    expect(me.statusCode).toBe(401);
  });

  it("R3.1 logout without a session answers a 401 problem", async () => {
    const response = await app.inject({
      method: "POST",
      url: LOGOUT_URL,
      headers: { origin: APP_ORIGIN, "x-csrf-token": "a".repeat(43) },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ type: string }>().type).toBe(UNAUTHENTICATED_TYPE);
  });
});
