/**
 * Helmet headers and CORS (cross-origin resource sharing) (R3.1, A9 section 3, O-236).
 *
 * Mechanism: helmet adds the response headers a JSON API wants (nosniff, a Content-Security-Policy
 * that allows nothing to load or frame it); CORS reflects only the one app origin, with
 * credentials, and answers preflights in its onRequest hook before authentication runs, so a
 * browser's preflight never needs the session cookie it does not send. A request or preflight from
 * any other origin gets no Access-Control-Allow-Origin, so the browser refuses to expose the answer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { APP_ORIGIN } from "./support/app.js";
import { appDatabase } from "./support/database.js";
import { buildAppWithTestRoutes, TEST_PREFIX } from "./support/test-routes.js";

const FOREIGN_ORIGIN = "https://evil.example";

function preflight(origin: string): Record<string, string> {
  return {
    origin,
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type,x-csrf-token,idempotency-key",
  };
}

describe("R3.1 security headers and CORS", () => {
  let database: Database;
  let app: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    app = buildAppWithTestRoutes(database, async (scope) => {
      scope.get("/open", { config: { auth: "none" } }, () => ({ ok: true }));
      await Promise.resolve();
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it("R3.1 responses carry nosniff and a restrictive Content-Security-Policy", async () => {
    const response = await app.inject({ method: "GET", url: `${TEST_PREFIX}/open` });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const csp = String(response.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("R3.1 error responses carry the helmet headers too", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBeDefined();
  });

  it("R3.1 a preflight from the app origin is allowed with credentials and needs no session", async () => {
    const response = await app.inject({ method: "OPTIONS", url: "/api/v1/drills", headers: preflight(APP_ORIGIN) });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    const methods = String(response.headers["access-control-allow-methods"]);
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(methods).toContain(method);
    }
    const allowed = String(response.headers["access-control-allow-headers"]).toLowerCase();
    for (const header of ["content-type", "x-csrf-token", "idempotency-key", "x-request-id"]) {
      expect(allowed).toContain(header);
    }
  });

  it("R3.1 a preflight from another origin gets no Access-Control-Allow-Origin", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/drills",
      headers: preflight(FOREIGN_ORIGIN),
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("R3.1 a request from the app origin exposes the request id, replay and retry headers", async () => {
    const response = await app.inject({ method: "GET", url: `${TEST_PREFIX}/open`, headers: { origin: APP_ORIGIN } });

    expect(response.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    const exposed = String(response.headers["access-control-expose-headers"]).toLowerCase();
    for (const header of ["x-request-id", "idempotent-replayed", "retry-after"]) {
      expect(exposed).toContain(header);
    }
  });

  it("R3.1 a request from another origin gets no Access-Control-Allow-Origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${TEST_PREFIX}/open`,
      headers: { origin: FOREIGN_ORIGIN },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("R3.1 every response carries x-request-id, the preflight included", async () => {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: `${TEST_PREFIX}/open` }),
      app.inject({ method: "GET", url: "/api/v1/me" }),
      app.inject({ method: "GET", url: "/api/v1/nowhere" }),
      app.inject({ method: "OPTIONS", url: "/api/v1/drills", headers: preflight(APP_ORIGIN) }),
    ]);

    for (const response of responses) {
      expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    }
  });
});
