/**
 * The weekly leak history job (R4.11, O-275, PM condition: idempotent): Monday 00:00 APP_TIME_ZONE,
 * every user's leak_stat rows are recomputed from their attempts, then one leak_history row per row
 * is written for the week that just ended, keyed by that week's Monday.
 *
 * Mechanism: the period key is the ISO date of the Monday that starts the ended week and the job is
 * due at the next Monday's local midnight (streaks/calendar.ts, the shared zone helpers). Each row is
 * recomputed with its stored prior (the weekly job never asks solver-query; the decision path keeps
 * the prior current, O-270) and its class's track from the newest counted attempt's track_ids
 * (learning-state/leak-stat.ts). learning's leakHistorySnapshot shapes the week's rows, inserted on
 * conflict do nothing, so a second run for the same week leaves the rows as they are; a recompute is
 * a function of the stored attempts, so it writes the same leak_stat values again.
 */
import { leakHistorySnapshot, type LeakStat } from "@g-tee-oh/learning";

import type { Database } from "../db.js";
import { recomputeLeakStatById } from "../learning-state/leak-stat.js";
import { countedAttempts } from "../learning-state/repository.js";
import { addDays, localDay, mondayOf, startOfDay } from "../streaks/calendar.js";
import type { JobContext, JobDefinition } from "./registry.js";
import type { JobPeriod } from "./schedule.js";

const DAYS_PER_WEEK = 7;
/** registry.ts JOB_KINDS.leakHistoryWeekly; spelled here because registry.ts imports this module (a test pins the two). */
export const LEAK_HISTORY_KIND = "leak_history_weekly";

/** The week that most recently ended at `now`: its Monday, due at the following Monday's midnight. */
export function leakHistoryPeriod(now: Date, timeZone: string): JobPeriod {
  const thisMonday = mondayOf(localDay(now, timeZone));
  return { periodKey: addDays(thisMonday, -DAYS_PER_WEEK), runAt: startOfDay(thisMonday, timeZone) };
}

interface StoredRow {
  user_id: string;
  spot_class_key: string;
  freq_prior_per_1k: number;
}

async function trackIdOfClass(database: Database, userId: string, spotClassKey: string): Promise<string | null> {
  const row = await countedAttempts(database, userId)
    .select("attempt.track_ids")
    .where("attempt.spot_class_key", "=", spotClassKey)
    .orderBy("attempt.created_at", "desc")
    .orderBy("attempt.id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.track_ids?.[0] ?? null;
}

async function recomputeRow(database: Database, row: StoredRow, now: Date): Promise<LeakStat | undefined> {
  return recomputeLeakStatById(database, {
    userId: row.user_id,
    spotClassKey: row.spot_class_key,
    trackId: await trackIdOfClass(database, row.user_id, row.spot_class_key),
    frequencyPriorPer1k: row.freq_prior_per_1k,
    now,
  });
}

async function writeWeek(database: Database, userId: string, week: string, stats: readonly LeakStat[]): Promise<void> {
  const rows = leakHistorySnapshot(week, stats);
  if (rows.length === 0) {
    return;
  }
  await database
    .insertInto("leak_history")
    .values(rows.map((row) => ({ user_id: userId, spot_class_key: row.spotClassKey, week: row.week, leak_cost_bb_per_1k: row.leakCostBbPer1k })))
    .onConflict((conflict) => conflict.columns(["user_id", "spot_class_key", "week"]).doNothing())
    .execute();
}

/** Recomputes every leak_stat row and writes the week's leak_history rows (see the module doc). */
export async function snapshotLeakWeek(transaction: Database, request: { week: string; now: Date }): Promise<void> {
  const rows = await transaction
    .selectFrom("leak_stat")
    .select(["user_id", "spot_class_key", "freq_prior_per_1k"])
    .orderBy("user_id")
    .orderBy("spot_class_key")
    .execute();
  const byUser = new Map<string, LeakStat[]>();
  for (const row of rows) {
    const stat = await recomputeRow(transaction, row, request.now);
    if (stat !== undefined) {
      byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), stat]);
    }
  }
  for (const [userId, stats] of byUser) {
    await writeWeek(transaction, userId, request.week, stats);
  }
}

export async function leakHistoryHandler(context: JobContext): Promise<void> {
  await snapshotLeakWeek(context.transaction, { week: context.job.periodKey, now: context.now });
}

export const LEAK_HISTORY_JOB: JobDefinition = {
  kind: LEAK_HISTORY_KIND,
  nextPeriod: leakHistoryPeriod,
  handler: leakHistoryHandler,
};
