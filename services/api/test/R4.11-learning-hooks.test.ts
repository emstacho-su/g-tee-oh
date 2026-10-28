/**
 * The S31 scaffold's hooks in S23's transactions (R4.11, R4.13, O-27, O-274, O-276), over the fake
 * solver-query: beforeGrade's overrides reach the attempt row and the grade, afterInsert's extras
 * reach the feedback and its patch the state, a failing hook leaves no attempt and no state change,
 * the default hooks store hand_class and panels_revealed, session end runs onSessionEnd once with
 * firstEnd true and a repeat end returns the same recap, and the holdout guard the hooks load holds
 * hands back from dealing.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { composeLearningHooks, type LearningHookPart, type SessionEndContext } from "../src/learning/effects.js";
import type { TrainerSettings } from "../src/schemas/drills.js";
import { feedbackSchema, recapSchema } from "../src/schemas/training.js";
import { adminPool, appDatabase } from "./support/database.js";
import { TEST_CONFIG } from "./support/app.js";
import { buildApp } from "../src/app.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, rowsOf, startSession, type Player } from "./sessions-test-kit.js";

const HERO_ROW = "AKo";
const ITEM_DIFFICULTY = 0.42;
const SERVER_ERROR = 500;

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let trackId: string;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
  const track = await database.selectFrom("track").select("id").where("key", "=", "opens").executeTakeFirstOrThrow();
  trackId = track.id;
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

async function setUp(parts: readonly LearningHookPart[] | undefined, trainer: Partial<TrainerSettings> = {}) {
  const sq = fakeSolverQuery({ solutionId });
  const app = buildApp({
    database,
    config: TEST_CONFIG,
    solverQuery: sq.client,
    ...(parts === undefined ? {} : { learningHooks: composeLearningHooks(parts) }),
  });
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody(trainer));
  const sessionId = await startSession(app, player, drillId);
  return { app, player, sessionId };
}

type App = Awaited<ReturnType<typeof setUp>>["app"];

function decide(app: App, player: Player, sessionId: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: 0, action_index: 1, response_ms: 900 },
  });
}

function end(app: App, player: Player, sessionId: string) {
  return app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write });
}

async function attemptRow(sessionId: string) {
  return database
    .selectFrom("attempt")
    .select(["hand_class", "panels_revealed", "track_ids", "item_difficulty"])
    .where("session_id", "=", sessionId)
    .executeTakeFirstOrThrow();
}

describe("R4.11 learning hooks in the decision transaction", () => {
  it("R4.11 overrides reach the attempt row, extras the feedback, and the patch the state", async () => {
    const seen: string[] = [];
    const part: LearningHookPart = {
      name: "probe",
      beforeGrade: ({ session, derived }) => {
        seen.push(`${session.id}:${derived.node.hands[0]?.hand ?? "none"}`);
        return Promise.resolve({ trackIds: [trackId], itemDifficulty: ITEM_DIFFICULTY, panelsRevealed: true });
      },
      afterInsert: ({ attempt, next }) => {
        seen.push(`attempt:${attempt.id === next.last_attempt_id}`);
        return Promise.resolve({
          feedbackExtras: {
            review_block: { spot_class_key: "k", closed: true, fsrs_grade: "Good", next_due: null, p_known: 0.5 },
          },
        });
      },
    };
    const { app, player, sessionId } = await setUp([part]);
    const response = await decide(app, player, sessionId);
    expect(response.statusCode, response.body).toBe(200);
    const feedback = feedbackSchema.parse(response.json());
    expect(feedback.item_difficulty).toBeCloseTo(ITEM_DIFFICULTY);
    expect(feedback.review_block).toMatchObject({ closed: true, fsrs_grade: "Good" });
    expect(seen).toEqual([`${sessionId}:${HERO_ROW}`, "attempt:true"]);
    const row = await attemptRow(sessionId);
    expect(row).toMatchObject({ hand_class: HERO_ROW, panels_revealed: true, track_ids: [trackId] });
    expect(row.item_difficulty).toBeCloseTo(ITEM_DIFFICULTY);
    await app.close();
  });

  it("R4.11 a hook that throws after the insert leaves no attempt and no state change", async () => {
    const failing: LearningHookPart = { name: "boom", afterInsert: () => Promise.reject(new Error("injected")) };
    const { app, player, sessionId } = await setUp([failing]);
    const before = await rowsOf(pool, sessionId);
    const response = await decide(app, player, sessionId);
    expect(response.statusCode).toBe(SERVER_ERROR);
    expect(await rowsOf(pool, sessionId)).toEqual(before);
    await app.close();
  });

  it("R4.11 the default hooks store the hero's row label and whether an answer panel was on", async () => {
    const { app, player, sessionId } = await setUp(undefined, { panels: { hero_strategy_matrix: true } });
    const response = await decide(app, player, sessionId);
    expect(response.statusCode, response.body).toBe(200);
    expect(await attemptRow(sessionId)).toMatchObject({ hand_class: HERO_ROW, panels_revealed: true, track_ids: [], item_difficulty: null });
    await app.close();
  });
});

describe("R4.11 learning hooks at session end", () => {
  it("R4.11 onSessionEnd runs once in the end transaction and a repeat end returns the same recap", async () => {
    const calls: Pick<SessionEndContext, "firstEnd">[] = [];
    const part: LearningHookPart = {
      name: "recap",
      onSessionEnd: ({ firstEnd, ended }) => {
        calls.push({ firstEnd });
        expect(ended.endedAt).not.toBeNull();
        return Promise.resolve({ unlocks: ["streak-badge-3"], rating_changes: [{ track_key: "opens", before: null, after: { mu: 1500, rd: 200 } }] });
      },
    };
    const { app, player, sessionId } = await setUp([part]);
    const first = await end(app, player, sessionId);
    const second = await end(app, player, sessionId);
    expect(first.statusCode, first.body).toBe(200);
    expect(recapSchema.parse(first.json())).toEqual(recapSchema.parse(second.json()));
    expect(first.json()).toMatchObject({ unlocks: ["streak-badge-3"], tier: null });
    expect(calls).toEqual([{ firstEnd: true }, { firstEnd: false }]);
    await app.close();
  });
});

describe("R4.13 the holdout guard in dealing", () => {
  it("R4.13 a hand the loaded guard holds back is never dealt, and GET /next reads the guard per request", async () => {
    const loads: string[] = [];
    const guard: LearningHookPart = {
      name: "guard",
      loadHoldoutGuard: ({ session }) => {
        loads.push(session.id);
        return Promise.resolve({ isHeldOut: (_solution, _node, hand) => hand === HERO_ROW });
      },
    };
    const { app, player, sessionId } = await setUp([guard]);
    const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
    // The fake deals only AKo to the hero, so holding it back leaves no hand to deal.
    expect(response.statusCode, response.body).toBe(422);
    expect(loads).toEqual([sessionId]);
    await app.close();
  });
});
