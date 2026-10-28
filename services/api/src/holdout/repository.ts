/**
 * Holdout rows (R4.13, O-100, O-276, O-277, ADR 0001): the global item set and its draws, each
 * user's monthly rounds, their results and their closing summaries.
 *
 * Mechanism:
 * - holdout_item and holdout_draw are global (A4 section 2): one recorded draw per track, never
 *   redrawn; the guard reads the item keys (solution, node, hand class) once per request.
 * - holdout_round is one row per user and month (unique), opened with `on conflict do nothing`, so
 *   the monthly job and a month's first holdout session open it once between them.
 * - holdout_result carries its round; unique (user, item, round) makes a replayed decision write
 *   it once. An item counts as answered in a round once it has a result there.
 * - closeRound writes one holdout_summary per track with items (answered, total, the mean attempt
 *   score, the track's rating at the close with inactivity on read, and the Goodhart flag against
 *   the user's previous closed round, O-277), then sets closed_at; a round already closed is left
 *   alone, so the monthly job may run twice.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";
import { ratingOnRead } from "../learning-state/rating-period.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import { isoDateOf } from "../streaks/calendar.js";
import { sqlDate } from "../streaks/sql-date.js";
import { goodhartFlag, type RoundFigures } from "./goodhart.js";

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
}

/** A drawn item before it is stored. */
export type NewHoldoutItem = Omit<HoldoutItem, "id">;

export interface HoldoutRound {
  id: string;
  /** The first day of the round's month. */
  month: string;
  openedAt: Date;
  closedAt: Date | null;
}

export interface NewResult {
  userId: string;
  itemId: string;
  attemptId: string;
  roundId: string;
  takenAt: Date;
}

function asTrackKey(key: string): TrackKey {
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
      })),
    )
    .execute();
}

function toRound(row: { id: string; month: Date | string; opened_at: Date; closed_at: Date | null }): HoldoutRound {
  return { id: row.id, month: isoDateOf(row.month), openedAt: row.opened_at, closedAt: row.closed_at };
}

/** The user's round of `month` (its first day), opened now if it does not exist yet. */
export async function openRound(transaction: Database, userId: string, month: string, now: Date): Promise<HoldoutRound> {
  await transaction
    .insertInto("holdout_round")
    .values({ user_id: userId, month, opened_at: now })
    .onConflict((conflict) => conflict.columns(["user_id", "month"]).doNothing())
    .execute();
  const row = await transaction
    .selectFrom("holdout_round")
    .select(["id", "month", "opened_at", "closed_at"])
    .where("user_id", "=", userId)
    .where("month", "=", sqlDate(month))
    .executeTakeFirstOrThrow();
  return toRound(row);
}

/** The user's rounds, newest month first, after `beforeMonth` when paging. */
export async function roundsPage(database: Database, userId: string, limit: number, beforeMonth: string | null): Promise<HoldoutRound[]> {
  let query = database
    .selectFrom("holdout_round")
    .select(["id", "month", "opened_at", "closed_at"])
    .where("user_id", "=", userId);
  if (beforeMonth !== null) {
    query = query.where("month", "<", sqlDate(beforeMonth));
  }
  const rows = await query.orderBy("month", "desc").limit(limit).execute();
  return rows.map(toRound);
}

/** The ids of the items the user answered in a round. */
export async function answeredItemIds(database: Database, userId: string, roundId: string): Promise<ReadonlySet<string>> {
  const rows = await database
    .selectFrom("holdout_result")
    .select("holdout_item_id")
    .where("user_id", "=", userId)
    .where("round_id", "=", roundId)
    .execute();
  return new Set(rows.flatMap((row) => (row.holdout_item_id === null ? [] : [row.holdout_item_id])));
}

/** Records one answered item (once per user, item and round). */
export async function insertResult(transaction: Database, result: NewResult): Promise<void> {
  await transaction
    .insertInto("holdout_result")
    .values({
      user_id: result.userId,
      holdout_item_id: result.itemId,
      attempt_id: result.attemptId,
      round_id: result.roundId,
      taken_at: result.takenAt,
    })
    .onConflict((conflict) => conflict.columns(["user_id", "holdout_item_id", "round_id"]).doNothing())
    .execute();
}

