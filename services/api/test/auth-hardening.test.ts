/**
 * Auth and request hardening from the PR #20 review (R3.1, A9 section 3, O-230, O-231, O-236):
 * - M3: a pasted email with surrounding whitespace or capitals logs in.
 * - M5: routes whose auth policy is "none" never look the cookie up, so a database outage never
 *   fails the liveness probe.
 * - M7: logout always answers 204 and clears the cookie, even with no live session; with a live
 *   session it is still CSRF (cross-site request forgery) protected.
 * - L1: proxies are trusted by address, so a direct client's X-Forwarded-For is ignored; a second
 *   login limiter keyed on the normalized email caps guessing whatever the client address.
 * - L3: logging in while presenting a session cookie deletes that older session.
 * - L4: every api response carries cache-control: no-store.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth/tokens.js";
import { createDatabaseFromUrl, type Database } from "../src/db.js";
import { CSRF_HEADER } from "../src/http/headers.js";
import { SESSION_COOKIE_NAME } from "../src/http/openapi.js";
import { LOGIN_EMAIL_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_MAX } from "../src/http/rate-limits.js";
import { APP_ORIGIN, buildTestApp, sessionCookie } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, TEST_PASSWORD } from "./support/database.js";

const LOGIN_URL = "/api/v1/auth/login";
const LOGOUT_URL = "/api/v1/auth/logout";
const ME_URL = "/api/v1/me";
const HEALTH_URL = "/api/v1/healthz";
/** A port nothing listens on: every query through this handle fails. */
const UNREACHABLE_DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
const WELL_FORMED_TOKEN = "A".repeat(43);

let addressCounter = 0;
function freshAddress(): string {
  addressCounter += 1;
  return `10.77.${Math.floor(addressCounter / 250)}.${(addressCounter % 250) + 1}`;
}

