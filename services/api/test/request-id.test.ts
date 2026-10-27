/**
 * Request ids and log redaction (R3.1, A9 section 3, O-158).
 *
 * Mechanism: Fastify's own x-request-id handling is off (requestIdHeader false) and genReqId
 * takes the incoming header only when it matches a conservative pattern, so a client cannot inject
 * log lines or oversized values through it; otherwise the id is a random UUID. The id is echoed on
 * every response and in every problem body. The logger options redact the cookie, the CSRF
 * (cross-site request forgery) token, authorization and set-cookie, which this test proves by
 * logging through a Fastify logger built with exactly those options.
 */
import { Writable } from "node:stream";

import Fastify, { type FastifyLoggerOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { serverOptions } from "../src/http/server-options.js";
import { TEST_CONFIG } from "./support/app.js";
import { appDatabase } from "./support/database.js";
import { buildAppWithTestRoutes, TEST_PREFIX } from "./support/test-routes.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REQUEST_ID_LENGTH = 128;

describe("R3.1 request ids", () => {
  let database: Database;
  let app: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    app = buildAppWithTestRoutes(database, async (scope) => {
      scope.get("/id", { config: { auth: "none" } }, (request) => ({ id: request.id }));
      await Promise.resolve();
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it("R3.1 a well-formed incoming x-request-id is used and echoed", async () => {
    const id = "web.4f2a_9:trace-01";
    const response = await app.inject({ method: "GET", url: `${TEST_PREFIX}/id`, headers: { "x-request-id": id } });

    expect(response.headers["x-request-id"]).toBe(id);
    expect(response.json<{ id: string }>().id).toBe(id);
  });

  it("R3.1 a malformed incoming x-request-id is replaced by a uuid", async () => {
    for (const bad of ["has space", "new line", "a/b", "x".repeat(MAX_REQUEST_ID_LENGTH + 1)]) {
      const response = await app.inject({
        method: "GET",
        url: `${TEST_PREFIX}/id`,
        headers: { "x-request-id": bad },
      });
      expect(response.headers["x-request-id"]).toMatch(UUID_PATTERN);
    }
  });

  it("R3.1 an id of exactly 128 allowed characters is kept", async () => {
    const id = "a".repeat(MAX_REQUEST_ID_LENGTH);
    const response = await app.inject({ method: "GET", url: `${TEST_PREFIX}/id`, headers: { "x-request-id": id } });

    expect(response.headers["x-request-id"]).toBe(id);
  });

  it("R3.1 a request without an id gets a uuid, echoed on error responses and in the problem body", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/no-such-route" });

    expect(response.headers["x-request-id"]).toMatch(UUID_PATTERN);
    expect(response.json<{ request_id: string }>().request_id).toBe(response.headers["x-request-id"]);
  });

  it("R3.1 an unauthenticated 401 still carries x-request-id", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { "x-request-id": "probe-1" } });

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-request-id"]).toBe("probe-1");
  });
});

describe("R3.1 log redaction", () => {
  it("R3.1 logging off passes no logger", () => {
    expect(serverOptions(TEST_CONFIG, false).logger).toBe(false);
  });

  it("R3.1 the logger redacts cookies, the CSRF token, authorization and set-cookie", () => {
    const options = serverOptions(TEST_CONFIG, true).logger as FastifyLoggerOptions;
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString("utf8"));
        callback();
      },
    });
    const logged = Fastify({ logger: { ...options, stream: sink } });

    logged.log.info(
      {
        req: { headers: { cookie: "s=secret-cookie", "x-csrf-token": "secret-csrf", authorization: "Bearer secret" } },
        res: { headers: { "set-cookie": "s=secret-set" } },
      },
      "request",
    );

    const output = lines.join("");
    expect(output).toContain("request");
    expect(output).not.toMatch(/secret/);
  });
});
