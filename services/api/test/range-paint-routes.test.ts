/**
 * Range painting routes (R3.17, O-300, O-302, ADR 0004) through HTTP against the real fixture
 * solver-query over validation/fixtures/library (cfg_6_online_100 BB-BTN, synthetic).
 *
 * The drill trains the big blind facing the button's open, so the session's stored spot is the
 * fixture node cfg_6_online_100/BB-BTN/r250 (fold, call, raise; 169 classes). The proof of R3.17 at
 * the api: a range painted at every class's best action totals 0; the near-indifferent 55 painted
 * at its second action costs little while the clear fold 72o painted as a raise costs at least ten
 * times more; the total the api relays equals what solver-query's own /v1/grade-range answers for
 * the same paint, and the sum of per_hand weighted_loss_bb. Painting writes no attempt row.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { rangePaintPromptSchema, rangePaintResultSchema } from "../src/schemas/range-paint.js";
import type { SolverQuery } from "../src/solver-query/client.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { createDrill, drillBody, newPlayer, rowsOf, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const FIXTURE_CLASSES = 169;
const NEAR_INDIFFERENT = "55";
const CLEAR_FOLD = "72o";
const RAISE_INDEX = 2;
const COST_RATIO = 10;
const SUM_TOLERANCE = 1e-6;
const SEED = "00000000deadbeef";
const NEXT_PATH = "/api/v1/range-paint/{session}/next";
const SUBMIT_PATH = "/api/v1/range-paint/submit";

type Prompt = ReturnType<typeof rangePaintPromptSchema.parse>;
type Paint = Record<string, number>;

let database: Database;
let pool: pg.Pool;
let solverQuery: SolverQuery;
let app: ApiApp;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solverQuery = fixtureSolverQuery();
  app = trainerApp(database, solverQuery);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

function paintDrill() {
  return drillBody({}, ["BTN"], { hero_positions: ["BB"], preflop_action: ["vs_open"] });
}

async function paintSession(player: Player, mode = "range_paint"): Promise<string> {
  const drillId = await createDrill(app, player, paintDrill());
  if (mode === "drill") {
    return startSession(app, player, drillId, SEED);
  }
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    headers: player.write,
    payload: { mode, drill_id: drillId, seed: SEED },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ session_id: string }>().session_id;
}

function getNext(player: Player, sessionId: string) {
  return app.inject({ method: "GET", url: `/api/v1/range-paint/${sessionId}/next`, headers: player.read });
}

async function next(player: Player, sessionId: string): Promise<Prompt> {
  const response = await getNext(player, sessionId);
  expect(response.statusCode, response.body).toBe(200);
  return rangePaintPromptSchema.parse(response.json());
}

function submit(player: Player, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: SUBMIT_PATH, headers: { ...player.write, ...extra }, payload: body });
}

/** Each class's best action as solver-query's node read lists it: the first action losing 0 (O-130). */
async function bestPaint(): Promise<Paint> {
  const { data } = await solverQuery.GET("/v1/nodes", { params: { query: { solution_id: FIXTURE_SOLUTION_ID, node_key: NODE_KEY } } });
  if (data === undefined) {
    throw new Error("the fixture node did not answer");
  }
  return Object.fromEntries(data.hands.map((row) => [row.hand, row.loss_pct_pot.indexOf(0)]));
}

function bodyOf(prompt: Prompt, paint: Paint): Record<string, unknown> {
  return { session_id: prompt.session_id, state_version: prompt.state_version, node_key: prompt.node_key, paint };
}

async function gradeDirect(paint: Paint) {
  const { data } = await solverQuery.POST("/v1/grade-range", {
    body: {
      solution_id: FIXTURE_SOLUTION_ID,
      node_key: NODE_KEY,
      paint: Object.entries(paint).map(([hand, action_index]) => ({ hand, action_index })),
    },
  });
  if (data === undefined) {
    throw new Error("solver-query did not grade the paint");
  }
  return data;
}

