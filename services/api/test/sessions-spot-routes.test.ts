/**
 * Drill spots through the session routes over a fake solver-query (R3.6, 05 section 4, O-249,
 * ADR 0018, PR #25 review HIGH 1, MEDIUM 3, 4 and 5): the hand is walked to the hero's decision
 * for the drill's seat and preflop action, alternate_seats alternates the hero seat, the hands
 * filter deals again until the hero's hand passes, a filter no node can satisfy is a 422 at
 * POST /sessions, coverage requests are recorded once per spot, coverage reads are bounded, and a
 * node the library no longer holds is a 502.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { MAX_CONCURRENT_SOLVER_CALLS } from "../src/sessions/concurrency.js";
import type { DrillCreateBody, TrainerSettings } from "../src/schemas/drills.js";
import { promptSchema } from "../src/schemas/training.js";
import { adminPool, appDatabase } from "./support/database.js";
import {
  FAKE_CONFIG,
  FAKE_PAIR,
  HERO_HAND,
  OPEN_KEY,
  PURE_FOLD_HAND,
  ROOT_KEY,
  THREE_BET_KEY,
  VILLAIN_HAND,
  fakeSolverQuery,
  type FakeOptions,
} from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof promptSchema.parse>;
type SpotFilterBody = DrillCreateBody["spot_filter"];

const SPOT_MODE: Partial<TrainerSettings> = { stop_rule: "after_action" };
/** BTN opens to 2.5bb at the root, so BB faces the open at r250. */
const BTN_OPENS = { [ROOT_KEY]: 1 };

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

interface SetUp {
  villains?: SpotFilterBody["villain_positions"];
  spot?: Partial<SpotFilterBody>;
  trainer?: Partial<TrainerSettings>;
  fake?: Omit<FakeOptions, "solutionId">;
}

async function setUp(options: SetUp = {}) {
  const sq = fakeSolverQuery({ solutionId, ...options.fake });
  const app = trainerApp(database, sq.client);
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody(options.trainer ?? SPOT_MODE, options.villains ?? ["BB"], options.spot));
  return { app, sq, player, drillId };
}

type App = Awaited<ReturnType<typeof setUp>>["app"];

async function next(app: App, player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  return promptSchema.parse(response.json());
}

function decide(app: App, player: Player, sessionId: string, version: number, actionIndex: number) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: version, action_index: actionIndex, response_ms: 800 },
  });
}

/** Plays `hands` spot-mode hands, answering each prompt with its first action, and returns the prompts. */
async function playHands(app: App, player: Player, sessionId: string, hands: number): Promise<Prompt[]> {
  const prompts: Prompt[] = [];
  for (let hand = 0; hand < hands; hand += 1) {
    const prompt = await next(app, player, sessionId);
    prompts.push(prompt);
    const answer = await decide(app, player, sessionId, prompt.state_version, prompt.buttons[0]?.index ?? 0);
    expect(answer.statusCode, answer.body).toBe(200);
  }
  return prompts;
}

function postSession(app: App, player: Player, drillId: string) {
  return app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "drill", drill_id: drillId } });
}

describe("R3.6 the hero acts at the drill's seat and preflop action (PR #25 review HIGH 1)", () => {
  it("R3.6 BB facing an open: BTN's open is sampled as the opponent's action and the hero acts at BB", async () => {
    const { app, sq, player, drillId } = await setUp({
      villains: ["BTN"],
      spot: { hero_positions: ["BB"], preflop_action: ["vs_open"] },
      fake: { opponentChoice: BTN_OPENS },
    });
    const sessionId = await startSession(app, player, drillId);
    const prompt = await next(app, player, sessionId);
    expect(prompt).toMatchObject({ hero_position: "BB", hero_hand: ["Qs", "Qc"], pot_cbb: 400 });
    expect(prompt.history).toEqual([{ position: "BTN", token: "r250", label: "r250" }]);
    expect(prompt.buttons.map((button) => button.token)).toEqual(["f", "c", "r1000"]);
    const opening = sq.calls.find((call) => call.path === "/v1/sample-action");
    expect(opening?.body).toMatchObject({ node_key: ROOT_KEY, hand: HERO_HAND });
    const answer = await decide(app, player, sessionId, 0, 1);
    expect(answer.statusCode, answer.body).toBe(200);
    const grade = sq.calls.find((call) => call.path === "/v1/grade");
    expect(grade?.body).toMatchObject({ node_key: OPEN_KEY, hand: VILLAIN_HAND, action_index: 1 });
    await app.close();
  });

  it("R3.6 alternate_seats alternates the hero between the pair's seats, hand by hand", async () => {
    const spot: Partial<SpotFilterBody> = { hero_positions: ["BTN", "BB"], preflop_action: ["rfi", "vs_open"], alternate_seats: true };
    const { app, player, drillId } = await setUp({ villains: [], spot, fake: { opponentChoice: BTN_OPENS } });
    const sessionId = await startSession(app, player, drillId);
    const prompts = await playHands(app, player, sessionId, 3);
    expect(prompts.map((prompt) => prompt.hero_position)).toEqual(["BB", "BTN", "BB"]);
    expect(prompts[0]?.history).toEqual([{ position: "BTN", token: "r250", label: "r250" }]);
    expect(prompts[1]?.history).toEqual([]);
    await app.close();
  });

  it("R3.6 without alternate_seats the first seat to act in the drill's families is the hero every hand", async () => {
    const spot: Partial<SpotFilterBody> = { hero_positions: ["BTN", "BB"], preflop_action: ["rfi", "vs_open"], alternate_seats: false };
    const { app, player, drillId } = await setUp({ villains: [], spot, fake: { opponentChoice: BTN_OPENS } });
    const sessionId = await startSession(app, player, drillId);
    const prompts = await playHands(app, player, sessionId, 2);
    expect(prompts.map((prompt) => prompt.hero_position)).toEqual(["BTN", "BTN"]);
    await app.close();
  });
});

