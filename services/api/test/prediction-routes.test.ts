/**
 * The prediction routes (R3.16, O-301, O-302, A5 section 3) over the real fixture solver-query and
 * the S19 library (cfg_6_online_100 BB-BTN, synthetic). The drill puts the big blind facing the
 * button's open, so the session's spot is node cfg_6_online_100/BB-BTN/r250.
 *
 * Every answer the test sends is worked out from solver-query's own node read (GET /v1/nodes for
 * the prompt's node), never from api internals; only the region names (naming data) come from
 * src. Levels above 1 are set up by inserting earlier answers through the superuser pool, which is
 * the history the api reads. Covered: next is pure; a right and a wrong answer for each kind the
 * fixture node offers (the size level falls back to the band because the node holds one raise; the
 * size kind is judged in prediction-questions.test.ts); 20 correct range-level-1 answers unlock
 * level 2 exactly once; a prediction session writes no attempt and touches no rating, schedule,
 * mastery, leak or streak row; stale version and prompt id are 409; another user's session is 404;
 * a drill session is 409 wrong-session-mode; and every 200 validates against the contract.
 */
import { randomBytes } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { regionOf } from "../src/prediction/regions.js";
import { predictionPromptSchema, predictionResultSchema } from "../src/schemas/prediction.js";
import type { SqNode } from "../src/solver-query/client.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof predictionPromptSchema.parse>;
type Result = ReturnType<typeof predictionResultSchema.parse>;
type Answer = Record<string, unknown>;

const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const FIXTURE_CONFIG = "cfg_6_online_100";
const FIXTURE_PAIR = "BB-BTN";
const SEED = "5eed00005eed0016";
const NEXT_PATH = "/api/v1/prediction/{session}/next";
const ANSWER_PATH = "/api/v1/prediction/{session}/answer";
const WINDOW = 20;
const BAND_EDGES = [
  ["0_25", 0],
  ["25_50", 25],
  ["50_75", 50],
  ["75_100", 75],
] as const;
const UNRATED_TABLES = ["rating", "rating_history", "schedule_card", "mastery", "leak_stat", "streak_day"] as const;

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
const solverQuery = fixtureSolverQuery();

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  await insertSolution(pool, FIXTURE_CONFIG, FIXTURE_PAIR, FIXTURE_SOLUTION_ID);
  app = trainerApp(database, solverQuery);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

function predictionDrill() {
  return drillBody({}, ["BTN"], { hero_positions: ["BB"], preflop_action: ["vs_open"] });
}

async function startPrediction(player: Player, drillId?: string): Promise<string> {
  const drill = drillId ?? (await createDrill(app, player, predictionDrill()));
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    headers: player.write,
    payload: { mode: "prediction", drill_id: drill, seed: SEED },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ session_id: string }>().session_id;
}

