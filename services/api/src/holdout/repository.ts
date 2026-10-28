/**
 * Holdout rows (R4.13, O-100, O-276, ADR 0001): the global item set and its draws, each user's
 * monthly rounds, and the user's open holdout session. Results live in holdout/results.ts and the
 * round summaries in holdout/summaries.ts.
 *
 * Mechanism:
 * - holdout_item and holdout_draw are global (A4 section 2): one recorded draw per track, never
 *   redrawn; the guard reads the item keys (solution, node, hand class) once per request. An item
 *   keeps its line's history as solver-query labelled it at the draw, so serving it needs no class
 *   catalog (PR #27 review HIGH 4).
 * - holdout_round is one row per user and month (unique), opened with `on conflict do nothing`, so
 *   the monthly job and a month's first holdout session open it once between them. Its order seed,
 *   64 random bits chosen when it opens, fixes the order the round serves its items in (PR #27
 *   review HIGH 1, holdout/session-items.ts roundOrder). lockRound serializes a user's holdout
 *   creates within the round.
 * - A user has at most one open holdout session (the partial unique index
 *   practice_session_open_holdout_key); openHoldoutSessions reads it with the item it serves.
 */
import { sql } from "kysely";
import { z } from "zod";

import type { Database } from "../db.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import { newSessionSeed } from "../sessions/randomness.js";
import { historyEntrySchema, learningOf, persistedStateSchema, type HistoryEntry } from "../sessions/state.js";
import { isoDateOf } from "../streaks/calendar.js";
import { sqlDate } from "../streaks/sql-date.js";

const historySchema = z.array(historyEntrySchema);

export interface HoldoutItem {
  id: string;
  trackKey: TrackKey;
  spotClassKey: string;
  configId: string;
  pair: string;
  line: string | null;
  heroPosition: string;
  dealSeed: string;
  solutionId: string;
  nodeKey: string;
  /** The hand class: the hero's row label at the node, as solver-query names it. */
  hand: string;
  /** The line's actions as solver-query labelled them at the draw (the prompt's history). */
  history: HistoryEntry[];
}

/** A drawn item before it is stored. */
export type NewHoldoutItem = Omit<HoldoutItem, "id">;

export interface HoldoutRound {
  id: string;
  /** The first day of the round's month. */
  month: string;
  /** Fixes the round's serving order (PR #27 review HIGH 1). */
  orderSeed: string;
  openedAt: Date;
  closedAt: Date | null;
}

/** A user's open holdout session and the item it serves (null once its round is done). */
export interface OpenHoldoutSession {
  id: string;
  currentItem: string | null;
}

export function asTrackKey(key: string): TrackKey {
  const found = TRACK_KEYS.find((candidate) => candidate === key);
  if (found === undefined) {
    throw new Error(`holdout item of an unknown track ${key}`);
  }
  return found;
}

