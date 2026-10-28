/**
 * Job schedules (R4.11, O-275): every job kind names its next period, and ensureScheduled inserts
 * that period's app_job row once (`on conflict (kind, period_key) do nothing`), so any number of
 * workers and restarts schedule each period exactly once. The kinds and their handlers live in
 * jobs/registry.ts; the periods are the lanes' (leak_history_weekly and idle_session_close, Lane B;
 * holdout_round_monthly and holdout_draw, Lane C).
 */
import type { Database } from "../db.js";

/** One period of a job kind: its key (unique per kind) and when it becomes due. */
export interface JobPeriod {
  periodKey: string;
  runAt: Date;
}

export interface JobSchedule {
  kind: string;
  /** The period current at `now`, in `timeZone` (APP_TIME_ZONE, O-247). Pure. */
  nextPeriod(now: Date, timeZone: string): JobPeriod;
}

/** Inserts each schedule's period current at `now`; an existing row is left as it is. */
export async function ensureScheduled(
  database: Database,
  schedules: readonly JobSchedule[],
  now: Date,
  timeZone: string,
): Promise<void> {
  if (schedules.length === 0) {
    return;
  }
  const rows = schedules.map((schedule) => {
    const period = schedule.nextPeriod(now, timeZone);
    return { kind: schedule.kind, period_key: period.periodKey, run_at: period.runAt };
  });
  await database
    .insertInto("app_job")
    .values(rows)
    .onConflict((conflict) => conflict.columns(["kind", "period_key"]).doNothing())
    .execute();
}
