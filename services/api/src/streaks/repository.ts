/**
 * Streak and cosmetic writes and reads (R4.14, O-278, O-279, O-252, ADR 0012).
 *
 * Mechanism:
 * - recordRatedDecision runs in the decision transaction of a rated decision: it adds one to
 *   today's streak_day row (today in APP_TIME_ZONE, O-247), recomputes the streak with the pure
 *   rules (streaks/rules.ts) over every streak_day row of the user, writes freeze_used and repaired
 *   to match (inserting a zero-count row for a frozen or repaired day with no decisions, clearing
 *   flags the rules no longer give), and inserts the streak cosmetics the longest streak has reached
 *   (on conflict do nothing, so an unlock is permanent and recorded once). It returns the keys this
 *   call unlocked.
 * - streakView reads the same rows and runs the same rules, so GET /progress/streak shows exactly
 *   what the writes would store (read equals write).
 * - tierUnlocks runs at the end of a rated automated session: the overall tier from the ratings as
 *   of the session's own rating_history rows (so a repeat end recomputes the same tier) and the
 *   catalog's effective weights (O-271); the tier cosmetics it reaches are inserted.
 * Unlock times are the database clock (now()), the clock attempt.created_at and practice_session
 * ended_at use, so a session's unlocks are the rows between its start and its end.
 */
import { sql } from "kysely";
import type { z } from "zod";

import type { ClassCatalog } from "../automated/class-catalog.js";
import type { Database } from "../db.js";
import { ratingOnRead } from "../learning-state/rating-period.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import { overallRatingOf } from "../progress/rating.js";
import { effectiveTrackWeights } from "../progress/weights.js";
import { STREAK_DAY_MINIMUM, type streakSchema } from "../schemas/insights.js";
import type { recapSchema } from "../schemas/training.js";
import { addDays, isoDateOf, localDay, startOfDay } from "./calendar.js";
import { nextStreakMilestone, streakCosmetics, tierCosmetics } from "./cosmetics.js";
import { computeStreak, type DayCounts, type StreakComputation } from "./rules.js";

export type StreakView = z.infer<typeof streakSchema>;
export type RecapTier = NonNullable<z.infer<typeof recapSchema>["tier"]>;

export interface RatedDecision {
  userId: string;
  now: Date;
  timeZone: string;
}

export interface TierRequest {
  userId: string;
  sessionId: string;
  catalog: ClassCatalog;
  /** False on a repeat end: recompute the same tier and insert nothing. */
  write: boolean;
}

export interface TierUnlocks {
  /** The overall tier after the session; null when the session rated nothing. */
  tier: RecapTier | null;
  unlocks: string[];
}

async function dayCounts(database: Database, userId: string): Promise<DayCounts> {
  const rows = await database.selectFrom("streak_day").select(["day", "rated_decisions"]).where("user_id", "=", userId).execute();
  return new Map(rows.map((row) => [isoDateOf(row.day), row.rated_decisions]));
}

async function insertUnlocks(transaction: Database, userId: string, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) {
    return [];
  }
  const inserted = await transaction
    .insertInto("cosmetic_unlock")
    .values(keys.map((key) => ({ user_id: userId, cosmetic_key: key, unlocked_at: sql<Date>`now()` })))
    .onConflict((conflict) => conflict.columns(["user_id", "cosmetic_key"]).doNothing())
    .returning("cosmetic_key")
    .execute();
  return inserted.map((row) => row.cosmetic_key);
}

async function writeFlags(transaction: Database, userId: string, streak: StreakComputation): Promise<void> {
  const flagged = [
    ...streak.frozenDays.map((day) => ({ day, freeze_used: true, repaired: false })),
    ...streak.repairedDays.map((day) => ({ day, freeze_used: false, repaired: true })),
  ];
  await transaction
    .updateTable("streak_day")
    .set({ freeze_used: false, repaired: false })
    .where("user_id", "=", userId)
    .where((eb) => eb.or([eb("freeze_used", "=", true), eb("repaired", "=", true)]))
    .execute();
  if (flagged.length === 0) {
    return;
  }
  await transaction
    .insertInto("streak_day")
    .values(flagged.map((row) => ({ user_id: userId, rated_decisions: 0, ...row })))
    .onConflict((conflict) =>
      conflict.columns(["user_id", "day"]).doUpdateSet((eb) => ({
        freeze_used: eb.ref("excluded.freeze_used"),
        repaired: eb.ref("excluded.repaired"),
      })),
    )
    .execute();
}

/** Counts one rated decision and reconciles the streak (see the module doc); returns the new unlocks. */
export async function recordRatedDecision(transaction: Database, decision: RatedDecision): Promise<string[]> {
  const today = localDay(decision.now, decision.timeZone);
  await transaction
    .insertInto("streak_day")
    .values({ user_id: decision.userId, day: today, rated_decisions: 1 })
    .onConflict((conflict) =>
      conflict.columns(["user_id", "day"]).doUpdateSet((eb) => ({ rated_decisions: eb("streak_day.rated_decisions", "+", 1) })),
    )
    .execute();
  const streak = computeStreak(await dayCounts(transaction, decision.userId), today);
  await writeFlags(transaction, decision.userId, streak);
  return insertUnlocks(transaction, decision.userId, streakCosmetics(streak.longestDays));
}

