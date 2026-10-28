/**
 * Session routes over a fake solver-query (R3.6, A6 section 2, O-249, ADR 0018): POST /sessions
 * (drill mode, coverage split, 501 and 404 and 422), GET /sessions/{id}/next is pure, the stop
 * rules' paths through the machine, hands that leave the solution's range, and POST end.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { promptSchema, recapSchema, sessionSchema } from "../src/schemas/training.js";
import { adminPool, appDatabase } from "./support/database.js";
import {
  FAKE_CONFIG,
  FAKE_PAIR,
  OPEN_KEY,
  THREE_BET_KEY,
  fakeSolverQuery,
  type FakeOptions,
} from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, rowsOf, startSession, trainerApp, type Player } from "./sessions-test-kit.js";
import type { TrainerSettings } from "../src/schemas/drills.js";

type Prompt = ReturnType<typeof promptSchema.parse>;

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

async function setUp(trainer: Partial<TrainerSettings> = {}, fake: Omit<FakeOptions, "solutionId"> = {}) {
  const sq = fakeSolverQuery({ solutionId, ...fake });
  const app = trainerApp(database, sq.client);
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody(trainer));
  return { app, sq, player, drillId };
}

async function next(app: Awaited<ReturnType<typeof setUp>>["app"], player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  return promptSchema.parse(response.json());
}

async function decide(app: Awaited<ReturnType<typeof setUp>>["app"], player: Player, sessionId: string, version: number, actionIndex: number) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: version, action_index: actionIndex, response_ms: 1200 },
  });
}

describe("R3.6 POST /sessions", () => {
  it("R3.13 the session body names the grouping its decisions are graded with, so the web never reads a changed default (PR #33 review round 1, finding 3)", async () => {
    const { app, player, drillId } = await setUp({ grouping: "simple" });
    const response = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill", drill_id: drillId } });
    expect(response.statusCode, response.body).toBe(201);
    const session = sessionSchema.parse(response.json());
    expect(session.grouping).toBe("simple");
    await app.close();
  });

  it("R3.6 a drill session starts in dealing at version 0", async () => {
    const { app, player, drillId } = await setUp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: player.write,
      payload: { mode: "drill", drill_id: drillId, seed: "0123456789abcdef" },
    });
    expect(response.statusCode, response.body).toBe(201);
    const session = sessionSchema.parse(response.json());
    expect(session).toMatchObject({ mode: "drill", drill_id: drillId, state: "dealing", state_version: 0 });
    const stored = await pool.query<{ state: { seed: string; spots: unknown[] } }>("select state from practice_session where id = $1", [session.session_id]);
    expect(stored.rows[0]?.state.seed).toBe("0123456789abcdef");
    expect(stored.rows[0]?.state.spots).toEqual([{ config_id: FAKE_CONFIG, pair: FAKE_PAIR, line: null, hero_seat: "BTN", history: [] }]);
    await app.close();
  });

  // Every POST /sessions mode is served now: S27 built prediction and range_paint (R3.16, R3.17) and
  // S31 automated and holdout (R4.10, R4.13), so no mode answers 501 any more.

  it("R3.16 R3.17 prediction and range_paint sessions are drill-backed and start awaiting their first prompt (O-302)", async () => {
    const { app, player, drillId } = await setUp();
    for (const mode of ["prediction", "range_paint"] as const) {
      const missing = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode } });
      expect(missing.statusCode, mode).toBe(400);
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers: player.write,
        payload: { mode, drill_id: drillId, seed: "0123456789abcdef" },
      });
      expect(response.statusCode, response.body).toBe(201);
      const session = sessionSchema.parse(response.json());
      expect(session).toMatchObject({ mode, drill_id: drillId, state: "await_hero", state_version: 0 });
      const stored = await pool.query<{ state: { practice: unknown; hand: unknown } }>("select state from practice_session where id = $1", [session.session_id]);
      expect(stored.rows[0]?.state.practice).toEqual({ kind: mode, counter: 0, data: {} });
      expect(stored.rows[0]?.state.hand).toBeNull();
      // The drill routes refuse a practice session (409 wrong-session-mode), so it never reaches grading.
      const nextResponse = await app.inject({ method: "GET", url: `/api/v1/sessions/${session.session_id}/next`, headers: player.read });
      expect(nextResponse.statusCode).toBe(409);
      expect(nextResponse.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:wrong-session-mode");
      const decision = await decide(app, player, session.session_id, 0, 0);
      expect(decision.statusCode).toBe(409);
      expect(decision.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:wrong-session-mode");
      expect((await rowsOf(pool, session.session_id)).attempts).toHaveLength(0);
    }
    await app.close();
  });

  it("R3.18 a decision body cannot carry a grading mode: the mode comes from the session row only (PM review note 2)", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    const prompt = await next(app, player, sessionId);
    const smuggled = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/decisions`,
      headers: player.write,
      payload: { state_version: prompt.state_version, action_index: 0, response_ms: 900, mode: "automated" },
    });
    expect(smuggled.statusCode).toBe(400);
    expect((await rowsOf(pool, sessionId)).attempts).toHaveLength(0);
    const honest = await decide(app, player, sessionId, prompt.state_version, prompt.buttons[0]?.index ?? 0);
    expect(honest.statusCode, honest.body).toBe(200);
    expect(honest.json<{ rated: boolean }>().rated).toBe(false);
    await app.close();
  });

  it("R3.6 a drill session needs a drill of the user's own (400 without, 404 for another's)", async () => {
    const { app, player, drillId } = await setUp();
    const missing = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill" } });
    expect(missing.statusCode).toBe(400);
    const other = await newPlayer(database);
    const foreign = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: other.write, payload: { mode: "drill", drill_id: drillId } });
    expect(foreign.statusCode).toBe(404);
    await app.close();
  });

  it("R3.6 uncovered pairs are recorded as coverage requests and the drill runs on the covered part (ADR 0018)", async () => {
    const { app, player } = await setUp();
    const drillId = await createDrill(app, player, drillBody({}, []));
    const sessionId = await startSession(app, player, drillId);
    const gaps = await pool.query<{ position_pair: string }>(
      "select position_pair from coverage_request where user_id = $1 order by position_pair",
      [player.userId],
    );
    expect(gaps.rows.map((row) => row.position_pair)).toEqual(["CO-BTN", "HJ-BTN", "SB-BTN", "UTG-BTN"]);
    const prompt = await next(app, player, sessionId);
    expect(prompt.hero_position).toBe("BTN");
    await app.close();
  });

  it("R3.6 a drill the library does not cover at all is a 422 no-coverage problem with its gaps recorded", async () => {
    const { app, player, drillId } = await setUp({}, { covered: [] });
    const response = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill", drill_id: drillId } });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:no-coverage");
    const gaps = await pool.query("select 1 from coverage_request where user_id = $1", [player.userId]);
    expect(gaps.rowCount).toBe(1);
    const sessions = await pool.query("select 1 from practice_session where user_id = $1", [player.userId]);
    expect(sessions.rowCount).toBe(0);
    await app.close();
  });
});

describe("R3.6 GET /sessions/{id}/next", () => {
  it("R3.6 two GET /next calls return the same prompt and change no row", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    await expect(decide(app, player, sessionId, 0, 1)).resolves.toMatchObject({ statusCode: 200 });
    const before = await rowsOf(pool, sessionId);
    const first = await next(app, player, sessionId);
    const second = await next(app, player, sessionId);
    const after = await rowsOf(pool, sessionId);
    expect(second).toEqual(first);
    expect(after).toEqual(before);
    expect(before.attempts).toHaveLength(1);
    await app.close();
  });

  it("R3.6 the prompt's buttons are the node's actions and the hero acts first (ADR 0020)", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    const prompt = await next(app, player, sessionId);
    expect(prompt).toMatchObject({
      session_id: sessionId,
      state: "await_hero",
      state_version: 0,
      hero_position: "BTN",
      hero_hand: ["Ah", "Kd"],
      board: [],
      pot_cbb: 150,
      stacks_cbb: [9900, 10000],
      history: [],
      visible_panels: ["hero_range_matrix"],
      street: "preflop",
      rng_roll: null,
      previous_board: null,
      synthetic: true,
    });
    expect(prompt.buttons.map((button) => button.token)).toEqual(["f", "r250", "r300"]);
    // O-245, O-280: each button names the node it leads to; a fold ends the solution.
    expect(prompt.buttons[0]?.next_node_key).toBeNull();
    expect(prompt.buttons[1]?.next_node_key).toEqual(expect.any(String));
    await app.close();
  });

  it("R3.6 an opponent's action comes from sample-action and shows in the history", async () => {
    const { app, sq, player, drillId } = await setUp({}, { opponentChoice: { [OPEN_KEY]: 2 } });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 1);
    const prompt = await next(app, player, sessionId);
    expect(prompt.history).toEqual([
      { position: "BTN", token: "r250", label: "r250" },
      { position: "BB", token: "r1000", label: "r1000" },
    ]);
    expect(prompt.pot_cbb).toBe(1300);
    const samples = sq.calls.filter((call) => call.path === "/v1/sample-action");
    expect(samples.at(-1)?.body).toMatchObject({ node_key: OPEN_KEY, hand: "QsQc" });
    await app.close();
  });

  it("R3.6 an ended session answers 409 session-ended", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write, payload: {} });
    const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:session-ended");
    await app.close();
  });

  it("R3.6 another user's session is a 404", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    const other = await newPlayer(database);
    const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: other.read });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("R3.6 stop rules (05 sections 2 and 4)", () => {
  it("R3.6 spot mode ends the hand after one decision, with no opponent action", async () => {
    const { app, sq, player, drillId } = await setUp({ stop_rule: "after_action" });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 1);
    const prompt = await next(app, player, sessionId);
    expect(prompt.history).toEqual([]);
    expect(prompt.state_version).toBe(1);
    expect(sq.count("/v1/sample-action")).toBe(0);
    expect(sq.count("reveal")).toBe(0);
    await app.close();
  });

  it("R3.6 street mode ends the hand when the street closes, without a reveal", async () => {
    const { app, sq, player, drillId } = await setUp({ stop_rule: "end_of_street" });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 1);
    const prompt = await next(app, player, sessionId);
    expect(sq.count("/v1/sample-action")).toBeGreaterThan(0);
    expect(sq.count("reveal")).toBe(0);
    expect(prompt.history).toEqual([]);
    expect(prompt.previous_board).toBeNull();
    await app.close();
  });

  it("R3.6 full-hand mode reveals the flop and then ends the hand in v1", async () => {
    const { app, sq, player, drillId } = await setUp({ stop_rule: "end_of_hand" });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 1);
    const prompt = await next(app, player, sessionId);
    expect(sq.count("reveal")).toBeGreaterThan(0);
    expect(prompt.previous_board).toEqual(["3c", "Kh", "4c"]);
    expect(prompt.history).toEqual([]);
    await app.close();
  });

  it("R3.6 a hero fold ends the hand in full-hand mode without a reveal", async () => {
    const { app, sq, player, drillId } = await setUp({ stop_rule: "end_of_hand" });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 0);
    const prompt = await next(app, player, sessionId);
    expect(sq.count("reveal")).toBe(0);
    expect(sq.count("/v1/sample-action")).toBe(0);
    expect(prompt.previous_board).toBeNull();
    await app.close();
  });

  it("R3.6 a hand whose solution holds no row for the hero's hand ends there", async () => {
    const { app, player, drillId } = await setUp({}, { opponentChoice: { [OPEN_KEY]: 2 }, heroOffRange: [THREE_BET_KEY] });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 1);
    const prompt = await next(app, player, sessionId);
    expect(prompt.history).toEqual([]);
    expect(prompt.pot_cbb).toBe(150);
    await app.close();
  });
});

describe("R3.6 POST /sessions/{id}/end", () => {
  it("R3.6 ends the session with a recap from its attempts, and a second end returns the same recap", async () => {
    const { app, player, drillId } = await setUp({ stop_rule: "after_action" });
    const sessionId = await startSession(app, player, drillId);
    await decide(app, player, sessionId, 0, 1);
    await decide(app, player, sessionId, 1, 0);
    const first = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write, payload: {} });
    const second = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write, payload: {} });
    expect(first.statusCode, first.body).toBe(200);
    const recap = recapSchema.parse(first.json());
    expect(second.json()).toEqual(first.json());
    expect(recap).toMatchObject({ session_id: sessionId, decisions: 2, rated_decisions: 0 });
    expect(recap.mean_score).toBeGreaterThan(0);
    expect(recap.ev_loss_bb_total).toBeCloseTo(0.6, 5);
    const row = await pool.query<{ phase: string; ended_at: Date | null; state_version: number }>(
      "select state->>'phase' as phase, ended_at, state_version from practice_session where id = $1",
      [sessionId],
    );
    expect(row.rows[0]).toMatchObject({ phase: "ended", state_version: 3 });
    expect(row.rows[0]?.ended_at).not.toBeNull();
    const late = await decide(app, player, sessionId, 3, 0);
    expect(late.statusCode).toBe(409);
    await app.close();
  });

  it("R3.6 POST end with no body at all works", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    const response = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write });
    expect(response.statusCode, response.body).toBe(200);
    expect(recapSchema.parse(response.json())).toMatchObject({ session_id: sessionId, decisions: 0 });
    await app.close();
  });

  it("R3.6 ending a session with no decisions recaps zero decisions", async () => {
    const { app, player, drillId } = await setUp();
    const sessionId = await startSession(app, player, drillId);
    const response = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write, payload: {} });
    expect(recapSchema.parse(response.json())).toMatchObject({ decisions: 0, rated_decisions: 0, mean_score: null, ev_loss_bb_total: 0 });
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/0190f000-0000-7000-8000-0000000000ff/end",
      headers: player.write,
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
