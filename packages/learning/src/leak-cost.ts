/**
 * Leak cost and shrinkage (A6 section 1 row "Leak cost and shrinkage"; 06 section 6). Owner: S30
 * (p4/learning), closing R4.8.
 *
 * leak_cost(spot_class) = frequency (spots per 1,000 hands) x miss rate (share of decisions above
 * the noise floor) x average EV (expected value) loss per miss in big blinds (bb), giving bb lost
 * per 1,000 hands. It ranks where money leaks rather than where mistakes are most common.
 *
 * Frequency is the equilibrium reach prior (ADR 0013): 1,000 x seat share (1 / table size, the
 * seat rotation) x the reach probability of the line under equilibrium play. The reach is a
 * solver-query number passed in, never computed here (ADR 0004). Personal frequency from hand
 * capture replaces the prior in v2, so freqPersonalPer1k is always null for now.
 *
 * A miss is a decision above the noise floor, any label other than Best or Correct (src/labels.ts
 * isCorrectLabel). Miss rate and EV per miss are shrunk toward the track average while a class has
 * under 30 decisions (06 section 6) with weight min(1, n / 30) on the class; a class with no misses
 * takes the track EV per miss (O-257). A never-practiced class starts at prior x track miss rate x
 * track EV per miss, or prior x 1 bb when the track has no decisions either (O-255).
 *
 * The rows match the A4 leak_stat and leak_history columns in camelCase. services/api owns the
 * week boundary and the write (R4.11); this module only shapes the rows and never reads a clock.
 */
import { isCorrectLabel } from "./labels.js";
import type { GradeLabel } from "./types.js";
import {
  elementAt,
  requireCount,
  requireIntegerInRange,
  requireKey,
  requireList,
  requireNonNegative,
  requireRecord,
  requireUnitInterval,
} from "./validate.js";

/** Leak cost is stated per this many hands (06 section 6). */
export const HANDS_PER_UNIT = 1000;

/** Classes with fewer decisions than this are shrunk toward the track average (06 section 6). */
export const SHRINKAGE_MIN_DECISIONS = 30;

/** Smallest and largest table the seat rotation share covers (ADR 0013: heads-up to full ring). */
const MIN_TABLE_SIZE = 2;
const MAX_TABLE_SIZE = 10;

/** EV loss per spot assumed when neither the class nor its track has decisions (O-255). */
const NO_HISTORY_EV_PER_SPOT_BB = 1;

/** The leak_history week as supplied by services/api: a calendar date YYYY-MM-DD (A4). */
const WEEK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1;
const MONTHS_IN_YEAR = 12;
const FEBRUARY = 2;
const FEBRUARY_LEAP_YEAR_DAYS = 29;
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** One graded trainer decision of a spot class: its label and its EV loss in bb. */
export type LeakDecision = Readonly<{ label: GradeLabel; evLossBb: number }>;

/** Raw stat of one class: decisions, misses, miss rate and mean EV loss over misses. */
export type ClassStat = Readonly<{ n: number; misses: number; missRate: number; evPerMissBb: number }>;

/** The track average the shrinkage pulls toward. */
export type TrackAverage = Readonly<{ missRate: number; evPerMissBb: number }>;

/** The shrunk values and the weight the class itself received (O-257). */
export type ShrunkStat = Readonly<TrackAverage & { weightOnClass: number }>;

/** Inputs of the leak cost product. */
export type LeakCostInput = Readonly<{ frequencyPer1000: number; missRate: number; evPerMissBb: number }>;

/** One A4 leak_stat row in camelCase; n is the raw decision count, the rates are shrunk. */
export type LeakStat = Readonly<{
  spotClassKey: string;
  freqPriorPer1k: number;
  freqPersonalPer1k: null;
  n: number;
  missRate: number;
  evPerMissBb: number;
  leakCostBbPer1k: number;
}>;

/** One A4 leak_history row in camelCase. */
export type LeakHistoryRow = Readonly<{ spotClassKey: string; week: string; leakCostBbPer1k: number }>;

