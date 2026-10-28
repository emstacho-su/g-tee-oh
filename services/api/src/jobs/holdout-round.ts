/**
 * The monthly holdout round job (R4.13, O-276, O-277): on the 1st at 00:00 APP_TIME_ZONE it closes
 * every user's round of an earlier month that is still open, writing its per-track summaries with
 * the Goodhart flag (holdout/repository.ts closeRound), and opens that user's round of the new
 * month. A user's first holdout session of a month opens the round itself when the job has not
 * (sessions/modes/holdout.ts). Idempotent: a second run finds no open round of an earlier month,
 * and an existing round is never opened twice (unique user and month).
 */
import { closeRound, openRound, openRoundsBefore } from "../holdout/repository.js";
import { localDay, monthOf, startOfDay } from "../streaks/calendar.js";
import type { JobContext, JobDefinition } from "./registry.js";
import type { JobPeriod } from "./schedule.js";

/** registry.ts JOB_KINDS.holdoutRoundMonthly; spelled here because registry.ts imports this module. */
export const HOLDOUT_ROUND_KIND = "holdout_round_monthly";

/** The month current at `now`: its first day is the period key, and its local midnight the run time. */
export function holdoutRoundPeriod(now: Date, timeZone: string): JobPeriod {
  const month = monthOf(localDay(now, timeZone));
  return { periodKey: month, runAt: startOfDay(month, timeZone) };
}

/** Closes the earlier months' open rounds and opens the period's month for their users. */
export async function runHoldoutRounds(context: Pick<JobContext, "transaction" | "job" | "now">): Promise<void> {
  const month = context.job.periodKey;
  const open = await openRoundsBefore(context.transaction, month);
  for (const { userId, round } of open) {
    await closeRound(context.transaction, userId, round, context.now);
    await openRound(context.transaction, userId, month, context.now);
  }
}

export const HOLDOUT_ROUND_JOB: JobDefinition = {
  kind: HOLDOUT_ROUND_KIND,
  nextPeriod: holdoutRoundPeriod,
  handler: runHoldoutRounds,
};