/** GET /progress/streak: the same rules over the same rows, written nothing. */
export async function streakView(database: Database, userId: string, now: Date, timeZone: string): Promise<StreakView> {
  const today = localDay(now, timeZone);
  const streak = computeStreak(await dayCounts(database, userId), today);
  const unlocks = await database
    .selectFrom("cosmetic_unlock")
    .select(["cosmetic_key", "unlocked_at"])
    .where("user_id", "=", userId)
    .orderBy("unlocked_at")
    .orderBy("cosmetic_key")
    .execute();
  const next = nextStreakMilestone(streak.currentDays, new Set(unlocks.map((row) => row.cosmetic_key)));
  const repairable = streak.repairable;
  return {
    current_days: streak.currentDays,
    longest_days: streak.longestDays,
    today_rated: streak.todayRated,
    day_minimum: STREAK_DAY_MINIMUM,
    freezes_left_this_week: streak.freezesLeftThisWeek,
    repairable:
      repairable === null
        ? null
        : {
            day: repairable.day,
            deadline: startOfDay(repairable.deadlineDay, timeZone).toISOString(),
            last_day: addDays(repairable.deadlineDay, -1),
            progress: repairable.progress,
            needed: repairable.needed,
          },
    unlocks: unlocks.map((row) => ({ cosmetic_key: row.cosmetic_key, unlocked_at: row.unlocked_at.toISOString() })),
    next_milestone: next === null ? null : { days: next.days, cosmetic_key: next.cosmeticKey },
  };
}

/** Every seeded track's enable weight (track.weight, O-271) by key. */
export async function enabledTrackWeights(database: Database): Promise<ReadonlyMap<TrackKey, number>> {
  const rows = await database.selectFrom("track").select(["key", "weight"]).execute();
  return new Map(rows.flatMap((row) => TRACK_KEYS.filter((key) => key === row.key).map((key) => [key, row.weight] as const)));
}

/** The instant the session's ratings were written, or undefined when it rated nothing. */
async function sessionRatedAt(database: Database, sessionId: string): Promise<Date | undefined> {
  const row = await database
    .selectFrom("rating_history")
    .select((eb) => eb.fn.max("recorded_at").as("at"))
    .where("session_id", "=", sessionId)
    .executeTakeFirst();
  return row?.at ?? undefined;
}

/** The user's rating per track as of `at`: each track's newest rating_history row then, with inactivity on read. */
async function ratingsAsOf(database: Database, userId: string, at: Date) {
  const rows = await database
    .selectFrom("rating_history")
    .innerJoin("track", "track.id", "rating_history.track_id")
    .distinctOn("rating_history.track_id")
    .select(["track.key", "rating_history.mu", "rating_history.rd", "rating_history.volatility", "rating_history.recorded_at"])
    .where("rating_history.user_id", "=", userId)
    .where("rating_history.recorded_at", "<=", at)
    .orderBy("rating_history.track_id")
    .orderBy("rating_history.recorded_at", "desc")
    .execute();
  return new Map(
    rows.flatMap((row) => {
      const key = TRACK_KEYS.find((candidate) => candidate === row.key);
      if (key === undefined || row.mu === null || row.rd === null || row.volatility === null) {
        return [];
      }
      return [[key, ratingOnRead({ mu: row.mu, rd: row.rd, volatility: row.volatility, updatedAt: row.recorded_at }, at)] as const];
    }),
  );
}

/** The session's overall tier and the tier cosmetics it unlocked (see the module doc). */
export async function tierUnlocks(transaction: Database, request: TierRequest): Promise<TierUnlocks> {
  const ratedAt = await sessionRatedAt(transaction, request.sessionId);
  if (ratedAt === undefined) {
    return { tier: null, unlocks: [] };
  }
  const weights = effectiveTrackWeights(request.catalog.classes, await enabledTrackWeights(transaction));
  const overall = overallRatingOf(await ratingsAsOf(transaction, request.userId, ratedAt), weights);
  if (overall === null) {
    return { tier: null, unlocks: [] };
  }
  const unlocks = request.write ? await insertUnlocks(transaction, request.userId, tierCosmetics(overall.tier)) : [];
  const tier: RecapTier = { overall: overall.conservative, tier: overall.tier, band_tier: overall.band_tier, blocked_by: overall.blocked_by };
  return { tier, unlocks };
}

/** The cosmetic keys unlocked between a session's start and its end (database clock), oldest first. */
export async function sessionUnlocks(database: Database, userId: string, startedAt: Date, endedAt: Date): Promise<string[]> {
  const rows = await database
    .selectFrom("cosmetic_unlock")
    .select("cosmetic_key")
    .where("user_id", "=", userId)
    .where("unlocked_at", ">=", startedAt)
    .where("unlocked_at", "<=", endedAt)
    .orderBy("unlocked_at")
    .orderBy("cosmetic_key")
    .execute();
  return rows.map((row) => row.cosmetic_key);
}
