/**
 * POST /sessions/{id}/decisions over a fake solver-query (R3.7, A5 section 3, O-92, O-156, O-232,
 * O-246, O-248): one transaction for the attempt and the state, an Idempotency-Key double submit
 * graded once, a keyless resubmit at the old version refused as stale, feedback equal to a
 * re-render of the stored row, Server-Timing, Simple mode's group member graded from Rust,
 * Mixed-frequency mode's roll and followed-the-roll mark (ADR 0024, O-371), the retired confidence
 * field (O-345, O-373), and ratedTodayInTrack's day boundary.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { countRatedToday, feedbackRows } from "../src/grading/attempts.js";
import { renderFeedback, type FeedbackRow } from "../src/grading/feedback.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { SERVER_TIMING_HEADER } from "../src/http/server-timing.js";
import type { TrainerSettings } from "../src/schemas/drills.js";
import { feedbackSchema, promptSchema } from "../src/schemas/training.js";
import { adminPool, appDatabase } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, ROOT_KEY, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, rowsOf, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

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

async function setUp(trainer: Partial<TrainerSettings> = {}) {
  const sq = fakeSolverQuery({ solutionId });
  const app = trainerApp(database, sq.client);
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody(trainer));
  const sessionId = await startSession(app, player, drillId);
  return { app, sq, player, sessionId };
}

type App = Awaited<ReturnType<typeof setUp>>["app"];

function decide(app: App, player: Player, sessionId: string, body: Record<string, unknown>, key?: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: key === undefined ? player.write : { ...player.write, [IDEMPOTENCY_HEADER]: key },
    payload: { state_version: 0, action_index: 1, response_ms: 900, ...body },
  });
}

async function storedFeedbackRows(sessionId: string): Promise<FeedbackRow[]> {
  return feedbackRows(database).where("attempt.session_id", "=", sessionId).orderBy("attempt.id").execute();
}

describe("R3.7 POST /sessions/{id}/decisions", () => {
  it("R3.7 grades the decision, stores the attempt and moves the session to feedback at version 1", async () => {
    const { app, sq, player, sessionId } = await setUp();
    const response = await decide(app, player, sessionId, {});
    expect(response.statusCode, response.body).toBe(200);
    const feedback = feedbackSchema.parse(response.json());
    expect(feedback).toMatchObject({ label: "best", score: 1, ev_loss_bb: 0, best_action_indexes: [1], rated: false, state_version: 1 });
    const grade = sq.calls.find((call) => call.path === "/v1/grade");
    expect(grade?.body).toEqual({ solution_id: solutionId, node_key: ROOT_KEY, hand: "AhKd", action_index: 1, reference: `${sessionId}:0` });
    const row = await pool.query("select * from attempt where session_id = $1", [sessionId]);
    // S31 (O-274): every attempt carries its class's track, and an RFI decision is in the opens track.
    const opens = await pool.query<{ id: string }>("select id from track where key = 'opens'");
    expect(row.rows[0]).toMatchObject({
      user_id: player.userId,
      solution_id: solutionId,
      node_key: ROOT_KEY,
      spot_class_key: "preflop/online/100/rfi/BB-BTN",
      track_ids: [opens.rows[0]?.id],
      hand: "AhKd",
      action_index: 1,
      action_token: "r250",
      label: "best",
      reference_strategy: "equilibrium",
      confidence: null,
      followed_roll: null,
      response_ms: 900,
      state_version: 0,
      graded_action_index: 1,
    });
    const session = await pool.query<{ phase: string; state_version: number; last: string }>(
      "select state->>'phase' as phase, state_version, state->>'last_attempt_id' as last from practice_session where id = $1",
      [sessionId],
    );
    expect(session.rows[0]).toEqual({ phase: "feedback", state_version: 1, last: feedback.attempt_id });
    await app.close();
  });

  it("R3.13 a decision that sends the retired confidence field is a 400 problem and stores nothing (O-345, O-373)", async () => {
    const { app, player, sessionId } = await setUp();
    const response = await decide(app, player, sessionId, { confidence: "sure" });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json()).toMatchObject({ type: "urn:g-tee-oh:problem:validation", status: 400 });
    expect(await storedFeedbackRows(sessionId)).toHaveLength(0);
    await app.close();
  });

  it("R3.7 the feedback equals a re-render from the stored attempt row (O-92)", async () => {
    const { app, player, sessionId } = await setUp();
    const response = await decide(app, player, sessionId, { action_index: 0 });
    const [row] = await storedFeedbackRows(sessionId);
    expect(row).toBeDefined();
    expect(response.json()).toEqual(renderFeedback(row as FeedbackRow));
    expect(response.json()).toMatchObject({ label: "blunder", ev_loss_pct_pot: 40 });
    await app.close();
  });

  it("R3.7 the feedback names the node decided: solution, node key, configuration, pair and hand (O-280, O-281)", async () => {
    const { app, player, sessionId } = await setUp();
    const response = await decide(app, player, sessionId, {});
    expect(response.statusCode, response.body).toBe(200);
    expect(feedbackSchema.parse(response.json())).toMatchObject({
      solution_id: solutionId,
      node_key: ROOT_KEY,
      config_id: FAKE_CONFIG,
      pair: FAKE_PAIR,
      hand: "AhKd",
    });
    await app.close();
  });

  it("R3.7 the response carries Server-Timing sq-grade (O-248)", async () => {
    const { app, player, sessionId } = await setUp();
    const response = await decide(app, player, sessionId, {});
    expect(String(response.headers[SERVER_TIMING_HEADER])).toMatch(/^sq-grade;dur=\d+\.\d{2}$/);
    await app.close();
  });

  it("R3.7 a double submit with one Idempotency-Key is graded once and replays the feedback", async () => {
    const { app, sq, player, sessionId } = await setUp();
    const key = `decision-${randomUUID()}`;
    const first = await decide(app, player, sessionId, {}, key);
    const second = await decide(app, player, sessionId, {}, key);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(second.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(await storedFeedbackRows(sessionId)).toHaveLength(1);
    expect(sq.count("/v1/grade")).toBe(1);
    await app.close();
  });

  it("R3.7 a second submit without a key at the old state_version is 409 stale-state", async () => {
    const { app, player, sessionId } = await setUp();
    expect((await decide(app, player, sessionId, {})).statusCode).toBe(200);
    const again = await decide(app, player, sessionId, {});
    expect(again.statusCode).toBe(409);
    expect(again.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:stale-state");
    expect(await storedFeedbackRows(sessionId)).toHaveLength(1);
    await app.close();
  });

  it("R3.7 a failure after the attempt insert rolls back the attempt and keeps the old state_version", async () => {
    const { app, player, sessionId } = await setUp();
    const trigger = `fail_${sessionId.replaceAll("-", "_")}`;
    await pool.query(
      `create function ${trigger}() returns trigger language plpgsql as $$
       begin
         if new.id = '${sessionId}' then raise exception 'injected failure after the attempt insert'; end if;
         return new;
       end $$`,
    );
    await pool.query(`create trigger ${trigger} before update on practice_session for each row execute function ${trigger}()`);
    try {
      const before = await rowsOf(pool, sessionId);
      const response = await decide(app, player, sessionId, {});
      expect(response.statusCode).toBe(500);
      const after = await rowsOf(pool, sessionId);
      expect(after).toEqual(before);
      expect(after.attempts).toHaveLength(0);
      expect(after.session[0]).toMatchObject({ state_version: 0 });
    } finally {
      await pool.query(`drop trigger ${trigger} on practice_session`);
      await pool.query(`drop function ${trigger}()`);
    }
    const retried = await decide(app, player, sessionId, {});
    expect(retried.statusCode).toBe(200);
    await app.close();
  });

  it("R3.7 an action index the node does not hold is a 400", async () => {
    const { app, player, sessionId } = await setUp();
    const response = await decide(app, player, sessionId, { action_index: 7 });
    expect(response.statusCode).toBe(400);
    expect(await storedFeedbackRows(sessionId)).toHaveLength(0);
    await app.close();
  });

  it("R3.7 Simple mode grades the chosen raise at its group's best member, with that member's loss from Rust (O-211)", async () => {
    const { app, sq, player, sessionId } = await setUp({ grouping: "simple" });
    const response = await decide(app, player, sessionId, { action_index: 2 });
    expect(response.statusCode, response.body).toBe(200);
    // The raise group grades at its lowest-loss member (raise to 2.5bb, loss 0), the node's lowest loss, so it is Best (ADR 0024).
    expect(response.json()).toMatchObject({ label: "best", ev_loss_bb: 0, ev_loss_pct_pot: 0 });
    // O-375 amended: the raise type is Best, but only its lowest-loss size (raise to 2.5bb) is named best, not raise to 3bb.
    expect(response.json<{ best_action_indexes: number[] }>().best_action_indexes).toEqual([1]);
    const grades = sq.calls.filter((call) => call.path === "/v1/grade").map((call) => (call.body as { action_index: number }).action_index);
    expect(grades).toEqual([2, 1]);
    const row = await pool.query("select action_index, graded_action_index from attempt where session_id = $1", [sessionId]);
    expect(row.rows[0]).toEqual({ action_index: 2, graded_action_index: 1 });
    await app.close();
  });

  it("R3.10 Mixed-frequency mode shows one roll per decision, stable across GETs, stores it with the attempt, and never moves Best (O-213, ADR 0024)", async () => {
    const { app, player, sessionId } = await setUp({ rng: true });
    const get = async () =>
      promptSchema.parse((await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read })).json());
    const prompt = await get();
    expect(prompt.rng_roll).not.toBeNull();
    expect((await get()).rng_roll).toBe(prompt.rng_roll);
    const feedback = feedbackSchema.parse((await decide(app, player, sessionId, {})).json());
    expect(feedback.rng_roll).toBe(prompt.rng_roll);
    // Best is the lowest loss whatever the roll; the roll only sets the followed mark (fold band 1 to 30, raise 31 to 100).
    expect(feedback.best_action_indexes).toEqual([1]);
    expect(feedback.label).toBe("best");
    expect(feedback.followed_roll).toBe((prompt.rng_roll ?? 0) > 30);
    const stored = await pool.query<{ followed_roll: boolean | null }>("select followed_roll from attempt where session_id = $1", [sessionId]);
    expect(stored.rows[0]?.followed_roll).toBe(feedback.followed_roll);
    await app.close();
  });

  it("R3.10 with Mixed-frequency mode off the feedback has no roll and no followed mark (ADR 0024 rule 2)", async () => {
    const { app, player, sessionId } = await setUp();
    const feedback = feedbackSchema.parse((await decide(app, player, sessionId, {})).json());
    expect(feedback).toMatchObject({ rng_roll: null, followed_roll: null });
    await app.close();
  });
});

describe("R3.7 ratedTodayInTrack (O-214, O-247)", () => {
  it("R3.7 counts the user's rated attempts since midnight in the configured time zone", async () => {
    const { app, player, sessionId } = await setUp();
    await decide(app, player, sessionId, {});
    const now = new Date("2026-03-10T03:00:00Z");
    const stamps = ["2026-03-10T00:30:00Z", "2026-03-09T23:30:00Z", "2026-03-09T03:30:00Z", "2026-03-10T04:00:00Z"];
    for (const stamp of stamps) {
      await pool.query(
        `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, action_index,
           action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight, created_at)
         values ($1, $2, $3, 'k', 'c', '{}', 'AhKd', 0, 'f', 0, 0, 0, 0, 0, 1, 'best', true, 1, $4)`,
        [player.userId, sessionId, solutionId, stamp],
      );
    }
    expect(await countRatedToday(database, player.userId, now, "UTC")).toBe(1);
    expect(await countRatedToday(database, player.userId, now, "America/New_York")).toBe(2);
    await app.close();
  });
});
