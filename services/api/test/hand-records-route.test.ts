/**
 * GET /sessions/{id}/hands, the hand log's read (R3.13, S40, O-403), over the fake solver-query in
 * spot mode, where every decision ends its hand. The answer matches the committed contract, pages
 * by hand number with the shared cursor and limit, refuses a tampered cursor or an out-of-range
 * limit with 400, needs a session (401), and is owner scoped: another user's session answers the
 * same 404 as an id that does not exist, so the answer never tells whether the session exists.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { MAX_PAGE_LIMIT } from "../src/http/pagination.js";
import { promptSchema } from "../src/schemas/training.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

const API = "/api/v1";
const OPEN = 1;
const HANDS_PLAYED = 3;
const CONTRACT_PATH = "/api/v1/sessions/{id}/hands";

interface HandsPage {
  items: { hand_no: number; end: string; hero_hand: string[]; attempt_id: string }[];
  next_cursor: string | null;
}

interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
let owner: Player;
let stranger: Player;
let sessionId: string;

function hands(player: Player | null, id: string, query = "") {
  return app.inject({ method: "GET", url: `${API}/sessions/${id}/hands${query}`, headers: player === null ? {} : player.read });
}

async function playSpots(player: Player, id: string, count: number): Promise<void> {
  for (let played = 0; played < count; played += 1) {
    const next = await app.inject({ method: "GET", url: `${API}/sessions/${id}/next`, headers: player.read });
    const prompt = promptSchema.parse(next.json());
    const decided = await app.inject({
      method: "POST",
      url: `${API}/sessions/${id}/decisions`,
      headers: player.write,
      payload: { state_version: prompt.state_version, action_index: OPEN, response_ms: 900 },
    });
    expect(decided.statusCode, decided.body).toBe(200);
  }
}

function problemOf(body: unknown): { type: string; title: string; status: number; detail: string | undefined } {
  const { type, title, status, detail } = body as Problem;
  return { type, title, status, detail };
}

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  const solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
  app = trainerApp(database, fakeSolverQuery({ solutionId }).client);
  await app.ready();
  owner = await newPlayer(database);
  stranger = await newPlayer(database);
  sessionId = await startSession(app, owner, await createDrill(app, owner, drillBody({ stop_rule: "after_action" })));
  await playSpots(owner, sessionId, HANDS_PLAYED);
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

describe("R3.13 GET /sessions/{id}/hands (O-403)", () => {
  it("R3.13 lists the session's finished hands by hand number, matching the contract", async () => {
    const response = await hands(owner, sessionId);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<HandsPage>();
    expect(contractErrors("get", CONTRACT_PATH, 200, body)).toEqual([]);
    expect(body.items.map((item) => item.end)).toEqual(["stop_rule", "stop_rule", "stop_rule"]);
    const numbers = body.items.map((item) => item.hand_no);
    expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
    expect(body.items.every((item) => item.hero_hand.length === 2)).toBe(true);
    expect(body.next_cursor).toBeNull();
  });

  it("R3.13 pages with the shared cursor and limit", async () => {
    const first = (await hands(owner, sessionId, "?limit=2")).json<HandsPage>();
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = (await hands(owner, sessionId, `?limit=2&cursor=${first.next_cursor ?? ""}`)).json<HandsPage>();
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    const all = (await hands(owner, sessionId)).json<HandsPage>();
    expect([...first.items, ...second.items]).toEqual(all.items);
  });

  it("R3.13 a tampered cursor or a limit outside 1 to the shared maximum is a 400 problem", async () => {
    for (const query of ["?cursor=not-a-cursor", "?limit=0", `?limit=${MAX_PAGE_LIMIT + 1}`, `?cursor=${Buffer.from('{"id":1}').toString("base64url")}`]) {
      const response = await hands(owner, sessionId, query);
      expect(response.statusCode, query).toBe(400);
      expect(contractErrors("get", CONTRACT_PATH, 400, response.json<unknown>())).toEqual([]);
    }
  });

  it("R3.13 a cursor whose hand number passes the int range is a 400, never a database error (security review L1)", async () => {
    const cursor = Buffer.from(JSON.stringify({ hand_no: 2_147_483_648 })).toString("base64url");
    const response = await hands(owner, sessionId, `?cursor=${cursor}`);
    expect(response.statusCode).toBe(400);
    expect(contractErrors("get", CONTRACT_PATH, 400, response.json<unknown>())).toEqual([]);
    const largest = Buffer.from(JSON.stringify({ hand_no: 2_147_483_647 })).toString("base64url");
    expect((await hands(owner, sessionId, `?cursor=${largest}`)).json<HandsPage>()).toEqual({ items: [], next_cursor: null });
  });

  it("R3.13 needs a signed-in user (401)", async () => {
    const response = await hands(null, sessionId);
    expect(response.statusCode).toBe(401);
  });

  it("R3.13 another user's session answers the same 404 as one that does not exist, and lists nothing", async () => {
    const theirs = await hands(stranger, sessionId);
    const missing = await hands(stranger, randomUUID());
    expect(theirs.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(problemOf(theirs.json())).toEqual(problemOf(missing.json()));
    expect(theirs.body).not.toContain(owner.userId);
    expect(contractErrors("get", CONTRACT_PATH, 404, theirs.json<unknown>())).toEqual([]);
  });

  it("R3.13 a session with no finished hand lists none", async () => {
    const fresh = await startSession(app, stranger, await createDrill(app, stranger, drillBody({ stop_rule: "after_action" })));
    const body = (await hands(stranger, fresh)).json<HandsPage>();
    expect(body).toEqual({ items: [], next_cursor: null });
  });
});
