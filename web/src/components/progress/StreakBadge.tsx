/**
 * The streak tile (S32, R4.12, R4.14, 06 section 8, O-278, O-279): the current and longest streak,
 * today's rated decisions against the day minimum, the freezes left this week, a missed day that
 * can still be repaired, and the next milestone.
 *
 * Not a chart (dataviz form pass): a stat tile. The day meter is a native <meter> with its numbers
 * in text beside it, so the count never rests on the bar alone. The wording is neutral: no guilt
 * and no urgency (06 section 8); a repairable day states what repairs it and by when: the api's
 * last_day, the last day in its time zone (APP_TIME_ZONE) on which the repair counts, so the date
 * never depends on the UTC date of the deadline's instant or on the browser's zone. Cosmetic
 * names come from the caller's describeCosmetic (the catalog, O-279); the key is shown otherwise.
 */
import type { ReactNode } from "react";

import { formatShortDate } from "../../progress/format.js";
import type { ProgressStreak } from "../../progress/types.js";
import { ProgressCard } from "./ProgressCard.js";

export interface StreakBadgeProps {
  streak: ProgressStreak;
  describeCosmetic?: (cosmeticKey: string) => string;
  footer?: ReactNode;
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

export function StreakBadge({ streak, describeCosmetic = (key) => key, footer }: StreakBadgeProps) {
  const todayDone = streak.today_rated >= streak.day_minimum;
  return (
    <ProgressCard title="Streak" testId="streak-badge">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums" data-testid="streak-current">
          {days(streak.current_days)}
        </span>
        <span className="text-sm text-muted">Longest {days(streak.longest_days)}</span>
      </p>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm">
          <span>Today</span>
          <meter min={0} max={streak.day_minimum} value={Math.min(streak.today_rated, streak.day_minimum)} className="h-3 w-32" />
          <span className="tabular-nums" data-testid="streak-today">
            {streak.today_rated} of {streak.day_minimum} rated decisions{todayDone ? " (day counted)" : ""}
          </span>
        </label>
        <p className="text-sm text-muted">Freezes left this week: {streak.freezes_left_this_week}</p>
      </div>
      {streak.repairable === null ? null : (
        <p className="text-sm" data-testid="streak-repair">
          The day {formatShortDate(streak.repairable.day)} can still count: {streak.repairable.progress} of {streak.repairable.needed} rated
          decisions by the end of {formatShortDate(streak.repairable.last_day)}.
        </p>
      )}
      {streak.next_milestone === null ? null : (
        <p className="text-sm text-muted" data-testid="streak-next">
          Next: {days(streak.next_milestone.days)} unlocks {describeCosmetic(streak.next_milestone.cosmetic_key)}.
        </p>
      )}
      {footer}
    </ProgressCard>
  );
}
