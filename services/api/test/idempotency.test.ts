/**
 * Idempotency-Key handling (R3.1, A5 section 3, O-232).
 *
 * Mechanism: on a mutating route whose policy allows it, a request with a session and an
 * Idempotency-Key claims (user, key) in idempotency_key before the handler runs; the first response
 * below 500 is stored and replayed to every repeat with the same request hash, marked
 * idempotent-replayed: true. The test routes count their side effects, so "the handler ran once" is
 * observed directly. Rows are seeded and aged through the app role and the superuser pool to reach
 * the in-flight and expired states.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { requestHash } from "../src/http/canonical-json.js";
import { mutatingHeadersSchema } from "../src/http/headers.js";
import { mutatingHeaders } from "./support/app.js";
import { adminPool, appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";
import { buildAppWithTestRoutes, SideEffectCounter, TEST_PREFIX } from "./support/test-routes.js";

const CREATED = 201;
const NO_CONTENT = 204;
const INTERNAL_ERROR = 500;
const EXPIRED_AGE_HOURS = 25;
const WAIT_STEP_MS = 5;
const WAIT_LIMIT_MS = 2000;

// Loose, so extra fields survive validation and key order reaches the request hash.
const itemBodySchema = z.looseObject({ name: z.string().min(1) });

interface ProblemBody {
  type: string;
  status: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let waited = 0; waited < WAIT_LIMIT_MS; waited += WAIT_STEP_MS) {
    if (condition()) {
      return;
    }
    await delay(WAIT_STEP_MS);
  }
  throw new Error("condition not met in time");
}

describe("R3.1 Idempotency-Key", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;
  let userId: string;
  const created = new SideEffectCounter();
  const flaky = new SideEffectCounter();
  const removed = new SideEffectCounter();
  const slow = new SideEffectCounter();
  const plain = new SideEffectCounter();
  const texts = new SideEffectCounter();
  let releaseSlow: () => void = () => undefined;

  beforeAll(async () => {
    database = appDatabase();
    app = buildAppWithTestRoutes(database, async (scope) => {
      const headers = mutatingHeadersSchema;
      scope.post("/items", { schema: { headers, body: itemBodySchema } }, async (request, reply) => {
        const id = created.increment();
        return reply.code(CREATED).send({ id, name: request.body.name });
      });
      scope.post("/flaky", { schema: { headers, body: itemBodySchema } }, async (request, reply) => {
        if (flaky.increment() === 1) {
          throw new Error("transient failure");
        }
        return reply.code(CREATED).send({ name: request.body.name });
      });
      scope.delete("/items/:id", { schema: { headers } }, async (_request, reply) => {
        removed.increment();
        return reply.code(NO_CONTENT).send();
      });
      scope.post("/slow", { schema: { headers, body: itemBodySchema } }, async (request, reply) => {
        slow.increment();
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
        return reply.code(CREATED).send({ name: request.body.name });
      });
      scope.post("/plain", { config: { idempotent: false }, schema: { body: itemBodySchema } }, () => ({
        count: plain.increment(),
      }));
      scope.post("/text", { schema: { headers, body: itemBodySchema } }, async (_request, reply) => {
        texts.increment();
        return reply.type("text/plain").send("not json");
      });
      await Promise.resolve();
    });
    await app.ready();
    const user = await createTestUser(database);
    userId = user.id;
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  function post(path: string, key: string | undefined, body: unknown, as: TestSession = session) {
    const headers = { ...mutatingHeaders(as), ...(key === undefined ? {} : { "idempotency-key": key }) };
    return app.inject({ method: "POST", url: `${TEST_PREFIX}${path}`, headers, payload: body as object });
  }

  it("R3.1 a double-submitted POST runs the handler once and replays the first response", async () => {
    const key = randomUUID();
    const before = created.count;

    const first = await post("/items", key, { name: "one" });
    const second = await post("/items", key, { name: "one" });

    expect(created.count).toBe(before + 1);
    expect(first.statusCode).toBe(CREATED);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.statusCode).toBe(CREATED);
    expect(second.json()).toEqual(first.json());
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.headers["content-type"]).toMatch(/^application\/json/);
  });

  it("R3.1 the same key with a different body is a 422 idempotency-mismatch problem", async () => {
    const key = randomUUID();
    await post("/items", key, { name: "one" });
    const before = created.count;

    const response = await post("/items", key, { name: "two" });

    expect(response.statusCode).toBe(422);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:idempotency-mismatch");
    expect(created.count).toBe(before);
  });

  it("R3.1 the same body with keys in another order is the same request", async () => {
    const key = randomUUID();
    await app.inject({
      method: "POST",
      url: `${TEST_PREFIX}/items`,
      headers: { ...mutatingHeaders(session), "idempotency-key": key, "content-type": "application/json" },
      payload: '{"name":"same","extra":1}',
    });
    const response = await app.inject({
      method: "POST",
      url: `${TEST_PREFIX}/items`,
      headers: { ...mutatingHeaders(session), "idempotency-key": key, "content-type": "application/json" },
      payload: '{"extra":1,"name":"same"}',
    });

    expect(response.headers["idempotent-replayed"]).toBe("true");
  });

  it("R3.1 a key whose first request is still in flight is a 409 problem", async () => {
    const key = randomUUID();
    const route = `${TEST_PREFIX}/items`;
    const hash = requestHash({ method: "POST", route, params: {}, body: { name: "one" } });
    await database
      .insertInto("idempotency_key")
      .values({ user_id: userId, key, method: "POST", route, request_hash: hash })
      .execute();

    const response = await post("/items", key, { name: "one" });

    expect(response.statusCode).toBe(409);
    expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:idempotency-in-flight");
  });

  it("R3.1 a concurrent duplicate while the handler runs is a 409 problem", async () => {
    const key = randomUUID();
    const before = slow.count;
    const first = post("/slow", key, { name: "slow" });
    await waitFor(() => slow.count === before + 1);

    const duplicate = await post("/slow", key, { name: "slow" });
    releaseSlow();
    const original = await first;

    expect(duplicate.statusCode).toBe(409);
    expect(original.statusCode).toBe(CREATED);
    expect(slow.count).toBe(before + 1);
  });

  it("R3.1 a handler that fails with a 500 releases the key so the retry runs", async () => {
    const key = randomUUID();

    const failed = await post("/flaky", key, { name: "retry" });
    const retried = await post("/flaky", key, { name: "retry" });

    expect(failed.statusCode).toBe(INTERNAL_ERROR);
    expect(retried.statusCode).toBe(CREATED);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
    expect(flaky.count).toBe(2);
  });

  it("R3.1 a key older than 24 hours is executed again", async () => {
    const key = randomUUID();
    await post("/items", key, { name: "old" });
    const admin = adminPool();
    try {
      await admin.query(
        "update idempotency_key set created_at = now() - make_interval(hours => $3) where user_id = $1 and key = $2",
        [userId, key, EXPIRED_AGE_HOURS],
      );
    } finally {
      await admin.end();
    }
    const before = created.count;

    const again = await post("/items", key, { name: "different body is fine once expired" });

    expect(again.statusCode).toBe(CREATED);
    expect(again.headers["idempotent-replayed"]).toBeUndefined();
    expect(created.count).toBe(before + 1);
  });

  it("R3.1 without a key the handler runs every time", async () => {
    const before = created.count;

    await post("/items", undefined, { name: "free" });
    await post("/items", undefined, { name: "free" });

    expect(created.count).toBe(before + 2);
  });

  it("R3.1 keys are per user: another user with the same key runs independently", async () => {
    const key = randomUUID();
    const other = await createTestUser(database);
    const otherSession = await createTestSession(database, other.id);
    const before = created.count;

    await post("/items", key, { name: "mine" });
    const theirs = await post("/items", key, { name: "theirs" }, otherSession);

    expect(theirs.statusCode).toBe(CREATED);
    expect(theirs.headers["idempotent-replayed"]).toBeUndefined();
    expect(created.count).toBe(before + 2);
  });

  it("R3.1 a route with idempotent false ignores the header", async () => {
    const key = randomUUID();
    const before = plain.count;

    await post("/plain", key, { name: "x" });
    const second = await post("/plain", key, { name: "x" });

    expect(plain.count).toBe(before + 2);
    expect(second.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("R3.1 a replayed 204 has no body", async () => {
    const key = randomUUID();
    const headers = { ...mutatingHeaders(session), "idempotency-key": key };
    const before = removed.count;

    const first = await app.inject({ method: "DELETE", url: `${TEST_PREFIX}/items/1`, headers });
    const second = await app.inject({ method: "DELETE", url: `${TEST_PREFIX}/items/1`, headers });

    expect(removed.count).toBe(before + 1);
    expect(first.statusCode).toBe(NO_CONTENT);
    expect(second.statusCode).toBe(NO_CONTENT);
    expect(second.body).toBe("");
    expect(second.headers["idempotent-replayed"]).toBe("true");
  });

  it("R3.1 a response that is not JSON is not stored, so the key stays free", async () => {
    const key = randomUUID();
    const before = texts.count;

    await post("/text", key, { name: "x" });
    const second = await post("/text", key, { name: "x" });

    expect(texts.count).toBe(before + 2);
    expect(second.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("R3.1 a malformed key is a 400 problem and the handler does not run", async () => {
    const before = created.count;

    const response = await post("/items", "has space", { name: "x" });

    expect(response.statusCode).toBe(400);
    expect(created.count).toBe(before);
  });
});
