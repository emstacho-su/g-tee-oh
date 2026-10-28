/**
 * What S26 adds to the session routes for street and full-hand modes and the covered part of a
 * drill (R3.13, R3.14, O-312, O-313, ADR 0018), over the fake solver-query tree
 * (sessions-fake-solver-query.ts: BTN opens at the root, BB answers, BTN answers a 3-bet).
 *
 * - POST /sessions answers coverage {pairs_total, pairs_covered, pairs_queued} over the drill's
 *   (configuration, position pair) candidates, so the run screen can say how much is missing.
 * - Every prompt carries hand_no, and previous_hand ({hand_no, history, board, end}) once a hand
 *   has ended, so the client can tell a second decision in the same hand from a new hand and show
 *   how the last hand closed: a fold, the street closing (with the flop in full-hand mode), the
 *   hand leaving the solution's range, or the stop rule (spot mode).
 * - A persisted state written before S26 (no previous_hand) still parses.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import type { DrillCreateBody, TrainerSettings } from "../src/schemas/drills.js";
import { promptSchema, sessionSchema } from "../src/schemas/training.js";
import { persistedStateSchema } from "../src/sessions/state.js";
import { adminPool, appDatabase } from "./support/database.js";
import { contractErrors } from "./support/contract.js";
import { FAKE_CONFIG, FAKE_PAIR, OPEN_KEY, fakeSolverQuery, type FakeOptions } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof promptSchema.parse>;

const OPEN_ACTION = 1;
const FOLD_ACTION = 0;
const CALL_ACTION = 1;
const THREE_BET_CHOICE = 2;

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

type Villains = DrillCreateBody["spot_filter"]["villain_positions"];
type Fake = Omit<FakeOptions, "solutionId">;
type SpotOverrides = Partial<DrillCreateBody["spot_filter"]>;

/** A drill whose hero spot is BTN facing BB's 3-bet: the spot's history already holds two raises. */
const FACING_THREE_BET: SpotOverrides = { preflop_action: ["vs_three_bet"] };

async function setUp(trainer: Partial<TrainerSettings>, fake: Fake = {}, villains: Villains = ["BB"], spot: SpotOverrides = {}) {
  const sq = fakeSolverQuery({ solutionId, ...fake });
  const app = trainerApp(database, sq.client);
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody(trainer, villains, spot));
  return { app, player, drillId };
}

type App = Awaited<ReturnType<typeof setUp>>["app"];

async function next(app: App, player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  expect(contractErrors("get", "/api/v1/sessions/{id}/next", 200, response.json<unknown>())).toEqual([]);
  return promptSchema.parse(response.json());
}

async function decide(app: App, player: Player, sessionId: string, version: number, actionIndex: number): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: version, action_index: actionIndex, response_ms: 800 },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/** The first prompt, the decision on it, and the prompt after. */
async function firstTwo(trainer: Partial<TrainerSettings>, action: number, fake: Fake = {}, spot: SpotOverrides = {}) {
  const { app, player, drillId } = await setUp(trainer, fake, ["BB"], spot);
  const sessionId = await startSession(app, player, drillId);
  const first = await next(app, player, sessionId);
  await decide(app, player, sessionId, first.state_version, action);
  const second = await next(app, player, sessionId);
  await app.close();
  return { first, second };
}

describe("R3.14 POST /sessions reports the covered part of the drill (O-312)", () => {
  it("R3.14 a drill reaching five pairs with one covered runs on that one and reports four queued", async () => {
    const { app, player, drillId } = await setUp({ stop_rule: "after_action" }, {}, []);
    const response = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill", drill_id: drillId } });
    expect(response.statusCode, response.body).toBe(201);
    expect(contractErrors("post", "/api/v1/sessions", 201, response.json<unknown>())).toEqual([]);
    expect(sessionSchema.parse(response.json()).coverage).toEqual({ pairs_total: 5, pairs_covered: 1, pairs_queued: 4 });
    await app.close();
  });

  it("R3.14 a fully covered drill reports nothing queued", async () => {
    const { app, player, drillId } = await setUp({ stop_rule: "after_action" });
    const response = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill", drill_id: drillId } });
    expect(sessionSchema.parse(response.json()).coverage).toEqual({ pairs_total: 1, pairs_covered: 1, pairs_queued: 0 });
    await app.close();
  });
});

