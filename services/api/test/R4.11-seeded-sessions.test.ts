/**
 * Seeded sessions write no learning state, in every mode (R4.11, PR #27 review HIGH 2, the PM seed
 * condition): POST /sessions stores a top-level seeded flag from body.seed, a seeded drill decision
 * writes no leak_stat while its unseeded twin does, and the attempts of a seeded session never count
 * toward leak stats (and so the queue picks, /progress and leak_history) or the typical response
 * time a review's Easy grade is measured against (O-273).
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { composeLearningHooks } from "../src/learning/effects.js";
import { recomputeLeakStat } from "../src/learning-state/leak-stat.js";
import { createSharedEffectsPart, writesLearningState } from "../src/learning-state/shared-effects.js";
import { TYPICAL_RESPONSE_MIN_SAMPLES, TYPICAL_RESPONSE_MS_DEFAULT, typicalResponseMs } from "../src/learning-state/typical-time.js";
import { classMemory } from "../src/progress/repository.js";
import type { SessionRow } from "../src/sessions/repository.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession } from "./sessions-test-kit.js";
import { insertAttemptRow, insertSessionRow, startUnseededSession, trackIds } from "./R4.11-learning-state-kit.js";

const ROOT_CLASS = "preflop/online/100/rfi/BB-BTN";
const PRIOR_PER_1K = 25;
const FOLD = 0;
const NOW = new Date("2026-10-27T12:00:00.000Z");
const SEEDED_RESPONSE_MS = 500;
const UNSEEDED_RESPONSE_MS = 3000;

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let tracks: Record<string, string>;

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

async function drillApp() {
  const app = buildApp({
    database,
    config: TEST_CONFIG,
    solverQuery: fakeSolverQuery({ solutionId }).client,
    learningHooks: composeLearningHooks([createSharedEffectsPart({ frequencyPrior: () => Promise.resolve(PRIOR_PER_1K) })]),
  });
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody());
  return { app, player, drillId };
}

async function seededFlag(sessionId: string): Promise<unknown> {
  const result = await pool.query<{ seeded: unknown }>("select state->'seeded' as seeded from practice_session where id = $1", [sessionId]);
  return result.rows[0]?.seeded;
}

async function leakRows(userId: string): Promise<unknown[]> {
  return (await pool.query<{ spot_class_key: string; n: number }>("select spot_class_key, n from leak_stat where user_id = $1", [userId])).rows;
}

describe("R4.11 the top-level seeded flag (PR #27 review HIGH 2)", () => {
  it("R4.11 POST /sessions stores seeded true for a drill created with a seed and false without one", async () => {
    const { app, player, drillId } = await drillApp();
    expect(await seededFlag(await startSession(app, player, drillId))).toBe(true);
    expect(await seededFlag(await startUnseededSession(app, player, drillId))).toBe(false);
    await app.close();
  });

  it("R4.11 a seeded drill decision writes no leak_stat; its unseeded twin does", async () => {
    for (const seeded of [true, false]) {
      const { app, player, drillId } = await drillApp();
      const sessionId = seeded ? await startSession(app, player, drillId) : await startUnseededSession(app, player, drillId);
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/decisions`,
        headers: player.write,
        payload: { state_version: 0, action_index: FOLD, response_ms: 900 },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(await leakRows(player.userId)).toEqual(seeded ? [] : [{ spot_class_key: ROOT_CLASS, n: 1 }]);
      await app.close();
    }
  });

  it("R4.11 writesLearningState is false for a seeded session of any mode", () => {
    const withState = (state: Record<string, unknown>) => ({ session: { state } as unknown as SessionRow });
    expect(writesLearningState(withState({ learning: null, seeded: true }))).toBe(false);
    expect(writesLearningState(withState({ learning: null, seeded: false }))).toBe(true);
    expect(writesLearningState(withState({ learning: null }))).toBe(true);
  });
});

describe("R4.11 seeded attempts never count (PR #27 review HIGH 2)", () => {
  it("R4.11 a seeded drill's attempts count toward neither leak_stat nor the typical response time", async () => {
    const user = await createTestUser(database);
    const opens = tracks.opens ?? "";
    const seeded = await insertSessionRow(pool, { userId: user.id, mode: "drill", seeded: true });
    const unseeded = await insertSessionRow(pool, { userId: user.id, mode: "drill" });
    const base = { userId: user.id, solutionId, spotClassKey: ROOT_CLASS, label: "blunder", evLossBb: 3, trackIds: [opens] };
    for (let index = 0; index < TYPICAL_RESPONSE_MIN_SAMPLES; index += 1) {
      await insertAttemptRow(pool, { ...base, sessionId: seeded, responseMs: SEEDED_RESPONSE_MS });
    }
    await insertAttemptRow(pool, { ...base, sessionId: unseeded, responseMs: UNSEEDED_RESPONSE_MS });
    await recomputeLeakStat(database, { userId: user.id, spotClassKey: ROOT_CLASS, trackKey: "opens", frequencyPriorPer1k: PRIOR_PER_1K, now: NOW });
    expect(await leakRows(user.id)).toEqual([{ spot_class_key: ROOT_CLASS, n: 1 }]);
    // Only one unseeded earlier attempt: below the minimum sample, so the default applies.
    expect(await typicalResponseMs(database, { userId: user.id, spotClassKey: ROOT_CLASS, blockSize: 0 })).toBe(TYPICAL_RESPONSE_MS_DEFAULT);
  });

  it("R4.11 /progress's heat map counts no decision of a seeded session", async () => {
    const user = await createTestUser(database);
    const seeded = await insertSessionRow(pool, { userId: user.id, mode: "drill", seeded: true });
    const unseeded = await insertSessionRow(pool, { userId: user.id, mode: "drill" });
    const base = { userId: user.id, solutionId, spotClassKey: ROOT_CLASS };
    await insertAttemptRow(pool, { ...base, sessionId: seeded });
    await insertAttemptRow(pool, { ...base, sessionId: unseeded });
    expect((await classMemory(database, user.id, NOW)).get(ROOT_CLASS)?.n).toBe(1);
  });
});
