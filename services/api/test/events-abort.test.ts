/**
 * GET /events when the client leaves during the admin lookup (R3.4, O-243, PR #25 review H2): the
 * admin flag is read with an await before the stream registers, so a client that disconnects in
 * that window must not leave a registered stream that nothing unregisters. isAdmin is wrapped so
 * a test can hold it open, abort the request while it waits, and release it; four such aborts
 * must leave the user's stream count at zero, so four new streams still open (no 429 lockout).
 */
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp, type ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { MAX_STREAMS_PER_USER } from "../src/events/hub.js";
import { eventHub } from "../src/events/registry.js";
import { StreamClient, waitForConnections, waitUntil } from "./events-test-kit.js";
import { sessionCookie, TEST_CONFIG } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

/** Holds isAdmin until released, and counts the lookups that entered and that finished. */
const gate = vi.hoisted(() => ({
  held: null as Promise<void> | null,
  entered: 0,
  finished: 0,
}));

vi.mock("../src/admin/require-admin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/require-admin.js")>();
  return {
    ...actual,
    isAdmin: async (...args: Parameters<typeof actual.isAdmin>) => {
      gate.entered += 1;
      try {
        if (gate.held !== null) {
          await gate.held;
        }
        return await actual.isAdmin(...args);
      } finally {
        gate.finished += 1;
      }
    },
  };
});

/** A turn for the handler to continue after the lookup resolves, in milliseconds. */
const HANDLER_SETTLE_MS = 50;

describe("R3.4 GET /events and a client that leaves during the admin lookup", () => {
  let database: Database;
  let app: ApiApp;
  let url: string;
  let session: TestSession;
  let userId: string;
  const opened: StreamClient[] = [];

  beforeAll(async () => {
    database = appDatabase();
    app = buildApp({ database, config: TEST_CONFIG });
    await app.listen({ host: "127.0.0.1", port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v1/events`;
    userId = (await createTestUser(database)).id;
    session = await createTestSession(database, userId);
  });

  afterAll(async () => {
    for (const client of opened) {
      client.close();
    }
    await app.close();
    await database.destroy();
  });

  /** Starts a stream request, aborts it while isAdmin is held, then lets the lookup finish. */
  async function abortDuringAdminLookup(): Promise<void> {
    let release: () => void = () => undefined;
    gate.held = new Promise((resolve) => {
      release = resolve;
    });
    const entered = gate.entered;
    const finished = gate.finished;
    const controller = new AbortController();
    const request = fetch(url, { headers: { cookie: sessionCookie(session) }, signal: controller.signal });
    await waitUntil(() => gate.entered > entered, "the admin lookup to start");

    controller.abort();
    await expect(request).rejects.toThrow();
    await waitForConnections(app, 0);

    gate.held = null;
    release();
    await waitUntil(() => gate.finished > finished, "the admin lookup to finish");
    // Before the fix the handler registered its stream right after the lookup; give it that turn.
    await new Promise((resolve) => setTimeout(resolve, HANDLER_SETTLE_MS));
  }

  it("R3.4 registers no stream for a client that left during the admin lookup, so it is not locked out (PR #25 H2)", async () => {
    for (let attempt = 0; attempt < MAX_STREAMS_PER_USER; attempt += 1) {
      await abortDuringAdminLookup();
      expect(eventHub(app).streamCount(userId), `after abort ${attempt + 1}`).toBe(0);
    }

    for (let index = 0; index < MAX_STREAMS_PER_USER; index += 1) {
      const client = await StreamClient.open(url, session);
      opened.push(client);
      expect(client.response.status).toBe(200);
    }
    expect(eventHub(app).streamCount(userId)).toBe(MAX_STREAMS_PER_USER);
  });
});
