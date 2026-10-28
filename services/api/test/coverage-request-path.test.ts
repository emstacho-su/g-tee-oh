/**
 * The request-path test (R3.4, ADR 0018, O-240): POST /coverage/requests raises a queued build to
 * the head of the queue and never starts a solve. The job stays queued and unclaimed, no solution
 * or scenario row appears, and the api boundary check (scripts/check-api-boundary.mjs: no
 * child_process, execa or library-builder under services/api/src) passes. An Idempotency-Key
 * replay raises nothing twice, a spot with no job records one coverage_request row, and a queued
 * job is preferred over a blocked_budget one (which is never raised, O-240).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { coverageRequestResultSchema } from "../src/schemas/study.js";
import { mutatingHeaders } from "./support/app.js";
import {
  countCoverageRequests,
  countSpotRows,
  deleteBuildJobs,
  insertBuildJob,
  readBuildJob,
} from "./support/build-jobs.js";
import { adminPool, appDatabase, createTestSession, createTestUser, type TestSession, type TestUser } from "./support/database.js";
import { buildTrainerApp } from "./support/solver-query.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BOUNDARY_TIMEOUT_MS = 120_000;
const CONFIG = "cfg_6_online_100";
const PAIR = "BB-BTN";
const RAISED_FLOP = "Ah7d2c";
const OTHER_FLOP = "Kd8s3h";
const NO_JOB_FLOP = "Qc9h4d";
const URL_PATH = "/api/v1/coverage/requests";

async function maxOtherQueuedPriority(pool: pg.Pool, exceptId: string): Promise<number> {
  const result = await pool.query<{ top: number }>(
    "select max(priority) as top from build_job where status = 'queued' and id <> $1",
    [exceptId],
  );
  return result.rows[0]?.top ?? Number.NEGATIVE_INFINITY;
}

describe("R3.4 coverage request path (ADR 0018)", () => {
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

  it(
    "R3.4 request-path: a coverage request raises a queued job to the queue head and never starts a solve",
    async () => {
      const raisedId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop: RAISED_FLOP, priority: 1.0 });
      const otherId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop: OTHER_FLOP, priority: 5 });
      jobIds.push(raisedId, otherId);
      // Only this spot's rows are counted: other test files insert solution rows while vitest runs
      // them in parallel, so a table-wide count was flaky ("expected 123 to be 120").
      const spot = { configId: CONFIG, pair: PAIR, flop: RAISED_FLOP };
      expect(await countSpotRows(pool, "solution", spot)).toBe(0);
      expect(await countSpotRows(pool, "scenario", spot)).toBe(0);

      const response = await app.inject({
        method: "POST",
        url: URL_PATH,
        headers: { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: `request-path-${raisedId}` },
        payload: { config_id: CONFIG, pair: PAIR, flop: RAISED_FLOP, line: "r250.c" },
      });

      expect(response.statusCode, response.body).toBe(202);
      const body = coverageRequestResultSchema.parse(response.json());
      expect(body.status).toBe("queued");
      expect(body.job_id).toBe(raisedId);
      expect(body.queue_position).toBe(1);
      const raised = await readBuildJob(pool, raisedId);
      expect(raised.priority).toBe(body.priority);
      expect(raised.priority).toBeGreaterThan(await maxOtherQueuedPriority(pool, raisedId));
      expect(raised.status).toBe("queued");
      expect(raised.locked_by).toBeNull();
      expect(await countSpotRows(pool, "solution", spot)).toBe(0);
      expect(await countSpotRows(pool, "scenario", spot)).toBe(0);

      // The api source holds no child_process, execa or library-builder (exit 0, else this throws).
      const output = execFileSync("node", ["scripts/check-api-boundary.mjs"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: BOUNDARY_TIMEOUT_MS,
      });
      expect(output).toContain("boundary:");
    },
    BOUNDARY_TIMEOUT_MS,
  );

  it("R3.4 a new request for a job already at the queue head raises nothing (O-240)", async () => {
    const [raisedId] = jobIds;
    const before = await readBuildJob(pool, raisedId ?? "");
    const response = await app.inject({
      method: "POST",
      url: URL_PATH,
      headers: mutatingHeaders(session),
      payload: { config_id: CONFIG, pair: PAIR, flop: RAISED_FLOP },
    });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toEqual({ status: "queued", job_id: raisedId, priority: before.priority, queue_position: 1 });
    expect((await readBuildJob(pool, raisedId ?? "")).priority).toBe(before.priority);
  });

  it("R3.4 an Idempotency-Key replay returns the same body and raises nothing twice", async () => {
    const jobId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop: "Tc6d2h", priority: 0.5 });
    jobIds.push(jobId);
    const headers = { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: `replay-${jobId}` };
    const payload = { config_id: CONFIG, pair: PAIR, flop: "Tc6d2h" };

    const first = await app.inject({ method: "POST", url: URL_PATH, headers, payload });
    expect(first.statusCode, first.body).toBe(202);
    const afterFirst = await readBuildJob(pool, jobId);
    const second = await app.inject({ method: "POST", url: URL_PATH, headers, payload });

    expect(second.statusCode).toBe(202);
    expect(second.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(second.json()).toEqual(first.json());
    expect((await readBuildJob(pool, jobId)).priority).toBe(afterFirst.priority);
  });

  it("R3.4 a request for a spot with no job writes one coverage_request row and answers job_id null", async () => {
    const before = await countCoverageRequests(pool, user.id);
    const response = await app.inject({
      method: "POST",
      url: URL_PATH,
      headers: mutatingHeaders(session),
      payload: { config_id: CONFIG, pair: PAIR, flop: NO_JOB_FLOP },
    });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toEqual({ status: "recorded", job_id: null, priority: null, queue_position: null });
    expect(await countCoverageRequests(pool, user.id)).toBe(before + 1);
  });

  it("R3.4 a queued job is raised ahead of a blocked_budget job for the same spot, which keeps its priority", async () => {
    const flop = "9d6c2h";
    const blockedId = await insertBuildJob(pool, {
      configId: CONFIG,
      pair: PAIR,
      flop,
      priority: 50,
      status: "blocked_budget",
      treeConfigHash: "\\x01",
    });
    const queuedId = await insertBuildJob(pool, { configId: CONFIG, pair: PAIR, flop, priority: 0.5 });
    jobIds.push(blockedId, queuedId);
    const response = await app.inject({
      method: "POST",
      url: URL_PATH,
      headers: mutatingHeaders(session),
      payload: { config_id: CONFIG, pair: PAIR, flop },
    });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({ status: "queued", job_id: queuedId, queue_position: 1 });
    expect((await readBuildJob(pool, blockedId)).priority).toBe(50);
  });
});
