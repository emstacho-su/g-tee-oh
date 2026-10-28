/**
 * Progress reads (R4.12, ADR 0001): every query is scoped to one user and nothing here writes.
 * Ratings come back with inactivity applied on read (Lane B's ratingOnRead, O-251); retrievability
 * is learning's, from the stored FSRS card (Lane B's codec), at the read's instant.
 */
import { retrievability, type TrackRating } from "@g-tee-oh/learning";
import { sql } from "kysely";

import type { Database } from "../db.js";
import { spotClassCardOf } from "../learning-state/fsrs-card.js";
import { ratingOnRead } from "../learning-state/rating-period.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import { isoDateOf } from "../streaks/calendar.js";
import { sqlDate } from "../streaks/sql-date.js";
import type { ClassMemory } from "./heatmap.js";
import type { LeakHistoryEntry, LeakStatRow } from "./leaks.js";

/** Holdout attempts measure, never train (O-274): they stay out of the heat map's decision counts. */
const UNCOUNTED_MODE = "holdout";

function trackKeyOf(key: string): TrackKey | undefined {
  return TRACK_KEYS.find((candidate) => candidate === key);
}

export interface StoredRatings {
  ratings: ReadonlyMap<TrackKey, TrackRating>;
  updatedAt: Date | null;
}

/** The user's track ratings with inactivity on read, and the newest update. */
export async function storedRatings(database: Database, userId: string, now: Date): Promise<StoredRatings> {
  const rows = await database
    .selectFrom("rating")
    .innerJoin("track", "track.id", "rating.track_id")
    .select(["track.key", "rating.mu", "rating.rd", "rating.volatility", "rating.updated_at"])
    .where("rating.user_id", "=", userId)
    .execute();
  const known = rows.flatMap((row) => {
    const key = trackKeyOf(row.key);
    return key === undefined ? [] : [{ key, row }];
  });
  const ratings = new Map<TrackKey, TrackRating>(
    known.map(({ key, row }) => [key, ratingOnRead({ mu: row.mu, rd: row.rd, volatility: row.volatility, updatedAt: row.updated_at }, now)]),
  );
  const times = known.map(({ row }) => row.updated_at.getTime());
  return { ratings, updatedAt: times.length === 0 ? null : new Date(Math.max(...times)) };
}

export interface TrackRow {
  key: TrackKey;
  family: string;
  format: string;
  weight: number;
}

/** The seeded tracks, in TRACK_KEYS order. */
export async function trackRows(database: Database): Promise<TrackRow[]> {
  const rows = await database.selectFrom("track").select(["key", "family", "format", "weight"]).execute();
  return TRACK_KEYS.flatMap((key) => {
    const row = rows.find((candidate) => candidate.key === key);
    return row === undefined ? [] : [{ key, family: row.family, format: row.format, weight: row.weight }];
  });
}

/** Rated decisions per track (by track_ids) and the last rated decision's time. */
export async function ratedByTrack(database: Database, userId: string): Promise<Map<TrackKey, { count: number; lastAt: Date | null }>> {
  const rows = await database
    .selectFrom(sql<{ track_id: string; created_at: Date }>`(select unnest(track_ids) as track_id, created_at from attempt where user_id = ${userId} and rated)`.as("rated"))
    .innerJoin("track", "track.id", "rated.track_id")
    .select((eb) => ["track.key", eb.fn.countAll<string>().as("count"), eb.fn.max("rated.created_at").as("last_at")])
    .groupBy("track.key")
    .execute();
  return new Map(
    rows.flatMap((row) => {
      const key = trackKeyOf(row.key);
      return key === undefined ? [] : [[key, { count: Number(row.count), lastAt: row.last_at }] as const];
    }),
  );
}

/** The user's leak_stat rows. */
export async function leakStatRows(database: Database, userId: string): Promise<LeakStatRow[]> {
  const rows = await database
    .selectFrom("leak_stat")
    .select(["spot_class_key", "freq_prior_per_1k", "n", "miss_rate", "ev_per_miss_bb", "leak_cost_bb_per_1k"])
    .where("user_id", "=", userId)
    .execute();
  return rows.map((row) => ({
    spotClassKey: row.spot_class_key,
    freqPriorPer1k: row.freq_prior_per_1k,
    n: row.n,
    missRate: row.miss_rate,
    evPerMissBb: row.ev_per_miss_bb,
    leakCostBbPer1k: row.leak_cost_bb_per_1k,
  }));
}

/** The user's leak_history rows from `fromWeek` on. */
export async function leakHistoryRows(database: Database, userId: string, fromWeek: string): Promise<LeakHistoryEntry[]> {
  const rows = await database
    .selectFrom("leak_history")
    .select(["spot_class_key", "week", "leak_cost_bb_per_1k"])
    .where("user_id", "=", userId)
    .where("week", ">=", sqlDate(fromWeek))
    .execute();
  return rows.map((row) => ({ spotClassKey: row.spot_class_key, week: isoDateOf(row.week), leakCostBbPer1k: row.leak_cost_bb_per_1k }));
}

/** Per class: BKT p_known, FSRS retrievability now, and the user's decisions outside holdout. */
export async function classMemory(database: Database, userId: string, now: Date): Promise<Map<string, ClassMemory>> {
  const [masteryRows, cardRows, countRows] = await Promise.all([
    database.selectFrom("mastery").select(["spot_class_key", "p_known"]).where("user_id", "=", userId).execute(),
    database.selectFrom("schedule_card").select(["spot_class_key", "fsrs_state"]).where("user_id", "=", userId).execute(),
    database
      .selectFrom("attempt")
      .innerJoin("practice_session", "practice_session.id", "attempt.session_id")
      .select((eb) => ["attempt.spot_class_key", eb.fn.countAll<string>().as("n")])
      .where("attempt.user_id", "=", userId)
      .where("practice_session.mode", "!=", UNCOUNTED_MODE)
      .groupBy("attempt.spot_class_key")
      .execute(),
  ]);
  const memory = new Map<string, ClassMemory>();
  const entry = (key: string): ClassMemory => memory.get(key) ?? { pKnown: null, retrievability: null, n: 0 };
  for (const row of masteryRows) {
    memory.set(row.spot_class_key, { ...entry(row.spot_class_key), pKnown: row.p_known });
  }
  for (const row of cardRows) {
    const card = spotClassCardOf(row.spot_class_key, row.fsrs_state);
    memory.set(row.spot_class_key, { ...entry(row.spot_class_key), retrievability: retrievability(card, now) });
  }
  for (const row of countRows) {
    memory.set(row.spot_class_key, { ...entry(row.spot_class_key), n: Number(row.n) });
  }
  return memory;
}
