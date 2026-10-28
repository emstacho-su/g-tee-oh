/**
 * The hand log's write path (R3.13, S40, O-352, O-400 to O-402). POST /sessions/{id}/decisions
 * inserts one hand_record when its decision ends the hand, inside the decision's transaction:
 * - over the fixture solver-query, in street and full-hand modes and several seeds, the record
 *   written at the decision equals the previous_hand GET /next then derives for that hand (history,
 *   board and end), a decision that leaves the hand going writes nothing, and the last decided hand
 *   is recorded even when no prompt follows (PM note 1);
 * - over the fake solver-query: spot mode records every decision with stop_rule and the attempt it
 *   ended with; a failure later in the transaction leaves neither the attempt nor the record; and an
 *   Idempotency-Key replay inserts nothing more.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER } from "../src/http/headers.js";
import { composeLearningHooks, type LearningHookPart } from "../src/learning/effects.js";
import type { TrainerSettings } from "../src/schemas/drills.js";
import { promptSchema } from "../src/schemas/training.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp } from "./support/solver-query.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, type Player } from "./sessions-test-kit.js";

type Prompt = ReturnType<typeof promptSchema.parse>;

const API = "/api/v1";
const OK = 200;
const SERVER_ERROR = 500;
const SEEDS = ["00000000000051e1", "00000000000051e2", "00000000000051e3"] as const;
const DECISIONS_PER_SESSION = 10;
const LONG_TEST_MS = 120_000;
const OPEN = 1;

interface StoredRecord {
  hand_no: number;
  attempt_id: string;
  hero_position: string;
  hero_hand: string;
  history: unknown;
  board: string[];
  end_reason: string;
}

let database: Database;
let pool: pg.Pool;

beforeAll(() => {
  database = appDatabase();
  pool = adminPool();
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

async function records(sessionId: string): Promise<StoredRecord[]> {
  const { rows } = await pool.query<StoredRecord>(
    `select hand_no, attempt_id, hero_position, hero_hand, history, board, end_reason from hand_record where session_id = $1 order by hand_no`,
    [sessionId],
  );
  return rows;
}

async function attemptIds(sessionId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(`select id from attempt where session_id = $1 order by created_at`, [sessionId]);
  return rows.map((row) => row.id);
}

function decisionRequest(player: Player, sessionId: string, prompt: Pick<Prompt, "state_version">, actionIndex: number, key = randomUUID()) {
  return {
    method: "POST" as const,
    url: `${API}/sessions/${sessionId}/decisions`,
    headers: { ...player.write, [IDEMPOTENCY_HEADER]: key },
    payload: { state_version: prompt.state_version, action_index: actionIndex, response_ms: 900 },
  };
}

async function nextPrompt(app: ApiApp, player: Player, sessionId: string): Promise<Prompt> {
  const response = await app.inject({ method: "GET", url: `${API}/sessions/${sessionId}/next`, headers: player.read });
  expect(response.statusCode, response.body).toBe(OK);
  return promptSchema.parse(response.json());
}

describe("R3.13 the record equals what the next prompt derives (fixture solver-query, PM note 1)", () => {
  let app: ApiApp;
  let player: Player;

  beforeAll(async () => {
    app = buildTrainerApp(database);
    await app.ready();
    player = await newPlayer(database);
  });

  afterAll(async () => {
    await app.close();
  });

  async function playAndCompare(stopRule: TrainerSettings["stop_rule"], seed: string): Promise<number> {
    const drillId = await createDrill(app, player, drillBody({ stop_rule: stopRule }));
    const sessionId = await startSession(app, player, drillId, seed);
    let prompt = await nextPrompt(app, player, sessionId);
    let compared = 0;
    for (let decision = 0; decision < DECISIONS_PER_SESSION; decision += 1) {
      const before = (await records(sessionId)).length;
      const button = prompt.buttons[decision % prompt.buttons.length];
      if (button === undefined) throw new Error("the prompt carries no buttons");
      const decided = await app.inject(decisionRequest(player, sessionId, prompt, button.index));
      expect(decided.statusCode, decided.body).toBe(OK);
      const written = await records(sessionId);
      const last = decision === DECISIONS_PER_SESSION - 1;
      if (last) {
        // No prompt follows the last decision: its hand, when it ended, is recorded all the same.
        expect(written.length - before).toBeLessThanOrEqual(1);
        break;
      }
      const next = await nextPrompt(app, player, sessionId);
      const ended = next.hand_no !== prompt.hand_no;
      expect(written.length - before, `decision ${decision}: a record exactly when the hand ended`).toBe(ended ? 1 : 0);
      if (ended) {
        const record = written.at(-1);
        expect(next.previous_hand).not.toBeNull();
        expect({ hand_no: record?.hand_no, history: record?.history, board: record?.board, end: record?.end_reason }).toEqual(next.previous_hand);
        expect(record?.hero_position).toBe(prompt.hero_position);
        expect(record?.hero_hand).toBe(prompt.hero_hand.join(""));
        expect(record?.attempt_id).toBe((await attemptIds(sessionId)).at(-1));
        compared += 1;
      }
      prompt = next;
    }
    return compared;
  }

  it.each(["end_of_street", "end_of_hand"] as const)(
    "R3.13 %s: over several seeds every record matches the next prompt's previous_hand",
    async (stopRule) => {
      let compared = 0;
      for (const seed of SEEDS) compared += await playAndCompare(stopRule, seed);
      expect(compared).toBeGreaterThan(0);
    },
    LONG_TEST_MS,
  );
});

describe("R3.13 the record commits with the decision (fake solver-query)", () => {
  let solutionId: string;

  beforeAll(async () => {
    solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
  });

  async function setUp(parts?: readonly LearningHookPart[]) {
    const app = buildApp({
      database,
      config: TEST_CONFIG,
      solverQuery: fakeSolverQuery({ solutionId }).client,
      ...(parts === undefined ? {} : { learningHooks: composeLearningHooks(parts) }),
    });
    await app.ready();
    const player = await newPlayer(database);
    const sessionId = await startSession(app, player, await createDrill(app, player, drillBody({ stop_rule: "after_action" })));
    return { app, player, sessionId };
  }

  it("R3.13 spot mode records each decided hand with stop_rule, the hero and the attempt that ended it", async () => {
    const { app, player, sessionId } = await setUp();
    const prompt = await nextPrompt(app, player, sessionId);
    const decided = await app.inject(decisionRequest(player, sessionId, prompt, OPEN));
    expect(decided.statusCode, decided.body).toBe(OK);
    const [record] = await records(sessionId);
    expect(record).toMatchObject({ hand_no: prompt.hand_no, end_reason: "stop_rule", hero_position: prompt.hero_position, hero_hand: prompt.hero_hand.join("") });
    expect(record?.attempt_id).toBe((await attemptIds(sessionId))[0]);
    await app.close();
  });

  it("R3.13 a failure later in the decision's transaction leaves neither the attempt nor the record", async () => {
    const failing: LearningHookPart = { name: "fail-after-insert", afterInsert: () => Promise.reject(new Error("injected")) };
    const { app, player, sessionId } = await setUp([failing]);
    const prompt = await nextPrompt(app, player, sessionId);
    const decided = await app.inject(decisionRequest(player, sessionId, prompt, OPEN));
    expect(decided.statusCode).toBe(SERVER_ERROR);
    expect(await records(sessionId)).toEqual([]);
    expect(await attemptIds(sessionId)).toEqual([]);
    await app.close();
  });

  it("R3.13 an Idempotency-Key replay returns the stored answer and records the hand once", async () => {
    const { app, player, sessionId } = await setUp();
    const prompt = await nextPrompt(app, player, sessionId);
    const key = randomUUID();
    const first = await app.inject(decisionRequest(player, sessionId, prompt, OPEN, key));
    const replay = await app.inject(decisionRequest(player, sessionId, prompt, OPEN, key));
    expect(first.statusCode).toBe(OK);
    expect(replay.statusCode).toBe(OK);
    expect(replay.json()).toEqual(first.json());
    expect(await records(sessionId)).toHaveLength(1);
    await app.close();
  });
});