function itemQuery(database: Database) {
  return database
    .selectFrom("holdout_item")
    .innerJoin("track", "track.id", "holdout_item.track_id")
    .select([
      "holdout_item.id",
      "track.key as track_key",
      "holdout_item.spot_class_key",
      "holdout_item.config_id",
      "holdout_item.pair",
      "holdout_item.line",
      "holdout_item.hero_position",
      "holdout_item.deal_seed",
      "holdout_item.solution_id",
      "holdout_item.node_key",
      "holdout_item.hand",
      "holdout_item.history",
    ]);
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof itemQuery>["execute"]>>[number];

function toItem(row: ItemRow): HoldoutItem {
  return {
    id: row.id,
    trackKey: asTrackKey(row.track_key),
    spotClassKey: row.spot_class_key,
    configId: row.config_id,
    pair: row.pair,
    line: row.line,
    heroPosition: row.hero_position,
    dealSeed: row.deal_seed,
    solutionId: row.solution_id,
    nodeKey: row.node_key,
    hand: row.hand,
    history: historySchema.parse(row.history),
  };
}

/** Every holdout item, or one track's, in id order. */
export async function holdoutItems(database: Database, trackKey: TrackKey | null = null): Promise<HoldoutItem[]> {
  const query = trackKey === null ? itemQuery(database) : itemQuery(database).where("track.key", "=", trackKey);
  const rows = await query.orderBy("holdout_item.id").execute();
  return rows.map(toItem);
}

/** The item keys the guard holds back: solution, node and hand class. */
export async function heldOutKeys(database: Database): Promise<{ solutionId: string; nodeKey: string; hand: string }[]> {
  const rows = await database.selectFrom("holdout_item").select(["solution_id", "node_key", "hand"]).execute();
  return rows.map((row) => ({ solutionId: row.solution_id, nodeKey: row.node_key, hand: row.hand }));
}

/** Holdout items per track. */
export async function itemTotals(database: Database): Promise<Map<TrackKey, { trackId: string; total: number }>> {
  const rows = await database
    .selectFrom("holdout_item")
    .innerJoin("track", "track.id", "holdout_item.track_id")
    .select((eb) => ["track.key", "track.id", eb.fn.countAll<string>().as("total")])
    .groupBy(["track.key", "track.id"])
    .execute();
  return new Map(rows.map((row) => [asTrackKey(row.key), { trackId: row.id, total: Number(row.total) }]));
}

/** The track ids that already have a recorded draw. */
export async function drawnTrackIds(database: Database): Promise<ReadonlySet<string>> {
  const rows = await database.selectFrom("holdout_draw").select("track_id").execute();
  return new Set(rows.map((row) => row.track_id));
}

/** Records one track's draw and its items together (the caller's transaction). */
export async function recordDraw(transaction: Database, trackId: string, seed: string, items: readonly NewHoldoutItem[]): Promise<void> {
  await transaction.insertInto("holdout_draw").values({ track_id: trackId, seed, items: items.length }).execute();
  await transaction
    .insertInto("holdout_item")
    .values(
      items.map((item) => ({
        track_id: trackId,
        spot_class_key: item.spotClassKey,
        config_id: item.configId,
        pair: item.pair,
        line: item.line,
        hero_position: item.heroPosition,
        deal_seed: item.dealSeed,
        solution_id: item.solutionId,
        node_key: item.nodeKey,
        hand: item.hand,
        history: sql`cast(${JSON.stringify(item.history)} as jsonb)`,
      })),
    )
    .execute();
}

const ROUND_COLUMNS = ["id", "month", "order_seed", "opened_at", "closed_at"] as const;

function toRound(row: { id: string; month: Date | string; order_seed: string; opened_at: Date; closed_at: Date | null }): HoldoutRound {
  return { id: row.id, month: isoDateOf(row.month), orderSeed: row.order_seed, openedAt: row.opened_at, closedAt: row.closed_at };
}

/**
 * The user's round of `month` (its first day), opened now if it does not exist yet; a new round's
 * order seed is 64 random bits unless the caller (a test) fixes it.
 */
export async function openRound(transaction: Database, userId: string, month: string, now: Date, orderSeed: string = newSessionSeed()): Promise<HoldoutRound> {
  await transaction
    .insertInto("holdout_round")
    .values({ user_id: userId, month, order_seed: orderSeed, opened_at: now })
    .onConflict((conflict) => conflict.columns(["user_id", "month"]).doNothing())
    .execute();
  const row = await transaction
    .selectFrom("holdout_round")
    .select(ROUND_COLUMNS)
    .where("user_id", "=", userId)
    .where("month", "=", sqlDate(month))
    .executeTakeFirstOrThrow();
  return toRound(row);
}

/** The user's round by id. */
export async function roundById(database: Database, userId: string, roundId: string): Promise<HoldoutRound> {
  const row = await database
    .selectFrom("holdout_round")
    .select(ROUND_COLUMNS)
    .where("id", "=", roundId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  return toRound(row);
}

/** Locks the round row for the transaction, so a user's holdout creates in it run one at a time. */
export async function lockRound(transaction: Database, roundId: string): Promise<void> {
  await transaction.selectFrom("holdout_round").select("id").where("id", "=", roundId).forUpdate().executeTakeFirstOrThrow();
}

/** The user's rounds, newest month first, after `beforeMonth` when paging. */
export async function roundsPage(database: Database, userId: string, limit: number, beforeMonth: string | null): Promise<HoldoutRound[]> {
  let query = database.selectFrom("holdout_round").select(ROUND_COLUMNS).where("user_id", "=", userId);
  if (beforeMonth !== null) {
    query = query.where("month", "<", sqlDate(beforeMonth));
  }
  const rows = await query.orderBy("month", "desc").limit(limit).execute();
  return rows.map(toRound);
}

/** Every user's open round of a month before `month`, oldest first. */
export async function openRoundsBefore(database: Database, month: string): Promise<{ userId: string; round: HoldoutRound }[]> {
  const rows = await database
    .selectFrom("holdout_round")
    .select([...ROUND_COLUMNS, "user_id"])
    .where("closed_at", "is", null)
    .where("month", "<", sqlDate(month))
    .orderBy("month")
    .orderBy("user_id")
    .execute();
  return rows.map((row) => ({ userId: row.user_id, round: toRound(row) }));
}

/** The user's open holdout sessions (at most one) with the item each serves. */
export async function openHoldoutSessions(database: Database, userId: string): Promise<OpenHoldoutSession[]> {
  const rows = await database
    .selectFrom("practice_session")
    .select(["id", "state"])
    .where("user_id", "=", userId)
    .where("mode", "=", "holdout")
    .where("ended_at", "is", null)
    .orderBy("started_at")
    .execute();
  return rows.map((row) => {
    const learning = learningOf(persistedStateSchema.parse(row.state));
    return { id: row.id, currentItem: learning?.kind === "holdout" ? learning.current_item : null };
  });
}
