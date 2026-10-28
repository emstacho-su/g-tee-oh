/**
 * The shared decision effects and leak_stat (R4.11, O-270, O-274, O-275) against the test database:
 * every decision stores its track and item difficulty, a drill or unseeded automated decision
 * recomputes its class's leak_stat in the decision transaction from the counted attempts (panels
 * hidden, never holdout or client-seeded), shrunk toward the track, and the post-grade unrate step
 * takes both flags through POST decisions.
 */
import {
  classStat,
  leakStat,
  trackAverage,
  UNRATED_WEIGHT,
  type LeakDecision,
} from "@g-tee-oh/learning";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { composeLearningHooks, type AfterInsertContext, type LearningHookPart } from "../src/learning/effects.js";
import { recomputeLeakStat } from "../src/learning-state/leak-stat.js";
import { createSharedEffectsPart } from "../src/learning-state/shared-effects.js";
import { findSession } from "../src/sessions/repository.js";
import type { TrainerSettings } from "../src/schemas/drills.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer } from "./sessions-test-kit.js";
import {
  automatedLearning,
  holdoutLearning,
  insertAttemptRow,
  insertSessionRow,
  learningRows,
  startUnseededSession,
  trackIds,
} from "./R4.11-learning-state-kit.js";

const ROOT_CLASS = "preflop/online/100/rfi/BB-BTN";
const PRIOR_PER_1K = 25;
const FAKE_DIFFICULTY = 1500;
const FOLD = 0;
const OPEN = 1;
const NOW = new Date("2026-10-27T12:00:00.000Z");
const SHRINK_N = 9;

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let tracks: Record<string, string>;

const sharedPart = createSharedEffectsPart({ frequencyPrior: () => Promise.resolve(PRIOR_PER_1K) });

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
  tracks = await trackIds(pool);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

