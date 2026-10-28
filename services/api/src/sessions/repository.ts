/**
 * practice_session and coverage_request rows (R3.6, R3.7, A4 section 2, A5 section 3, ADR 0001).
 * Every query is scoped by user_id as well as the session id, so another user's session is a 404.
 *
 * Mechanism: state and settings are jsonb, written as JSON text cast to jsonb and parsed on every
 * read with their Zod schemas (state.ts, trainerSettingsSchema), so a malformed row is a loud 500.
 * Every state write is optimistic: `update ... set state, state_version = state_version + 1 where
 * id and user_id and state_version = expected returning state_version`, so a write that lost a
 * race returns no row and the caller answers 409 stale-state (A5 section 3). Recaps aggregate the
 * session's attempts in SQL (count, the rated count, the mean score and the summed EV loss), so
 * the numbers are the stored ones, never recomputed (ADR 0004).
 */
import { sql, type RawBuilder, type Selectable } from "kysely";

import type { DB } from "@g-tee-oh/contracts";

import { ONCE_KEY_TARGET } from "../coverage-request-key.js";
import type { Database } from "../db.js";
import { trainerSettingsSchema, type TrainerSettings } from "../schemas/drills.js";
import type { PairCandidate } from "./candidates.js";
import { persistedStateSchema, type PersistedState } from "./state.js";

type Json = Selectable<DB["practice_session"]>["state"];
type PracticeMode = Selectable<DB["practice_session"]>["mode"];

export interface SessionRow {
  id: string;
  userId: string;
  mode: PracticeMode;
  drillId: string | null;
  settings: TrainerSettings;
  state: PersistedState;
  stateVersion: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface NewSession {
  userId: string;
  mode: PracticeMode;
  /** The drill of a drill session; null for automated and holdout sessions (S31). */
  drillId: string | null;
  settings: TrainerSettings;
  state: PersistedState;
}

export interface StateWrite {
  userId: string;
  sessionId: string;
  expectedVersion: number;
  state: PersistedState;
  /** Set ended_at to now() with this write (POST end). */
  end?: boolean;
}

export interface RecapStats {
  decisions: number;
  ratedDecisions: number;
  meanScore: number | null;
  evLossBbTotal: number;
}

const SESSION_COLUMNS = [
  "id",
  "user_id",
  "mode",
  "drill_id",
  "settings",
  "state",
  "state_version",
  "started_at",
  "ended_at",
] as const;

/** A value as a jsonb parameter (bound, never interpolated); S41's prediction answers share it. */
export function toJsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`cast(${JSON.stringify(value)} as jsonb)`;
}

type RawSession = Pick<Selectable<DB["practice_session"]>, (typeof SESSION_COLUMNS)[number]>;

function toSessionRow(row: RawSession): SessionRow {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    drillId: row.drill_id,
    settings: trainerSettingsSchema.parse(row.settings),
    state: persistedStateSchema.parse(row.state),
    stateVersion: row.state_version,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export async function insertSession(database: Database, session: NewSession): Promise<SessionRow> {
  const row = await database
    .insertInto("practice_session")
    .values({
      user_id: session.userId,
      mode: session.mode,
      drill_id: session.drillId,
      settings: toJsonb(session.settings),
      state: toJsonb(persistedStateSchema.parse(session.state)),
    })
    .returning(SESSION_COLUMNS)
    .executeTakeFirstOrThrow();
  return toSessionRow(row);
}

export async function findSession(database: Database, userId: string, sessionId: string): Promise<SessionRow | undefined> {
  const row = await database
    .selectFrom("practice_session")
    .select(SESSION_COLUMNS)
    .where("id", "=", sessionId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row === undefined ? undefined : toSessionRow(row);
}

/** The session row locked for update inside a transaction. */
export async function lockSession(transaction: Database, userId: string, sessionId: string): Promise<SessionRow | undefined> {
  const row = await transaction
    .selectFrom("practice_session")
    .select(SESSION_COLUMNS)
    .where("id", "=", sessionId)
    .where("user_id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined ? undefined : toSessionRow(row);
}

/** The optimistic state write; undefined when the version moved on (a lost race). */
export async function writeState(database: Database, write: StateWrite): Promise<SessionRow | undefined> {
  const row = await database
    .updateTable("practice_session")
    .set((eb) => ({
      state: toJsonb(persistedStateSchema.parse(write.state)),
      state_version: eb("state_version", "+", 1),
      ...(write.end === true ? { ended_at: sql<Date>`now()` } : {}),
    }))
    .where("id", "=", write.sessionId)
    .where("user_id", "=", write.userId)
    .where("state_version", "=", write.expectedVersion)
    .returning(SESSION_COLUMNS)
    .executeTakeFirst();
  return row === undefined ? undefined : toSessionRow(row);
}


/**
 * Records the spots a drill reaches that the library does not cover (05 section 1, O-240, ADR
 * 0018), at most once per user and spot: a spot already requested is left as it is (PR #25 review
 * MEDIUM 4), so repeated POST /sessions over the same drill keep one row per spot.
 */
export async function insertCoverageRequests(
  database: Database,
  userId: string,
  gaps: readonly PairCandidate[],
  line: string | null,
): Promise<void> {
  if (gaps.length === 0) {
    return;
  }
  await database
    .insertInto("coverage_request")
    .values(gaps.map((gap) => ({ user_id: userId, game_config_id: gap.config_id, position_pair: gap.pair, line })))
    .onConflict((conflict) => conflict.expression(ONCE_KEY_TARGET).doNothing())
    .execute();
}

export async function recapStats(database: Database, sessionId: string): Promise<RecapStats> {
  const row = await database
    .selectFrom("attempt")
    .select((eb) => [
      eb.fn.countAll<string>().as("decisions"),
      sql<string>`count(*) filter (where rated)`.as("rated_decisions"),
      sql<number | null>`avg(score)::float8`.as("mean_score"),
      sql<number>`coalesce(sum(ev_loss_bb), 0)::float8`.as("ev_loss_bb_total"),
    ])
    .where("session_id", "=", sessionId)
    .executeTakeFirstOrThrow();
  return {
    decisions: Number(row.decisions),
    ratedDecisions: Number(row.rated_decisions),
    meanScore: row.mean_score === null ? null : Number(row.mean_score),
    evLossBbTotal: Number(row.ev_loss_bb_total),
  };
}