describe("R3.13 prompts mark hand boundaries (O-313)", () => {
  it("R3.13 the first prompt is hand 0 with no previous hand", async () => {
    const { first } = await firstTwo({ stop_rule: "end_of_street" }, OPEN_ACTION);
    expect(first.hand_no).toBe(0);
    expect(first.previous_hand).toBeNull();
  });

  it("R3.13 street mode: a second decision in the same hand keeps the hand number and grows the history", async () => {
    const { first, second } = await firstTwo({ stop_rule: "end_of_street" }, OPEN_ACTION, { opponentChoice: { [OPEN_KEY]: THREE_BET_CHOICE } });
    expect(second.hand_no).toBe(first.hand_no);
    expect(second.history.map((entry) => entry.position)).toEqual(["BTN", "BB"]);
    expect(second.previous_hand).toBeNull();
  });

  it("R3.13 street mode: when the street closes the next hand carries the closed hand's actions", async () => {
    const { first, second } = await firstTwo({ stop_rule: "end_of_street" }, OPEN_ACTION);
    expect(second.hand_no).toBeGreaterThan(first.hand_no);
    expect(second.previous_hand).toMatchObject({ hand_no: first.hand_no, board: [], end: "street_closed" });
    expect(second.previous_hand?.history.map((entry) => entry.position)).toEqual(["BTN", "BB"]);
  });

  it("R3.13 full-hand mode: the previous hand ends at the flop and carries the three flop cards", async () => {
    const { second } = await firstTwo({ stop_rule: "end_of_hand" }, OPEN_ACTION);
    expect(second.previous_hand).toMatchObject({ hand_no: 0, board: ["3c", "Kh", "4c"], end: "street_closed" });
    expect(second.previous_board).toEqual(["3c", "Kh", "4c"]);
  });

  it("R3.13 a hero fold ends the hand as a fold, with no board", async () => {
    const { second } = await firstTwo({ stop_rule: "end_of_hand" }, FOLD_ACTION);
    expect(second.previous_hand).toMatchObject({ hand_no: 0, board: [], end: "fold" });
    expect(second.previous_hand?.history.map((entry) => entry.position)).toEqual(["BTN"]);
  });

  it("R3.13 spot mode ends each hand by the stop rule after the hero's one decision", async () => {
    const { second } = await firstTwo({ stop_rule: "after_action" }, OPEN_ACTION);
    expect(second.previous_hand).toMatchObject({ hand_no: 0, board: [], end: "stop_rule" });
    expect(second.previous_hand?.history.map((entry) => entry.position)).toEqual(["BTN"]);
  });

  it("R3.13 a persisted state written before S26 (no previous_hand) still parses", () => {
    const old = {
      phase: "dealing",
      seed: "00000000deadbeef",
      hand_no: 0,
      spots: [{ config_id: FAKE_CONFIG, pair: FAKE_PAIR, line: null, hero_seat: "BTN", history: [] }],
      spot: { preflop_action: ["rfi"], hands: { mode: "all" }, alternate_seats: false },
      hand: null,
      previous_board: null,
      last_attempt_id: null,
    };
    expect(persistedStateSchema.safeParse(old).success).toBe(true);
  });
});

describe("R3.14 a fully uncovered drill's 422 carries its counts as typed members (MEDIUM 3, O-318)", () => {
  it("R3.14 the no-coverage problem names pairs_total and pairs_queued and matches the contract", async () => {
    const { app, player, drillId } = await setUp({ stop_rule: "after_action" }, { covered: [] }, []);
    const response = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill", drill_id: drillId } });
    expect(response.statusCode, response.body).toBe(422);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({ type: "urn:g-tee-oh:problem:no-coverage", pairs_total: 5, pairs_queued: 5 });
    expect(contractErrors("post", "/api/v1/sessions", 422, body)).toEqual([]);
    // The members are typed in the contract: a negative count is refused there.
    expect(contractErrors("post", "/api/v1/sessions", 422, { ...body, pairs_queued: -1 })).not.toEqual([]);
    await app.close();
  });
});

