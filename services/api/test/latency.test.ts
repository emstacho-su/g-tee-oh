/**
 * The three trainer paths timed in process (R3.3, O-40): study node read, grade and decision to
 * feedback, each at its nearest-rank p95 against the O-40 limit (twice the A9 section 6 budget).
 * This is the continuous integration (CI) stand-in for just perf (scripts/perf.mjs), which times
 * the same paths through Caddy on the dev stack and writes validation/reports/perf-zenbook.json.
 *
 * Mechanism: the api is built over the test database and the fixture solver-query
 * (buildTrainerApp) and driven with app.inject, so there is no socket on the api side; solver-query
 * is the real binary over validation/fixtures/library. The study reads cycle over every pair root
 * of the fixture configuration the api serves, plus the nodes along each root's likeliest line
 * (next_likely_node_key, O-245). One drill session on BB-BTN with the after-action stop rule and a
 * fixed seed (O-249) supplies the decisions: each sample fetches the prompt with GET /next (not
 * timed), then times POST /decisions; the grade sample is that response's Server-Timing sq-grade
 * entry (O-248). The sample is modest so the whole file stays under the api's 300 requests per
 * client per minute (GLOBAL_RATE_LIMIT_MAX); a failure names the measured p95.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { canonicalPairs } from "../src/catalog/seats.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER } from "../src/http/headers.js";
import { GLOBAL_RATE_LIMIT_MAX } from "../src/http/rate-limits.js";
import { SERVER_TIMING_HEADER, SQ_GRADE_METRIC } from "../src/http/server-timing.js";
import type { DrillCreateBody } from "../src/schemas/drills.js";
import { mutatingHeaders, readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";
import { buildTrainerApp } from "./support/solver-query.js";

const API = "/api/v1";
const CONFIG = "cfg_6_online_100";
const TABLE_SIZE = 6;
const SESSION_SEED = "0000000000005eed";
const WARMUP_SAMPLES = 5;
const TIMED_SAMPLES = 40;
const MAX_WALK_DEPTH = 4;
const MAX_STUDY_TARGETS = 32;
const P95_FRACTION = 0.95;
const DECISION_RESPONSE_MS = 1000;
/** The O-40 limits in milliseconds. */
const LIMIT_MS = { studyNode: 300, grade: 60, decisionFeedback: 500 } as const;
/** The drill and the session. */
const SETUP_REQUESTS = 2;
/** One study read, one GET /next and one POST /decisions per sample. */
const REQUESTS_PER_SAMPLE = 3;
/** The most study reads discovery makes: every pair's root and its likeliest line. */
const DISCOVERY_REQUESTS = canonicalPairs(TABLE_SIZE).length * (MAX_WALK_DEPTH + 1);
const PLANNED_REQUESTS = DISCOVERY_REQUESTS + REQUESTS_PER_SAMPLE * (WARMUP_SAMPLES + TIMED_SAMPLES) + SETUP_REQUESTS;
const LATENCY_TEST_TIMEOUT_MS = 120_000;

const DRILL: DrillCreateBody = {
  name: "latency: BTN versus BB preflop",
  tags: ["perf"],
  spot_filter: {
    game_config: { format: "online", table_size: TABLE_SIZE, depths_bb: [100] },
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
    stop_rule: "after_action",
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

interface StudyQuery {
  config_id: string;
  pair: string;
  node_key?: string;
}

interface Prompt {
  state: string;
  state_version: number;
  buttons: { index: number }[];
}

/** Nearest rank: the value at rank ceil(p n) of the samples sorted ascending, as just perf takes it. */
function nearestRankP95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(P95_FRACTION * sorted.length)) - 1] ?? Number.NaN;
}

function sqGradeMs(header: string | string[] | number | undefined): number {
  const text = Array.isArray(header) ? header.join(",") : String(header ?? "");
  const entry = text.split(",").find((part) => part.trim().startsWith(`${SQ_GRADE_METRIC};`));
  const match = /dur=([0-9.]+)/.exec(entry ?? "");
  if (match?.[1] === undefined) throw new Error(`no ${SQ_GRADE_METRIC} entry in Server-Timing: ${text}`);
  return Number(match[1]);
}