function requireTrack(track: TrackAverage, field: string): TrackAverage {
  requireRecord(track, field);
  requireUnitInterval(track.missRate, `${field}.missRate`);
  requireNonNegative(track.evPerMissBb, `${field}.evPerMissBb`);
  return track;
}

function requireClassStat(stat: ClassStat, field: string): ClassStat {
  requireRecord(stat, field);
  const n = requireCount(stat.n, `${field}.n`);
  requireIntegerInRange(stat.misses, 0, n, `${field}.misses`);
  requireUnitInterval(stat.missRate, `${field}.missRate`);
  requireNonNegative(stat.evPerMissBb, `${field}.evPerMissBb`);
  return stat;
}

function requireLeakStat(stat: LeakStat, field: string): LeakStat {
  requireRecord(stat, field);
  requireKey(stat.spotClassKey, `${field}.spotClassKey`);
  requireNonNegative(stat.leakCostBbPer1k, `${field}.leakCostBbPer1k`);
  return stat;
}

function requireLeakStats(stats: readonly LeakStat[], field: string): readonly LeakStat[] {
  requireList(stats, field);
  stats.forEach((stat, index) => requireLeakStat(stat, `${field}[${index}]`));
  return stats;
}

/** True when the decision is above the noise floor; the label error names the decision's field. */
function isMiss(decision: LeakDecision, field: string): boolean {
  requireRecord(decision, field);
  requireNonNegative(decision.evLossBb, `${field}.evLossBb`);
  try {
    return !isCorrectLabel(decision.label);
  } catch (error: unknown) {
    // isCorrectLabel only throws the RangeError of requireOneOf, whose message starts with "label".
    throw new RangeError(`${field}.${(error as RangeError).message}`);
  }
}

/** Spots per 1,000 hands from the equilibrium reach prior: 1,000 x (1 / tableSize) x reach (ADR 0013). */
export function frequencyPriorPer1000(tableSize: number, reachProbability: number): number {
  const seats = requireIntegerInRange(tableSize, MIN_TABLE_SIZE, MAX_TABLE_SIZE, "tableSize");
  const reach = requireUnitInterval(reachProbability, "reachProbability");
  return HANDS_PER_UNIT * (1 / seats) * reach;
}

/** Raw stat of a class; with no decisions or no misses the missing ratio is 0 (shrinkage fills it). */
export function classStat(decisions: readonly LeakDecision[]): ClassStat {
  requireList(decisions, "decisions");
  const misses = decisions.filter((decision, index) => isMiss(decision, `decisions[${index}]`));
  const n = decisions.length;
  const lossOverMisses = misses.reduce((sum, decision) => sum + decision.evLossBb, 0);
  return {
    n,
    misses: misses.length,
    missRate: n === 0 ? 0 : misses.length / n,
    evPerMissBb: misses.length === 0 ? 0 : lossOverMisses / misses.length,
  };
}

/**
 * Pooled track average: total misses over total decisions, EV per miss weighted by misses. null
 * when the track has no decisions at all, so a caller cannot mistake an empty track for one with a
 * zero miss rate: startingLeakCost reads null as "no history" (O-255).
 */
export function trackAverage(stats: readonly ClassStat[]): TrackAverage | null {
  requireList(stats, "stats");
  stats.forEach((stat, index) => requireClassStat(stat, `stats[${index}]`));
  const decisions = stats.reduce((sum, stat) => sum + stat.n, 0);
  const misses = stats.reduce((sum, stat) => sum + stat.misses, 0);
  const loss = stats.reduce((sum, stat) => sum + stat.misses * stat.evPerMissBb, 0);
  if (decisions === 0) {
    return null;
  }
  return {
    missRate: misses / decisions,
    evPerMissBb: misses === 0 ? 0 : loss / misses,
  };
}

/** Shrinks a class toward its track with weight min(1, n / 30) on the class (06 section 6, O-257). */
export function shrinkTowardTrack(stat: ClassStat, track: TrackAverage): ShrunkStat {
  requireClassStat(stat, "classStat");
  requireTrack(track, "track");
  const weightOnClass = Math.min(1, stat.n / SHRINKAGE_MIN_DECISIONS);
  const blend = (own: number, pooled: number): number => weightOnClass * own + (1 - weightOnClass) * pooled;
  return {
    weightOnClass,
    missRate: blend(stat.missRate, track.missRate),
    evPerMissBb: stat.misses === 0 ? track.evPerMissBb : blend(stat.evPerMissBb, track.evPerMissBb),
  };
}