describe("R3.13 previous_hand.end is recorded where the hand ends (MEDIUM 5)", () => {
  it("R3.13 a hero call that closes preflop under after_action ends the hand by the stop rule", async () => {
    const { first, second } = await firstTwo({ stop_rule: "after_action" }, CALL_ACTION, {}, FACING_THREE_BET);
    expect(first.buttons[CALL_ACTION]?.kind).toBe("call");
    expect(second.previous_hand).toMatchObject({ hand_no: first.hand_no, board: [], end: "stop_rule" });
  });

  it("R3.13 a hero fold under after_action is still recorded as a fold", async () => {
    const { second } = await firstTwo({ stop_rule: "after_action" }, FOLD_ACTION);
    expect(second.previous_hand).toMatchObject({ board: [], end: "fold" });
  });

  it("R3.13 an opponent's fold in street mode is recorded as a fold", async () => {
    const { second } = await firstTwo({ stop_rule: "end_of_street" }, OPEN_ACTION, { opponentChoice: { [OPEN_KEY]: FOLD_ACTION } });
    expect(second.previous_hand).toMatchObject({ board: [], end: "fold" });
    expect(second.previous_hand?.history.map((entry) => entry.position)).toEqual(["BTN", "BB"]);
  });

  it("R3.13 a hero call that closes preflop in street mode is recorded as the street closing", async () => {
    const { second } = await firstTwo({ stop_rule: "end_of_street" }, CALL_ACTION, {}, FACING_THREE_BET);
    expect(second.previous_hand).toMatchObject({ board: [], end: "street_closed" });
  });

  it("R3.13 a hero call that closes preflop in full-hand mode is recorded at the flop reveal, with the flop", async () => {
    const { second } = await firstTwo({ stop_rule: "end_of_hand" }, CALL_ACTION, {}, FACING_THREE_BET);
    expect(second.previous_hand).toMatchObject({ board: ["3c", "Kh", "4c"], end: "street_closed" });
  });
});

describe("R3.13 hand_decision_no counts the hero's decisions in the hand (O-335)", () => {
  it("R3.13 a fresh 3-bet spot, dealt at a line with two raises, is decision 1", async () => {
    const { app, player, drillId } = await setUp({ stop_rule: "end_of_street" }, {}, ["BB"], FACING_THREE_BET);
    const sessionId = await startSession(app, player, drillId);
    const first = await next(app, player, sessionId);
    expect(first.history.map((entry) => entry.position)).toEqual(["BTN", "BB"]);
    expect(first.hand_decision_no).toBe(1);
    await app.close();
  });

  it("R3.13 street mode: the hero's second decision in one hand is decision 2, and a reload still answers 2", async () => {
    const fake: Fake = { opponentChoice: { [OPEN_KEY]: THREE_BET_CHOICE } };
    const { app, player, drillId } = await setUp({ stop_rule: "end_of_street" }, fake);
    const sessionId = await startSession(app, player, drillId);
    const first = await next(app, player, sessionId);
    expect(first.hand_decision_no).toBe(1);
    await decide(app, player, sessionId, first.state_version, OPEN_ACTION);
    const second = await next(app, player, sessionId);
    expect(second.hand_no).toBe(first.hand_no);
    expect(second.hand_decision_no).toBe(2);
    const reloaded = await next(app, player, sessionId);
    expect(reloaded.hand_decision_no).toBe(2);
    await app.close();
  });

  it("R3.13 the next hand starts again at decision 1", async () => {
    const { second } = await firstTwo({ stop_rule: "end_of_street" }, OPEN_ACTION);
    expect(second.hand_decision_no).toBe(1);
  });
});