/** Per track of a round: answered items and their mean attempt score. */
export async function roundScores(database: Database, roundId: string): Promise<Map<TrackKey, { answered: number; meanScore: number | null }>> {
  const rows = await database
    .selectFrom("holdout_result")
    .innerJoin("holdout_item", "holdout_item.id", "holdout_result.holdout_item_id")
    .innerJoin("track", "track.id", "holdout_item.track_id")
    .innerJoin("attempt", "attempt.id", "holdout_result.attempt_id")
    .select((eb) => [
      "track.key",
      eb.fn.countAll<string>().as("answered"),
      sql<number | null>`avg(attempt.score)::float8`.as("mean_score"),
    ])
    .where("holdout_result.round_id", "=", roundId)
    .groupBy("track.key")
    .execute();
  return new Map(rows.map((row) => [asTrackKey(row.key), { answered: Number(row.answered), meanScore: row.mean_score }]));
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

export interface SummaryRow {
  trackKey: TrackKey;
  answered: number;
  total: number;
  meanScore: number | null;
  mu: number | null;
  goodhartFlag: boolean;
}

/** The summaries of a set of rounds, by round id. */
export async function summariesOf(database: Database, roundIds: readonly string[]): Promise<Map<string, SummaryRow[]>> {
  if (roundIds.length === 0) {
    return new Map();
  }
  const rows = await database
    .selectFrom("holdout_summary")
    .innerJoin("track", "track.id", "holdout_summary.track_id")
    .select(["holdout_summary.round_id", "track.key", "answered", "total", "mean_score", "mu", "goodhart_flag"])
    .where("holdout_summary.round_id", "in", [...roundIds])
    .execute();
  const byRound = new Map<string, SummaryRow[]>();
  for (const row of rows) {
    const summary: SummaryRow = {
      trackKey: asTrackKey(row.key),
      answered: row.answered,
      total: row.total,
      meanScore: row.mean_score,
      mu: row.mu,
      goodhartFlag: row.goodhart_flag,
    };
    byRound.set(row.round_id, [...(byRound.get(row.round_id) ?? []), summary]);
  }
  return byRound;
}

async function ratingsAt(database: Database, userId: string, now: Date): Promise<Map<TrackKey, { mu: number; rd: number }>> {
  const rows = await database
    .selectFrom("rating")
    .innerJoin("track", "track.id", "rating.track_id")
    .select(["track.key", "mu", "rd", "volatility", "updated_at"])
    .where("user_id", "=", userId)
    .execute();
  return new Map(
    rows.map((row) => {
      const rating = ratingOnRead({ mu: row.mu, rd: row.rd, volatility: row.volatility, updatedAt: row.updated_at }, now);
      return [asTrackKey(row.key), { mu: rating.rating, rd: rating.rd }] as const;
    }),
  );
}

async function previousClosedRound(database: Database, userId: string, month: string): Promise<string | undefined> {
  const row = await database
    .selectFrom("holdout_round")
    .select("id")
    .where("user_id", "=", userId)
    .where("month", "<", sqlDate(month))
    .where("closed_at", "is not", null)
    .orderBy("month", "desc")
    .executeTakeFirst();
  return row?.id;
}

/** Closes an open round with its per-track summaries (see the module doc). */
export async function closeRound(transaction: Database, userId: string, round: HoldoutRound, now: Date): Promise<void> {
  const totals = await itemTotals(transaction);
  const scores = await roundScores(transaction, round.id);
  const ratings = await ratingsAt(transaction, userId, now);
  const previousId = await previousClosedRound(transaction, userId, round.month);
  const previous = previousId === undefined ? [] : ((await summariesOf(transaction, [previousId])).get(previousId) ?? []);
  const rows = [...totals].map(([key, { trackId, total }]) => {
    const score = scores.get(key) ?? { answered: 0, meanScore: null };
    const rating = ratings.get(key) ?? null;
    const current: RoundFigures = { answered: score.answered, meanScore: score.meanScore, mu: rating?.mu ?? null };
    const before = previous.find((summary) => summary.trackKey === key) ?? null;
    return {
      round_id: round.id,
      track_id: trackId,
      answered: score.answered,
      total,
      mean_score: score.meanScore,
      mu: rating?.mu ?? null,
      rd: rating?.rd ?? null,
      goodhart_flag: goodhartFlag(before, current),
    };
  });
  if (rows.length > 0) {
    await transaction
      .insertInto("holdout_summary")
      .values(rows)
      .onConflict((conflict) => conflict.columns(["round_id", "track_id"]).doNothing())
      .execute();
  }
  await transaction
    .updateTable("holdout_round")
    .set({ closed_at: now })
    .where("id", "=", round.id)
    .where("closed_at", "is", null)
    .execute();
}

/** Every user's open round of a month before `month`, oldest first. */
export async function openRoundsBefore(database: Database, month: string): Promise<{ userId: string; round: HoldoutRound }[]> {
  const rows = await database
    .selectFrom("holdout_round")
    .select(["id", "user_id", "month", "opened_at", "closed_at"])
    .where("closed_at", "is", null)
    .where("month", "<", sqlDate(month))
    .orderBy("month")
    .orderBy("user_id")
    .execute();
  return rows.map((row) => ({ userId: row.user_id, round: toRound(row) }));
}
