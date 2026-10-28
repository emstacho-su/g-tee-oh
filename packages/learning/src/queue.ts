/**
 * Queue selection (A6 section 1 row "Queue selection (due, leak priority, interleave rule)"; A6
 * section 3; 06 section 4). Owner: S30 (p4/learning), closing R4.9.
 *
 * Mechanism: services/api builds one QueueCandidate per spot class it can serve, with priority =
 * max(leak cost, LEAK_COST_FLOOR_BB_PER_1000) x overdue factor (queuePriority; the overdue factor
 * is src/fsrs.ts overdueFactor, O-254, O-195, and a never-practiced class takes its leak cost from
 * the frequency prior, ADR 0013, O-255; the floor keeps every due class drawable, O-255). pickNext then applies the rules of O-256 in order:
 *   1. The interleave rule: only candidates whose action family differs from the last pick's are
 *      eligible. With one family only, the rule relaxes and every candidate is eligible.
 *   2. One eligible candidate is drawn with probability proportional to priority, with exactly one
 *      call of the injected RandomSource (A1 section 2); if every eligible priority is 0 the draw is
 *      uniform. (S30's hypercorrection step, which served a confident miss first, was retired with
 *      the confidence tap and R3.11, O-345.)
 *   3. A first exposure is served as a worked example: panels visible and not rated (A6 section 3).
 *      Any other pick is eligible to be rated; grade() still applies the anti-farming rules.
 * Mastery is not an input: it gates nothing (ADR 0012). Every function
 * returns new frozen objects and never mutates its arguments.
 */
import type { RandomSource } from "./types.js";
import { elementAt, isList, requireBoolean, requireKey, requireNonNegative } from "./validate.js";

/** One spot class the queue may serve: its key, its action family, its priority, and whether it is new. */
export type QueueCandidate = Readonly<{
  spotClassKey: string;
  family: string;
  priority: number;
  firstExposure: boolean;
}>;

/** The picker's memory: the last pick's family. */
export type QueueState = Readonly<{ lastFamily: string | null }>;

/** Why a class was picked: the priority-weighted draw, the only rule since O-345. */
export type QueuePickReason = "priority";

/** The served class and how to serve it; rated means eligible to be rated (A6 section 3). */
export type QueuePick = Readonly<{
  spotClassKey: string;
  family: string;
  firstExposure: boolean;
  panelsVisible: boolean;
  rated: boolean;
  reason: QueuePickReason;
}>;

/** One pick and the queue state after it. */
export type QueueStep = Readonly<{ pick: QueuePick; state: QueueState }>;

/**
 * The smallest leak cost a class counts with in its priority, in bb per 1,000 hands (O-255). A
 * class with no misses, or a never-practiced class in a track with no misses, has leak cost 0 and
 * would never be drawn while any positive priority exists, so it would miss its first exposure and
 * its reviews. 0.1 bb per 1,000 hands is one 1 bb mistake per 10,000 hands: at equal overdue
 * factors such a class is drawn about 1 time in 45 against the 4.5 bb worked row of 06 section 6,
 * enough to keep clean classes in rotation without crowding out real leaks. The floor scales with
 * the overdue factor, so a class that is not due (factor 0) still waits for its due time.
 */
export const LEAK_COST_FLOOR_BB_PER_1000 = 0.1;

/** Priority of a class: max(leak cost, the floor) in bb per 1,000 hands times the overdue factor (A6 section 3, O-255). */
export function queuePriority(leakCostBbPer1000: number, overdueFactor: number): number {
  const leakCost = requireNonNegative(leakCostBbPer1000, "leakCostBbPer1000");
  return Math.max(leakCost, LEAK_COST_FLOOR_BB_PER_1000) * requireNonNegative(overdueFactor, "overdueFactor");
}

/** The state before the first pick: no last family. */
export function emptyQueueState(): QueueState {
  return Object.freeze({ lastFamily: null });
}

function requireState(state: QueueState): QueueState {
  if (state.lastFamily !== null) {
    requireKey(state.lastFamily, "state.lastFamily");
  }
  return state;
}

function requireCandidates(candidates: readonly QueueCandidate[]): readonly QueueCandidate[] {
  if (!isList(candidates) || candidates.length === 0) {
    throw new RangeError("candidates must list at least one spot class");
  }
  const seen = new Set<string>();
  candidates.forEach((candidate, index) => {
    const key = requireKey(candidate.spotClassKey, `candidates[${index}].spotClassKey`);
    if (seen.has(key)) {
      throw new RangeError(`candidates[${index}].spotClassKey is a duplicate: ${key}`);
    }
    seen.add(key);
    requireKey(candidate.family, `candidates[${index}].family`);
    requireNonNegative(candidate.priority, `candidates[${index}].priority`);
    requireBoolean(candidate.firstExposure, `candidates[${index}].firstExposure`);
  });
  return candidates;
}

/** A draw of the injected RandomSource, checked to lie in [0, 1). */
function drawUnit(random: RandomSource): number {
  const draw = random();
  if (typeof draw !== "number" || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError(`random must return a number in [0, 1), got ${String(draw)}`);
  }
  return draw;
}

/**
 * One candidate drawn in proportion to priority with exactly one draw. The cumulative walk runs
 * over positive priorities only with a running total; a target past every earlier band falls in
 * the last one, so rounding can never step past the end.
 */
function drawByPriority(eligible: readonly QueueCandidate[], random: RandomSource): QueueCandidate {
  const draw = drawUnit(random);
  const positive = eligible.filter((candidate) => candidate.priority > 0);
  const pool = positive.length === 0 ? eligible : positive;
  const weights = pool.map((candidate) => (positive.length === 0 ? 1 : candidate.priority));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = draw * total;
  let runningTotal = 0;
  const found = weights.slice(0, -1).findIndex((weight) => {
    runningTotal += weight;
    return target < runningTotal;
  });
  const index = found === -1 ? pool.length - 1 : found;
  return elementAt(pool, index, "candidates");
}

function pickOf(candidate: QueueCandidate, reason: QueuePickReason): QueuePick {
  return Object.freeze({
    spotClassKey: candidate.spotClassKey,
    family: candidate.family,
    firstExposure: candidate.firstExposure,
    panelsVisible: candidate.firstExposure,
    rated: !candidate.firstExposure,
    reason,
  });
}

/** The next class to serve and the new state, under the rules of O-256 listed in the header. */
export function pickNext(
  state: QueueState,
  candidates: readonly QueueCandidate[],
  random: RandomSource,
): QueueStep {
  const valid = requireState(state);
  const offered = requireCandidates(candidates);
  const outsideLast = offered.filter((candidate) => candidate.family !== valid.lastFamily);
  const eligible = outsideLast.length === 0 ? offered : outsideLast;
  const pick = pickOf(drawByPriority(eligible, random), "priority");
  return Object.freeze({ pick, state: Object.freeze({ lastFamily: pick.family }) });
}
