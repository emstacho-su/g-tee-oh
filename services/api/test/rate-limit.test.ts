/**
 * Rate limits (R3.1, A9 section 3, O-236): a generous global per-client-IP limit on every route,
 * the strict login limit, and the probes exempt.
 *
 * Mechanism: the limiter runs in an onRequest hook registered before authentication, so an
 * unauthenticated flood is counted and refused before any session lookup; the 429 is an RFC 9457
 * problem with Retry-After. Every test builds its own app, so the in-memory counters start empty.
 * Login's handler may be a 501 stub or the real one; only the statuses the hooks produce are
 * asserted.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { GLOBAL_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_MAX } from "../src/http/rate-limits.js";
import { APP_ORIGIN } from "./support/app.js";
import { appDatabase, TEST_PASSWORD, uniqueEmail } from "./support/database.js";
import { buildAppWithTestRoutes, TEST_PREFIX } from "./support/test-routes.js";

const PROBE_REQUESTS = 400;
const OTHER_CLIENT_IP = "203.0.113.7";
const TOO_MANY_REQUESTS = 429;

interface ProblemBody {
  type: string;
  status: number;
}

describe("R3.1 rate limits", () => {
  let database: Database;
  let app: ApiApp;

  beforeAll(() => {
    database = appDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  async function freshApp(): Promise<ApiApp> {
    app = buildAppWithTestRoutes(database, async (scope) => {
      scope.get("/ping", { config: { auth: "none" } }, () => ({ ok: true }));
      await Promise.resolve();
    });
    await app.ready();
    return app;
  }

  afterEach(async () => {
    await app.close();
  });

  function login(target: ApiApp, remoteAddress?: string) {
    return target.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: APP_ORIGIN },
      payload: { email: uniqueEmail("rate"), password: TEST_PASSWORD },
      ...(remoteAddress === undefined ? {} : { remoteAddress }),
    });
  }

  it("R3.1 the sixth login within a minute from one IP is a 429 problem with Retry-After", async () => {
    const target = await freshApp();
    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      const response = await login(target);
      expect(response.statusCode).not.toBe(TOO_MANY_REQUESTS);
    }

    const blocked = await login(target);

    expect(blocked.statusCode).toBe(TOO_MANY_REQUESTS);
    expect(blocked.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(blocked.json<ProblemBody>()).toMatchObject({ type: "urn:g-tee-oh:problem:rate-limited", status: 429 });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
  });

  it("R3.1 the login limit is per client IP", async () => {
    const target = await freshApp();
    for (let attempt = 0; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      await login(target);
    }

    const other = await login(target, OTHER_CLIENT_IP);

    expect(other.statusCode).not.toBe(TOO_MANY_REQUESTS);
  });

  it("R3.1 the global limit lets 300 requests through and refuses the 301st", async () => {
    const target = await freshApp();
    for (let request = 1; request <= GLOBAL_RATE_LIMIT_MAX; request += 1) {
      const response = await target.inject({ method: "GET", url: `${TEST_PREFIX}/ping` });
      expect(response.statusCode).toBe(200);
    }

    const blocked = await target.inject({ method: "GET", url: `${TEST_PREFIX}/ping` });

    expect(blocked.statusCode).toBe(TOO_MANY_REQUESTS);
    expect(blocked.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:rate-limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("R3.1 an unauthenticated flood on an authenticated route is limited before authentication", async () => {
    const target = await freshApp();
    for (let request = 1; request <= GLOBAL_RATE_LIMIT_MAX; request += 1) {
      const response = await target.inject({ method: "GET", url: "/api/v1/me" });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await target.inject({ method: "GET", url: "/api/v1/me" });

    expect(blocked.statusCode).toBe(TOO_MANY_REQUESTS);
  });

  it("R3.1 the health and OpenAPI routes are exempt from the global limit", async () => {
    const target = await freshApp();
    for (const url of ["/api/v1/healthz", "/healthz", "/api/v1/openapi.json"]) {
      for (let request = 1; request <= PROBE_REQUESTS; request += 1) {
        const response = await target.inject({ method: "GET", url });
        expect(response.statusCode).toBe(200);
      }
    }
  });
});
