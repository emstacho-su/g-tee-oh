/**
 * The weekly leak history job (R4.11, O-275, PM conditions) through the job worker against the test
 * database: it recomputes leak_stat and writes one leak_history row per class for the period's
 * Monday, counting only attempts before the week's end (PR #27 review MEDIUM 10), and running it
 * twice leaves identical rows. The idle closer's tests are in R4.11-idle-close.test.ts.
 *
 * Isolation: each test drives its own job kinds (the worker claims only the kinds it has handlers
 * for).
 */
import { randomUUID } from "node:crypto";

import { classStat, leakStat } from "@g-tee-oh/learning";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { LEAK_HISTORY_JOB, weekEndOf } from "../src/jobs/leak-history.js";
import type { JobHandler, JobServices } from "../src/jobs/registry.js";
import { runDueJobs } from "../src/jobs/worker.js";
import { NO_LEARNING_HOOKS } from "../src/learning/effects.js";
import { recomputeLeakStat } from "../src/learning-state/leak-stat.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { insertSolution } from "./sessions-test-kit.js";
import {
  insertAttemptRow,
  insertSessionRow,
  learningRows,
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
