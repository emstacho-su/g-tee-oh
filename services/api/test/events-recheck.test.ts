/**
 * GET /events keeps checking authorization after the open (R3.4, R3.5, O-243, PR #25 review L2):
 * over a real port with a short heartbeat injected into the app's hub before the routes register.
 * Shows a revoked admin's stream losing build_progress at the next heartbeat, logout ending the
 * session's open stream at once, and a stream whose session expired or was deleted ending at the
 * next heartbeat. Notifications come from a fake source, so no LISTEN connection is needed.
 */
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp, type ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { eventHub } from "../src/events/registry.js";
import type { NotificationListener, NotificationSource } from "../src/events/source.js";
import { StreamClient, waitForConnections, waitUntil } from "./events-test-kit.js";
import { mutatingHeaders, TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

const HEARTBEAT_MS = 100;
/** Heartbeats to wait after a change, so at least one full recheck has run since it. */
const BEATS_AFTER_CHANGE = 2;

class FakeSource implements NotificationSource {
  private listeners: readonly NotificationListener[] = [];

  subscribe(listener: NotificationListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((existing) => existing !== listener);
    };
  }

  emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners) {
      listener(channel, JSON.stringify(payload));
    }
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function progress(jobId: string): Record<string, unknown> {
  return { job_id: jobId, line: "r250.c", iteration: 10, exploitability: null };
}

function coverageMarker(): Record<string, unknown> & { build_id: string } {
  return { config_id: "cfg_6_online_100", pair: "BB-BTN", flop: "2c3d4h", build_id: randomUUID(), scenario_count: 1 };
}

describe("R3.4 GET /events re-checks the session and the admin flag", () => {
  let database: Database;
  let admin: pg.Pool;
  let source: FakeSource;
  let app: ApiApp;
  let url: string;
  const opened: StreamClient[] = [];

  async function freshSession(options: { admin?: boolean } = {}): Promise<{ userId: string; session: TestSession }> {
    const userId = (await createTestUser(database)).id;
    if (options.admin === true) {
      // The app role cannot set is_admin (PR #25 L1); the superuser pool does, as create-user --admin would.
      await admin.query("update app_user set is_admin = true where id = $1", [userId]);
    }
    return { userId, session: await createTestSession(database, userId) };
  }

  async function open(session: TestSession): Promise<StreamClient> {
    const client = await StreamClient.open(url, session);
    opened.push(client);
    expect(client.response.status).toBe(200);
    return client;
  }

  async function afterBeats(client: StreamClient): Promise<void> {
    const target = client.heartbeats() + BEATS_AFTER_CHANGE;
    await waitUntil(() => client.heartbeats() >= target || client.ended, "heartbeats after the change");
  }

  beforeAll(async () => {
    database = appDatabase();
    admin = adminPool();
    source = new FakeSource();
    app = buildApp({ database, config: TEST_CONFIG, notifications: source });
    // The routes take the hub created first for this app, so the short heartbeat applies to them.
    eventHub(app, { heartbeatMs: HEARTBEAT_MS });
    await app.listen({ host: "127.0.0.1", port: 0 });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v1/events`;
  });

  afterEach(() => {
    for (const client of opened.splice(0)) {
      client.close();
    }
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
    await admin.end();
  });

  it("R3.5 an admin whose flag is revoked stops receiving build_progress at the next heartbeat", async () => {
    const { userId, session } = await freshSession({ admin: true });
    const client = await open(session);
    source.emit("build_progress", progress("before-revoke"));
    await client.waitFor("before-revoke");

    await admin.query("update app_user set is_admin = false where id = $1", [userId]);
    await afterBeats(client);
    const marker = coverageMarker();
    source.emit("build_progress", progress("after-revoke"));
    source.emit("coverage_added", marker);

    await client.waitFor(marker.build_id);
    expect(client.text).not.toContain("after-revoke");
    expect(client.ended).toBe(false);
  });

  it("R3.4 logout ends the session's open stream at once", async () => {
    const { userId, session } = await freshSession();
    const client = await open(session);
    const otherDevice = await open(await createTestSession(database, userId));

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: mutatingHeaders(session) });

    expect(response.statusCode).toBe(204);
    await waitUntil(() => client.ended, "the logged-out stream to end");
    expect(eventHub(app).streamCount(userId)).toBe(1);
    expect(otherDevice.ended).toBe(false);
    // The ended stream also gives up its connection (connection: close), so shutdown never waits on it.
    await waitForConnections(app, 1);
  });

  it("R3.4 a stream whose session expired ends at the next heartbeat", async () => {
    const { userId, session } = await freshSession();
    const client = await open(session);

    await admin.query("update auth_session set expires_at = now() - interval '1 second' where id = $1", [session.sessionId]);

    await waitUntil(() => client.ended, "the expired session's stream to end");
    expect(eventHub(app).streamCount(userId)).toBe(0);
  });

  it("R3.4 a stream whose session row was deleted ends at the next heartbeat", async () => {
    const { userId, session } = await freshSession();
    const client = await open(session);

    await admin.query("delete from auth_session where id = $1", [session.sessionId]);

    await waitUntil(() => client.ended, "the deleted session's stream to end");
    expect(eventHub(app).streamCount(userId)).toBe(0);
  });
});
