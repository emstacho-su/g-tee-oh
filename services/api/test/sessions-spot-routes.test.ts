/**
 * Drill spots through the session routes over a fake solver-query (R3.6, 05 section 4, O-249,
 * ADR 0018, PR #25 review HIGH 1, MEDIUM 3, 4 and 5, re-review BLOCKER 2 and LOW 6): POST /sessions
 * stores the hero spots of the drill's seats and families, and each hand is dealt straight at one
 * (the line before the hero is the spot's line, nothing is sampled before the hero acts);
 * alternate_seats alternates the hero seat; the hands filter deals again until the hero's hand
 * passes; a filter no node can satisfy is a 422 at POST /sessions; coverage requests are recorded
 * once per spot; coverage reads are bounded; a 404 during the search or a node lost later is a 502;
 * and a stalled solver-query is a transient 503 that leaves the session usable.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { MAX_CONCURRENT_SOLVER_CALLS } from "../src/sessions/concurrency.js";
import { SESSION_DEADLINE_MS } from "../src/sessions/solver-port.js";
import type { DrillCreateBody, TrainerSettings } from "../src/schemas/drills.js";
import { promptSchema } from "../src/schemas/training.js";
import { adminPool, appDatabase } from "./support/database.js";
import {
  FAKE_CONFIG,
  FAKE_PAIR,
  HERO_HAND,
  OPEN_KEY,
  PURE_FOLD_HAND,
  THREE_BET_KEY,
  VILLAIN_HAND,
  fakeSolverQuery,
  type FakeOptions,
} from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, rowsOf, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof promptSchema.parse>;
type SpotFilterBody = DrillCreateBody["spot_filter"];

const SPOT_MODE: Partial<TrainerSettings> = { stop_rule: "after_action" };
// Every history entry names its street (S38 review round 1); a spot line is preflop.
const OPEN = { position: "BTN", token: "r250", label: "r250", street: "preflop" };

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

function getNext(app: App, player: Player, sessionId: string) {
  return app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
}

async function next(app: App, player: Player, sessionId: string): Promise<Prompt> {
  const response = await getNext(app, player, sessionId);
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

describe("R3.6 each hand is dealt at a stored hero spot (PR #25 review HIGH 1, re-review BLOCKER 2)", () => {
  it("R3.6 BB facing an open: the deal starts at BB's decision behind BTN's open, nothing sampled before it", async () => {
    const { app, sq, player, drillId } = await setUp({ villains: ["BTN"], spot: { hero_positions: ["BB"], preflop_action: ["vs_open"] } });
    const sessionId = await startSession(app, player, drillId);
    const prompt = await next(app, player, sessionId);
    expect(prompt).toMatchObject({ hero_position: "BB", hero_hand: ["Qs", "Qc"], pot_cbb: 400 });
    expect(prompt.history).toEqual([OPEN]);
    expect(prompt.buttons.map((button) => button.token)).toEqual(["f", "c", "r1000"]);
    expect(sq.count("/v1/sample-action")).toBe(0);
    const deal = sq.calls.filter((call) => call.path === "/v1/deal").at(-1);
    expect(deal?.body).toMatchObject({ filter: { line: "r250" } });
    const answer = await decide(app, player, sessionId, 0, 1);
    expect(answer.statusCode, answer.body).toBe(200);
    const grade = sq.calls.find((call) => call.path === "/v1/grade");
    expect(grade?.body).toMatchObject({ node_key: OPEN_KEY, hand: VILLAIN_HAND, action_index: 1 });
    await app.close();
  });

  it("R3.6 a rare family (4-bet: the opener facing a 3-bet) is dealt in a few calls, well inside the deadline", async () => {
    const { app, sq, player, drillId } = await setUp({ spot: { preflop_action: ["four_bet"] } });
    const sessionId = await startSession(app, player, drillId);
    const dealsBefore = sq.count("/v1/deal");
    const started = performance.now();
    const prompt = await next(app, player, sessionId);
    expect(performance.now() - started).toBeLessThan(SESSION_DEADLINE_MS);
    expect(prompt.history).toEqual([OPEN, { position: "BB", token: "r1000", label: "r1000", street: "preflop" }]);
    expect(prompt.hero_position).toBe("BTN");
    expect(sq.count("/v1/deal") - dealsBefore).toBe(1);
    expect(sq.count("/v1/sample-action")).toBe(0);
    await app.close();
  });

  it("R3.6 alternate_seats alternates the hero between the pair's seats, hand by hand", async () => {
    const spot: Partial<SpotFilterBody> = { hero_positions: ["BTN", "BB"], preflop_action: ["rfi", "vs_open"], alternate_seats: true };
    const { app, player, drillId } = await setUp({ villains: [], spot });
    const sessionId = await startSession(app, player, drillId);
    const prompts = await playHands(app, player, sessionId, 3);
    expect(prompts.map((prompt) => prompt.hero_position)).toEqual(["BB", "BTN", "BB"]);
    expect(prompts[0]?.history).toEqual([OPEN]);
    expect(prompts[1]?.history).toEqual([]);
    await app.close();
  });

  it("R3.6 without alternate_seats each hand's spot is drawn from both seats' spots", async () => {
    const spot: Partial<SpotFilterBody> = { hero_positions: ["BTN", "BB"], preflop_action: ["rfi", "vs_open"], alternate_seats: false };
    const { app, player, drillId } = await setUp({ villains: [], spot });
    const sessionId = await startSession(app, player, drillId);
    const prompts = await playHands(app, player, sessionId, 6);
    for (const prompt of prompts) {
      expect(prompt.history).toEqual(prompt.hero_position === "BB" ? [OPEN] : []);
    }
    expect(new Set(prompts.map((prompt) => prompt.hero_position)).size).toBe(2);
    await app.close();
  });
});

describe("R3.6 the hands filter deals again until the hero's hand passes", () => {
  const deals = [
    { btn: PURE_FOLD_HAND, bb: VILLAIN_HAND },
    { btn: HERO_HAND, bb: VILLAIN_HAND },
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

  it("R3.6 a 404 from solver-query during the spot search is a 502, not a 404 (re-review LOW 6)", async () => {
    const { app, player, drillId } = await setUp({ fake: { missingNodes: [OPEN_KEY] } });
    const response = await postSession(app, player, drillId);
    expect(response.statusCode, response.body).toBe(502);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:upstream");
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

describe("R3.6 upstream failures after POST /sessions", () => {
  it("R3.6 R3.13 a node the library lost is a 502, never an off-range hand played on silently (MEDIUM 5)", async () => {
    const { app, player, drillId } = await setUp({
      trainer: { stop_rule: "end_of_hand" },
      fake: { opponentChoice: { [OPEN_KEY]: 2 }, lostNodes: [THREE_BET_KEY] },
    });
    const sessionId = await startSession(app, player, drillId);
    const prompt = await next(app, player, sessionId);
    const before = await rowsOf(pool, sessionId);
    // S40 (O-400): the decision runs the hand forward to see whether it ends, so it meets the lost
    // node itself: the same upstream 502 GET /next gave before, now with nothing written.
    const answer = await decide(app, player, sessionId, 0, 1);
    expect(answer.statusCode, answer.body).toBe(502);
    expect(answer.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:upstream");
    expect(await rowsOf(pool, sessionId)).toEqual(before);
    expect(await next(app, player, sessionId)).toEqual(prompt);
    await app.close();
  });

  it("R3.6 a stalled solver-query is a transient 503 past the deadline, writes nothing, and the session still plays (BLOCKER 2)", async () => {
    const { app, player, drillId } = await setUp({ fake: { stallHandReads: 1 } });
    const sessionId = await startSession(app, player, drillId);
    const before = await rowsOf(pool, sessionId);
    const stalled = await getNext(app, player, sessionId);
    expect(stalled.statusCode, stalled.body).toBe(503);
    expect(stalled.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:unavailable");
    expect(await rowsOf(pool, sessionId)).toEqual(before);
    const prompt = await next(app, player, sessionId);
    expect(prompt.hero_position).toBe("BTN");
    await app.close();
  });
});