async function next(player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `/api/v1/prediction/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  expect(contractErrors("get", NEXT_PATH, 200, response.json())).toEqual([]);
  return predictionPromptSchema.parse(response.json());
}

/** S41 (O-350, O-412): every answer carries a typed reason; this one is used unless a test sends its own. */
const REASON = "BB defends wide against a button open at this price.";

/** Posts an answer; the body gets REASON as its rationale unless it names one (or names it undefined). */
async function post(player: Player, sessionId: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  const body = "rationale" in payload ? payload : { ...payload, rationale: REASON };
  return app.inject({
    method: "POST",
    url: `/api/v1/prediction/${sessionId}/answer`,
    headers: { ...player.write, ...headers },
    payload: body,
  });
}

async function nodeOf(prompt: Prompt): Promise<SqNode> {
  const { data } = await solverQuery.GET("/v1/nodes", {
    params: { query: { solution_id: FIXTURE_SOLUTION_ID, node_key: prompt.node_key } },
  });
  if (data === undefined) {
    throw new Error(`solver-query has no node ${prompt.node_key}`);
  }
  return data;
}

function rowOf(node: SqNode, hand: string | null) {
  const row = node.hands.find((entry) => entry.hand === hand);
  if (row === undefined) {
    throw new Error(`no row for ${String(hand)}`);
  }
  return row;
}

function sharePct(node: SqNode, index: number | null): number {
  const share = node.range_summary.by_action.find((entry) => entry.index === index)?.share;
  if (share === undefined) {
    throw new Error(`no share for action ${String(index)}`);
  }
  return share * 100;
}

function topIndex(strategy: readonly number[]): number {
  return strategy.indexOf(Math.max(...strategy));
}

function bandOf(frequencyPct: number): string {
  return BAND_EDGES.filter(([, from]) => frequencyPct >= from).at(-1)?.[0] ?? "0_25";
}

function mixedRegions(node: SqNode): Set<string> {
  const seat = node.pair.split("-").indexOf(node.to_act);
  return new Set(node.hands.filter((row) => row.mixed && (row.reach?.[seat] ?? 1) > 0).map((row) => regionOf(row.hand)));
}

/** The right answer, or a wrong one, worked out from solver-query's node. */
function answerFor(prompt: Prompt, node: SqNode, right: boolean): Answer {
  switch (prompt.answer_kind) {
    case "yes_no":
      return { kind: "yes_no", value: (sharePct(node, prompt.action_index) > (prompt.threshold_pct ?? 0)) === right };
    case "percent": {
      const share = sharePct(node, prompt.action_index);
      return { kind: "percent", value: right ? Math.round(share / 5) * 5 : share > 50 ? share - 20 : share + 20 };
    }
    case "regions": {
      const mixed = mixedRegions(node);
      const offered = prompt.regions ?? [];
      // Wrong: the first offered region's membership flipped.
      const value = offered.filter((region, index) => mixed.has(region) === (right || index !== 0));
      return { kind: "regions", value };
    }
    case "action": {
      const strategy = rowOf(node, prompt.hand).strategy;
      const best = topIndex(strategy);
      return { kind: "action", action_index: right ? best : strategy.indexOf(Math.min(...strategy)) };
    }
    case "band": {
      const frequency = rowOf(node, prompt.hand).strategy[prompt.action_index ?? 0] ?? 0;
      const band = bandOf(frequency * 100);
      return { kind: "band", band: right ? band : BAND_EDGES.map(([name]) => name).find((name) => name !== band) };
    }
    default:
      throw new Error(`the fixture node offers no ${prompt.answer_kind} prompt`);
  }
}

async function answerOne(player: Player, sessionId: string, right: boolean): Promise<{ prompt: Prompt; result: Result }> {
  const prompt = await next(player, sessionId);
  const node = await nodeOf(prompt);
  const response = await post(player, sessionId, {
    prompt_id: prompt.prompt_id,
    state_version: prompt.state_version,
    answer: answerFor(prompt, node, right),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(contractErrors("post", ANSWER_PATH, 200, response.json())).toEqual([]);
  const result = predictionResultSchema.parse(response.json());
  expect(result.correct, `${prompt.answer_kind} ${prompt.question}`).toBe(right);
  expect(result.state_version).toBe(prompt.state_version + 1);
  return { prompt, result };
}

async function seedLevel(player: Player, sessionId: string, spotClassKey: string, level: number): Promise<void> {
  for (let reached = 1; reached < level; reached += 1) {
    for (const ladder of ["range", "hand"]) {
      await pool.query(
        `insert into prediction_answer (user_id, session_id, spot_class_key, ladder, level, correct, created_at)
         select $1, $2, $3, $4, $5, true, now() - make_interval(days => $6) - make_interval(secs => g) from generate_series(${WINDOW}, 1, -1) g`,
        [player.userId, sessionId, spotClassKey, ladder, reached, level - reached],
      );
    }
  }
}

async function playAtLevel(level: number): Promise<{ prompts: Prompt[]; results: Result[] }> {
  const player = await newPlayer(database);
  const sessionId = await startPrediction(player);
  const first = await next(player, sessionId);
  await seedLevel(player, sessionId, first.spot_class_key, level);
  const played = [];
  for (const right of [true, true, false, false]) {
    played.push(await answerOne(player, sessionId, right));
  }
  return { prompts: played.map((entry) => entry.prompt), results: played.map((entry) => entry.result) };
}

describe("R3.16 prediction routes", () => {
  it("R3.16 GET next is pure: two calls answer the same prompt and nothing is written", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    const before = await pool.query("select state, state_version from practice_session where id = $1", [sessionId]);
    const first = await next(player, sessionId);
    const second = await next(player, sessionId);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ ladder: "range", level: 1, answer_kind: "yes_no", hero_position: "BB", synthetic: true });
    expect(first.node_key).toBe("cfg_6_online_100/BB-BTN/r250");
    expect(JSON.stringify(first)).not.toMatch(/share|strategy|frequency_pct/);
    const after = await pool.query("select state, state_version from practice_session where id = $1", [sessionId]);
    expect(after.rows).toEqual(before.rows);
    const answers = await pool.query("select count(*)::int as n from prediction_answer where session_id = $1", [sessionId]);
    expect(answers.rows[0]).toEqual({ n: 0 });
  });

  it("R3.16 level 1: a right and a wrong yes or no answer and a right and a wrong action answer", async () => {
    const { prompts, results } = await playAtLevel(1);
    expect(prompts.map((prompt) => prompt.answer_kind)).toEqual(["yes_no", "action", "yes_no", "action"]);
    expect(results.map((result) => result.correct)).toEqual([true, true, false, false]);
    const [yesNo, action] = results;
    expect(yesNo?.truth.share_pct).not.toBeNull();
    expect(action?.truth.action_indexes?.length).toBeGreaterThan(0);
    expect(results.every((result) => result.new_level === 1 && !result.next_level_unlocked)).toBe(true);
  });

  it("R3.16 level 2: a right and a wrong percent answer and a right and a wrong band answer", async () => {
    const { prompts, results } = await playAtLevel(2);
    expect(prompts.map((prompt) => [prompt.answer_kind, prompt.level])).toEqual([
      ["percent", 2],
      ["band", 2],
      ["percent", 2],
      ["band", 2],
    ]);
    expect(results[1]?.truth.band).not.toBeNull();
  });

  it("R3.16 level 3: a right and a wrong regions answer; the size level falls back to the band at a node with one raise", async () => {
    const { prompts, results } = await playAtLevel(3);
    expect(prompts.map((prompt) => [prompt.answer_kind, prompt.level])).toEqual([
      ["regions", 3],
      ["band", 2],
      ["regions", 3],
      ["band", 2],
    ]);
    expect(results[0]?.truth.regions).toEqual(expect.arrayContaining(["pairs", "suited_aces"]));
    expect(results.map((result) => result.new_level)).toEqual([3, 3, 3, 3]);
  });

  it("R3.16 20 correct range level 1 answers unlock range level 2 exactly once", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    const range: Result[] = [];
    for (let answered = 0; range.length < WINDOW; answered += 1) {
      const { prompt, result } = await answerOne(player, sessionId, true);
      if (prompt.ladder === "range") {
        range.push(result);
      }
    }
    expect(range.filter((result) => result.next_level_unlocked)).toHaveLength(1);
    expect(range.at(-1)).toMatchObject({ next_level_unlocked: true, new_level: 2, level: 1 });
    expect(range.at(-1)?.window).toEqual({ answers: 20, correct: 20, size: 20, required_pct: 90 });
    expect(range.at(-2)).toMatchObject({ next_level_unlocked: false, new_level: 1, level_passed: false });
    expect(range.at(-1)?.level_passed, "S41 (O-410): the window at the asked level passes with the 20th correct answer").toBe(true);
    let prompt = await next(player, sessionId);
    if (prompt.ladder !== "range") {
      await answerOne(player, sessionId, true);
      prompt = await next(player, sessionId);
    }
    expect(prompt).toMatchObject({ ladder: "range", level: 2, answer_kind: "percent" });
  });

  it("R3.16 an open level 1 prompt stays answerable as shown after another session of the user unlocks level 2 (PR #29 review M6)", async () => {
    const player = await newPlayer(database);
    const drillId = await createDrill(app, player, predictionDrill());
    const sessionA = await startPrediction(player, drillId);
    const sessionB = await startPrediction(player, drillId);
    const shown = await next(player, sessionA);
    expect(shown).toMatchObject({ ladder: "range", level: 1, answer_kind: "yes_no" });
    // Session B holds all but one answer of a full correct range level 1 window; its next range answer unlocks level 2.
    await pool.query(
      `insert into prediction_answer (user_id, session_id, spot_class_key, ladder, level, correct, created_at)
       select $1, $2, $3, 'range', 1, true, now() - make_interval(secs => g) from generate_series($4::int, 1, -1) g`,
      [player.userId, sessionB, shown.spot_class_key, WINDOW - 1],
    );
    const unlock = await answerOne(player, sessionB, true);
    expect(unlock.prompt).toMatchObject({ ladder: "range", level: 1 });
    expect(unlock.result).toMatchObject({ next_level_unlocked: true, new_level: 2 });
    const response = await post(player, sessionA, {
      prompt_id: shown.prompt_id,
      state_version: shown.state_version,
      answer: answerFor(shown, await nodeOf(shown), true),
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = predictionResultSchema.parse(response.json());
    expect(result).toMatchObject({ prompt_id: shown.prompt_id, correct: true, ladder: "range", level: 1, new_level: 2 });
    expect(result.truth.share_pct).not.toBeNull();
    const stored = await pool.query("select ladder, level, correct from prediction_answer where session_id = $1", [sessionA]);
    expect(stored.rows).toEqual([{ ladder: "range", level: 1, correct: true }]);
    expect(await next(player, sessionA)).toMatchObject({ state_version: shown.state_version + 1 });
  });

  it("R3.16 a prediction session writes no attempt and touches no rating, schedule, mastery, leak or streak row", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    for (const right of [true, false, true, false]) {
      await answerOne(player, sessionId, right);
    }
    const answers = await pool.query("select count(*)::int as n from prediction_answer where session_id = $1", [sessionId]);
    expect(answers.rows[0]).toEqual({ n: 4 });
    const attempts = await pool.query(
      "select count(*)::int as n from attempt where session_id = $1 or session_id in (select id from practice_session where user_id = $2)",
      [sessionId, player.userId],
    );
    expect(attempts.rows[0]).toEqual({ n: 0 });
    for (const table of UNRATED_TABLES) {
      const rows = await pool.query(`select count(*)::int as n from ${table} where user_id = $1`, [player.userId]);
      expect(rows.rows[0], table).toEqual({ n: 0 });
    }
  });

  it("R3.16 a stale state_version or an older prompt id is 409 stale-state and records nothing", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    const { prompt } = await answerOne(player, sessionId, true);
    const current = await next(player, sessionId);
    const node = await nodeOf(current);
    const stale = await post(player, sessionId, { prompt_id: current.prompt_id, state_version: prompt.state_version, answer: answerFor(current, node, true) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ type: string }>().type).toMatch(/stale-state$/);
    const older = await post(player, sessionId, { prompt_id: prompt.prompt_id, state_version: current.state_version, answer: answerFor(current, node, true) });
    expect(older.statusCode).toBe(409);
    const answers = await pool.query("select count(*)::int as n from prediction_answer where session_id = $1", [sessionId]);
    expect(answers.rows[0]).toEqual({ n: 1 });
  });

  it("R3.16 an answer of another kind than the prompt asks is a 400 problem", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    const prompt = await next(player, sessionId);
    const response = await post(player, sessionId, { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: { kind: "band", band: "0_25" } });
    expect(response.statusCode).toBe(400);
    const unknown = await post(player, sessionId, { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: { kind: "yes_no", value: true, extra: 1 } });
    expect(unknown.statusCode).toBe(400);
  });

  it("R3.16 an Idempotency-Key replay answers the same result and records one answer", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    const prompt = await next(player, sessionId);
    const payload = { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: answerFor(prompt, await nodeOf(prompt), true) };
    const headers = { [IDEMPOTENCY_HEADER]: `predict-${randomBytes(8).toString("hex")}` };
    const first = await post(player, sessionId, payload, headers);
    const again = await post(player, sessionId, payload, headers);
    expect(first.statusCode).toBe(200);
    expect(again.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(again.json()).toEqual(first.json());
    const answers = await pool.query("select count(*)::int as n from prediction_answer where session_id = $1", [sessionId]);
    expect(answers.rows[0]).toEqual({ n: 1 });
  });

  it("R3.16 another user's prediction session is 404 for next and answer", async () => {
    const owner = await newPlayer(database);
    const sessionId = await startPrediction(owner);
    const prompt = await next(owner, sessionId);
    const stranger = await newPlayer(database);
    const read = await app.inject({ method: "GET", url: `/api/v1/prediction/${sessionId}/next`, headers: stranger.read });
    expect(read.statusCode).toBe(404);
    const write = await post(stranger, sessionId, { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: { kind: "yes_no", value: true } });
    expect(write.statusCode).toBe(404);
  });

  it("R3.16 a drill session is 409 wrong-session-mode on the prediction routes", async () => {
    const player = await newPlayer(database);
    const drillId = await createDrill(app, player, predictionDrill());
    const sessionId = await startSession(app, player, drillId);
    const read = await app.inject({ method: "GET", url: `/api/v1/prediction/${sessionId}/next`, headers: player.read });
    expect(read.statusCode).toBe(409);
    expect(read.json<{ type: string }>().type).toMatch(/wrong-session-mode$/);
    const write = await post(player, sessionId, { prompt_id: sessionId, state_version: 0, answer: { kind: "yes_no", value: true } });
    expect(write.statusCode).toBe(409);
  });

  it("R3.16 an ended prediction session is 409 session-ended", async () => {
    const player = await newPlayer(database);
    const sessionId = await startPrediction(player);
    const end = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write, payload: {} });
    expect(end.statusCode, end.body).toBe(200);
    const read = await app.inject({ method: "GET", url: `/api/v1/prediction/${sessionId}/next`, headers: player.read });
    expect(read.statusCode).toBe(409);
    expect(read.json<{ type: string }>().type).toMatch(/session-ended$/);
  });
});
