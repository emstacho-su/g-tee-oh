/**
 * The admin builder endpoints (R3.5, O-36, O-88, O-188, O-241, O-242) against the test container:
 * GET /admin/builder, PATCH /admin/builder/settings, POST /admin/builder/pause and /resume.
 *
 * Other test files insert build_job rows concurrently, so queue counts and throughput through the
 * route are checked as lower bounds; the 24-hour throughput window is checked exactly through
 * readBuilderStatus with an injected clock far in the future, where only this file's rows fall.
 * builder_setting rows are deleted before each test with the superuser pool (the app role has no
 * delete, O-241), and the last builder_state comes from a fake notification source.
 */
import { randomBytes } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readBuilderStatus } from "../src/admin/builder-status.js";
import { buildApp, type ApiApp } from "../src/app.js";
import { createUser } from "../src/auth/users.js";
import type { Database } from "../src/db.js";
import type { NotificationListener, NotificationSource } from "../src/events/source.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { builderSettingsSchema, builderStatusSchema } from "../src/schemas/insights.js";
import { mutatingHeaders, readHeaders, TEST_CONFIG, APP_ORIGIN, sessionCookie } from "./support/app.js";
import {
  adminPool,
  appDatabase,
  createTestSession,
  createTestUser,
  TEST_PASSWORD,
  uniqueEmail,
  type TestSession,
} from "./support/database.js";

const BASE = "/api/v1/admin/builder";
const CONFIG_ID = "cfg_6_online_100";
const PAIR = "BB-BTN";
const FUTURE_NOW = new Date("2999-06-01T13:00:00Z");
const HOURS_PER_DAY = 24;

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

interface ProblemBody {
  type: string;
  status: number;
}

const ROUTES = [
  { method: "GET", url: BASE },
  { method: "PATCH", url: `${BASE}/settings`, payload: { paused: false } },
  { method: "POST", url: `${BASE}/pause` },
  { method: "POST", url: `${BASE}/resume` },
] as const;

const MUTATING_ROUTES = ROUTES.filter((route) => route.method !== "GET");