async function drillApp(parts: readonly LearningHookPart[], trainer: Partial<TrainerSettings> = {}) {
  const app = buildApp({
    database,
    config: TEST_CONFIG,
    solverQuery: fakeSolverQuery({ solutionId }).client,
    learningHooks: composeLearningHooks(parts),
  });
  await app.ready();
  const player = await newPlayer(database);
  // Unseeded: a client-seeded session writes no learning state (PR #27 review HIGH 2).
  const sessionId = await startUnseededSession(app, player, await createDrill(app, player, drillBody(trainer)));
  const decide = (actionIndex: number) =>
    app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/decisions`,
      headers: player.write,
      payload: { state_version: 0, action_index: actionIndex, response_ms: 900 },
    });
  return { app, player, sessionId, decide };
}

async function leakRow(userId: string, key: string) {
  const result = await pool.query("select * from leak_stat where user_id = $1 and spot_class_key = $2", [userId, key]);
  return result.rows[0] as Record<string, number> | undefined;
}

describe("R4.11 shared effects in a drill decision", () => {
  it("R4.11 a drill decision stores its track and difficulty and recomputes its class's leak_stat", async () => {
    const { app, player, sessionId, decide } = await drillApp([sharedPart]);
    const response = await decide(FOLD);
    expect(response.statusCode, response.body).toBe(200);
    const attempt = await pool.query<{ ev_loss_bb: number }>(
      "select track_ids, item_difficulty, ev_loss_bb, label from attempt where session_id = $1",
      [sessionId],
    );
    expect(attempt.rows[0]).toMatchObject({ track_ids: [tracks.opens], item_difficulty: FAKE_DIFFICULTY, label: "blunder" });
    const decisions: LeakDecision[] = [{ label: "Blunder", evLossBb: Number(attempt.rows[0]?.ev_loss_bb) }];
    const own = classStat(decisions);
    const expected = leakStat(ROOT_CLASS, PRIOR_PER_1K, decisions, { missRate: own.missRate, evPerMissBb: own.evPerMissBb });
    const row = await leakRow(player.userId, ROOT_CLASS);
    expect(row).toMatchObject({ n: 1, freq_prior_per_1k: PRIOR_PER_1K, freq_personal_per_1k: null });
    expect(row?.leak_cost_bb_per_1k).toBeCloseTo(expected.leakCostBbPer1k, 4);
    expect(row?.miss_rate).toBeCloseTo(1);
    await app.close();
  });

  it("R4.11 a drill decision with an answer panel on writes no leak_stat", async () => {
    const { app, player, decide } = await drillApp([sharedPart], { panels: { hero_strategy_matrix: true } });
    expect((await decide(OPEN)).statusCode).toBe(200);
    expect(await leakRow(player.userId, ROOT_CLASS)).toBeUndefined();
    await app.close();
  });
});

describe("R4.11 the post-grade unrate step through POST decisions (O-274, PM seed condition)", () => {
  const ratedProbe: LearningHookPart = {
    name: "rated-probe",
    beforeGrade: () => Promise.resolve({ mode: "automated", firstAttempt: true, panelsRevealed: false, ratedTodayInTrack: 0 }),
  };

  async function storedRating(parts: readonly LearningHookPart[]) {
    const { app, sessionId, decide } = await drillApp(parts);
    const response = await decide(OPEN);
    expect(response.statusCode, response.body).toBe(200);
    const row = await pool.query("select rated, weight from attempt where session_id = $1", [sessionId]);
    await app.close();
    return { feedback: response.json<{ rated: boolean }>(), row: row.rows[0] as { rated: boolean; weight: number } };
  }

  it("R4.11 an otherwise rated decision stays rated without a flag", async () => {
    const { feedback, row } = await storedRating([ratedProbe]);
    expect(feedback.rated).toBe(true);
    expect(row.rated).toBe(true);
  });

  it("R4.11 itemExcluded and forceUnrated each store and answer the decision unrated", async () => {
    for (const flag of [{ itemExcluded: true }, { forceUnrated: true }]) {
      const unrate: LearningHookPart = { name: "unrate", beforeGrade: () => Promise.resolve(flag) };
      const { feedback, row } = await storedRating([ratedProbe, unrate]);
      expect(feedback.rated).toBe(false);
      expect(row).toEqual({ rated: false, weight: UNRATED_WEIGHT });
    }
  });
});

function hookContext(userId: string, learning: ReturnType<typeof automatedLearning> | null, allWithinFloor = false): AfterInsertContext {
  return {
    transaction: database,
    now: NOW,
    timeZone: TEST_CONFIG.timeZone,
    userId,
    session: { state: { learning } },
    derived: { node: { spot_class_key: ROOT_CLASS, action_family: "rfi" }, hand: { hero_position: "BTN", config_id: FAKE_CONFIG } },
    grade: { difficulty_features: { ev_gap_pct_pot: 0, purity: 1, n_actions: 2, mixed: false, all_within_floor: allWithinFloor } },
  } as unknown as AfterInsertContext;
}

describe("R4.11 which sessions write leak_stat (O-274, PM seed condition)", () => {
  async function userWithCountedAttempt() {
    const user = await createTestUser(database);
    const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(ROOT_CLASS) });
    await insertAttemptRow(pool, { userId: user.id, sessionId, solutionId, spotClassKey: ROOT_CLASS, label: "mistake", evLossBb: 2, trackIds: [tracks.opens ?? ""] });
    return user.id;
  }

  it("R4.11 holdout and client-seeded automated sessions write no leak_stat; an unseeded automated one does", async () => {
    const userId = await userWithCountedAttempt();
    const empty = await learningRows(pool, userId);
    await sharedPart.afterInsert?.(hookContext(userId, holdoutLearning()));
    await sharedPart.afterInsert?.(hookContext(userId, automatedLearning(ROOT_CLASS, true)));
    expect(await learningRows(pool, userId)).toEqual(empty);
    await sharedPart.afterInsert?.(hookContext(userId, automatedLearning(ROOT_CLASS)));
    expect(await leakRow(userId, ROOT_CLASS)).toMatchObject({ n: 1, freq_prior_per_1k: PRIOR_PER_1K });
  });

  it("R4.11 an all-within-floor grade sets itemExcluded and the opens track id", async () => {
    const user = await createTestUser(database);
    const overrides = await sharedPart.beforeGrade?.(hookContext(user.id, null, true));
    expect(overrides).toEqual({ trackIds: [tracks.opens], itemDifficulty: FAKE_DIFFICULTY, itemExcluded: true });
  });

  it("R4.11 the recompute counts only panels-hidden drill and unseeded automated attempts", async () => {
    const user = await createTestUser(database);
    const opens = tracks.opens ?? "";
    const drill = await insertSessionRow(pool, { userId: user.id, mode: "drill" });
    const seeded = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(ROOT_CLASS, true) });
    const holdout = await insertSessionRow(pool, { userId: user.id, mode: "holdout", learning: holdoutLearning() });
    const base = { userId: user.id, solutionId, spotClassKey: ROOT_CLASS, label: "blunder", evLossBb: 3, trackIds: [opens] };
    await insertAttemptRow(pool, { ...base, sessionId: drill });
    await insertAttemptRow(pool, { ...base, sessionId: drill, panelsRevealed: true });
    await insertAttemptRow(pool, { ...base, sessionId: seeded });
    await insertAttemptRow(pool, { ...base, sessionId: holdout });
    await recomputeLeakStat(database, { userId: user.id, spotClassKey: ROOT_CLASS, trackKey: "opens", frequencyPriorPer1k: PRIOR_PER_1K, now: NOW });
    expect(await leakRow(user.id, ROOT_CLASS)).toMatchObject({ n: 1, miss_rate: 1, ev_per_miss_bb: 3 });
  });

  it("R4.11 a small class shrinks toward its track's average over every class of the track (O-257)", async () => {
    const user = await createTestUser(database);
    const opens = tracks.opens ?? "";
    const other = "preflop/online/100/rfi/BTN-CO";
    const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "drill" });
    const base = { userId: user.id, sessionId, solutionId, trackIds: [opens] };
    await insertAttemptRow(pool, { ...base, spotClassKey: ROOT_CLASS, label: "mistake", evLossBb: 4 });
    for (let index = 0; index < SHRINK_N; index += 1) {
      await insertAttemptRow(pool, { ...base, spotClassKey: other, label: index < 3 ? "inaccuracy" : "best", evLossBb: index < 3 ? 1 : 0 });
    }
    await recomputeLeakStat(database, { userId: user.id, spotClassKey: ROOT_CLASS, trackKey: "opens", frequencyPriorPer1k: PRIOR_PER_1K, now: NOW });
    const own: LeakDecision[] = [{ label: "Mistake", evLossBb: 4 }];
    const otherDecisions: LeakDecision[] = Array.from({ length: SHRINK_N }, (_, index) =>
      index < 3 ? { label: "Inaccuracy", evLossBb: 1 } : { label: "Best", evLossBb: 0 },
    );
    const track = trackAverage([classStat(own), classStat(otherDecisions)]);
    if (track === null) {
      throw new Error("the track has decisions");
    }
    const expected = leakStat(ROOT_CLASS, PRIOR_PER_1K, own, track);
    const row = await leakRow(user.id, ROOT_CLASS);
    expect(row?.miss_rate).toBeCloseTo(expected.missRate, 5);
    expect(row?.ev_per_miss_bb).toBeCloseTo(expected.evPerMissBb, 4);
    expect(row?.leak_cost_bb_per_1k).toBeCloseTo(expected.leakCostBbPer1k, 3);
    expect(await leakRow(user.id, other)).toBeUndefined();
  });
});

describe("R4.11 the production prior source", () => {
  it("R4.11 a class the catalog does not list keeps its stored prior", async () => {
    const { app, player, sessionId, decide } = await drillApp([createSharedEffectsPart()]);
    const stored = 7;
    await pool.query(
      `insert into leak_stat (user_id, spot_class_key, freq_prior_per_1k, n, miss_rate, ev_per_miss_bb, leak_cost_bb_per_1k, computed_at)
       values ($1, $2, $3, 0, 0, 0, 0, now())`,
      [player.userId, ROOT_CLASS, stored],
    );
    expect((await decide(FOLD)).statusCode).toBe(200);
    expect(await leakRow(player.userId, ROOT_CLASS)).toMatchObject({ n: 1, freq_prior_per_1k: stored });
    expect((await findSession(database, player.userId, sessionId))?.stateVersion).toBe(1);
    await app.close();
  });
});
