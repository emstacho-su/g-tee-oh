/**
 * GET /coverage and POST /coverage/requests over the fixture solver-query and the test database
 * (R3.4, O-172, O-176, O-240, ADR 0018): the relay with its synthetic and database fields, a
 * covered spot answered without a write, a preflop gap recorded, a blocked_budget job reported
 * with no queue position and left at its priority, a failed job left alone, repeated requests
 * leaving one coverage_request row (PR #25 review M4), and the 400, 403 and 404 problems.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER } from "../src/http/headers.js";
import { coverageRequestResultSchema, coverageSchema } from "../src/schemas/study.js";
import { mutatingHeaders, readHeaders } from "./support/app.js";
import { countCoverageRequests, countSpotRequests, deleteBuildJobs, insertBuildJob, readBuildJob } from "./support/build-jobs.js";
import { adminPool, appDatabase, createTestSession, createTestUser, type TestSession, type TestUser } from "./support/database.js";
import { buildTrainerApp } from "./support/solver-query.js";

const CONFIG = "cfg_6_online_100";
const PAIR = "BB-BTN";
/** In the catalog, with no preflop solution in the fixture library. */
const GAP_CONFIG = "cfg_9_live_13_300";
/** Matches the configuration grammar but is not in the catalog. */
const UNKNOWN_CONFIG = "cfg_7_online_100";
const REQUESTS = "/api/v1/coverage/requests";
const COVERED = { status: "covered", job_id: null, priority: null, queue_position: null };
const RECORDED = { status: "recorded", job_id: null, priority: null, queue_position: null };

describe("R3.4 GET /coverage", () => {
  let database: Database;
  let pool: pg.Pool;
  let app: ApiApp;
  let session: TestSession;
  const jobIds: string[] = [];

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    app = buildTrainerApp(database);
    await app.ready();
    const user = await createTestUser(database);
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await deleteBuildJobs(pool, jobIds);
    await app.close();
    await database.destroy();
    await pool.end();
  });

  it("R3.4 relays solver-query's coverage with the synthetic flag, the database state and the queue", async () => {
    const jobId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop: "8c5d2s", priority: 2 });
    jobIds.push(jobId);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/coverage?config_id=${CONFIG}&pair=${PAIR}`,
      headers: readHeaders(session),
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = coverageSchema.parse(response.json());
    expect(body).toMatchObject({ config_id: CONFIG, pair: PAIR, preflop_available: true, synthetic: true, database: "connected" });
    const entry = body.queue.find((job) => job.job_id === jobId);
    expect(entry).toMatchObject({ flop: "8c5d2s", priority: 2 });
    expect(entry?.position).toBeGreaterThanOrEqual(1);
  });

  it("R3.4 a configuration with no preflop solution answers preflop_available false", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/coverage?config_id=${GAP_CONFIG}&pair=${PAIR}`,
      headers: readHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    expect(coverageSchema.parse(response.json())).toMatchObject({ preflop_available: false, synthetic: false, flops: [] });
  });

  it("R3.4 a pair written in-position first is a 400 problem", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/coverage?config_id=${CONFIG}&pair=BTN-BB`,
      headers: readHeaders(session),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("R3.4 POST /coverage/requests", () => {
  let database: Database;
  let pool: pg.Pool;
  let app: ApiApp;
  let user: TestUser;
  let session: TestSession;
  const jobIds: string[] = [];

  beforeAll(async () => {
    database = appDatabase();
    pool = adminPool();
    app = buildTrainerApp(database);
    await app.ready();
    user = await createTestUser(database);
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await deleteBuildJobs(pool, jobIds);
    await app.close();
    await database.destroy();
    await pool.end();
  });

  function post(payload: Record<string, string>, extraHeaders: Record<string, string> = {}) {
    return app.inject({ method: "POST", url: REQUESTS, headers: { ...mutatingHeaders(session), ...extraHeaders }, payload });
  }

  it("R3.4 a covered preflop spot answers nulls and records nothing", async () => {
    const before = await countCoverageRequests(pool, user.id);
    const response = await post({ config_id: CONFIG, pair: PAIR, line: "r250" });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toEqual(COVERED);
    expect(await countCoverageRequests(pool, user.id)).toBe(before);
  });

  it("R3.4 a preflop gap records a coverage_request row with its line", async () => {
    const response = await post({ config_id: GAP_CONFIG, pair: PAIR, line: "r300.c" });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toEqual(RECORDED);
    const rows = await pool.query<{ game_config_id: string; position_pair: string; flop: string | null; line: string | null }>(
      "select game_config_id, position_pair, flop, line from coverage_request where user_id = $1 and game_config_id = $2",
      [user.id, GAP_CONFIG],
    );
    expect(rows.rows).toEqual([{ game_config_id: GAP_CONFIG, position_pair: PAIR, flop: null, line: "r300.c" }]);
  });

  it("R3.4 a blocked_budget job answers status blocked_budget with no queue position, keeps its priority and records the request (O-240)", async () => {
    const jobId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop: "Js9s4c", priority: 0.25, status: "blocked_budget" });
    jobIds.push(jobId);
    const response = await post({ config_id: CONFIG, pair: PAIR, flop: "Js9s4c" });
    expect(response.statusCode, response.body).toBe(202);
    const body = coverageRequestResultSchema.parse(response.json());
    expect(body).toEqual({ status: "blocked_budget", job_id: jobId, priority: 0.25, queue_position: null });
    expect(await readBuildJob(pool, jobId)).toMatchObject({ status: "blocked_budget", priority: 0.25 });
    expect(await countSpotRequests(pool, { userId: user.id, configId: CONFIG, pair: PAIR, flop: "Js9s4c" })).toBe(1);
  });

  it("R3.4 three requests for the same uncovered spot leave one coverage_request row and each answers 202 (PR #25 review M4)", async () => {
    const spot = { config_id: GAP_CONFIG, pair: PAIR, line: "r250.c" };
    const responses = [
      await post(spot),
      await post(spot, { [IDEMPOTENCY_HEADER]: `once-a-${user.id}` }),
      await post(spot, { [IDEMPOTENCY_HEADER]: `once-b-${user.id}` }),
    ];
    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(202);
      expect(response.json()).toEqual(RECORDED);
    }
    expect(await countSpotRequests(pool, { userId: user.id, configId: GAP_CONFIG, pair: PAIR, line: "r250.c" })).toBe(1);
  });

  it("R3.4 a failed (parked) job is left alone and the request is recorded (O-176)", async () => {
    const jobId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop: "6h6d3c", priority: 0.75, status: "failed" });
    jobIds.push(jobId);
    const before = await countCoverageRequests(pool, user.id);
    const response = await post({ config_id: CONFIG, pair: PAIR, flop: "6h6d3c" });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toEqual(RECORDED);
    expect((await readBuildJob(pool, jobId)).priority).toBe(0.75);
    expect(await countCoverageRequests(pool, user.id)).toBe(before + 1);
  });

  it("R3.4 an unknown configuration is a 404 problem", async () => {
    const response = await post({ config_id: UNKNOWN_CONFIG, pair: PAIR });
    expect(response.statusCode, response.body).toBe(404);
  });

  it("R3.4 needs the CSRF token", async () => {
    const response = await app.inject({
      method: "POST",
      url: REQUESTS,
      headers: readHeaders(session),
      payload: { config_id: CONFIG, pair: PAIR },
    });
    expect(response.statusCode).toBe(403);
  });
});
