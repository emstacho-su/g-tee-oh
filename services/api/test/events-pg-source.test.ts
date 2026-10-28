/**
 * The Postgres notification source (R3.4, O-243) against the test container: it LISTENs on the
 * three builder channels as the app login (LISTEN needs no grant), delivers a pg_notify, and after
 * its backend is killed with pg_terminate_backend it reconnects with backoff and LISTENs again, so
 * a later pg_notify still arrives. close() stops it for good.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";

import { backoffDelayMs, createPgNotificationSource, type PgNotificationSource } from "../src/events/pg-source.js";
import type { HubLogger } from "../src/events/hub.js";
import { adminPool } from "./support/database.js";

const WAIT_TIMEOUT_MS = 15_000;
const POLL_MS = 100;

interface Received {
  channel: string;
  payload: string;
}

interface SpyLogger {
  logger: HubLogger;
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
}

/** A logger whose calls land in spies, so tests can assert on what was logged. */
function quietLogger(): SpyLogger {
  const warn = vi.fn();
  const info = vi.fn();
  const logger: HubLogger = {
    warn: (...args: unknown[]) => {
      warn(...args);
    },
    info: (...args: unknown[]) => {
      info(...args);
    },
  };
  return { logger, warn, info };
}

async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("R3.4 pg notification source", () => {
  let admin: pg.Pool;
  let source: PgNotificationSource;
  let received: Received[] = [];
  const applicationName = `listen-test-${randomUUID()}`;
  const log = quietLogger();

  const notify = (channel: string, payload: string) => admin.query("select pg_notify($1, $2)", [channel, payload]);
  const sawPayload = (payload: string) => received.some((item) => item.payload === payload);

  beforeAll(async () => {
    admin = adminPool();
    source = createPgNotificationSource(
      { connectionString: inject("appDatabaseUrl"), application_name: applicationName },
      { initialBackoffMs: 50, maxBackoffMs: 200 },
    );
    source.subscribe((channel, payload) => {
      received = [...received, { channel, payload }];
    });
    source.start(log.logger);
    await source.whenListening();
  });

  afterAll(async () => {
    await source.close();
    await admin.end();
  });

  it("R3.4 receives a pg_notify on each builder channel", async () => {
    const marker = randomUUID();
    for (const channel of ["coverage_added", "builder_state", "build_progress"]) {
      await notify(channel, `${channel}-${marker}`);
    }

    await waitFor(() => received.filter((item) => item.payload.endsWith(marker)).length === 3, "three notifications");
    expect(received.filter((item) => item.payload.endsWith(marker)).map((item) => item.channel)).toEqual([
      "coverage_added",
      "builder_state",
      "build_progress",
    ]);
  });

  it("R3.4 reconnects after its backend is terminated and still receives a later pg_notify", async () => {
    const terminated = await admin.query<{ terminated: boolean }>(
      "select pg_terminate_backend(pid) as terminated from pg_stat_activity where application_name = $1",
      [applicationName],
    );
    expect(terminated.rows.map((row) => row.terminated)).toEqual([true]);
    await waitFor(() => log.warn.mock.calls.length > 0, "the lost connection to be logged");

    const marker = `after-reconnect-${randomUUID()}`;
    await waitFor(async () => {
      await notify("coverage_added", marker);
      return sawPayload(marker);
    }, "a notification after the reconnect");
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ channels: expect.any(Array) as unknown }), expect.any(String));
  });

  it("R3.4 close stops listening and does not reconnect", async () => {
    const local = createPgNotificationSource({ connectionString: inject("appDatabaseUrl"), application_name: `${applicationName}-b` });
    local.start(quietLogger().logger);
    await local.whenListening();

    await local.close();
    await local.close();

    await waitFor(async () => {
      const rows = await admin.query("select 1 from pg_stat_activity where application_name = $1", [`${applicationName}-b`]);
      return rows.rowCount === 0;
    }, "the closed source's backend to go away");
  });

  it("R3.4 the reconnect delay doubles from the initial delay up to the cap", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelayMs(attempt, 500, 30_000));
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });
});