/** bb lost per 1,000 hands: frequency x miss rate x EV per miss (06 section 6). */
export function leakCost(input: LeakCostInput): number {
  requireRecord(input, "input");
  const frequency = requireNonNegative(input.frequencyPer1000, "frequencyPer1000");
  const missRate = requireUnitInterval(input.missRate, "missRate");
  const evPerMissBb = requireNonNegative(input.evPerMissBb, "evPerMissBb");
  return frequency * missRate * evPerMissBb;
}

/** The A4 leak_stat row of one class: shrunk rates, raw n and the leak cost. */
export function leakStat(
  spotClassKey: string,
  freqPriorPer1k: number,
  decisions: readonly LeakDecision[],
  track: TrackAverage,
): LeakStat {
  const key = requireKey(spotClassKey, "spotClassKey");
  const frequencyPer1000 = requireNonNegative(freqPriorPer1k, "freqPriorPer1k");
  const raw = classStat(decisions);
  const { missRate, evPerMissBb } = shrinkTowardTrack(raw, track);
  return {
    spotClassKey: key,
    freqPriorPer1k: frequencyPer1000,
    freqPersonalPer1k: null,
    n: raw.n,
    missRate,
    evPerMissBb,
    leakCostBbPer1k: leakCost({ frequencyPer1000, missRate, evPerMissBb }),
  };
}

/**
 * Leak cost of a never-practiced class (O-255): prior x track miss rate x track EV per miss, or
 * prior x 1 bb when the track has no decisions either, which trackAverage reports as null.
 */
export function startingLeakCost(freqPriorPer1k: number, track: TrackAverage | null): number {
  const frequency = requireNonNegative(freqPriorPer1k, "freqPriorPer1k");
  if (track === null) {
    return frequency * NO_HISTORY_EV_PER_SPOT_BB;
  }
  const checked = requireTrack(track, "track");
  return frequency * checked.missRate * checked.evPerMissBb;
}

function compareKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** A new list by leak cost descending, ties by spot class key ascending (code unit order). */
export function rankLeaks(stats: readonly LeakStat[]): LeakStat[] {
  requireLeakStats(stats, "stats");
  return [...stats].sort(
    (left, right) =>
      right.leakCostBbPer1k - left.leakCostBbPer1k || compareKeys(left.spotClassKey, right.spotClassKey),
  );
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === FEBRUARY && isLeapYear(year)
    ? FEBRUARY_LEAP_YEAR_DAYS
    : elementAt(DAYS_IN_MONTH, month - 1, "month");
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  return year >= MIN_YEAR && month >= 1 && month <= MONTHS_IN_YEAR && day >= 1 && day <= daysInMonth(year, month);
}

/** A YYYY-MM-DD string naming a real calendar date, checked by arithmetic alone (no clock). */
function requireWeek(week: string): string {
  const match = typeof week === "string" ? WEEK_PATTERN.exec(week) : null;
  if (match === null || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new RangeError(`week must be a calendar date YYYY-MM-DD, got ${String(week)}`);
  }
  return week;
}

/** A4 leak_history rows for the week services/api supplies, one per class (R4.11 writes them). */
export function leakHistorySnapshot(week: string, stats: readonly LeakStat[]): readonly LeakHistoryRow[] {
  const checkedWeek = requireWeek(week);
  requireLeakStats(stats, "stats");
  const seen = new Set<string>();
  stats.forEach((stat, index) => {
    if (seen.has(stat.spotClassKey)) {
      throw new RangeError(`stats[${index}].spotClassKey must be unique in one week, got ${stat.spotClassKey} twice`);
    }
    seen.add(stat.spotClassKey);
  });
  return stats.map((stat) => ({
    spotClassKey: stat.spotClassKey,
    week: checkedWeek,
    leakCostBbPer1k: stat.leakCostBbPer1k,
  }));
}
