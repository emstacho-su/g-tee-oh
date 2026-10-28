/**
 * The streak rules (R4.14, O-278, 06 section 8), pure: the same function runs when a rated decision
 * writes streak_day and when GET /progress/streak reads it, so the read always equals the write.
 *
 * Input: the user's rated decisions per local day (APP_TIME_ZONE, O-247) and today's date. Rules:
 * - a day counts once it holds STREAK_DAY_MINIMUM (5) rated decisions; today is in progress and is
 *   never a missed day;
 * - nothing is protected before the first counted day, nor after a break until a day counts again;
 * - a missed day inside a streak takes a freeze automatically while its Monday-start week has used
 *   fewer than FREEZES_PER_WEEK (2); a frozen day bridges the streak without adding to it;
 * - a missed day with no freeze left is repaired, and then counts, when the next REPAIR_WINDOW_DAYS
 *   (2) days together hold REPAIR_NEEDED (10) rated decisions (two minimum days); while that window
 *   is still open the day is repairable and the streak is not broken yet; once it closes short the
 *   streak breaks.
 * The walk is chronological, so freezes go to the earliest missed days of a week.
 */
import { STREAK_DAY_MINIMUM } from "../schemas/insights.js";
import { addDays, daysBetween, mondayOf } from "./calendar.js";

/** Freezes a Monday-start week may use (O-278). */
export const FREEZES_PER_WEEK = 2;
/** Days after a missed day that may repair it: 48 hours (O-278). */
export const REPAIR_WINDOW_DAYS = 2;
/** Rated decisions the repair window must hold: two minimum days (O-278). */
export const REPAIR_NEEDED = REPAIR_WINDOW_DAYS * STREAK_DAY_MINIMUM;

/** A missed day that can still be repaired, and how far the window has come. */
export interface Repairable {
  day: string;
  /** The local day whose midnight closes the window. */
  deadlineDay: string;
  progress: number;
  needed: number;
}

export interface StreakComputation {
  currentDays: number;
  longestDays: number;
  todayRated: number;
  freezesLeftThisWeek: number;
  /** Missed days a freeze covered, oldest first. */
  frozenDays: readonly string[];
  /** Missed days the next two days repaired, oldest first. */
  repairedDays: readonly string[];
  repairable: Repairable | null;
}

/** Rated decisions per local day (ISO date to count). */
export type DayCounts = ReadonlyMap<string, number>;

interface Walk {
  streak: number;
  longest: number;
  freezesByWeek: ReadonlyMap<string, number>;
  frozen: readonly string[];
  repaired: readonly string[];
  repairable: Repairable | null;
}

const EMPTY_WALK: Walk = { streak: 0, longest: 0, freezesByWeek: new Map(), frozen: [], repaired: [], repairable: null };

function countOn(counts: DayCounts, day: string): number {
  return counts.get(day) ?? 0;
}

function firstCountedDay(counts: DayCounts, today: string): string | undefined {
  return [...counts.entries()]
    .filter(([day, count]) => count >= STREAK_DAY_MINIMUM && day <= today)
    .map(([day]) => day)
    .sort()[0];
}

function repairProgress(counts: DayCounts, day: string, today: string): number {
  let progress = 0;
  for (let offset = 1; offset <= REPAIR_WINDOW_DAYS; offset += 1) {
    const next = addDays(day, offset);
    if (next <= today) {
      progress += countOn(counts, next);
    }
  }
  return progress;
}

function withStreak(walk: Walk, streak: number): Walk {
  return { ...walk, streak, longest: Math.max(walk.longest, streak) };
}

/** One missed day before today, inside a streak (see the module doc). */
function missedDay(walk: Walk, day: string, counts: DayCounts, today: string): Walk {
  const week = mondayOf(day);
  const used = walk.freezesByWeek.get(week) ?? 0;
  if (used < FREEZES_PER_WEEK) {
    return { ...walk, freezesByWeek: new Map([...walk.freezesByWeek, [week, used + 1]]), frozen: [...walk.frozen, day] };
  }
  const progress = repairProgress(counts, day, today);
  if (progress >= REPAIR_NEEDED) {
    return withStreak({ ...walk, repaired: [...walk.repaired, day] }, walk.streak + 1);
  }
  const deadlineDay = addDays(day, REPAIR_WINDOW_DAYS + 1);
  if (today < deadlineDay) {
    const repairable = walk.repairable ?? { day, deadlineDay, progress, needed: REPAIR_NEEDED };
    return { ...walk, repairable };
  }
  return { ...walk, streak: 0 };
}

function step(walk: Walk, day: string, counts: DayCounts, today: string): Walk {
  if (countOn(counts, day) >= STREAK_DAY_MINIMUM) {
    return withStreak(walk, walk.streak + 1);
  }
  if (day === today || walk.streak === 0) {
    return walk;
  }
  return missedDay(walk, day, counts, today);
}

/** The streak as of `today` from the rated decisions per day (see the module doc). */
export function computeStreak(counts: DayCounts, today: string): StreakComputation {
  const first = firstCountedDay(counts, today);
  let walk = EMPTY_WALK;
  if (first !== undefined) {
    const span = daysBetween(first, today);
    for (let offset = 0; offset <= span; offset += 1) {
      walk = step(walk, addDays(first, offset), counts, today);
    }
  }
  const usedThisWeek = walk.freezesByWeek.get(mondayOf(today)) ?? 0;
  return {
    currentDays: walk.streak,
    longestDays: walk.longest,
    todayRated: countOn(counts, today),
    freezesLeftThisWeek: FREEZES_PER_WEEK - usedThisWeek,
    frozenDays: walk.frozen,
    repairedDays: walk.repaired,
    repairable: walk.repairable,
  };
}
