/**
 * Noise flags unrate a decision and grading stores the node's action kinds (R3.18, 05 section 9,
 * O-304).
 *
 * - Policy: through the api's buildGradeInput in mode "automated" (the policy's rated mode, used
 *   here only to show the flag is the cause), a close_ev_mix grade is unrated by learning's grade()
 *   and the same input without the flag is rated. The mode reaches buildGradeInput from the
 *   session row only (PM note 2).
 * - Decision: when the fake solver-query's /v1/grade answers noise_flags ["close_ev_mix"], the
 *   attempt row stores the flag, rated is false and DecisionFeedback.noise_flags carries it, with
 *   the node's spot_class_key.
 * - Grading writes attempt.action_kinds: the derived node's kinds in record order, as Rust names
 *   them (ADR 0004), the input range drift compares by.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grade } from "@g-tee-oh/learning";

import type { Database } from "../src/db.js";
import { buildGradeInput } from "../src/grading/policy.js";
import { feedbackSchema } from "../src/schemas/training.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery, type FakeOptions } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, TRAINER } from "./sessions-test-kit.js";
import { flaggedGrade, policyNode } from "./R3.18-support.js";

let database: Database;
let pool: pg.Pool;
let solutionId: string;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

function automatedInput(noiseFlags: Parameters<typeof flaggedGrade>[0]) {
  return buildGradeInput({
    node: policyNode(),
    grade: flaggedGrade(noiseFlags),
    actionIndex: 1,
    rngRoll: null,
    settings: TRAINER,
    ratedTodayInTrack: 0,
    mode: "automated",
  });
}

describe("R3.18 noise flags unrate through the api's policy input", () => {
  it("R3.18 a close_ev_mix grade is unrated and the same input without flags is rated", () => {
    const flagged = grade(automatedInput(["close_ev_mix"]));
    const clean = grade(automatedInput([]));
    expect(flagged.rated).toBe(false);
    expect(clean.rated).toBe(true);
    expect(flagged.score).toBe(clean.score);
    expect(flagged.label).toBe(clean.label);
  });
});

async function decideOnce(options: Partial<FakeOptions> = {}) {
  const sq = fakeSolverQuery({ solutionId, ...options });
  const app = trainerApp(database, sq.client);
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody());
  const sessionId = await startSession(app, player, drillId);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: 0, action_index: 1, response_ms: 900 },
  });
  const stored = await pool.query<{ noise_flags: string[]; rated: boolean; action_kinds: string[] | null; spot_class_key: string }>(
    "select noise_flags, rated, action_kinds, spot_class_key from attempt where session_id = $1",
    [sessionId],
  );
  await app.close();
  return { response, row: stored.rows[0] };
}

describe("R3.18 a flagged decision through POST /sessions/{id}/decisions", () => {
  it("R3.18 stores the flag, is unrated and the feedback carries the flag and the spot class", async () => {
    const { response, row } = await decideOnce({ gradeNoiseFlags: ["close_ev_mix"] });
    expect(response.statusCode, response.body).toBe(200);
    expect(contractErrors("post", "/api/v1/sessions/{id}/decisions", 200, response.json())).toEqual([]);
    const feedback = feedbackSchema.parse(response.json());
    expect(feedback.noise_flags).toEqual(["close_ev_mix"]);
    expect(feedback.rated).toBe(false);
    expect(feedback.spot_class_key).toBe("preflop/online/100/rfi/BB-BTN");
    expect(row).toMatchObject({ noise_flags: ["close_ev_mix"], rated: false });
  });

  it("R3.18 an unflagged decision stores and returns no flags", async () => {
    const { response, row } = await decideOnce();
    expect(feedbackSchema.parse(response.json()).noise_flags).toEqual([]);
    expect(row?.noise_flags).toEqual([]);
  });
});

describe("R3.18 grading writes attempt.action_kinds (O-304)", () => {
  it("R3.18 a graded decision stores the node's action kinds in record order", async () => {
    const { response, row } = await decideOnce();
    expect(response.statusCode, response.body).toBe(200);
    // The fake root: fold, raise to 2.5bb, raise to 3bb.
    expect(row?.action_kinds).toEqual(["fold", "raise", "raise"]);
  });
});