async function graded(player: Player, sessionId: string, paint: Paint) {
  const prompt = await next(player, sessionId);
  const response = await submit(player, bodyOf(prompt, paint));
  expect(response.statusCode, response.body).toBe(200);
  expect(contractErrors("post", SUBMIT_PATH, 200, response.json())).toEqual([]);
  return rangePaintResultSchema.parse(response.json());
}

describe("R3.17 GET /range-paint/{session}/next", () => {
  it("R3.17 derives the stored spot's node with every held class and the tree actions as brushes, and writes nothing", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const before = await rowsOf(pool, sessionId);
    const response = await getNext(player, sessionId);
    expect(response.statusCode, response.body).toBe(200);
    expect(contractErrors("get", NEXT_PATH, 200, response.json())).toEqual([]);
    const prompt = rangePaintPromptSchema.parse(response.json());
    expect(prompt).toMatchObject({
      session_id: sessionId,
      state_version: 0,
      prompt_no: 0,
      solution_id: FIXTURE_SOLUTION_ID,
      node_key: NODE_KEY,
      hero_position: "BB",
      synthetic: true,
    });
    expect(prompt.spot_class_key).not.toBe("");
    expect(prompt.history).toEqual([{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }]);
    expect(prompt.actions.map((action) => action.token)).toEqual(["f", "c", "r1000"]);
    expect(prompt.hands).toHaveLength(FIXTURE_CLASSES);
    expect(await next(player, sessionId)).toEqual(prompt);
    expect(await rowsOf(pool, sessionId)).toEqual(before);
  });

  it("R3.17 another user's session is 404, a drill session is 409 wrong-session-mode, an ended session is 409", async () => {
    const owner = await newPlayer(database);
    const stranger = await newPlayer(database);
    const sessionId = await paintSession(owner);
    expect((await getNext(stranger, sessionId)).statusCode).toBe(404);
    const drillSession = await paintSession(owner, "drill");
    const wrongMode = await getNext(owner, drillSession);
    expect(wrongMode.statusCode).toBe(409);
    expect(wrongMode.json<{ type: string }>().type).toMatch(/wrong-session-mode$/);
    const ended = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: owner.write, payload: {} });
    expect(ended.statusCode, ended.body).toBe(200);
    const afterEnd = await getNext(owner, sessionId);
    expect(afterEnd.statusCode).toBe(409);
    expect(afterEnd.json<{ type: string }>().type).toMatch(/session-ended$/);
  });
});

describe("R3.17 POST /range-paint/submit grades by reach-weighted EV loss (O-300)", () => {
  it("R3.17 every class painted at its best action totals 0", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const result = await graded(player, sessionId, await bestPaint());
    expect(result.total_weighted_loss_bb).toBe(0);
    expect(result.per_hand).toHaveLength(FIXTURE_CLASSES);
    expect(result.per_hand.every((row) => row.action_index === row.best_action_index)).toBe(true);
  });

  it("R3.17 the near-indifferent class painted wrong costs little; the clear fold painted as a raise costs at least ten times more", async () => {
    const player = await newPlayer(database);
    const best = await bestPaint();
    const near = await graded(player, await paintSession(player), { ...best, [NEAR_INDIFFERENT]: RAISE_INDEX });
    const clear = await graded(player, await paintSession(player), { ...best, [CLEAR_FOLD]: RAISE_INDEX });
    expect(near.total_weighted_loss_bb).toBeGreaterThan(0);
    expect(clear.total_weighted_loss_bb).toBeGreaterThanOrEqual(COST_RATIO * near.total_weighted_loss_bb);
  });

  it("R3.17 the relayed numbers equal solver-query's /v1/grade-range for the same paint and the sum of per_hand", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const paint = { ...(await bestPaint()), [NEAR_INDIFFERENT]: RAISE_INDEX, [CLEAR_FOLD]: RAISE_INDEX, AA: 0 };
    const before = await rowsOf(pool, sessionId);
    const result = await graded(player, sessionId, paint);
    const direct = await gradeDirect(paint);
    expect(result.total_weighted_loss_bb).toBe(direct.total_weighted_loss_bb);
    expect(result.floor_pct_pot).toBe(direct.floor_pct_pot);
    expect(result.per_hand).toEqual(direct.per_hand);
    const sum = result.per_hand.reduce((total, row) => total + row.weighted_loss_bb, 0);
    expect(Math.abs(sum - result.total_weighted_loss_bb)).toBeLessThan(SUM_TOLERANCE);
    const after = await rowsOf(pool, sessionId);
    expect(after.attempts).toEqual([]);
    expect(before.attempts).toEqual([]);
    expect(result.state_version).toBe(1);
    const second = await next(player, sessionId);
    expect(second).toMatchObject({ state_version: 1, prompt_no: 1 });
  });

  it("R3.17 a repeat under one Idempotency-Key replays the grade and advances the counter once", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const prompt = await next(player, sessionId);
    const body = bodyOf(prompt, await bestPaint());
    const key = { "idempotency-key": `paint-${sessionId}` };
    const first = await submit(player, body, key);
    const again = await submit(player, body, key);
    expect(first.statusCode, first.body).toBe(200);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect((await next(player, sessionId)).state_version).toBe(1);
  });
});

