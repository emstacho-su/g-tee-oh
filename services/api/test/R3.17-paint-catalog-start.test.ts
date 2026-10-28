/**
 * Painting by position (R3.17, S41, O-351, O-415, O-300) over the real fixture solver-query and the
 * S19 library (cfg_6_online_100 BB-BTN, synthetic): a range_paint session starts from a catalog
 * spot (a seat and a preflop spot type) instead of a drill.
 *
 * Covered: the big blind facing the button's open paints node r250 and the button's open paints the
 * pair's root, each prompt for the chosen seat only and preflop only; the grade is still solver-query's
 * /v1/grade-range answer relayed unchanged (ADR 0004) and writes no attempt; the start keeps the
 * drill start's idempotency (a replay of the same Idempotency-Key answers the same session once)
 * and its 422 for a spot the library does not serve; another user cannot read the session.
 */
import { randomBytes } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { rangePaintPromptSchema, rangePaintResultSchema } from "../src/schemas/range-paint.js";
import type { SolverQuery } from "../src/solver-query/client.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { insertSolution, newPlayer, trainerApp, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof rangePaintPromptSchema.parse>;

const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const CONFIG = "cfg_6_online_100";
const DEFEND_NODE = "cfg_6_online_100/BB-BTN/r250";
const OPEN_NODE = "cfg_6_online_100/BB-BTN/";
const SEED = "00000000deadbe41";
const SESSIONS_PATH = "/api/v1/sessions";
const SUBMIT_PATH = "/api/v1/range-paint/submit";
const PROMPTS = 4;
const DEFEND = { config_id: CONFIG, hero_positions: ["BB"], villain_positions: ["BTN"], spot_types: ["vs_open"] };
const OPEN = { config_id: CONFIG, hero_positions: ["BTN"], villain_positions: ["BB"], spot_types: ["rfi"] };

let database: Database;
let pool: pg.Pool;
let solverQuery: SolverQuery;
let app: ApiApp;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  await insertSolution(pool, CONFIG, "BB-BTN", FIXTURE_SOLUTION_ID);
  solverQuery = fixtureSolverQuery();
  app = trainerApp(database, solverQuery);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

function start(player: Player, catalogSpot: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: SESSIONS_PATH,
    headers: { ...player.write, ...headers },
    payload: { mode: "range_paint", catalog_spot: catalogSpot, seed: SEED },
  });
}

async function paintSession(player: Player, catalogSpot: Record<string, unknown>): Promise<string> {
  const response = await start(player, catalogSpot);
  expect(response.statusCode, response.body).toBe(201);
  expect(contractErrors("post", SESSIONS_PATH, 201, response.json())).toEqual([]);
  return response.json<{ session_id: string }>().session_id;
}

async function next(player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `/api/v1/range-paint/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  return rangePaintPromptSchema.parse(response.json());
}

async function submitFirstBrush(player: Player, prompt: Prompt) {
  const brush = prompt.actions[0]?.index ?? 0;
  const paint = Object.fromEntries(prompt.hands.map((hand) => [hand, brush]));
  const response = await app.inject({
    method: "POST",
    url: SUBMIT_PATH,
    headers: player.write,
    payload: { session_id: prompt.session_id, state_version: prompt.state_version, node_key: prompt.node_key, paint },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { paint, result: rangePaintResultSchema.parse(response.json()) };
}

describe("R3.17 painting starts from a catalog spot", () => {
  it("R3.17 the big blind facing an open paints node r250, for that seat only, with no drill (O-351)", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player, DEFEND);
    const row = await pool.query("select mode, drill_id from practice_session where id = $1", [sessionId]);
    expect(row.rows).toEqual([{ mode: "range_paint", drill_id: null }]);
    for (let painted = 0; painted < PROMPTS; painted += 1) {
      const prompt = await next(player, sessionId);
      expect(prompt).toMatchObject({ node_key: DEFEND_NODE, hero_position: "BB", solution_id: FIXTURE_SOLUTION_ID });
      expect(prompt.spot_class_key.startsWith("preflop/"), "painting stays preflop only (O-300)").toBe(true);
      await submitFirstBrush(player, prompt);
    }
  });

  it("R3.17 the button's open paints the pair's root", async () => {
    const player = await newPlayer(database);
    const prompt = await next(player, await paintSession(player, OPEN));
    expect(prompt).toMatchObject({ node_key: OPEN_NODE, hero_position: "BTN", history: [] });
  });

  it("R3.17 the grade is solver-query's own answer, relayed unchanged, and no attempt is written (ADR 0004)", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player, DEFEND);
    const prompt = await next(player, sessionId);
    const { paint, result } = await submitFirstBrush(player, prompt);
    const { data } = await solverQuery.POST("/v1/grade-range", {
      body: {
        solution_id: FIXTURE_SOLUTION_ID,
        node_key: DEFEND_NODE,
        paint: Object.entries(paint).map(([hand, action_index]) => ({ hand, action_index })),
      },
    });
    expect(result.total_weighted_loss_bb).toBe(data?.total_weighted_loss_bb);
    const attempts = await pool.query("select count(*)::int as n from attempt where session_id = $1", [sessionId]);
    expect(attempts.rows[0]).toEqual({ n: 0 });
  });

  it("R3.17 an Idempotency-Key replay of the start answers the same session and writes one (PM note 3)", async () => {
    const player = await newPlayer(database);
    const headers = { [IDEMPOTENCY_HEADER]: `paint-start-${randomBytes(8).toString("hex")}` };
    const first = await start(player, DEFEND, headers);
    const again = await start(player, DEFEND, headers);
    expect(first.statusCode, first.body).toBe(201);
    expect(again.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(again.json()).toEqual(first.json());
    const sessions = await pool.query("select count(*)::int as n from practice_session where user_id = $1", [player.userId]);
    expect(sessions.rows[0]).toEqual({ n: 1 });
  });

  it("R3.17 a seat and spot the library does not serve is 422 no-coverage", async () => {
    const player = await newPlayer(database);
    // cfg_9_live_13_150 is in the catalog but not in the fixture library.
    const response = await start(player, { config_id: "cfg_9_live_13_150", hero_positions: ["CO"], villain_positions: ["UTG"], spot_types: ["vs_open"] });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json<{ type: string }>().type).toMatch(/no-coverage$/);
  });

  it("R3.17 another user's catalog-spot paint session is 404", async () => {
    const owner = await newPlayer(database);
    const sessionId = await paintSession(owner, DEFEND);
    const stranger = await newPlayer(database);
    const read = await app.inject({ method: "GET", url: `/api/v1/range-paint/${sessionId}/next`, headers: stranger.read });
    expect(read.statusCode).toBe(404);
  });
});
