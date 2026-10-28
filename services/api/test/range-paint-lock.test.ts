/**
 * POST /range-paint/submit never holds the session row lock across a solver-query call (PR #29
 * review M5, R3.17, O-232). The submit reads the session, derives the prompt and has the paint
 * graded first, then opens the transaction, locks the row and re-checks state_version, as POST
 * /sessions/{id}/decisions does (grading/decide.ts).
 *
 * The proof hooks the fixture solver-query's fetch: while the api's POST /v1/grade-range is in
 * flight, a second connection must be able to take the session row with FOR UPDATE NOWAIT (it
 * fails at once with lock_not_available when the api's transaction holds the row), and a second
 * submit of the same prompt run inside that window wins, so the first answers 409 stale-state and
 * the counter advances exactly once.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { rangePaintPromptSchema } from "../src/schemas/range-paint.js";
import { adminPool, appDatabase } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { createDrill, drillBody, newPlayer, trainerApp, type Player } from "./sessions-test-kit.js";

const SEED = "00000000deadbeef";
const GRADE_RANGE_PATH = "/v1/grade-range";
const SUBMIT_PATH = "/api/v1/range-paint/submit";
/** Postgres SQLSTATE for FOR UPDATE NOWAIT on a row another transaction holds. */
const LOCK_NOT_AVAILABLE = "55P03";

type Prompt = ReturnType<typeof rangePaintPromptSchema.parse>;
type Hook = () => Promise<void>;

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
/** A one-shot hook run before the next grade-range call is forwarded. */
let pendingHook: Hook | undefined;

const hookedFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const hook = pendingHook;
  if (hook !== undefined && new URL(url).pathname === GRADE_RANGE_PATH) {
    pendingHook = undefined;
    await hook();
  }
  return fetch(input, init);
};

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  app = trainerApp(database, fixtureSolverQuery(hookedFetch));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

async function paintSession(player: Player): Promise<string> {
  const drillId = await createDrill(app, player, drillBody({}, ["BTN"], { hero_positions: ["BB"], preflop_action: ["vs_open"] }));
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    headers: player.write,
    payload: { mode: "range_paint", drill_id: drillId, seed: SEED },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ session_id: string }>().session_id;
}

async function next(player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `/api/v1/range-paint/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  return rangePaintPromptSchema.parse(response.json());
}

function bodyOf(prompt: Prompt): Record<string, unknown> {
  // Every class painted with the first brush: a valid paint is all the lock proof needs.
  const brush = prompt.actions[0]?.index ?? 0;
  return {
    session_id: prompt.session_id,
    state_version: prompt.state_version,
    node_key: prompt.node_key,
    paint: Object.fromEntries(prompt.hands.map((hand) => [hand, brush])),
  };
}

function submit(player: Player, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: SUBMIT_PATH, headers: player.write, payload: body });
}

/** "free" when another connection can lock the row at once, "held" when a transaction holds it. */
async function probeRowLock(sessionId: string): Promise<"free" | "held"> {
  try {
    await pool.query("select id from practice_session where id = $1 for update nowait", [sessionId]);
    return "free";
  } catch (error) {
    if ((error as { code?: string }).code === LOCK_NOT_AVAILABLE) {
      return "held";
    }
    throw error;
  }
}

async function counterOf(sessionId: string): Promise<{ state_version: number; counter: number }> {
  const result = await pool.query<{ state_version: number; counter: number }>(
    "select state_version, (state->'practice'->>'counter')::int as counter from practice_session where id = $1",
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("the session row is gone");
  }
  return row;
}

describe("R3.17 POST /range-paint/submit reads solver-query outside the row lock (PR #29 review M5)", () => {
  it("R3.17 the session row is not locked while solver-query grades the paint", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const prompt = await next(player, sessionId);
    const probes: string[] = [];
    pendingHook = async () => {
      probes.push(await probeRowLock(sessionId));
    };
    const response = await submit(player, bodyOf(prompt));
    expect(response.statusCode, response.body).toBe(200);
    expect(probes).toEqual(["free"]);
    expect(await counterOf(sessionId)).toEqual({ state_version: 1, counter: 1 });
  });

  it("R3.17 a submit that lands while another's grade is in flight wins; the other is 409 stale-state and the counter advances once", async () => {
    const player = await newPlayer(database);
    const sessionId = await paintSession(player);
    const prompt = await next(player, sessionId);
    const body = bodyOf(prompt);
    const inner: number[] = [];
    pendingHook = async () => {
      inner.push((await submit(player, body)).statusCode);
    };
    const outer = await submit(player, body);
    expect(inner).toEqual([200]);
    expect(outer.statusCode, outer.body).toBe(409);
    expect(outer.json<{ type: string }>().type).toMatch(/stale-state$/);
    expect(await counterOf(sessionId)).toEqual({ state_version: 1, counter: 1 });
  });
});