describe("R3.5 admin builder endpoints", () => {
  let database: Database;
  let admin: pg.Pool;
  let app: ApiApp;
  let source: FakeSource;
  let owner: TestSession;
  let member: TestSession;

  async function insertJob(status: string, updatedAt?: Date): Promise<void> {
    await admin.query(
      `insert into build_job (game_config_id, position_pair, flop, preflop_lines, tree_config_hash, k_runouts, priority, status, updated_at)
       values ($1, $2, 'KhQd4s', '{}', $3, 20, 1, $4::job_status, coalesce($5, now()))`,
      [CONFIG_ID, PAIR, randomBytes(16), status, updatedAt ?? null],
    );
  }

  async function status(): Promise<ReturnType<typeof builderStatusSchema.parse>> {
    const response = await app.inject({ method: "GET", url: BASE, headers: readHeaders(owner) });
    expect(response.statusCode).toBe(200);
    return builderStatusSchema.parse(response.json());
  }

  beforeAll(async () => {
    database = appDatabase();
    admin = adminPool();
    source = new FakeSource();
    app = buildApp({ database, config: TEST_CONFIG, notifications: source });
    await app.ready();
    const ownerUser = await createUser(database, { email: uniqueEmail("admin"), password: TEST_PASSWORD, isAdmin: true });
    owner = await createTestSession(database, ownerUser.id);
    member = await createTestSession(database, (await createTestUser(database)).id);
  });

  beforeEach(async () => {
    await admin.query("delete from builder_setting");
  });

  afterAll(async () => {
    await admin.query("delete from builder_setting");
    await app.close();
    await database.destroy();
    await admin.end();
  });

  it("R3.5 GET /admin/builder reports unknown before any builder_state, the stored overrides and zero storage without a ledger row", async () => {
    await admin.query("delete from storage_ledger");

    const body = await status();

    expect(body.state).toBe("unknown");
    expect(body.reason).toBeNull();
    expect(body.settings).toEqual({});
    expect(body.storage).toEqual({ library_bytes: 0, reference_bytes: 0 });
  });

  it("R3.5 GET /admin/builder counts the queue by status and storage from the latest ledger row", async () => {
    const before = await status();
    for (const jobStatus of ["queued", "queued", "running", "failed", "blocked_budget", "done"]) {
      await insertJob(jobStatus);
    }
    await admin.query(
      "insert into storage_ledger (day, library_bytes, reference_bytes) values ('2999-12-30', 1, 2), ('2999-12-31', 5000000000, 1234)",
    );

    const body = await status();

    expect(body.queue.queued).toBeGreaterThanOrEqual(before.queue.queued + 2);
    expect(body.queue.running).toBeGreaterThanOrEqual(before.queue.running + 1);
    expect(body.queue.failed).toBeGreaterThanOrEqual(before.queue.failed + 1);
    expect(body.queue.blocked_budget).toBeGreaterThanOrEqual(before.queue.blocked_budget + 1);
    expect(body.throughput_per_hour).toBeGreaterThanOrEqual(before.throughput_per_hour + 1 / HOURS_PER_DAY);
    expect(body.storage).toEqual({ library_bytes: 5_000_000_000, reference_bytes: 1234 });
  });

  it("R3.5 throughput_per_hour is the jobs done in the last 24 hours divided by 24", async () => {
    const inWindow = [1, 5, 23].map((hours) => new Date(FUTURE_NOW.getTime() - hours * 3_600_000));
    for (const updatedAt of inWindow) {
      await insertJob("done", updatedAt);
    }
    await insertJob("done", new Date(FUTURE_NOW.getTime() - 25 * 3_600_000));

    const body = await readBuilderStatus(database, null, FUTURE_NOW);

    expect(body.throughput_per_hour).toBeCloseTo(3 / HOURS_PER_DAY, 10);
  });

  it("R3.5 the state is the last builder_state the hub saw, and paused while the paused setting is true", async () => {
    source.emit("builder_state", { state: "throttled", reason: "outside the overnight window" });
    expect(await status()).toMatchObject({ state: "throttled", reason: "outside the overnight window" });

    const paused = await app.inject({ method: "POST", url: `${BASE}/pause`, headers: mutatingHeaders(owner) });
    expect(paused.statusCode).toBe(200);
    const pausedBody = builderStatusSchema.parse(paused.json());
    expect(pausedBody.state).toBe("paused");
    expect(pausedBody.settings).toEqual({ paused: true });
    expect((await status()).state).toBe("paused");

    const resumed = await app.inject({ method: "POST", url: `${BASE}/resume`, headers: mutatingHeaders(owner) });
    expect(resumed.statusCode).toBe(200);
    const resumedBody = builderStatusSchema.parse(resumed.json());
    expect(resumedBody.state).toBe("throttled");
    expect(resumedBody.settings).toEqual({ paused: false });
  });

  it("R3.5 PATCH /admin/builder/settings upserts every key and GET shows the stored overrides", async () => {
    const first = {
      cpu_share: 0.25,
      overnight: { start_hour: 22, end_hour: 6, utc_offset_minutes: -300, cpu_share: 1 },
      plan_configs: ["cfg_6_online_100", "cfg_6_online_150"],
    };
    const patched = await app.inject({ method: "PATCH", url: `${BASE}/settings`, headers: mutatingHeaders(owner), payload: first });
    expect(patched.statusCode).toBe(200);
    expect(builderSettingsSchema.parse(patched.json())).toEqual({ settings: first });

    const second = await app.inject({
      method: "PATCH",
      url: `${BASE}/settings`,
      headers: mutatingHeaders(owner),
      payload: { cpu_share: 0.75, storage_bits: 16 },
    });
    expect(second.statusCode).toBe(200);
    const expected = { ...first, cpu_share: 0.75, storage_bits: 16 };
    expect(second.json()).toEqual({ settings: expected });
    expect((await status()).settings).toEqual(expected);

    const stored = await admin.query<{ value: unknown }>("select value from builder_setting where key = 'plan_configs'");
    expect(stored.rows[0]?.value).toEqual(first.plan_configs);
  });

  it("R3.5 PATCH replays its stored response under the same Idempotency-Key", async () => {
    const headers = { ...mutatingHeaders(owner), [IDEMPOTENCY_HEADER]: `settings-${randomBytes(8).toString("hex")}` };
    const first = await app.inject({ method: "PATCH", url: `${BASE}/settings`, headers, payload: { poll_seconds: 60 } });
    const again = await app.inject({ method: "PATCH", url: `${BASE}/settings`, headers, payload: { poll_seconds: 60 } });

    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(again.json()).toEqual(first.json());
  });

  it("R3.5 PATCH answers a 400 problem for an unknown key, a wrong JSON type, an out-of-bounds value or an empty body", async () => {
    const bad = [
      { not_a_setting: 1 },
      { paused: "yes" },
      { max_iterations: 5_000_000_000 },
      { overnight: { start_hour: 1, end_hour: 2 } },
      {},
    ];
    for (const payload of bad) {
      const response = await app.inject({ method: "PATCH", url: `${BASE}/settings`, headers: mutatingHeaders(owner), payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
    expect((await status()).settings).toEqual({});
  });

  it("R3.5 every admin route answers 403 forbidden to a signed-in user who is not an admin", async () => {
    for (const route of ROUTES) {
      const headers = route.method === "GET" ? readHeaders(member) : mutatingHeaders(member);
      const response = await app.inject({ ...route, headers });
      expect(response.statusCode, route.url).toBe(403);
      expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:forbidden");
    }
    expect((await status()).settings).toEqual({});
  });

  it("R3.5 every admin route answers 401 without a session", async () => {
    for (const route of ROUTES) {
      const headers = route.method === "GET" ? {} : { origin: APP_ORIGIN };
      const response = await app.inject({ ...route, headers });
      expect(response.statusCode, route.url).toBe(401);
    }
  });

  it("R3.5 the three mutating admin routes enforce the CSRF token", async () => {
    for (const route of MUTATING_ROUTES) {
      const response = await app.inject({ ...route, headers: { cookie: sessionCookie(owner), origin: APP_ORIGIN } });
      expect(response.statusCode, route.url).toBe(403);
      expect(response.json<ProblemBody>().type).toBe("urn:g-tee-oh:problem:csrf");
    }
    expect((await status()).settings).toEqual({});
  });
});
