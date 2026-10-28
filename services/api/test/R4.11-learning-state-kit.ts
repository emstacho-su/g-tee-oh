/**
 * Fixtures of the Lane B learning-state tests (R4.11): practice_session and attempt rows written
 * straight through the superuser pool (each a valid persisted state, so the session end path can
 * parse it), the track ids, and readers of every learning table a user owns, so a test compares
 * the whole learning state before and after.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { initialState, type LearningState } from "../src/sessions/state.js";
import { TRAINER } from "./sessions-test-kit.js";

export const KIT_CONFIG = "cfg_6_online_100";
export const KIT_PAIR = "BB-BTN";
export const KIT_SEED = "00000000deadbeef";

/** An automated learning state with one block of the given class (Lane A's shape, sessions/state.ts). */
export function automatedLearning(spotClassKey: string, seeded = false): LearningState {
  return {
    kind: "automated",
    seeded,
    config_ids: [KIT_CONFIG],
    pick_no: 1,
    queue: { last_family: "rfi", hypercorrection: [] },
    block: { spot_class_key: spotClassKey, family: "rfi", track_key: "opens", worked_example: false, served: 0, size: 3 },
  };
}

export function holdoutLearning(): LearningState {
  return {
    kind: "holdout",
    round_id: randomUUID(),
    round_month: "2026-10-01",
    track_key: null,
    remaining: [],
    answered: 0,
    total: 0,
    current_item: null,
  };
}

export interface SessionFixture {
  userId: string;
  mode: "drill" | "automated" | "holdout";
  learning?: LearningState | null;
  startedAt?: Date;
}

export async function insertSessionRow(pool: pg.Pool, fixture: SessionFixture): Promise<string> {
  const state = initialState(
    KIT_SEED,
    [{ config_id: KIT_CONFIG, pair: KIT_PAIR, line: null, hero_seat: "BTN", history: [] }],
    { preflop_action: ["rfi"], hands: { mode: "all" }, alternate_seats: false },
    fixture.learning ?? null,
  );
  const settings = { ...TRAINER, stop_rule: "after_action" };
  const result = await pool.query<{ id: string }>(
    `insert into practice_session (user_id, mode, settings, state, started_at)
     values ($1, $2, $3::jsonb, $4::jsonb, $5) returning id`,
    [fixture.userId, fixture.mode, JSON.stringify(settings), JSON.stringify(state), fixture.startedAt ?? new Date()],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("session insert returned no row");
  }
  return row.id;
}

export interface AttemptFixture {
  userId: string;
  sessionId: string;
  solutionId: string;
  spotClassKey: string;
  label?: string;
  score?: number;
  evLossBb?: number;
  rated?: boolean;
  weight?: number;
  itemDifficulty?: number | null;
  trackIds?: readonly string[];
  panelsRevealed?: boolean;
  responseMs?: number;
  createdAt?: Date;
}

const DEFAULT_SCORE = 1;
const DEFAULT_RESPONSE_MS = 1000;

export async function insertAttemptRow(pool: pg.Pool, fixture: AttemptFixture): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, action_index,
       action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, response_ms,
       rated, weight, item_difficulty, panels_revealed, hand_class, created_at)
     values ($1, $2, $3, 'k', $4, $5::uuid[], 'AhKd', 0, 'f', 0, $6, $6, 0, 0.5, $7, $8, $9, $10, $11, $12, $13, 'AKo', $14)
     returning id`,
    [
      fixture.userId,
      fixture.sessionId,
      fixture.solutionId,
      fixture.spotClassKey,
      [...(fixture.trackIds ?? [])],
      fixture.evLossBb ?? 0,
      fixture.score ?? DEFAULT_SCORE,
      fixture.label ?? "best",
      fixture.responseMs ?? DEFAULT_RESPONSE_MS,
      fixture.rated ?? false,
      fixture.weight ?? (fixture.rated === true ? 1 : 0),
      fixture.itemDifficulty ?? null,
      fixture.panelsRevealed ?? false,
      fixture.createdAt ?? new Date(),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("attempt insert returned no row");
  }
  return row.id;
}

export async function trackIds(pool: pg.Pool): Promise<Record<string, string>> {
  const result = await pool.query<{ key: string; id: string }>("select key, id from track");
  return Object.fromEntries(result.rows.map((row) => [row.key, row.id]));
}

/** Every learning row the user owns, ordered, so two snapshots compare with toEqual. */
export async function learningRows(pool: pg.Pool, userId: string): Promise<Record<string, unknown[]>> {
  const tables: Record<string, string> = {
    leak_stat: "select * from leak_stat where user_id = $1 order by spot_class_key",
    leak_history: "select * from leak_history where user_id = $1 order by spot_class_key, week",
    schedule_card: "select * from schedule_card where user_id = $1 order by spot_class_key",
    mastery: "select * from mastery where user_id = $1 order by spot_class_key",
    rating: "select * from rating where user_id = $1 order by track_id",
    rating_history: "select * from rating_history where user_id = $1 order by track_id, recorded_at",
  };
  const entries = await Promise.all(
    Object.entries(tables).map(async ([table, query]) => [table, (await pool.query(query, [userId])).rows] as const),
  );
  return Object.fromEntries(entries);
}

export async function sessionAndAttempts(pool: pg.Pool, userId: string): Promise<{ sessions: unknown[]; attempts: unknown[] }> {
  const sessions = await pool.query("select * from practice_session where user_id = $1 order by id", [userId]);
  const attempts = await pool.query("select * from attempt where user_id = $1 order by id", [userId]);
  return { sessions: sessions.rows, attempts: attempts.rows };
}
