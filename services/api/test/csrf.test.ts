/**
 * The CSRF (cross-site request forgery) guard (R3.1, A9 section 3, O-230).
 *
 * Mechanism: an onRequest hook after authentication checks mutating requests only. The Origin
 * check comes first on every policy but "none": an Origin header must equal the app origin, and
 * without one a Sec-Fetch-Site of cross-site is refused; a client sending neither (curl, the
 * create-user tooling) passes that step. A "token" route then needs x-csrf-token equal to the
 * session's own csrf_token, compared in constant time. Login is "origin-only": it has no session yet,
 * so the Origin is all it can be checked against.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { APP_ORIGIN, mutatingHeaders, readHeaders, sessionCookie } from "./support/app.js";
import {
  appDatabase,
  createTestSession,
  createTestUser,
  TEST_PASSWORD,
  type TestSession,
} from "./support/database.js";
import { buildAppWithTestRoutes, SideEffectCounter, TEST_PREFIX } from "./support/test-routes.js";

const FOREIGN_ORIGIN = "https://evil.example";

interface ProblemBody {
  type: string;
  status: number;
}

/** The same headers without Origin: a copy, the input is left as it is. */
function withoutOriginHeader(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "origin"));
}

describe("R3.1 CSRF guard", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;
  const handled = new SideEffectCounter();

  beforeAll(async () => {
    database = appDatabase();
    app = buildAppWithTestRoutes(database, async (scope) => {
      scope.post("/mutate", () => ({ handled: handled.increment() }));
      scope.get("/read", () => ({ ok: true }));
      await Promise.resolve();
    });
    await app.ready();
    const user = await createTestUser(database);
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  function mutate(headers: Record<string, string>) {
    return app.inject({ method: "POST", url: `${TEST_PREFIX}/mutate`, headers, payload: {} });
  }

  function expectProblem(response: { statusCode: number; json: <T>() => T }, slug: string): void {
    expect(response.statusCode).toBe(403);
    expect(response.json<ProblemBody>().type).toBe(`urn:g-tee-oh:problem:${slug}`);
  }

  it("R3.1 a mutating request without the token is a 403 csrf problem", async () => {
    expectProblem(await mutate({ cookie: sessionCookie(session), origin: APP_ORIGIN }), "csrf");
  });

  it("R3.1 a mutating request with a wrong token is a 403 csrf problem", async () => {
    const headers = { ...mutatingHeaders(session), "x-csrf-token": `${session.csrfToken.slice(1)}x` };
    expectProblem(await mutate(headers), "csrf");
  });

  it("R3.1 the correct token from a foreign Origin is a 403 forbidden-origin problem", async () => {
    expectProblem(await mutate({ ...mutatingHeaders(session), origin: FOREIGN_ORIGIN }), "forbidden-origin");
  });

  it("R3.1 Origin null is a 403 forbidden-origin problem", async () => {
    expectProblem(await mutate({ ...mutatingHeaders(session), origin: "null" }), "forbidden-origin");
  });

  it("R3.1 Sec-Fetch-Site cross-site without an Origin is a 403 forbidden-origin problem", async () => {
    const withoutOrigin = withoutOriginHeader(mutatingHeaders(session));
    expectProblem(await mutate({ ...withoutOrigin, "sec-fetch-site": "cross-site" }), "forbidden-origin");
  });

  it("R3.1 the correct token and Origin reach the handler", async () => {
    const before = handled.count;
    const response = await mutate(mutatingHeaders(session));

    expect(response.statusCode).toBe(200);
    expect(handled.count).toBe(before + 1);
  });

  it("R3.1 the correct token without Origin or Sec-Fetch-Site passes (a non-browser client)", async () => {
    const withoutOrigin = withoutOriginHeader(mutatingHeaders(session));
    const response = await mutate(withoutOrigin);

    expect(response.statusCode).toBe(200);
  });

  it("R3.1 refused requests never reach the handler", async () => {
    const before = handled.count;
    await mutate({ cookie: sessionCookie(session), origin: APP_ORIGIN });
    await mutate({ ...mutatingHeaders(session), origin: FOREIGN_ORIGIN });

    expect(handled.count).toBe(before);
  });

  it("R3.1 GET routes are never checked", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${TEST_PREFIX}/read`,
      headers: { ...readHeaders(session), origin: FOREIGN_ORIGIN, "sec-fetch-site": "cross-site" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("R3.1 a token from another user's session is rejected", async () => {
    const other = await createTestUser(database);
    const otherSession = await createTestSession(database, other.id);

    const response = await mutate({ ...mutatingHeaders(session), "x-csrf-token": otherSession.csrfToken });

    expectProblem(response, "csrf");
  });

  it("R3.1 login from a foreign Origin is 403 even without a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: FOREIGN_ORIGIN },
      payload: { email: "nobody@example.test", password: TEST_PASSWORD },
    });

    expectProblem(response, "forbidden-origin");
  });

  it("R3.1 login from the app Origin passes the guard without a token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: APP_ORIGIN },
      payload: { email: "nobody@example.test", password: TEST_PASSWORD },
    });

    expect(response.statusCode).not.toBe(403);
  });
});
