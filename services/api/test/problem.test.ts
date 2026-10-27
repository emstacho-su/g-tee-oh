/**
 * RFC 9457 problem responses end to end (R3.1, A5 section 3, A9 section 3).
 *
 * Mechanism: test routes registered after the app plugins throw the failures a handler can meet
 * (a plain Error carrying SQL text and an internal uuid, a Zod validation failure, a response that
 * breaks its own schema), and the body parser meets the malformed inputs a client can send (an
 * oversized body, a wrong content type, broken JSON). Every answer must be application/problem+json
 * with the problem fields only; a 5xx body is generic, so a stack trace, SQL text or an internal
 * identifier never reaches the client.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { BODY_LIMIT_BYTES } from "../src/http/server-options.js";
import { readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser } from "./support/database.js";
import { buildAppWithTestRoutes, TEST_PREFIX } from "./support/test-routes.js";

const INTERNAL_ID = randomUUID();
const SQL_TEXT = "select * from app_user where email = 'x'";
const PROBLEM_KEYS = ["detail", "instance", "request_id", "status", "title", "type"];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: Array<{ path: string; message: string }>;
}

describe("R3.1 problem responses", () => {
  let database: Database;
  let app: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    app = buildAppWithTestRoutes(database, async (scope) => {
      scope.get("/sql-leak", { config: { auth: "none" } }, () => {
        throw new Error(`${SQL_TEXT} failed for ${INTERNAL_ID}`);
      });
      scope.get(
        "/bad-response",
        { config: { auth: "none" }, schema: { response: { 200: z.object({ count: z.number() }) } } },
        () => ({ count: `secret-${INTERNAL_ID}` }) as unknown as { count: number },
      );
      scope.post(
        "/echo",
        { config: { auth: "none", csrf: "none" }, schema: { body: z.object({ name: z.string().min(1) }) } },
        (request) => request.body,
      );
      await Promise.resolve();
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it("R3.1 a thrown error holding SQL text and an internal uuid answers a generic 500 problem", async () => {
    const response = await app.inject({ method: "GET", url: `${TEST_PREFIX}/sql-leak` });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    const body = response.json<ProblemBody>();
    expect(Object.keys(body).sort()).toEqual(PROBLEM_KEYS);
    expect(body).toMatchObject({
      type: "urn:g-tee-oh:problem:internal",
      title: "Internal server error",
      status: 500,
      instance: `${TEST_PREFIX}/sql-leak`,
      request_id: response.headers["x-request-id"],
    });
    expect(response.body).not.toMatch(/select|app_user|stack|failed for|\.ts:\d+/i);
    const uuids = response.body.match(UUID_PATTERN) ?? [];
    expect(uuids.filter((id) => id !== body.request_id)).toEqual([]);
  });

  it("R3.1 a Zod validation failure is a 400 problem naming the field", async () => {
    const response = await app.inject({ method: "POST", url: `${TEST_PREFIX}/echo`, payload: { name: "" } });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    const body = response.json<ProblemBody>();
    expect(body.type).toBe("urn:g-tee-oh:problem:validation");
    expect(body.errors?.map((error) => error.path)).toContain("body.name");
  });

  it("R3.1 a response that fails its own schema is a generic 500 without the value", async () => {
    const response = await app.inject({ method: "GET", url: `${TEST_PREFIX}/bad-response` });

    expect(response.statusCode).toBe(500);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:internal");
    expect(response.body).not.toContain("secret-");
    expect(response.body).not.toContain(INTERNAL_ID);
  });

  it("R3.1 an unknown path is a 404 problem for an unauthenticated caller", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/no-such-route?x=1" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<ProblemBody>()).toMatchObject({
      type: "urn:g-tee-oh:problem:not-found",
      status: 404,
      instance: "/api/v1/no-such-route",
    });
  });

  it("R3.1 an unknown path is a 404 problem for an authenticated caller", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);

    const response = await app.inject({ method: "GET", url: "/api/v1/no-such-route", headers: readHeaders(session) });

    expect(response.statusCode).toBe(404);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:not-found");
  });

  it("R3.1 a body over the 64 KiB limit is a 413 problem", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${TEST_PREFIX}/echo`,
      payload: { name: "x".repeat(BODY_LIMIT_BYTES + 1) },
    });

    expect(response.statusCode).toBe(413);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:payload-too-large");
  });

  it("R3.1 a non-JSON content type on a JSON route is a 415 problem", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${TEST_PREFIX}/echo`,
      headers: { "content-type": "text/plain" },
      payload: "name=x",
    });

    expect(response.statusCode).toBe(415);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:unsupported-media-type");
  });

  it("R3.1 malformed JSON is a 400 problem", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${TEST_PREFIX}/echo`,
      headers: { "content-type": "application/json" },
      payload: '{"name": ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:bad-request");
  });
});
