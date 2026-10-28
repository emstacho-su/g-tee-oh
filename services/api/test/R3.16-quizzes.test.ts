/**
 * Quizzes (R3.16, S41, O-350, O-410 to O-415) over the real fixture solver-query and the S19 library
 * (cfg_6_online_100 BB-BTN, synthetic): the catalog-spot start of a prediction session, the quiz
 * difficulty and question kinds, the per-level passed mark and the required typed reason.
 *
 * Covered: a catalog spot starts a quiz with no drill on the chosen seat and spot; Easy, Medium and
 * Hard ask levels 1, 2 and 3 whatever the user's unlocks say (free choice, no gate) and never a
 * lower level or an unchosen ladder, refusing with a clear message when the spots cannot ask it
 * (O-411 amended, PR #39 review finding 2); one question kind asks only that ladder; level_passed
 * and the window read the answers at the asked level; every body rule of the start is a 400 that writes nothing, a spot the
 * library cannot serve is a 422 that queues its gaps, an Idempotency-Key replay answers the same
 * session once; the reason is required, cleaned, 3 to 1,000 characters, stored with the answer as
 * jsonb, never echoed and never logged, and a refused reason records nothing.
 */
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { PREDICTION_LADDERS } from "@g-tee-oh/learning";
import { predictionPromptSchema, predictionResultSchema } from "../src/schemas/prediction.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp } from "./support/solver-query.js";
import { insertSolution, newPlayer, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof predictionPromptSchema.parse>;

const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const CONFIG = "cfg_6_online_100";
const UNSERVED_CONFIG = "cfg_9_live_13_150";
const PAIR = "BB-BTN";
const NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const SEED = "5eed00005eed0041";
const SESSIONS_PATH = "/api/v1/sessions";
const ANSWER_PATH = "/api/v1/prediction/{session}/answer";
const REASON = "The button opens wide, so the big blind defends a lot at this price.";
const WINDOW = 20;
const MAX_REASON = 1000;
const DEFEND = { config_id: CONFIG, hero_positions: ["BB"], villain_positions: ["BTN"], spot_types: ["vs_open"] };

let database: Database;
let pool: pg.Pool;
let app: ApiApp;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  await insertSolution(pool, CONFIG, PAIR, FIXTURE_SOLUTION_ID);
  app = buildTrainerApp(database);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

function quizBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { mode: "prediction", catalog_spot: DEFEND, quiz: { difficulty: "easy", question_kinds: ["range", "hand"] }, seed: SEED, ...overrides };
}

async function start(player: Player, body: Record<string, unknown>, headers: Record<string, string> = {}, target: ApiApp = app) {
  return target.inject({ method: "POST", url: SESSIONS_PATH, headers: { ...player.write, ...headers }, payload: body });
}

async function startQuiz(player: Player, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await start(player, quizBody(overrides));
  expect(response.statusCode, response.body).toBe(201);
  expect(contractErrors("post", SESSIONS_PATH, 201, response.json())).toEqual([]);
  return response.json<{ session_id: string }>().session_id;
}

