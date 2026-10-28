/**
 * The learning-state jobs (R4.11, O-275, PM conditions) through the job worker against the test
 * database: the weekly leak history job recomputes leak_stat and writes one leak_history row per
 * class for the period's Monday, and running it twice leaves identical rows; the idle closer ends
 * automated and holdout sessions idle for an hour through the shared end path (with the tier, over
 * the fixture solver-query), leaves drills and recent sessions open, refuses to end anything without
 * solver-query, and a second run ends nothing.
 *
 * Isolation: each test drives its own job kinds (the worker claims only the kinds it has handlers
 * for), and the idle closer's clock sits in a past window of its own, so sessions other test files
 * create now are never idle at that instant.
 */
import { randomUUID } from "node:crypto";

import { classStat, leakStat } from "@g-tee-oh/learning";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { closeIdleSessions, IDLE_CLOSE_JOB, IDLE_SESSION_CLOSE_MS } from "../src/jobs/idle-close.js";
import { LEAK_HISTORY_JOB, weekEndOf } from "../src/jobs/leak-history.js";
import type { JobHandler, JobServices } from "../src/jobs/registry.js";
import { runDueJobs } from "../src/jobs/worker.js";
import { NO_LEARNING_HOOKS, type LearningHooks, type RecapExtras, type SessionEndContext } from "../src/learning/effects.js";
import { DEFAULT_LEARNING_HOOKS } from "../src/learning/hooks.js";
import { recomputeLeakStat } from "../src/learning-state/leak-stat.js";
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
const OTHER_CLASS = "preflop/online/100/rfi/BTN-CO";
const WEEK = "2026-10-19";
const WEEK_DUE = new Date("2026-10-26T04:00:00.000Z");
const PRIOR_PER_1K = 40;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** The end of WEEK in the test time zone; the history counts only attempts before it (PR #27 review MEDIUM 10). */
const WEEK_END = weekEndOf(WEEK, TEST_CONFIG.timeZone);
const IN_WEEK = new Date(WEEK_END.getTime() - HOUR_MS);

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

describe("R4.11 the weekly leak history job (O-275)", () => {
  it("R4.11 the job recomputes leak_stat and snapshots the ended week; a second run leaves identical rows", async () => {
    const user = await createTestUser(database);
    const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "drill" });
    const base = { userId: user.id, sessionId, solutionId, trackIds: [tracks.opens ?? ""], createdAt: IN_WEEK };
    await insertAttemptRow(pool, { ...base, spotClassKey: CLASS, label: "mistake", evLossBb: 2 });
    await insertAttemptRow(pool, { ...base, spotClassKey: OTHER_CLASS, label: "blunder", evLossBb: 5 });
    for (const key of [CLASS, OTHER_CLASS]) {
      await recomputeLeakStat(database, { userId: user.id, spotClassKey: key, trackKey: "opens", frequencyPriorPer1k: PRIOR_PER_1K, now: WEEK_DUE });
    }
    // A decision the stored row has not seen yet: the job's recompute must count it.
    await insertAttemptRow(pool, { ...base, spotClassKey: CLASS, label: "best", evLossBb: 0 });
    const services: JobServices = { solverQuery: null, learningHooks: NO_LEARNING_HOOKS, log };

    const first = await runOnce(LEAK_HISTORY_JOB.handler, WEEK, WEEK_DUE, services);
    expect(first.job).toEqual({ status: "done", last_error: null });
    const afterFirst = await learningRows(pool, user.id);
    const stats = afterFirst.leak_stat as { spot_class_key: string; n: number; leak_cost_bb_per_1k: number; freq_prior_per_1k: number }[];
    expect(stats.map((row) => [row.spot_class_key, row.n, row.freq_prior_per_1k])).toEqual([
      [CLASS, 2, PRIOR_PER_1K],
      [OTHER_CLASS, 1, PRIOR_PER_1K],
    ]);
    const history = afterFirst.leak_history as { spot_class_key: string; week: Date; leak_cost_bb_per_1k: number }[];
    expect(history.map((row) => [row.spot_class_key, row.leak_cost_bb_per_1k])).toEqual(
      stats.map((row) => [row.spot_class_key, row.leak_cost_bb_per_1k]),
    );
    const weeks = await pool.query("select distinct week::text as week from leak_history where user_id = $1", [user.id]);
    expect(weeks.rows).toEqual([{ week: WEEK }]);

    const second = await runOnce(LEAK_HISTORY_JOB.handler, WEEK, WEEK_DUE, services);
    expect(second.job.status).toBe("done");
    expect(await learningRows(pool, user.id)).toEqual(afterFirst);
  });
});

describe("R4.11 the weekly snapshot's week boundary (PR #27 review MEDIUM 10)", () => {
  it("R4.11 leak_history counts the attempts before the week's end; leak_stat counts every attempt", async () => {
    const user = await createTestUser(database);
    const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "drill" });
    const base = { userId: user.id, sessionId, solutionId, spotClassKey: CLASS, trackIds: [tracks.opens ?? ""] };
    await insertAttemptRow(pool, { ...base, label: "mistake", evLossBb: 2, createdAt: IN_WEEK });
    await recomputeLeakStat(database, { userId: user.id, spotClassKey: CLASS, trackKey: "opens", frequencyPriorPer1k: PRIOR_PER_1K, now: WEEK_DUE });
    // Made after the week ended but before the (late) run: it belongs to the next week.
    await insertAttemptRow(pool, { ...base, label: "blunder", evLossBb: 5, createdAt: new Date(WEEK_END.getTime() + 10 * MINUTE_MS) });
    const lateRun = new Date(WEEK_END.getTime() + HOUR_MS);
    const services: JobServices = { solverQuery: null, learningHooks: NO_LEARNING_HOOKS, log };
    const run = await runOnce(LEAK_HISTORY_JOB.handler, WEEK, lateRun, services);
    expect(run.job).toEqual({ status: "done", last_error: null });
    const weekDecisions = [{ label: "Mistake", evLossBb: 2 }] as const;
    const own = classStat(weekDecisions);
    const expected = leakStat(CLASS, PRIOR_PER_1K, weekDecisions, { missRate: own.missRate, evPerMissBb: own.evPerMissBb });
    const rows = await learningRows(pool, user.id);
    const history = rows.leak_history as { leak_cost_bb_per_1k: number }[];
    expect(history).toHaveLength(1);
    expect(history[0]?.leak_cost_bb_per_1k).toBeCloseTo(expected.leakCostBbPer1k, 3);
    expect((rows.leak_stat as { n: number }[]).map((row) => row.n)).toEqual([2]);
  });
});

describe("R4.11 the idle session closer (O-275)", () => {
  /**
   * A past window of its own per test (see the module doc). Later tests take earlier years, so the
   * sessions an earlier test left open started after every later test's cutoff (the poisoned-session
   * test takes the latest year, since its poisoned session stays open).
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
      sessions.push(await insertSessionRow(pool, { userId: user.id, mode: "holdout", learning: holdoutLearning(), startedAt: window.idleStart }));
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
});
