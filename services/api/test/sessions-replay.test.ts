/**
 * Replay from seed (R3.6, A6 section 2, O-249, O-151, O-152): a session with a fixed seed and
 * scripted hero choices produces the same prompts and feedback every time, through the HTTP routes
 * and the real fixture solver-query over S19's library (cfg_6_online_100 BB-BTN, synthetic).
 *
 * The script: the hero always takes the first action that is not a fold, in full-hand mode with RNG
 * mode on, for DECISIONS decisions. Ids and timestamps are dropped before comparing. The golden is
 * test/fixtures/session-replay-golden.json; to regenerate it after an intended change, run
 *   UPDATE_GOLDEN=1 pnpm --filter @g-tee-oh/api exec vitest run test/sessions-replay.test.ts
 * and review the diff. This test needs the fixture library (validation/fixtures/library).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { feedbackSchema, promptSchema } from "../src/schemas/training.js";
import { adminPool, appDatabase } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, type Player } from "./sessions-test-kit.js";

const GOLDEN_PATH = fileURLToPath(new URL("./fixtures/session-replay-golden.json", import.meta.url));
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";
/** The fixture library's synthetic BB-BTN solution of cfg_6_online_100 (S19 manifest id). */
const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const FIXTURE_CONFIG = "cfg_6_online_100";
const FIXTURE_PAIR = "BB-BTN";
const REPLAY_SEED = "5eed00005eed0001";
const DECISIONS = 40;
const RESPONSE_MS = 1000;

interface Step {
  prompt: Record<string, unknown>;
  feedback: Record<string, unknown>;
}

let database: Database;
let pool: pg.Pool;
let app: ApiApp;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  await insertSolution(pool, FIXTURE_CONFIG, FIXTURE_PAIR, FIXTURE_SOLUTION_ID);
  app = trainerApp(database, fixtureSolverQuery());
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

function withoutIds<T extends Record<string, unknown>>(value: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

async function playScript(player: Player, drillId: string): Promise<Step[]> {
  const sessionId = await startSession(app, player, drillId, REPLAY_SEED);
  const steps: Step[] = [];
  for (let decision = 0; decision < DECISIONS; decision += 1) {
    const next = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
    expect(next.statusCode, next.body).toBe(200);
    const prompt = promptSchema.parse(next.json());
    const choice = prompt.buttons.find((button) => button.kind !== "fold") ?? prompt.buttons[0];
    const answer = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/decisions`,
      headers: player.write,
      payload: { state_version: prompt.state_version, action_index: choice?.index ?? 0, response_ms: RESPONSE_MS },
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const feedback = feedbackSchema.parse(answer.json());
    steps.push({ prompt: withoutIds(prompt, ["session_id"]), feedback: withoutIds(feedback, ["attempt_id"]) });
  }
  return steps;
}

describe("R3.6 replay from seed", () => {
  it("R3.6 a fixed seed and scripted choices replay the same prompts and feedback, matching the golden", async () => {
    const player = await newPlayer(database);
    const drillId = await createDrill(app, player, drillBody({ stop_rule: "end_of_hand", rng: true }));
    const first = await playScript(player, drillId);
    const second = await playScript(player, drillId);
    expect(second).toEqual(first);
    if (UPDATE_GOLDEN) {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(first, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Step[];
    expect(first).toEqual(golden);
  });
});