async function next(player: Player, sessionId: string, target: ApiApp = app): Promise<Prompt> {
  const response = await target.inject({ method: "GET", url: `/api/v1/prediction/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  return predictionPromptSchema.parse(response.json());
}

/** A well-formed answer of the prompt's kind; whether it is right does not matter here. */
function anyAnswer(prompt: Prompt): Record<string, unknown> {
  switch (prompt.answer_kind) {
    case "yes_no":
      return { kind: "yes_no", value: true };
    case "percent":
      return { kind: "percent", value: 50 };
    case "regions":
      return { kind: "regions", value: [] };
    case "band":
      return { kind: "band", band: "0_25" };
    default:
      return { kind: prompt.answer_kind, action_index: prompt.actions[0]?.index ?? 0 };
  }
}

async function answer(player: Player, sessionId: string, prompt: Prompt, extra: Record<string, unknown> = {}, target: ApiApp = app) {
  return target.inject({
    method: "POST",
    url: `/api/v1/prediction/${sessionId}/answer`,
    headers: player.write,
    payload: { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: anyAnswer(prompt), rationale: REASON, ...extra },
  });
}

/** Answers `count` prompts and returns each prompt's (ladder, level, kind). */
async function play(player: Player, sessionId: string, count: number): Promise<Array<[string, number, string]>> {
  const seen: Array<[string, number, string]> = [];
  for (let answered = 0; answered < count; answered += 1) {
    const prompt = await next(player, sessionId);
    seen.push([prompt.ladder, prompt.level, prompt.answer_kind]);
    const response = await answer(player, sessionId, prompt);
    expect(response.statusCode, response.body).toBe(200);
  }
  return seen;
}

async function countRows(sql: string, values: unknown[]): Promise<number> {
  const result = await pool.query<{ n: number }>(`select count(*)::int as n from (${sql}) rows`, values);
  return result.rows[0]?.n ?? 0;
}

async function seedAnswers(player: Player, sessionId: string, spotClassKey: string, ladder: string, level: number, count: number): Promise<void> {
  await pool.query(
    `insert into prediction_answer (user_id, session_id, spot_class_key, ladder, level, correct, created_at)
     select $1, $2, $3, $4, $5, true, now() - interval '1 day' - make_interval(secs => g) from generate_series($6::int, 1, -1) g`,
    [player.userId, sessionId, spotClassKey, ladder, level, count],
  );
}

describe("R3.16 quiz start from a catalog spot", () => {
  it("R3.16 a catalog spot starts a quiz with no drill, on the chosen seat and spot (O-415)", async () => {
    const player = await newPlayer(database);
    const sessionId = await startQuiz(player);
    const row = await pool.query("select mode, drill_id from practice_session where id = $1", [sessionId]);
    expect(row.rows).toEqual([{ mode: "prediction", drill_id: null }]);
    const prompt = await next(player, sessionId);
    expect(prompt).toMatchObject({ hero_position: "BB", node_key: NODE_KEY, level: 1 });
  });

  it("R3.16 Easy, Medium and Hard ask levels 1, 2 and 3 and never a lower level (O-410, O-411 amended)", async () => {
    const levels: Record<string, Array<[string, number, string]>> = {};
    for (const difficulty of ["easy", "medium", "hard"]) {
      const player = await newPlayer(database);
      const sessionId = await startQuiz(player, { quiz: { difficulty, question_kinds: ["range", "hand"] } });
      levels[difficulty] = await play(player, sessionId, 2);
    }
    expect(levels["easy"]).toEqual([
      ["range", 1, "yes_no"],
      ["hand", 1, "action"],
    ]);
    expect(levels["medium"]).toEqual([
      ["range", 2, "percent"],
      ["hand", 2, "band"],
    ]);
    // The fixture node holds one raise, so it has no hand size question: a Hard quiz asks the chosen
    // range ladder at level 3 instead, never the band (PR #39 review finding 2).
    expect(levels["hard"]).toEqual([
      ["range", 3, "regions"],
      ["range", 3, "regions"],
    ]);
  });

  it("R3.16 a Hard hand quiz on spots with no size question is refused with a clear message and writes no session (O-411 amended)", async () => {
    const player = await newPlayer(database);
    const response = await start(player, quizBody({ quiz: { difficulty: "hard", question_kinds: ["hand"] } }));
    expect(response.statusCode, response.body).toBe(422);
    const problem = response.json<{ type: string; detail: string }>();
    expect(problem.type).toMatch(/no-quiz-questions$/);
    expect(problem.detail).toBe("No more Hard hand questions in these spots; try more spot types or another difficulty.");
    expect(await countRows("select 1 from practice_session where user_id = $1", [player.userId])).toBe(0);
  });

  it("R3.16 a quiz result's window counts the answers at the level asked, not the ladder's unlock level (PR #39 review finding 1)", async () => {
    const player = await newPlayer(database);
    const first = await startQuiz(player);
    const spotClassKey = (await next(player, first)).spot_class_key;
    await seedAnswers(player, first, spotClassKey, "range", 1, WINDOW);
    const hard = await startQuiz(player, { quiz: { difficulty: "hard", question_kinds: ["range"] } });
    const result = predictionResultSchema.parse((await answer(player, hard, await next(player, hard))).json());
    expect(result).toMatchObject({ level: 3, window: { answers: 1, size: WINDOW } });
  });

  it("R3.16 the difficulty is a free choice: unlocks neither raise an Easy quiz nor gate a Hard one (O-410)", async () => {
    const player = await newPlayer(database);
    const first = await startQuiz(player);
    const spotClassKey = (await next(player, first)).spot_class_key;
    await seedAnswers(player, first, spotClassKey, "range", 1, WINDOW);
    expect((await next(player, await startQuiz(player))).level).toBe(1);
    const fresh = await newPlayer(database);
    const hard = await startQuiz(fresh, { quiz: { difficulty: "hard", question_kinds: ["range"] } });
    expect(await next(fresh, hard)).toMatchObject({ ladder: "range", level: 3, answer_kind: "regions" });
  });

  it("R3.16 one question kind asks only that ladder (O-411)", async () => {
    for (const kind of PREDICTION_LADDERS) {
      const player = await newPlayer(database);
      const sessionId = await startQuiz(player, { quiz: { difficulty: "easy", question_kinds: [kind] } });
      const seen = await play(player, sessionId, 3);
      expect(seen.map(([ladder]) => ladder), kind).toEqual([kind, kind, kind]);
    }
  });

  it("R3.16 level_passed reads the last 20 answers at the asked level (O-410)", async () => {
    const player = await newPlayer(database);
    const sessionId = await startQuiz(player, { quiz: { difficulty: "medium", question_kinds: ["range"] } });
    const prompt = await next(player, sessionId);
    const before = predictionResultSchema.parse((await answer(player, sessionId, prompt)).json());
    expect(before.level_passed).toBe(false);
    await seedAnswers(player, sessionId, prompt.spot_class_key, "range", 2, WINDOW);
    const after = predictionResultSchema.parse((await answer(player, sessionId, await next(player, sessionId))).json());
    expect(after).toMatchObject({ level: 2, level_passed: true });
  });

  it("R3.16 every body rule of the start is a 400 that writes nothing (O-415)", async () => {
    const player = await newPlayer(database);
    const drillId = "0193a000-0000-7000-8000-000000000041";
    const refused: Array<[string, Record<string, unknown>]> = [
      ["drill_id and catalog_spot", quizBody({ drill_id: drillId })],
      ["neither drill_id nor catalog_spot", { mode: "prediction" }],
      ["catalog_spot in drill mode", { mode: "drill", catalog_spot: DEFEND }],
      ["catalog_spot in automated mode", { mode: "automated", catalog_spot: DEFEND }],
      ["quiz on range_paint", { mode: "range_paint", catalog_spot: DEFEND, quiz: { difficulty: "easy", question_kinds: ["hand"] } }],
      ["an unknown configuration", quizBody({ catalog_spot: { ...DEFEND, config_id: "cfg_6_online_999" } })],
      ["a seat not seated at six-max", quizBody({ catalog_spot: { ...DEFEND, hero_positions: ["LJ"] } })],
      ["an opponent not seated", quizBody({ catalog_spot: { ...DEFEND, villain_positions: ["UTG1"] } })],
      ["hero and opponent the same seat", quizBody({ catalog_spot: { ...DEFEND, villain_positions: ["BB"] } })],
      ["a repeated seat", quizBody({ catalog_spot: { ...DEFEND, hero_positions: ["BB", "BB"] } })],
      ["no spot type", quizBody({ catalog_spot: { ...DEFEND, spot_types: [] } })],
      ["an unknown spot type", quizBody({ catalog_spot: { ...DEFEND, spot_types: ["open"] } })],
      ["no question kind", quizBody({ quiz: { difficulty: "easy", question_kinds: [] } })],
      ["a repeated question kind", quizBody({ quiz: { difficulty: "easy", question_kinds: ["hand", "hand"] } })],
      ["an unknown difficulty", quizBody({ quiz: { difficulty: "expert", question_kinds: ["hand"] } })],
      ["an unknown catalog_spot field", quizBody({ catalog_spot: { ...DEFEND, board: "AhKd2c" } })],
    ];
    for (const [why, body] of refused) {
      const response = await start(player, body);
      expect(response.statusCode, `${why}: ${response.body}`).toBe(400);
    }
    expect(await countRows("select 1 from practice_session where user_id = $1", [player.userId])).toBe(0);
    expect(await countRows("select 1 from coverage_request where user_id = $1", [player.userId])).toBe(0);
  });

  it("R3.16 a spot the library cannot serve is 422 no-coverage and its gaps are queued (O-240, O-415)", async () => {
    const player = await newPlayer(database);
    // cfg_9_live_13_150 is in the catalog but not in the fixture library: all eight UTG pairs are gaps.
    const response = await start(player, quizBody({ catalog_spot: { config_id: UNSERVED_CONFIG, hero_positions: ["UTG"], spot_types: ["rfi"] } }));
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json<{ type: string }>().type).toMatch(/no-coverage$/);
    expect(await countRows("select 1 from practice_session where user_id = $1", [player.userId])).toBe(0);
    expect(await countRows("select 1 from coverage_request where user_id = $1", [player.userId])).toBe(8);
  });

  it("R3.16 an Idempotency-Key replay of the start answers the same session and writes one (PM note 3)", async () => {
    const player = await newPlayer(database);
    const headers = { [IDEMPOTENCY_HEADER]: `quiz-start-${randomBytes(8).toString("hex")}` };
    const first = await start(player, quizBody(), headers);
    const again = await start(player, quizBody(), headers);
    expect(first.statusCode, first.body).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(again.json()).toEqual(first.json());
    expect(await countRows("select 1 from practice_session where user_id = $1", [player.userId])).toBe(1);
  });

  it("R3.16 the start needs a session (401)", async () => {
    const response = await app.inject({ method: "POST", url: SESSIONS_PATH, payload: quizBody() });
    expect(response.statusCode).toBe(401);
  });
});

describe("R3.16 the typed reason (O-350, O-412, O-413)", () => {
  async function opened(): Promise<{ player: Player; sessionId: string; prompt: Prompt }> {
    const player = await newPlayer(database);
    const sessionId = await startQuiz(player);
    return { player, sessionId, prompt: await next(player, sessionId) };
  }

  async function nothingRecorded(sessionId: string, prompt: Prompt): Promise<void> {
    expect(await countRows("select 1 from prediction_answer where session_id = $1", [sessionId])).toBe(0);
    const state = await pool.query<{ state_version: number }>("select state_version from practice_session where id = $1", [sessionId]);
    expect(state.rows[0]?.state_version).toBe(prompt.state_version);
  }

  it("R3.16 a missing, blank, too short or too long reason is a 400 that records nothing", async () => {
    const { player, sessionId, prompt } = await opened();
    const refused: Array<[string, Record<string, unknown>]> = [
      ["missing", { rationale: undefined }],
      ["blank", { rationale: "   " }],
      ["two characters", { rationale: "ok" }],
      ["one character once cleaned", { rationale: "\u0007x​‍" }],
      ["over 1,000 characters", { rationale: "x".repeat(MAX_REASON + 1) }],
      // PR #39 re-review MEDIUM: 1,000 UTF-16 units that NFC turns into 3,000 code points.
      ["over 1,000 code points once normalised", { rationale: "\uFB2C".repeat(MAX_REASON) }],
      ["not a string", { rationale: 42 }],
      // Security LOW 1: reasons that only look typed.
      ["Hangul fillers", { rationale: "ㅤㅤㅤ" }],
      ["halfwidth Hangul fillers", { rationale: "ﾠﾠﾠ" }],
      ["blank braille patterns", { rationale: "⠀⠀⠀" }],
      ["combining grapheme joiners", { rationale: "͏͏͏" }],
      ["variation selectors around two letters", { rationale: "a️️b︎" }],
      ["bare combining marks", { rationale: "́́́" }],
    ];
    for (const [why, extra] of refused) {
      const response = await answer(player, sessionId, prompt, extra);
      expect(response.statusCode, `${why}: ${response.body}`).toBe(400);
      // PR #39 review finding 3: the problem names the reason, so the web can say the reason is the fault.
      const paths = (response.json<{ errors?: Array<{ path: string }> }>().errors ?? []).map((error) => error.path);
      expect(paths, why).toContain("body.rationale");
    }
    await nothingRecorded(sessionId, prompt);
  });

  it("R3.16 the reason is stored cleaned beside the answer, at the 1,000 character bound too, and never echoed", async () => {
    const { player, sessionId, prompt } = await opened();
    const response = await answer(player, sessionId, prompt, { rationale: "  Calls\u0000here​ because\n\n the\tprice  " });
    expect(response.statusCode, response.body).toBe(200);
    expect(contractErrors("post", ANSWER_PATH, 200, response.json())).toEqual([]);
    expect(response.body).not.toContain("because");
    const stored = await pool.query("select rationale, answer from prediction_answer where session_id = $1", [sessionId]);
    expect(stored.rows).toEqual([{ rationale: "Calls here because the price", answer: anyAnswer(prompt) }]);
    const longest = await answer(player, sessionId, await next(player, sessionId), { rationale: "y".repeat(MAX_REASON) });
    expect(longest.statusCode, longest.body).toBe(200);
  });

  it("R3.16 the reason never reaches the log", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString("utf8"));
        callback();
      },
    });
    const logged = buildTrainerApp(database, { logger: true, logStream: stream });
    await logged.ready();
    try {
      const player = await newPlayer(database);
      const started = await start(player, quizBody(), {}, logged);
      const sessionId = started.json<{ session_id: string }>().session_id;
      const secret = "zebra-marker-reason-not-for-logs";
      const response = await answer(player, sessionId, await next(player, sessionId, logged), { rationale: secret }, logged);
      expect(response.statusCode, response.body).toBe(200);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("")).not.toContain(secret);
    } finally {
      await logged.close();
    }
  });
});