describe("R3.3 trainer latency in process against the O-40 limits", () => {
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

  async function timedInject(options: InjectOptions): Promise<{ response: LightMyRequestResponse; ms: number }> {
    const started = performance.now();
    const response = await app.inject(options);
    return { response, ms: performance.now() - started };
  }

  function studyUrl(query: StudyQuery): string {
    return `${API}/study/node?${new URLSearchParams({ ...query }).toString()}`;
  }

  async function walkPair(pair: string): Promise<StudyQuery[]> {
    const found: StudyQuery[] = [];
    let query: StudyQuery | null = { config_id: CONFIG, pair };
    for (let depth = 0; depth <= MAX_WALK_DEPTH && query !== null; depth += 1) {
      const response: LightMyRequestResponse = await app.inject({ method: "GET", url: studyUrl(query), headers: readHeaders(session) });
      if (response.statusCode !== 200) break;
      found.push(query);
      const next: string | null = response.json<{ next_likely_node_key: string | null }>().next_likely_node_key;
      query = next === null ? null : { config_id: CONFIG, pair, node_key: next };
    }
    return found;
  }

  async function studyTargets(): Promise<StudyQuery[]> {
    const walks = [];
    for (const { pair } of canonicalPairs(TABLE_SIZE)) walks.push(await walkPair(pair));
    return walks.flat().slice(0, MAX_STUDY_TARGETS);
  }

  async function startSession(): Promise<string> {
    const drill = await app.inject({ method: "POST", url: `${API}/drills`, headers: mutatingHeaders(session), payload: DRILL });
    expect(drill.statusCode).toBe(201);
    const payload = { mode: "drill", drill_id: drill.json<{ id: string }>().id, seed: SESSION_SEED };
    const created = await app.inject({ method: "POST", url: `${API}/sessions`, headers: mutatingHeaders(session), payload });
    expect(created.statusCode).toBe(201);
    return created.json<{ session_id: string }>().session_id;
  }

  async function decide(sessionId: string, index: number): Promise<{ decisionMs: number; gradeMs: number }> {
    const next = await app.inject({ method: "GET", url: `${API}/sessions/${sessionId}/next`, headers: readHeaders(session) });
    expect(next.statusCode).toBe(200);
    const prompt = next.json<Prompt>();
    expect(prompt.state).toBe("await_hero");
    const button = prompt.buttons[index % prompt.buttons.length];
    if (button === undefined) throw new Error("the prompt carries no buttons");
    const { response, ms } = await timedInject({
      method: "POST",
      url: `${API}/sessions/${sessionId}/decisions`,
      headers: { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: randomUUID() },
      payload: { state_version: prompt.state_version, action_index: button.index, response_ms: DECISION_RESPONSE_MS },
    });
    expect(response.statusCode).toBe(200);
    return { decisionMs: ms, gradeMs: sqGradeMs(response.headers[SERVER_TIMING_HEADER]) };
  }

  it("R3.3 the planned requests stay under the api's per-minute limit", () => {
    expect(PLANNED_REQUESTS).toBeLessThan(GLOBAL_RATE_LIMIT_MAX);
  });

  it(
    "R3.3 study node read p95 at most 300 ms, grade at most 60 ms, decision to feedback at most 500 ms (O-40)",
    async () => {
      const targets = await studyTargets();
      expect(targets.length).toBeGreaterThan(0);
      const study: number[] = [];
      for (let index = 0; index < WARMUP_SAMPLES + TIMED_SAMPLES; index += 1) {
        const target = targets[index % targets.length];
        if (target === undefined) throw new Error("no study target");
        const { response, ms } = await timedInject({ method: "GET", url: studyUrl(target), headers: readHeaders(session) });
        expect(response.statusCode).toBe(200);
        if (index >= WARMUP_SAMPLES) study.push(ms);
      }

      const sessionId = await startSession();
      const grade: number[] = [];
      const decisionFeedback: number[] = [];
      for (let index = 0; index < WARMUP_SAMPLES + TIMED_SAMPLES; index += 1) {
        const sample = await decide(sessionId, index);
        if (index >= WARMUP_SAMPLES) {
          grade.push(sample.gradeMs);
          decisionFeedback.push(sample.decisionMs);
        }
      }

      const measured = {
        studyNode: nearestRankP95(study),
        grade: nearestRankP95(grade),
        decisionFeedback: nearestRankP95(decisionFeedback),
      };
      expect(study).toHaveLength(TIMED_SAMPLES);
      expect(grade).toHaveLength(TIMED_SAMPLES);
      expect(measured.studyNode, `study node read p95 ${measured.studyNode} ms`).toBeLessThanOrEqual(LIMIT_MS.studyNode);
      expect(measured.grade, `grade p95 ${measured.grade} ms`).toBeLessThanOrEqual(LIMIT_MS.grade);
      expect(measured.decisionFeedback, `decision to feedback p95 ${measured.decisionFeedback} ms`).toBeLessThanOrEqual(
        LIMIT_MS.decisionFeedback,
      );
    },
    LATENCY_TEST_TIMEOUT_MS,
  );
});
