/**
 * GET /events end to end (R3.4, A4 section 4, O-243): the api listens on a real port, a fetch
 * with a streaming body reader plays the browser, and events are sent with pg_notify from the
 * superuser pool through the real Postgres notification source (pg-source.ts) as the app login.
 * Shows the stream headers, coverage_added and builder_state reaching a signed-in user,
 * build_progress reaching admins only, a malformed payload dropped, the fifth stream per user
 * refused with a 429 problem, and a closed client unregistered from the hub.
 */
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from "node:stream/web";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { buildApp, type ApiApp } from "../src/app.js";
import { createUser } from "../src/auth/users.js";
import type { Database } from "../src/db.js";
import { createPgNotificationSource, type PgNotificationSource } from "../src/events/pg-source.js";
import { eventHub } from "../src/events/registry.js";
import { sessionCookie, TEST_CONFIG } from "./support/app.js";
import {
  adminPool,
  appDatabase,
  createTestSession,
  createTestUser,
  TEST_PASSWORD,
  uniqueEmail,
  type TestSession,
} from "./support/database.js";

const WAIT_TIMEOUT_MS = 10_000;
const POLL_MS = 50;
const RETRY_LINE = "retry: 5000\n\n";

/** A browser-like event stream reader over fetch. */
class StreamClient {
  text = "";
  private readonly decoder = new TextDecoder();

  private constructor(
    readonly response: Response,
    private readonly controller: AbortController,
  ) {}

  static async open(url: string, session: TestSession): Promise<StreamClient> {
    const controller = new AbortController();
    const response = await fetch(url, { headers: { cookie: sessionCookie(session) }, signal: controller.signal });
    const client = new StreamClient(response, controller);
    if (response.ok) {
      client.pump();
      await client.waitFor(RETRY_LINE);
    }
    return client;
  }

  private pump(): void {
    const body = this.response.body;
    if (body === null) {
      throw new Error("the event stream has no body");
    }
    const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const read = async (): Promise<void> => {
      for (;;) {
        const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (chunk.done) {
          return;
        }
        this.text += this.decoder.decode(chunk.value, { stream: true });
      }
    };
    read().catch((error: unknown) => {
      if (!(error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
    });
  }

  async waitFor(fragment: string): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (!this.text.includes(fragment)) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${JSON.stringify(fragment)}; received ${JSON.stringify(this.text)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  close(): void {
    this.controller.abort();
  }
}

async function waitUntil(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

describe("R3.4 GET /events", () => {
  let database: Database;
  let admin: pg.Pool;
  let source: PgNotificationSource;
  let app: ApiApp;
  let url: string;
  let member: TestSession;
  let owner: TestSession;
  let memberId: string;
  const opened: StreamClient[] = [];

  const notify = (channel: string, payload: unknown) =>
    admin.query("select pg_notify($1, $2)", [channel, typeof payload === "string" ? payload : JSON.stringify(payload)]);

  async function open(session: TestSession): Promise<StreamClient> {
    const client = await StreamClient.open(url, session);
    opened.push(client);
    return client;
  }

  beforeAll(async () => {
    database = appDatabase();
    admin = adminPool();
    source = createPgNotificationSource({ connectionString: inject("appDatabaseUrl") });
    app = buildApp({ database, config: TEST_CONFIG, notifications: source });
    source.start(app.log);
    await source.whenListening();
    await app.listen({ host: "127.0.0.1", port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v1/events`;
    memberId = (await createTestUser(database)).id;
    member = await createTestSession(database, memberId);
    const ownerUser = await createUser(database, { email: uniqueEmail("admin"), password: TEST_PASSWORD, isAdmin: true });
    owner = await createTestSession(database, ownerUser.id);
  });

  afterAll(async () => {
    // Streams are still open here: app.close() must end them itself (the preClose hook) or hang.
    expect(eventHub(app).streamCount()).toBeGreaterThan(0);
    await app.close();
    expect(eventHub(app).streamCount()).toBe(0);
    for (const client of opened) {
      client.close();
    }
    await source.close();
    await database.destroy();
    await admin.end();
  });

  it("R3.4 answers 401 without a session, and HEAD is not a way to open a stream", async () => {
    const response = await fetch(url);
    expect(response.status).toBe(401);

    const head = await fetch(url, { method: "HEAD", headers: { cookie: sessionCookie(member) } });
    expect(head.status).toBe(404);
    expect(eventHub(app).streamCount(memberId)).toBe(0);
  });

  it("R3.4 streams with no-store, no proxy buffering and the security headers, then relays coverage_added and builder_state", async () => {
    const client = await open(member);
    const headers = client.response.headers;
    expect(client.response.status).toBe(200);
    expect(headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("x-accel-buffering")).toBe("no");
    expect(headers.get("x-request-id")).toMatch(/.+/);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toContain("default-src 'none'");

    const coverage = { config_id: "cfg_6_online_100", pair: "BB-BTN", flop: "KhQd4s", build_id: randomUUID(), scenario_count: 7 };
    const state = { state: "running", reason: `test ${randomUUID()}` };
    await notify("coverage_added", coverage);
    await notify("builder_state", state);

    await client.waitFor(`event: builder_state\ndata: ${JSON.stringify(state)}\n\n`);
    expect(client.text).toContain(`event: coverage_added\ndata: ${JSON.stringify(coverage)}\n\n`);
    expect(eventHub(app).lastBuilderState()).toEqual(state);
  });

  it("R3.4 withholds build_progress from a non-admin and delivers it to an admin", async () => {
    const memberStream = await open(member);
    const adminStream = await open(owner);
    const progress = { job_id: randomUUID(), line: "r250.c", iteration: 1200, exploitability: [0.4, 0.2] };
    const marker = { config_id: "cfg_6_online_100", pair: "BB-BTN", flop: "2c3d4h", build_id: randomUUID(), scenario_count: 1 };

    await notify("build_progress", progress);
    await notify("coverage_added", marker);

    await memberStream.waitFor(marker.build_id);
    await adminStream.waitFor(marker.build_id);
    expect(memberStream.text).not.toContain("build_progress");
    expect(adminStream.text).toContain(`event: build_progress\ndata: ${JSON.stringify(progress)}\n\n`);
  });

  it("R3.4 drops a malformed payload and keeps the stream open", async () => {
    const client = await open(member);
    const valid = { state: "idle", reason: `after the bad one ${randomUUID()}` };

    await notify("builder_state", "{not json");
    await notify("builder_state", { state: "exploded", reason: "bad" });
    await notify("builder_state", valid);

    await client.waitFor(valid.reason);
    expect(client.text).not.toContain("exploded");
    expect(client.text).not.toContain("not json");
  });

  it("R3.4 refuses a fifth stream per user with a 429 problem, and a closed client frees its slot", async () => {
    for (const client of opened) {
      client.close();
    }
    await waitUntil(() => eventHub(app).streamCount(memberId) === 0, "earlier streams to unregister");

    const streams = [];
    for (let index = 0; index < 4; index += 1) {
      streams.push(await open(member));
    }
    expect(eventHub(app).streamCount(memberId)).toBe(4);

    const fifth = await fetch(url, { headers: { cookie: sessionCookie(member) } });
    expect(fifth.status).toBe(429);
    expect(fifth.headers.get("content-type")).toContain("application/problem+json");
    expect(((await fifth.json()) as { type: string }).type).toBe("urn:g-tee-oh:problem:too-many-streams");

    streams[0]?.close();
    await waitUntil(() => eventHub(app).streamCount(memberId) === 3, "the closed stream to unregister");
    const again = await open(member);
    expect(again.response.status).toBe(200);
  });
});
