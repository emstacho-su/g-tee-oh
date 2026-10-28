/**
 * Shared setup of the R4.10 automated-session tests: the api over the test database and the fixture
 * solver-query, automated session creation, one decision at a time, cards seeded so blocks are
 * reviews rather than worked examples, a snapshot of every learning table of a user, and the hero
 * row of the prompt in play (derived exactly as GET /next derives it) to choose a missing action.
 */
import { newSpotClassCard, reviewSpotClass } from "@g-tee-oh/learning";
import type { FastifyRequest, LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import type pg from "pg";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { canonicalPairs } from "../src/catalog/seats.js";
import { storedCardOf } from "../src/learning-state/fsrs-card.js";
import { deriveAwaitHero, type DerivedPrompt } from "../src/sessions/derive.js";
import { findSession } from "../src/sessions/repository.js";
import type { AutomatedLearning } from "../src/sessions/state.js";
import { solverPort } from "../src/sessions/solver-port.js";
import type { Player } from "./sessions-test-kit.js";
import { fixtureSolverQuery } from "./support/solver-query.js";

export const API = "/api/v1";
export const ONLINE_100 = "cfg_6_online_100";
export const SCOPE = [ONLINE_100];
const DAY_MS = 24 * 60 * 60 * 1000;
const SEEDED_REVIEW_DAYS = 30;
export const RESPONSE_MS = 4000;

export interface AutomatedBlock {
  spot_class_key: string;
  track_key: string | null;
  family: string;
  served: number;
  size: number;
  worked_example: boolean;
}

export interface SessionBody {
  session_id: string;
  state_version: number;
  rated_eligible: boolean;
  automated: AutomatedBlock | null;
}

export interface PromptBody {
  state_version: number;
  hero_hand: string[];
  history: unknown[];
  buttons: { index: number }[];
  visible_panels: string[];
  spot_class_key: string | null;
  track_key: string | null;
  worked_example: boolean;
  /** S26 (O-313, O-335): the shared session machine fills these in every graded mode. */
  hand_no: number;
  hand_decision_no: number;
  previous_hand: { hand_no: number; end: string } | null;
}

export interface FeedbackBody {
  rated: boolean;
  label: string;
  state_version: number;
  solution_id: string;
  node_key: string;
  hand: string;
  review_block: { spot_class_key: string; closed: boolean; fsrs_grade: string | null; next_due: string | null; p_known: number | null } | null;
}

export async function createAutomated(app: ApiApp, player: Player, body: Record<string, unknown> = {}): Promise<LightMyRequestResponse> {
  return app.inject({ method: "POST", url: `${API}/sessions`, headers: player.write, payload: { mode: "automated", config_ids: SCOPE, ...body } });
}

export async function requireAutomated(app: ApiApp, player: Player, body: Record<string, unknown> = {}): Promise<SessionBody> {
  const response = await createAutomated(app, player, body);
  if (response.statusCode !== 201) {
    throw new Error(`automated create failed: ${response.statusCode} ${response.body}`);
  }
  return response.json<SessionBody>();
}

export async function nextPrompt(app: ApiApp, player: Player, sessionId: string): Promise<PromptBody> {
  const response = await app.inject({ method: "GET", url: `${API}/sessions/${sessionId}/next`, headers: player.read });
  if (response.statusCode !== 200) {
    throw new Error(`next failed: ${response.statusCode} ${response.body}`);
  }
  return response.json<PromptBody>();
}

export interface Choice {
  actionIndex?: number;
  confidence?: "sure" | "unsure";
}

/** GET /next, then POST one decision at the prompt's state version. */
export async function decideOnce(app: ApiApp, player: Player, sessionId: string, choice: Choice = {}): Promise<{ prompt: PromptBody; feedback: FeedbackBody }> {
  const prompt = await nextPrompt(app, player, sessionId);
  const response = await app.inject({
    method: "POST",
    url: `${API}/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: {
      state_version: prompt.state_version,
      action_index: choice.actionIndex ?? 0,
      response_ms: RESPONSE_MS,
      ...(choice.confidence === undefined ? {} : { confidence: choice.confidence }),
    },
  });
  if (response.statusCode !== 200) {
    throw new Error(`decision failed: ${response.statusCode} ${response.body}`);
  }
  return { prompt, feedback: response.json<FeedbackBody>() };
}

export async function endSession(app: ApiApp, player: Player, sessionId: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: "POST", url: `${API}/sessions/${sessionId}/end`, headers: player.write });
}

/** The persisted automated learning state of a session. */
export async function learningOfSession(database: Database, userId: string, sessionId: string): Promise<AutomatedLearning> {
  const row = await findSession(database, userId, sessionId);
  const learning = row?.state.learning;
  if (learning === undefined || learning === null || learning.kind !== "automated") {
    throw new Error("not an automated session");
  }
  return learning;
}

/** Reviewed cards (state Review, due before now) for the given classes, so their blocks are reviews. */
export async function seedCards(database: Database, userId: string, keys: readonly string[], now: Date = new Date()): Promise<void> {
  const created = new Date(now.getTime() - 2 * SEEDED_REVIEW_DAYS * DAY_MS);
  const reviewed = new Date(now.getTime() - SEEDED_REVIEW_DAYS * DAY_MS);
  const rows = keys.map((key) => {
    const card = reviewSpotClass(reviewSpotClass(newSpotClassCard(key, created), "Good", created), "Good", reviewed);
    return {
      user_id: userId,
      spot_class_key: key,
      fsrs_state: sql<never>`cast(${JSON.stringify(storedCardOf(card))} as jsonb)`,
      due: card.card.due,
    };
  });
  if (rows.length > 0) {
    await database.insertInto("schedule_card").values(rows).execute();
  }
}

const LEARNING_TABLES = ["schedule_card", "mastery", "leak_stat", "rating", "rating_history", "streak_day", "cosmetic_unlock", "leak_history"] as const;
export type LearningTable = (typeof LEARNING_TABLES)[number];

/** Every learning row of the user, by table, as JSON text sorted, for before/after comparison. */
export async function learningSnapshot(pool: pg.Pool, userId: string): Promise<Record<LearningTable, string[]>> {
  const entries = await Promise.all(
    LEARNING_TABLES.map(async (table) => {
      const result = await pool.query(`select * from ${table} where user_id = $1`, [userId]);
      return [table, result.rows.map((row) => JSON.stringify(row)).sort()] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<LearningTable, string[]>;
}

const TEST_REQUEST = { id: "r4.10-test" } as FastifyRequest;

/** The derivation GET /next would answer for the session now (read only). */
export async function derivedNow(database: Database, userId: string, sessionId: string): Promise<DerivedPrompt> {
  const row = await findSession(database, userId, sessionId);
  if (row === undefined) {
    throw new Error("no session");
  }
  const port = solverPort(fixtureSolverQuery(), TEST_REQUEST, { deadlineMs: 30_000 });
  return deriveAwaitHero(row.state, { stopRule: row.settings.stop_rule, rng: row.settings.rng }, port);
}

/** The action of the hero's row that loses the most, and that loss in percent of the pot. */
export function worstAction(derived: DerivedPrompt): { index: number; lossPctPot: number } {
  const losses = derived.node.hands[0]?.loss_pct_pot ?? [];
  const index = losses.reduce((best, loss, at) => (loss > (losses[best] ?? -1) ? at : best), 0);
  return { index, lossPctPot: losses[index] ?? 0 };
}

export const COVERAGE_PATH = "/v1/coverage";
/** The 500 a failing coverage call answers; the client maps it to its generic 502 (expectData). */
const FAILED_STATUS = 500;
/** v1 serves no ante variants (O-33), so the catalog scope is the no-ante configurations. */
const NO_ANTE_CBB = 0;

type CoverageBody = Record<string, unknown>;

/**
 * A fetch over the fixture solver-query whose GET /v1/coverage a test controls (PR #27 review HIGH 3,
 * MEDIUM 6, MEDIUM 7): `failing` answers every coverage call with a 500, `problemFor` answers a
 * pair's call with the problem it returns (follow-up LOW 4), `rewrite` edits each coverage body
 * before the client reads it; `calls()` counts the coverage calls so far.
 */
export interface CoverageControl {
  fetch: typeof fetch;
  calls: () => number;
  failing: boolean;
  problemFor: ((pair: string) => CoverageProblem | undefined) | null;
  rewrite: ((body: CoverageBody) => CoverageBody) | null;
}

/** A problem a coverage call answers with: its status and, when set, its RFC 9457 type. */
export interface CoverageProblem {
  status: number;
  type?: string;
}

function problemResponse(problem: CoverageProblem): Response {
  const body = { ...(problem.type === undefined ? {} : { type: problem.type }), status: problem.status, title: "test problem" };
  return new Response(JSON.stringify(body), { status: problem.status, headers: { "content-type": "application/problem+json" } });
}

export function coverageControl(): CoverageControl {
  let count = 0;
  const control: CoverageControl = {
    calls: () => count,
    failing: false,
    problemFor: null,
    rewrite: null,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname !== COVERAGE_PATH) {
        return fetch(input, init);
      }
      count += 1;
      if (control.failing) {
        return new Response(JSON.stringify({ status: FAILED_STATUS, title: "test failure" }), {
          status: FAILED_STATUS,
          headers: { "content-type": "application/problem+json" },
        });
      }
      const problem = control.problemFor?.(url.searchParams.get("pair") ?? "");
      if (problem !== undefined) {
        return problemResponse(problem);
      }
      const response = await fetch(input, init);
      const rewrite = control.rewrite;
      if (rewrite === null || !response.ok) {
        return response;
      }
      const body = rewrite((await response.json()) as CoverageBody);
      return new Response(JSON.stringify(body), { status: response.status, headers: { "content-type": "application/json" } });
    },
  };
  return control;
}

/** Every (configuration, pair) the all-configs catalog asks solver-query about (MEDIUM 6). */
export async function fullCatalogPairs(database: Database): Promise<number> {
  const configs = await database.selectFrom("game_config").select("table_size").where("ante_cbb", "=", NO_ANTE_CBB).execute();
  return configs.reduce((sum, config) => sum + canonicalPairs(config.table_size).length, 0);
}