describe("R3.6 the hands filter deals again until the hero's hand passes", () => {
  const deals = [
    { hero: PURE_FOLD_HAND, villain: VILLAIN_HAND },
    { hero: HERO_HAND, villain: VILLAIN_HAND },
  ];

  const filters: SpotFilterBody["hands"][] = [{ mode: "manual", hands: ["KAo"] }, { mode: "close_decisions" }];
  for (const hands of filters) {
    it(`R3.6 ${hands.mode}: every prompt holds a passing hand, and a failing deal was dealt again`, async () => {
      const { app, sq, player, drillId } = await setUp({ spot: { hands }, fake: { deals } });
      const sessionId = await startSession(app, player, drillId);
      const prompts = await playHands(app, player, sessionId, 4);
      expect(prompts.map((prompt) => prompt.hero_hand.join(""))).toEqual(Array(4).fill(HERO_HAND));
      const seeds = sq.calls.filter((call) => call.path === "/v1/deal").map((call) => BigInt(`0x${String((call.body as { seed: string }).seed)}`));
      expect(seeds.some((seed) => seed % 2n === 0n), "a deal of the pure-fold hand was refused").toBe(true);
      await app.close();
    });
  }
});

describe("R3.6 POST /sessions refuses a filter the library cannot satisfy", () => {
  it("R3.6 no node where a hero seat acts in the drill's families is a 422 no-coverage, with no session written", async () => {
    const { app, player, drillId } = await setUp({ spot: { preflop_action: ["squeeze"] } });
    const response = await postSession(app, player, drillId);
    expect(response.statusCode, response.body).toBe(422);
    const body = response.json<{ type: string; detail: string }>();
    expect(body.type).toBe("urn:g-tee-oh:problem:no-coverage");
    expect(body.detail).toContain("preflop action");
    const sessions = await pool.query("select 1 from practice_session where user_id = $1", [player.userId]);
    expect(sessions.rowCount).toBe(0);
    await app.close();
  });

  it("R3.6 a manual list with no class in the hero's range at any matching node is a 422", async () => {
    const { app, player, drillId } = await setUp({ spot: { hands: { mode: "manual", hands: ["32s"] } } });
    const response = await postSession(app, player, drillId);
    expect(response.statusCode, response.body).toBe(422);
    await app.close();
  });
});

describe("R3.6 coverage requests and coverage reads (PR #25 review MEDIUM 3 and 4)", () => {
  it("R3.6 repeated POST /sessions over the same uncovered drill records one coverage_request row per spot", async () => {
    const { app, player, drillId } = await setUp({ villains: [], fake: { covered: [] } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await postSession(app, player, drillId);
      expect(response.statusCode, response.body).toBe(422);
    }
    const rows = await pool.query<{ position_pair: string; n: string }>(
      "select position_pair, count(*) as n from coverage_request where user_id = $1 group by position_pair order by position_pair",
      [player.userId],
    );
    expect(rows.rows.map((row) => row.position_pair)).toEqual(["BB-BTN", "CO-BTN", "HJ-BTN", "SB-BTN", "UTG-BTN"]);
    expect(rows.rows.every((row) => Number(row.n) === 1)).toBe(true);
    await app.close();
  });

  it("R3.6 a drill over many spots never has more than the cap of coverage reads in flight", async () => {
    const spot: Partial<SpotFilterBody> = { hero_positions: ["UTG", "HJ", "CO", "BTN", "SB"] };
    const { app, sq, player, drillId } = await setUp({ villains: [], spot, fake: { coverageDelayMs: 5 } });
    const response = await postSession(app, player, drillId);
    expect(response.statusCode, response.body).toBe(201);
    expect(sq.count("/v1/coverage")).toBeGreaterThan(MAX_CONCURRENT_SOLVER_CALLS);
    expect(sq.maxCoverageInFlight()).toBeLessThanOrEqual(MAX_CONCURRENT_SOLVER_CALLS);
    await app.close();
  });
});

describe("R3.6 a node the library no longer holds (PR #25 review MEDIUM 5)", () => {
  it("R3.6 is a 502 at GET /next, never an off-range hand played on silently", async () => {
    const { app, player, drillId } = await setUp({
      trainer: { stop_rule: "end_of_hand" },
      fake: { opponentChoice: { [OPEN_KEY]: 2 }, missingNodes: [THREE_BET_KEY] },
    });
    const sessionId = await startSession(app, player, drillId);
    const answer = await decide(app, player, sessionId, 0, 1);
    expect(answer.statusCode, answer.body).toBe(200);
    const response = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:upstream");
    await app.close();
  });
});
