/**
 * The idle session closer (R4.11, O-275, PM conditions) through the job worker against the test
 * database: automated and holdout sessions idle for an hour end through the shared end path (with
 * the tier, over the fixture solver-query); drills and recent sessions stay open; nothing ends
 * without solver-query; a second run ends nothing; a user's ends are strictly ordered within a run
 * and across batches and runs (PR #27 review HIGH 5 and follow-up MEDIUM 1); a run ends at most its
 * batch (MEDIUM 11); and sessions whose end keeps failing go to the back of the queue (follow-up
 * LOW 3).
 *
 * Isolation: each test drives its own job kinds (the worker claims only the kinds it has handlers
 * for), and its clock sits in a past window of its own (windowAt), so sessions other test files
 * create now are never idle at that instant. This is the only test file that writes sessions
 * started in those past windows.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { closeIdleSessions, IDLE_CLOSE_JOB, IDLE_SESSION_CLOSE_MS } from "../src/jobs/idle-close.js";
import type { JobHandler, JobServices } from "../src/jobs/registry.js";
import { runDueJobs } from "../src/jobs/worker.js";
import { NO_LEARNING_HOOKS, type LearningHooks, type RecapExtras, type SessionEndContext } from "../src/learning/effects.js";
import { DEFAULT_LEARNING_HOOKS } from "../src/learning/hooks.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { insertSolution } from "./sessions-test-kit.js";
import {
  automatedLearning,
  holdoutLearning,
  insertAttemptRow,
  insertSessionRow,
  learningRows,
  sessionAndAttempts,
  trackIds,
  KIT_CONFIG,
  KIT_PAIR,
} from "./R4.11-learning-state-kit.js";

const CLASS = "preflop/online/100/rfi/BB-BTN";
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** A batch smaller than the sessions a test makes, so the run needs a follow-up (MEDIUM 11, follow-up MEDIUM 1 and LOW 3). */
const SMALL_BATCH = 2;

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let tracks: Record<string, string>;
let log: JobServices["log"];

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, KIT_CONFIG, KIT_PAIR);
  tracks = await trackIds(pool);
  log = buildApp().log;
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

/** Runs `handler` once as a fresh job of its own kind for `periodKey`, due at `now`. */
async function runOnce(handler: JobHandler, periodKey: string, now: Date, services: JobServices) {
  const kind = `test_${randomUUID()}`;
  await database.insertInto("app_job").values({ kind, period_key: periodKey, run_at: now }).execute();
  const report = await runDueJobs(database, now, { [kind]: handler }, { workerId: "r4.11-test", timeZone: TEST_CONFIG.timeZone, services });
  const job = await database.selectFrom("app_job").select(["status", "last_error"]).where("kind", "=", kind).executeTakeFirstOrThrow();
  return { report, job };
}

/** The closer with a batch of SMALL_BATCH sessions per run. */
const smallBatchHandler: JobHandler = (context) => closeIdleSessions(context, { batchSize: SMALL_BATCH }).then(() => undefined);

