/**
 * Holdout round summaries (R4.13, O-276, O-277): a round's close per track.
 *
 * closeRound writes one holdout_summary per track with items (answered: the scored items, answered
 * or skipped; total: the track's items; the mean score with a skipped item at 0; the track's rating
 * at the close with inactivity on read; and the Goodhart flag against the user's previous closed
 * round, O-277), then sets closed_at; a round already closed is left alone, so the monthly job may
 * run twice. Summaries are written once (the app may only select and insert them, PR #27 review
 * LOW 13).
 */
import type { Database } from "../db.js";
import { ratingOnRead } from "../learning-state/rating-period.js";
import type { TrackKey } from "../learning/tracks.js";
import { sqlDate } from "../streaks/sql-date.js";
import { goodhartFlag, type RoundFigures } from "./goodhart.js";
import { asTrackKey, itemTotals, type HoldoutRound } from "./repository.js";
import { roundScores } from "./results.js";

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
