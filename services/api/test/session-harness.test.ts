/**
 * The integration harness and the session lookup (R3.1, O-231): the test container is reachable
 * as the app role, a seeded session authenticates, an expired one does not and is deleted, and a
 * route a later session builds answers a 501 problem naming its owner once authenticated (O-38).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { buildTestApp, readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser } from "./support/database.js";

describe("R3.1 session harness", () => {
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

  it("R3.1 the app role reads the seeded catalog in the test container", async () => {
    const rows = await database.selectFrom("game_config").select("id").execute();
    expect(rows).toHaveLength(11);
  });

  it("R3.1 an authenticated request to a planned route answers a 501 problem naming its owner", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/progress/streak",
      headers: readHeaders(session),
    });

    expect(response.statusCode).toBe(501);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<{ type: string; status: number; detail: string }>()).toMatchObject({
      type: "urn:g-tee-oh:problem:not-implemented",
      status: 501,
      detail: expect.stringContaining("S31") as unknown,
    });
  });

  it("R3.1 an expired session is rejected with 401 and its row is deleted", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id, { expiresAt: new Date(Date.now() - 1000) });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/progress/streak",
      headers: readHeaders(session),
    });

    expect(response.statusCode).toBe(401);
    const remaining = await database
      .selectFrom("auth_session")
      .select("id")
      .where("id", "=", session.sessionId)
      .execute();
    expect(remaining).toEqual([]);
  });

  it("R3.1 a cookie that is not a well-formed token is treated as no session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/progress/streak",
      headers: { cookie: "__Host-gto_session=not-a-token" },
    });

    expect(response.statusCode).toBe(401);
  });
});