describe("R3.1 auth and request hardening (PR #20 review)", () => {
  let database: Database;
  let app: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  function login(payload: { email: string; password: string }, options: { remoteAddress?: string; cookie?: string; forwardedFor?: string } = {}) {
    return app.inject({
      method: "POST",
      url: LOGIN_URL,
      remoteAddress: options.remoteAddress ?? freshAddress(),
      headers: {
        origin: APP_ORIGIN,
        ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
        ...(options.forwardedFor === undefined ? {} : { "x-forwarded-for": options.forwardedFor }),
      },
      payload,
    });
  }

  it("R3.1 an email with surrounding whitespace and capitals logs in (M3)", async () => {
    const user = await createTestUser(database);

    const response = await login({ email: `  ${user.email.toUpperCase()}  `, password: user.password });

    expect(response.statusCode).toBe(200);
  });

  it("R3.1 a malformed email is still a 400 validation problem after trimming (M3)", async () => {
    const response = await login({ email: "  not-an-email  ", password: "whatever" });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:validation");
  });

  it("R3.1 the liveness probe and login never look a cookie up, so a database outage cannot fail the probe (M5)", async () => {
    const broken = createDatabaseFromUrl(UNREACHABLE_DATABASE_URL);
    const isolated = buildTestApp(broken);
    await isolated.ready();
    try {
      const response = await isolated.inject({
        method: "GET",
        url: HEALTH_URL,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${WELL_FORMED_TOKEN}` },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await isolated.close();
      await broken.destroy();
    }
  });

  it("R3.1 logout without any session answers 204 and clears the cookie (M7)", async () => {
    const response = await app.inject({ method: "POST", url: LOGOUT_URL, headers: { origin: APP_ORIGIN } });

    expect(response.statusCode).toBe(204);
    const cleared = response.cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME);
    expect(cleared?.value).toBe("");
  });

  it("R3.1 logout with an expired session answers 204 and clears the cookie (M7)", async () => {
    const user = await createTestUser(database);
    const expired = await createTestSession(database, user.id, { expiresAt: new Date(Date.now() - 1000) });

    const response = await app.inject({
      method: "POST",
      url: LOGOUT_URL,
      headers: { origin: APP_ORIGIN, cookie: sessionCookie(expired), [CSRF_HEADER]: expired.csrfToken },
    });

    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME)?.value).toBe("");
  });

  it("R3.1 logout with a live session still needs its CSRF token (M7)", async () => {
    const user = await createTestUser(database);
    const live = await createTestSession(database, user.id);

    const response = await app.inject({
      method: "POST",
      url: LOGOUT_URL,
      headers: { origin: APP_ORIGIN, cookie: sessionCookie(live) },
    });

    expect(response.statusCode).toBe(403);
    const still = await database.selectFrom("auth_session").select("id").where("id", "=", live.sessionId).execute();
    expect(still).toHaveLength(1);
  });

  it("R3.1 logging in while presenting a session cookie deletes that older session (L3)", async () => {
    const user = await createTestUser(database);
    const previous = await createTestSession(database, user.id);

    const response = await login({ email: user.email, password: user.password }, { cookie: sessionCookie(previous) });

    expect(response.statusCode).toBe(200);
    const old = await database
      .selectFrom("auth_session")
      .select("id")
      .where("token_hash", "=", hashSessionToken(previous.token))
      .execute();
    expect(old).toEqual([]);
  });

  it("R3.1 every api response carries cache-control: no-store (L4)", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: ME_URL, headers: { cookie: sessionCookie(session) } }),
      app.inject({ method: "GET", url: ME_URL }),
      app.inject({ method: "GET", url: HEALTH_URL }),
      login({ email: user.email, password: user.password }),
    ]);

    for (const response of responses) {
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("R3.1 a direct client's X-Forwarded-For is ignored, so spoofed addresses share its login bucket (L1)", async () => {
    const direct = freshAddress();
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      const response = await login(
        { email: `nobody-${attempt}@example.test`, password: "wrong" },
        { remoteAddress: direct, forwardedFor: `198.51.100.${attempt + 1}` },
      );
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, LOGIN_RATE_LIMIT_MAX).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("R3.1 X-Forwarded-For from a trusted proxy (loopback by default) names the client (L1)", async () => {
    const proxy = "127.0.0.1";
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      const response = await login(
        { email: `proxied-${attempt}@example.test`, password: "wrong" },
        { remoteAddress: proxy, forwardedFor: `203.0.113.${attempt + 1}` },
      );
      statuses.push(response.statusCode);
    }

    expect(statuses.every((status) => status === 401)).toBe(true);
  });

  it("R3.1 the login limiter keyed on the email trips whatever the client address (L1)", async () => {
    const user = await createTestUser(database);
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= LOGIN_EMAIL_RATE_LIMIT_MAX; attempt += 1) {
      const email = attempt % 2 === 0 ? user.email : `  ${user.email.toUpperCase()}`;
      const response = await login({ email, password: `wrong-${attempt}` });
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, LOGIN_EMAIL_RATE_LIMIT_MAX).every((status) => status === 401)).toBe(true);
    const last = statuses.at(-1);
    expect(last).toBe(429);
    const blocked = await login({ email: user.email, password: TEST_PASSWORD });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("R3.1 correct logins never consume the per-email budget (re-review MEDIUM 1)", async () => {
    const user = await createTestUser(database);
    for (let attempt = 0; attempt <= LOGIN_EMAIL_RATE_LIMIT_MAX; attempt += 1) {
      const response = await login({ email: user.email, password: user.password });
      expect(response.statusCode, `correct login ${attempt}`).toBe(200);
    }
    const failures: number[] = [];
    for (let attempt = 0; attempt < LOGIN_EMAIL_RATE_LIMIT_MAX; attempt += 1) {
      failures.push((await login({ email: user.email, password: `wrong-${attempt}` })).statusCode);
    }
    expect(failures.every((status) => status === 401)).toBe(true);
  });

  it("R3.1 a successful login resets the email's failure count (re-review MEDIUM 1)", async () => {
    const user = await createTestUser(database);
    const statuses: number[] = [];
    for (let round = 0; round < 2; round += 1) {
      for (let attempt = 0; attempt < LOGIN_EMAIL_RATE_LIMIT_MAX - 1; attempt += 1) {
        statuses.push((await login({ email: user.email, password: `wrong-${round}-${attempt}` })).statusCode);
      }
      statuses.push((await login({ email: user.email, password: user.password })).statusCode);
    }
    expect(statuses).not.toContain(429);
    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
  });
});