describe("R4.11 the idle session closer (O-275)", () => {
  /**
   * A past window of its own per test (see the module doc). Later tests take earlier years, so the
   * sessions an earlier test left open started after every later test's cutoff (the poisoned-session
   * test takes the latest year, since its poisoned session stays open; the follow-up LOW 3 test takes
   * the earliest and ends its own poisoned sessions when it is done).
   */
  function windowAt(year: number) {
    const now = new Date(Date.UTC(year, 0, 1, 12));
    return { now, idleStart: new Date(now.getTime() - 2 * HOUR_MS), recent: new Date(now.getTime() - 10 * MINUTE_MS) };
  }

  async function idleFixture(year: number) {
    const window = windowAt(year);
    const user = await createTestUser(database);
    const automated = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(CLASS), startedAt: window.idleStart });
    const holdout = await insertSessionRow(pool, { userId: user.id, mode: "holdout", learning: holdoutLearning(), startedAt: window.idleStart });
    const drill = await insertSessionRow(pool, { userId: user.id, mode: "drill", startedAt: window.idleStart });
    const busy = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(CLASS), startedAt: window.idleStart });
    await insertAttemptRow(pool, { userId: user.id, sessionId: busy, solutionId, spotClassKey: CLASS, createdAt: window.recent });
    return { window, userId: user.id, automated, holdout, drill, busy };
  }

  async function endedIds(userId: string): Promise<string[]> {
    const result = await pool.query("select id from practice_session where user_id = $1 and ended_at is not null order by id", [userId]);
    return result.rows.map((row: { id: string }) => row.id);
  }

  it("R4.11 idle automated and holdout sessions end; drills and recent sessions stay open; a second run changes nothing", async () => {
    const fixture = await idleFixture(2004);
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: NO_LEARNING_HOOKS, log };
    const first = await runOnce(IDLE_CLOSE_JOB.handler, fixture.window.now.toISOString(), fixture.window.now, services);
    expect(first.job).toEqual({ status: "done", last_error: null });
    expect(await endedIds(fixture.userId)).toEqual([fixture.automated, fixture.holdout].sort());
    const phases = await pool.query("select state->>'phase' as phase from practice_session where id = any($1::uuid[])", [[fixture.automated, fixture.holdout]]);
    expect(phases.rows.map((row: { phase: string }) => row.phase)).toEqual(["ended", "ended"]);
    const rows = { sessions: await sessionAndAttempts(pool, fixture.userId), learning: await learningRows(pool, fixture.userId) };

    const second = await runOnce(IDLE_CLOSE_JOB.handler, fixture.window.now.toISOString(), fixture.window.now, services);
    expect(second.job.status).toBe("done");
    expect({ sessions: await sessionAndAttempts(pool, fixture.userId), learning: await learningRows(pool, fixture.userId) }).toEqual(rows);
  });

  it("R4.11 a session stays open until a full hour has passed since its last decision", async () => {
    const fixture = await idleFixture(2003);
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: NO_LEARNING_HOOKS, log };
    const early = new Date(fixture.window.recent.getTime() + IDLE_SESSION_CLOSE_MS - MINUTE_MS);
    await runOnce(IDLE_CLOSE_JOB.handler, early.toISOString(), early, services);
    expect(await endedIds(fixture.userId)).not.toContain(fixture.busy);
    const late = new Date(fixture.window.recent.getTime() + IDLE_SESSION_CLOSE_MS + MINUTE_MS);
    await runOnce(IDLE_CLOSE_JOB.handler, late.toISOString(), late, services);
    expect(await endedIds(fixture.userId)).toContain(fixture.busy);
  });

  it("R4.11 without solver-query the closer fails the run and ends nothing, so the run is retried", async () => {
    const fixture = await idleFixture(2002);
    const services: JobServices = { solverQuery: null, learningHooks: NO_LEARNING_HOOKS, log };
    const run = await runOnce(IDLE_CLOSE_JOB.handler, fixture.window.now.toISOString(), fixture.window.now, services);
    expect(run.job.status).toBe("queued");
    expect(run.job.last_error).toMatch(/solver-query/);
    expect(await endedIds(fixture.userId)).toEqual([]);
  });

  it("R4.11 a session whose end fails is skipped and logged while the other idle sessions end", async () => {
    const fixture = await idleFixture(2005);
    const poisoned = await insertSessionRow(pool, { userId: fixture.userId, mode: "automated", learning: automatedLearning(CLASS), startedAt: fixture.window.idleStart });
    // A state that no longer parses: its end throws before writing anything.
    await pool.query(`update practice_session set state = '{"phase": "dealing"}'::jsonb where id = $1`, [poisoned]);
    const errors: unknown[] = [];
    const recording: JobServices["log"] = {
      info: () => undefined,
      warn: () => undefined,
      error: (...args: unknown[]) => {
        errors.push(args[0]);
      },
    };
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: NO_LEARNING_HOOKS, log: recording };
    const run = await runOnce(IDLE_CLOSE_JOB.handler, fixture.window.now.toISOString(), fixture.window.now, services);
    expect(run.job).toEqual({ status: "done", last_error: null });
    expect(await endedIds(fixture.userId)).toEqual([fixture.automated, fixture.holdout].sort());
    expect(errors).toEqual([expect.objectContaining({ session_id: poisoned })]);
  });

  it("R4.11 the closer ends through the production end hooks with a tier, over the fixture solver-query", async () => {
    const fixture = await idleFixture(2001);
    // One rated decision early in the idle session: the end rates its track, so it has a tier.
    await insertAttemptRow(pool, {
      userId: fixture.userId,
      sessionId: fixture.automated,
      solutionId,
      spotClassKey: CLASS,
      rated: true,
      score: 1,
      itemDifficulty: 1500,
      trackIds: [tracks.opens ?? ""],
      createdAt: new Date(fixture.window.idleStart.getTime() + 10 * MINUTE_MS),
    });
    const extras: RecapExtras[] = [];
    const capturing: LearningHooks = {
      ...DEFAULT_LEARNING_HOOKS,
      async onSessionEnd(context) {
        const result = await DEFAULT_LEARNING_HOOKS.onSessionEnd(context);
        extras.push(result);
        return result;
      },
    };
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: capturing, log };
    const run = await runOnce(IDLE_CLOSE_JOB.handler, fixture.window.now.toISOString(), fixture.window.now, services);
    expect(run.job).toEqual({ status: "done", last_error: null });
    expect(await endedIds(fixture.userId)).toEqual([fixture.automated, fixture.holdout].sort());
    const automatedEnd = extras[0];
    expect(automatedEnd?.tier, JSON.stringify(extras)).not.toBeNull();
    expect(automatedEnd?.tier).toBeDefined();
    expect(automatedEnd?.rating_changes?.map((change) => change.track_key)).toEqual(["opens"]);
    const history = await pool.query("select session_id from rating_history where user_id = $1", [fixture.userId]);
    expect(history.rows).toEqual([{ session_id: fixture.automated }]);
  });

  it("R4.11 two idle sessions of one user end in start order with strictly increasing rating times (PR #27 review HIGH 5)", async () => {
    const window = windowAt(2000);
    const user = await createTestUser(database);
    const sessions: string[] = [];
    for (const offsetMs of [0, MINUTE_MS]) {
      const startedAt = new Date(window.idleStart.getTime() + offsetMs);
      const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(CLASS), startedAt });
      await insertAttemptRow(pool, {
        userId: user.id,
        sessionId,
        solutionId,
        spotClassKey: CLASS,
        rated: true,
        score: 1,
        itemDifficulty: 1500,
        trackIds: [tracks.opens ?? ""],
        createdAt: new Date(startedAt.getTime() + MINUTE_MS),
      });
      sessions.push(sessionId);
    }
    const ends: { sessionId: string; extras: RecapExtras; prepared: SessionEndContext["prepared"] }[] = [];
    const capturing: LearningHooks = {
      ...DEFAULT_LEARNING_HOOKS,
      async onSessionEnd(context) {
        const result = await DEFAULT_LEARNING_HOOKS.onSessionEnd(context);
        ends.push({ sessionId: context.session.id, extras: result, prepared: context.prepared });
        return result;
      },
    };
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: capturing, log };
    const run = await runOnce(IDLE_CLOSE_JOB.handler, window.now.toISOString(), window.now, services);
    expect(run.job).toEqual({ status: "done", last_error: null });
    expect(ends.map((end) => end.sessionId)).toEqual(sessions);
    const history = await pool.query<{ session_id: string; mu: number; rd: number; recorded_at: Date }>(
      "select session_id, mu, rd, recorded_at from rating_history where user_id = $1 order by recorded_at, session_id",
      [user.id],
    );
    expect(history.rows.map((row) => row.session_id)).toEqual(sessions);
    const [first, second] = history.rows;
    expect(second?.recorded_at.getTime()).toBeGreaterThan(first?.recorded_at.getTime() ?? Number.POSITIVE_INFINITY);
    const before = ends[1]?.extras.rating_changes?.[0]?.before;
    expect(before?.mu).toBeCloseTo(first?.mu ?? Number.NaN, 3);
    const rating = await pool.query<{ mu: number }>("select mu from rating where user_id = $1", [user.id]);
    expect(rating.rows[0]?.mu).toBeCloseTo(second?.mu ?? Number.NaN, 5);
    // The prepare phase ran per session before its end: the end hooks see the all-configs catalog.
    expect(ends.every((end) => end.prepared.catalog !== null)).toBe(true);
  });

  it("R4.11 a run ends at most its batch and schedules a follow-up run for the rest (PR #27 review MEDIUM 11)", async () => {
    const window = windowAt(1999);
    const user = await createTestUser(database);
    const sessions: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      // Automated: a user has at most one open holdout session (PR #27 review HIGH 1); the hooks are NO_LEARNING_HOOKS.
      sessions.push(await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(CLASS), startedAt: window.idleStart }));
    }
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: NO_LEARNING_HOOKS, log };
    const kind = `test_${randomUUID()}`;
    await database.insertInto("app_job").values({ kind, period_key: window.now.toISOString(), run_at: window.now }).execute();
    const smallBatch = 2;
    const report = await runDueJobs(
      database,
      window.now,
      { [kind]: (context) => closeIdleSessions(context, { batchSize: smallBatch }).then(() => undefined) },
      { workerId: "r4.11-test", timeZone: TEST_CONFIG.timeZone, services },
    );
    expect(report).toEqual({ done: [expect.any(String), expect.any(String)], failed: [] });
    expect(await endedIds(user.id)).toEqual([...sessions].sort());
    const jobs = await pool.query("select status from app_job where kind = $1", [kind]);
    expect(jobs.rows).toEqual([{ status: "done" }, { status: "done" }]);
  });

  /** `count` automated sessions of one new user, a minute apart from the window's idle start, each with one rated decision in its track. */
  async function ratedIdleSessions(window: ReturnType<typeof windowAt>, count: number): Promise<{ userId: string; sessions: string[] }> {
    const user = await createTestUser(database);
    const sessions: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const startedAt = new Date(window.idleStart.getTime() + index * MINUTE_MS);
      const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(CLASS), startedAt });
      await insertAttemptRow(pool, {
        userId: user.id,
        sessionId,
        solutionId,
        spotClassKey: CLASS,
        rated: true,
        score: 1,
        itemDifficulty: 1500,
        trackIds: [tracks.opens ?? ""],
        createdAt: new Date(startedAt.getTime() + MINUTE_MS),
      });
      sessions.push(sessionId);
    }
    return { userId: user.id, sessions };
  }

  it("R4.11 a user's idle sessions split across batches end with strictly increasing times, each reading the right before rows (PR #27 review follow-up MEDIUM 1)", async () => {
    const window = windowAt(1998);
    const { userId, sessions } = await ratedIdleSessions(window, SMALL_BATCH + 1);
    const ends: { sessionId: string; extras: RecapExtras }[] = [];
    const capturing: LearningHooks = {
      ...DEFAULT_LEARNING_HOOKS,
      async onSessionEnd(context) {
        const result = await DEFAULT_LEARNING_HOOKS.onSessionEnd(context);
        ends.push({ sessionId: context.session.id, extras: result });
        return result;
      },
    };
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: capturing, log };
    // One tick: the follow-up run of the full first batch is claimed with the same `now`.
    const run = await runOnce(smallBatchHandler, window.now.toISOString(), window.now, services);
    expect(run.report.failed).toEqual([]);
    expect(ends.map((end) => end.sessionId)).toEqual(sessions);
    const history = await pool.query<{ session_id: string; mu: number; recorded_at: Date }>(
      "select session_id, mu, recorded_at from rating_history where user_id = $1 order by recorded_at, session_id",
      [userId],
    );
    expect(history.rows.map((row) => row.session_id)).toEqual(sessions);
    // rating_history.recorded_at is the closer's planned end instant; practice_session.ended_at is the end transaction's now() (S23), so only the former is ordered here.
    const times = history.rows.map((row) => row.recorded_at.getTime());
    times.slice(1).forEach((time, index) => expect(time).toBeGreaterThan(times[index] ?? Number.POSITIVE_INFINITY));
    for (const [index, end] of ends.entries()) {
      const previous = history.rows[index - 1];
      const before = end.extras.rating_changes?.[0]?.before ?? null;
      if (previous === undefined) {
        expect(before).toBeNull();
      } else {
        expect(before?.mu).toBeCloseTo(previous.mu, 3);
      }
    }
    const rating = await pool.query<{ mu: number }>("select mu from rating where user_id = $1", [userId]);
    expect(rating.rows[0]?.mu).toBeCloseTo(history.rows.at(-1)?.mu ?? Number.NaN, 5);
  });

  it("R4.11 sessions whose end keeps failing are queued last, so a healthy idle session behind a full batch of them still closes (PR #27 review follow-up LOW 3)", async () => {
    const window = windowAt(1997);
    const user = await createTestUser(database);
    const poisoned: string[] = [];
    for (let index = 0; index < SMALL_BATCH; index += 1) {
      const id = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(CLASS), startedAt: window.idleStart });
      // A state that no longer parses: its end throws before writing anything.
      await pool.query(`update practice_session set state = '{"phase": "dealing"}'::jsonb where id = $1`, [id]);
      poisoned.push(id);
    }
    const healthy = await insertSessionRow(pool, {
      userId: user.id,
      mode: "automated",
      learning: automatedLearning(CLASS),
      startedAt: new Date(window.idleStart.getTime() + MINUTE_MS),
    });
    const services: JobServices = { solverQuery: fixtureSolverQuery(), learningHooks: NO_LEARNING_HOOKS, log };
    try {
      const first = await runOnce(smallBatchHandler, window.now.toISOString(), window.now, services);
      expect(first.job).toEqual({ status: "done", last_error: null });
      expect(await endedIds(user.id)).toEqual([]);
      const failures = await pool.query<{ idle_close_failures: number; idle_close_failed_at: Date | null }>(
        "select idle_close_failures, idle_close_failed_at from practice_session where id = any($1::uuid[])",
        [poisoned],
      );
      expect(failures.rows).toEqual(poisoned.map(() => ({ idle_close_failures: 1, idle_close_failed_at: window.now })));
      const second = await runOnce(smallBatchHandler, window.now.toISOString(), window.now, services);
      expect(second.job).toEqual({ status: "done", last_error: null });
      expect(await endedIds(user.id)).toEqual([healthy]);
    } finally {
      // Poisoned sessions never end; close them so no later run meets them.
      await pool.query("update practice_session set ended_at = $2 where id = any($1::uuid[]) and ended_at is null", [poisoned, window.now]);
    }
  });
});
