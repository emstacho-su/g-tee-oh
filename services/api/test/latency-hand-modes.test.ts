/**
 * Decision to feedback in street and full-hand modes, timed in process (R3.3, R3.13, O-40, O-400).
 * S40 writes a hand_record at the decision that ends a hand: in these two modes the decision path
 * first runs the session's machine forward from the decided state to the hand's end, reading
 * solver-query the way the next GET /next does (the opponent's node and sampled action, and in
 * full-hand mode the flop reveal). latency.test.ts times spot mode, where that forward run reads
 * nothing; this file holds the two modes that pay for it to the same O-40 limit.
 *
 * Mechanism: as latency.test.ts. The api is built over the test database and the fixture
 * solver-query and driven with app.inject. One drill session per mode on BTN against BB with a
 * fixed seed; each sample fetches the prompt with GET /next (not timed) and times POST /decisions.
 * Its own app instance, so its requests count against their own per-minute limit. A failure names
 * the measured p95; LATENCY_REPORT=1 prints both p95 values for the pull request's before and after.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER } from "../src/http/headers.js";
import { GLOBAL_RATE_LIMIT_MAX } from "../src/http/rate-limits.js";
import type { DrillCreateBody, TrainerSettings } from "../src/schemas/drills.js";
import { mutatingHeaders, readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";
import { buildTrainerApp } from "./support/solver-query.js";

const API = "/api/v1";
const SESSION_SEED = "00000000000a5eed";
const WARMUP_SAMPLES = 5;
const TIMED_SAMPLES = 40;
const P95_FRACTION = 0.95;
const DECISION_RESPONSE_MS = 1000;
/** The O-40 decision to feedback limit in milliseconds (twice the A9 section 6 budget). */
const DECISION_FEEDBACK_LIMIT_MS = 500;
const MODES: readonly TrainerSettings["stop_rule"][] = ["end_of_street", "end_of_hand"];
/** A drill and a session per mode, then one GET /next and one POST /decisions per sample. */
const PLANNED_REQUESTS = MODES.length * (2 + 2 * (WARMUP_SAMPLES + TIMED_SAMPLES));
const LATENCY_TEST_TIMEOUT_MS = 120_000;
const REPORT_FLAG = "LATENCY_REPORT";

function drill(stopRule: TrainerSettings["stop_rule"]): DrillCreateBody {
  return {
    name: `latency: BTN versus BB, ${stopRule}`,
    tags: ["perf"],
    spot_filter: {
      game_config: { format: "online", table_size: 6, depths_bb: [100] },
      stake: "online",
      sizing: { mode: "convention" },
      start_street: "preflop",
      hero_positions: ["BTN"],
      villain_positions: ["BB"],
      preflop_action: ["rfi"],
      hands: { mode: "all" },
      alternate_seats: false,
    },
    trainer: {
      stop_rule: stopRule,
      input: "actions",
      grouping: "standard",
      rng: false,
      pause: "never",
      speed: "fast",
      quick_result: true,
      tables: 1,
      timebank_s: null,
      panels: {},
    },
  };
}

interface Prompt {
  state: string;
  state_version: number;
  buttons: { index: number }[];
}

function nearestRankP95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(P95_FRACTION * sorted.length)) - 1] ?? Number.NaN;
}

describe("R3.3 R3.13 decision to feedback in street and full-hand modes (O-40, O-400)", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTrainerApp(database);
    await app.ready();
    session = await createTestSession(database, (await createTestUser(database)).id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function startSession(stopRule: TrainerSettings["stop_rule"]): Promise<string> {
    const created = await app.inject({ method: "POST", url: `${API}/drills`, headers: mutatingHeaders(session), payload: drill(stopRule) });
    expect(created.statusCode).toBe(201);
    const payload = { mode: "drill", drill_id: created.json<{ id: string }>().id, seed: SESSION_SEED };
    const started = await app.inject({ method: "POST", url: `${API}/sessions`, headers: mutatingHeaders(session), payload });
    expect(started.statusCode).toBe(201);
    return started.json<{ session_id: string }>().session_id;
  }

  async function timedDecision(sessionId: string, index: number): Promise<number> {
    const next = await app.inject({ method: "GET", url: `${API}/sessions/${sessionId}/next`, headers: readHeaders(session) });
    expect(next.statusCode).toBe(200);
    const prompt = next.json<Prompt>();
    const button = prompt.buttons[index % prompt.buttons.length];
    if (button === undefined) throw new Error("the prompt carries no buttons");
    const started = performance.now();
    const response = await app.inject({
      method: "POST",
      url: `${API}/sessions/${sessionId}/decisions`,
      headers: { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: randomUUID() },
      payload: { state_version: prompt.state_version, action_index: button.index, response_ms: DECISION_RESPONSE_MS },
    });
    const ms = performance.now() - started;
    expect(response.statusCode).toBe(200);
    return ms;
  }

  it("R3.3 the planned requests stay under the api's per-minute limit", () => {
    expect(PLANNED_REQUESTS).toBeLessThan(GLOBAL_RATE_LIMIT_MAX);
  });

  it(
    "R3.3 R3.13 decision to feedback p95 at most 500 ms in street and full-hand modes (O-40)",
    async () => {
      const measured: Record<string, number> = {};
      for (const mode of MODES) {
        const sessionId = await startSession(mode);
        const samples: number[] = [];
        for (let index = 0; index < WARMUP_SAMPLES + TIMED_SAMPLES; index += 1) {
          const ms = await timedDecision(sessionId, index);
          if (index >= WARMUP_SAMPLES) samples.push(ms);
        }
        measured[mode] = nearestRankP95(samples);
      }
      if (process.env[REPORT_FLAG] === "1") {
        process.stdout.write(`decision to feedback p95 (ms): ${JSON.stringify(measured)}\n`);
      }
      for (const mode of MODES) {
        const p95 = measured[mode] ?? Number.NaN;
        expect(p95, `${mode} decision to feedback p95 ${p95} ms`).toBeLessThanOrEqual(DECISION_FEEDBACK_LIMIT_MS);
      }
    },
    LATENCY_TEST_TIMEOUT_MS,
  );
});
