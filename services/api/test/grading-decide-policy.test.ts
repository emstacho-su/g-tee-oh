/**
 * The graded member's loss always belongs to the member the stored decision names (R3.7, O-211,
 * ADR 0004, PR #25 review MEDIUM 7). The policy is stubbed so the preview (ratedTodayInTrack 0,
 * before the transaction) grades at one group member and the real call inside the transaction at
 * another; the stored EV loss must then be solver-query's loss for the second member, never the
 * first member's loss next to the second member's index.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../src/db.js";
import { adminPool, appDatabase } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp } from "./sessions-test-kit.js";

/** The member the preview grades at, then the member the transaction grades at (fake root: loss_bb 0.6, then 0). */
const PREVIEW_MEMBER = 0;
const REAL_MEMBER = 1;
const CHOSEN = 2;

const policyCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@g-tee-oh/learning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@g-tee-oh/learning")>();
  return {
    ...actual,
    grade: (input: Parameters<typeof actual.grade>[0]) => {
      policyCalls.count += 1;
      const output = actual.grade(input);
      return { ...output, gradedActionIndex: policyCalls.count === 1 ? PREVIEW_MEMBER : REAL_MEMBER };
    },
  };
});

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

describe("R3.7 the graded member and its loss", () => {
  it("R3.7 a member that changes inside the transaction is graded again, so the stored pair matches", async () => {
    const sq = fakeSolverQuery({ solutionId });
    const app = trainerApp(database, sq.client);
    await app.ready();
    const player = await newPlayer(database);
    const drillId = await createDrill(app, player, drillBody({ stop_rule: "after_action" }));
    const sessionId = await startSession(app, player, drillId);
    policyCalls.count = 0;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/decisions`,
      headers: player.write,
      payload: { state_version: 0, action_index: CHOSEN, response_ms: 700 },
    });
    expect(response.statusCode, response.body).toBe(200);
    const graded = sq.calls.filter((call) => call.path === "/v1/grade").map((call) => (call.body as { action_index: number }).action_index);
    expect(graded).toEqual([CHOSEN, PREVIEW_MEMBER, REAL_MEMBER]);
    const row = await pool.query<{ graded_action_index: number; ev_loss_bb: number }>(
      "select graded_action_index, ev_loss_bb from attempt where session_id = $1",
      [sessionId],
    );
    expect(row.rows[0]).toEqual({ graded_action_index: REAL_MEMBER, ev_loss_bb: 0 });
    await app.close();
  });
});
