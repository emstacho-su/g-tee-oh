/**
 * The leak-cost trend (R4.12, O-275, 06 sections 6 and 7.1), pure: the top TOP_LEAKS spot classes
 * by current leak cost, each with its weekly series.
 *
 * Mechanism: the weeks are the Mondays (O-278's Monday-start week) of the requested span, oldest
 * first, ending with the current week. Past weeks read leak_history (written by the weekly job,
 * week = that week's Monday; a week with no row is null); the current week is partial and shows the
 * live leak_stat value. Ranking is learning's rankLeaks (cost descending, ties by key). Only classes
 * the catalog still lists are shown: their family and track come from solver-query's catalog (the
 * api never parses a class key, ADR 0004), and a line on the chart opens a drill, which needs
 * coverage (06 section 7.1).
 */
import { rankLeaks, type LeakStat } from "@g-tee-oh/learning";
import type { z } from "zod";

import type { TrackKey } from "../learning/tracks.js";
import { TOP_LEAKS, type leaksSchema } from "../schemas/insights.js";
import { addDays, mondayOf } from "../streaks/calendar.js";

export type Leaks = z.infer<typeof leaksSchema>;

const DAYS_PER_WEEK = 7;

/** One leak_stat row as the view reads it. */
export interface LeakStatRow {
  spotClassKey: string;
  freqPriorPer1k: number;
  n: number;
  missRate: number;
  evPerMissBb: number;
  leakCostBbPer1k: number;
}

/** One leak_history row; week is its Monday. */
export interface LeakHistoryEntry {
  spotClassKey: string;
  week: string;
  leakCostBbPer1k: number | null;
}

/** What the catalog says of a class; undefined when it no longer lists it. */
export interface LeakClassInfo {
  family: string;
  trackKey: TrackKey | null;
}

/** The `count` Mondays ending with the week of `today`, oldest first. */
export function leakWeeks(today: string, count: number): string[] {
  const current = mondayOf(today);
  return Array.from({ length: count }, (_, index) => addDays(current, -DAYS_PER_WEEK * (count - 1 - index)));
}

function asLeakStat(row: LeakStatRow): LeakStat {
  return { ...row, freqPersonalPer1k: null };
}

function historyKey(spotClassKey: string, week: string): string {
  return `${week}|${spotClassKey}`;
}

/** The leak trend over `weeks` (see the module doc). */
export function leakTrend(
  stats: readonly LeakStatRow[],
  history: readonly LeakHistoryEntry[],
  weeks: readonly string[],
  infoOf: (spotClassKey: string) => LeakClassInfo | undefined,
): Leaks {
  const byWeek = new Map(history.map((entry) => [historyKey(entry.spotClassKey, entry.week), entry.leakCostBbPer1k]));
  const currentWeek = weeks.at(-1);
  const ranked = rankLeaks(stats.map(asLeakStat)).flatMap((stat) => {
    const info = infoOf(stat.spotClassKey);
    return info === undefined ? [] : [{ stat, info }];
  });
  const items = ranked.slice(0, TOP_LEAKS).map(({ stat, info }) => ({
    spot_class_key: stat.spotClassKey,
    family: info.family,
    track_key: info.trackKey,
    leak_cost_bb_per_1k: stat.leakCostBbPer1k,
    series: weeks.map((week) =>
      week === currentWeek
        ? { week, leak_cost_bb_per_1k: stat.leakCostBbPer1k, partial: true }
        : { week, leak_cost_bb_per_1k: byWeek.get(historyKey(stat.spotClassKey, week)) ?? null, partial: false },
    ),
  }));
  return { weeks: [...weeks], items };
}