describe("R3.17 POST /range-paint/submit refuses what it cannot grade", () => {
  it("R3.17 a stale state_version and a node other than the prompt's are 409 stale-state", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const prompt = await next(player, sessionId);
    const paint = await bestPaint();
    const wrongNode = await submit(player, { ...bodyOf(prompt, paint), node_key: `${NODE_KEY}.r1000` });
    expect(wrongNode.statusCode).toBe(409);
    expect(wrongNode.json<{ type: string }>().type).toMatch(/stale-state$/);
    expect((await submit(player, bodyOf(prompt, paint))).statusCode).toBe(200);
    const stale = await submit(player, bodyOf(prompt, paint));
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ type: string }>().type).toMatch(/stale-state$/);
  });

  it("R3.17 a missing class, an extra class and an index that names no action are 400 without echoing the input", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const prompt = await next(player, sessionId);
    const best = await bestPaint();
    const missing = Object.fromEntries(Object.entries(best).filter(([hand]) => hand !== CLEAR_FOLD));
    const lacking = await submit(player, bodyOf(prompt, missing));
    expect(lacking.statusCode).toBe(400);
    expect(lacking.json<{ detail: string }>().detail).toMatch(/1 missing/);
    expect(lacking.body).not.toContain(`"${CLEAR_FOLD}"`);
    const notAnAction = await submit(player, bodyOf(prompt, { ...best, [CLEAR_FOLD]: prompt.actions.length }));
    expect(notAnAction.statusCode).toBe(400);
    expect(notAnAction.json<{ detail: string }>().detail).toMatch(/1 painted/);
    expect((await next(player, sessionId)).state_version).toBe(0);
  });

  it("R3.17 a class the node does not hold is 400 naming the count of extra classes", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const prompt = await next(player, sessionId);
    // KAs matches the class pattern but is not canonical, so no node holds it.
    const extra = await submit(player, bodyOf(prompt, { ...(await bestPaint()), KAs: 0 }));
    expect(extra.statusCode).toBe(400);
    expect(extra.json<{ detail: string }>().detail).toMatch(/1 extra/);
    expect(extra.body).not.toContain("KAs");
  });

  it("R3.17 another user's session is 404 and a drill session is 409 wrong-session-mode", async () => {
    const owner = await newPlayer(database);
    const stranger = await newPlayer(database);
    const sessionId = await paintSession(owner);
    const prompt = await next(owner, sessionId);
    const paint = await bestPaint();
    expect((await submit(stranger, bodyOf(prompt, paint))).statusCode).toBe(404);
    const drillSession = await paintSession(owner, "drill");
    const wrongMode = await submit(owner, { ...bodyOf(prompt, paint), session_id: drillSession });
    expect(wrongMode.statusCode).toBe(409);
    expect(wrongMode.json<{ type: string }>().type).toMatch(/wrong-session-mode$/);
  });
});
