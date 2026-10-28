/**
 * The weekly leak history job (R4.11, O-275, PM condition: idempotent): Monday 00:00 APP_TIME_ZONE,
 * every user's leak_stat rows are recomputed from their attempts, then one leak_history row per row
 * is written for the week that just ended, keyed by that week's Monday.
 *
 * Mechanism: the period key is the ISO date of the Monday that starts the ended week and the job is
 * due at the next Monday's local midnight (streaks/calendar.ts, the shared zone helpers). Each row is
 * recomputed with its stored prior (the weekly job never asks solver-query; the decision path keeps
 * the prior current, O-270) and its class's track from the newest counted attempt's track_ids.
 *
 * - Week boundary (PR #27 review MEDIUM 10): the week's snapshot counts only the attempts made
 *   before the end of the week it labels (the next Monday's local midnight), not before the run, so
 *   a late or retried run writes the same history; leak_stat is refreshed over every attempt, as the
 *   decision path keeps it.
 * - Batched (PR #27 review MEDIUM 10): one grouped read per user (learning-state/track-decisions.ts,
 *   both sides of the week's end in one query), one upsert of the user's leak_stat rows and one
 *   insert of the week's rows, instead of about three statements per (user, class), so the run fits
 *   the job lease (repository.ts JOB_LEASE_MS).
 * learning's leakHistorySnapshot shapes the week's rows, inserted on conflict do nothing, so a
 * second run for the same week leaves the rows as they are; a recompute is a function of the stored
 * attempts, so it writes the same leak_stat values again.
 */
import { leakHistorySnapshot, type LeakStat } from "@g-tee-oh/learning";

import type { Database } from "../db.js";
import { leakStatOf, upsertLeakStats } from "../learning-state/leak-stat.js";
import { classTrackIdOf, decisionGroups, type DecisionGroup } from "../learning-state/track-decisions.js";
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

/** The instant the week starting on Monday `week` ends: the next Monday's local midnight. */
export function weekEndOf(week: string, timeZone: string): Date {
  return startOfDay(addDays(week, DAYS_PER_WEEK), timeZone);
}

interface StoredRow {
  spot_class_key: string;
  freq_prior_per_1k: number;
}

/** One class's row over `groups`, with its stored prior and the track of its newest group there. */
function statOver(groups: readonly DecisionGroup[], row: StoredRow): LeakStat | undefined {
  return leakStatOf(groups, {
    spotClassKey: row.spot_class_key,
    trackId: classTrackIdOf(groups, row.spot_class_key),
    frequencyPriorPer1k: row.freq_prior_per_1k,
  });
}

function definedStats(stats: readonly (LeakStat | undefined)[]): LeakStat[] {
  return stats.flatMap((stat) => (stat === undefined ? [] : [stat]));
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

interface UserWeek {
  userId: string;
  rows: readonly StoredRow[];
  week: string;
  weekEnd: Date;
  now: Date;
}

/** One user's refresh and snapshot: three statements (see the module doc). */
async function snapshotUser(transaction: Database, request: UserWeek): Promise<void> {
  const groups = await decisionGroups(transaction, request.userId, { cutoff: request.weekEnd });
  const inWeek = groups.filter((group) => group.beforeCutoff);
  await upsertLeakStats(transaction, request.userId, definedStats(request.rows.map((row) => statOver(groups, row))), request.now);
  await writeWeek(transaction, request.userId, request.week, definedStats(request.rows.map((row) => statOver(inWeek, row))));
}

/** Recomputes every leak_stat row and writes the week's leak_history rows (see the module doc). */
export async function snapshotLeakWeek(transaction: Database, request: { week: string; now: Date; timeZone: string }): Promise<void> {
  const stored = await transaction
    .selectFrom("leak_stat")
    .select(["user_id", "spot_class_key", "freq_prior_per_1k"])
    .orderBy("user_id")
    .orderBy("spot_class_key")
    .execute();
  const byUser = new Map<string, StoredRow[]>();
  for (const row of stored) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }
  const weekEnd = weekEndOf(request.week, request.timeZone);
  for (const [userId, rows] of byUser) {
    await snapshotUser(transaction, { userId, rows, week: request.week, weekEnd, now: request.now });
  }
}

export async function leakHistoryHandler(context: JobContext): Promise<void> {
  await snapshotLeakWeek(context.transaction, { week: context.job.periodKey, now: context.now, timeZone: context.timeZone });
}

export const LEAK_HISTORY_JOB: JobDefinition = {
  kind: LEAK_HISTORY_KIND,
  nextPeriod: leakHistoryPeriod,
  handler: leakHistoryHandler,
};
