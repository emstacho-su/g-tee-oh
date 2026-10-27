/**
 * Queue selection (A6 section 1 row "Queue selection (due, leak priority, interleave rule)"; A6
 * section 3; 06 section 4). Owner: S30 (p4/learning), closing R4.9.
 *
 * Mechanism: services/api builds one QueueCandidate per spot class it can serve, with priority =
 * leak cost x overdue factor (queuePriority; the overdue factor is src/fsrs.ts overdueFactor,
 * O-254, and a never-practiced class takes its leak cost from the frequency prior, ADR 0013,
 * O-255). pickNext then applies the rules of O-256 in order:
 *   1. The interleave rule: only candidates whose action family differs from the last pick's are
 *      eligible. With one family only, the rule relaxes and every candidate is eligible.
 *   2. Hypercorrection (05 section 5, O-215): the first key of state.hypercorrection (most recent
 *      first) that is eligible is served next and leaves the list, whatever its priority. A miss in
 *      the family just played therefore waits exactly one pick. A key that is not on offer stays.
 *   3. Otherwise one eligible candidate is drawn with probability proportional to priority, with
 *      exactly one call of the injected RandomSource (A1 section 2); if every eligible priority is
 *      0 the draw is uniform.
 *   4. A first exposure is served as a worked example: panels visible and not rated (A6 section 3).
 *      Any other pick is eligible to be rated; grade() still applies the anti-farming rules.
 * recordAttempt files a confident miss at the front of the hypercorrection list through S22's
 * promoteConfidentMiss. Mastery is not an input: it gates nothing (ADR 0012). Every function
 * returns new frozen objects and never mutates its arguments.
 */
import { promoteConfidentMiss } from "./calibration.js";
import type { ConfidenceAttempt } from "./calibration.js";
import type { RandomSource } from "./types.js";
import { elementAt, isList, requireBoolean, requireNonNegative, requireStringList } from "./validate.js";

/** One spot class the queue may serve: its key, its action family, its priority, and whether it is new. */
export type QueueCandidate = Readonly<{
  spotClassKey: string;
  family: string;
  priority: number;
  firstExposure: boolean;
}>;

/** The picker's memory: the last pick's family and the pending confident misses, most recent first. */
export type QueueState = Readonly<{ lastFamily: string | null; hypercorrection: readonly string[] }>;

/** Why a class was picked: a pending confident miss, or the priority-weighted draw. */
export type QueuePickReason = "hypercorrection" | "priority";

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

/** Priority of a class: leak cost in bb per 1,000 hands times the overdue factor (A6 section 3). */
export function queuePriority(leakCostBbPer1000: number, overdueFactor: number): number {
  const leakCost = requireNonNegative(leakCostBbPer1000, "leakCostBbPer1000");
  return leakCost * requireNonNegative(overdueFactor, "overdueFactor");
}

/** The state before the first pick: no last family and no pending miss. */
export function emptyQueueState(): QueueState {
  return Object.freeze({ lastFamily: null, hypercorrection: Object.freeze([]) });
}

/** A non-empty string, or a RangeError naming the field. */
function requireKey(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${field} must be a non-empty string, got ${String(value)}`);
  }
  return value;
}

function requireState(state: QueueState): QueueState {
  if (state.lastFamily !== null) {
    requireKey(state.lastFamily, "state.lastFamily");
  }
  requireStringList(state.hypercorrection, "state.hypercorrection");
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

/** The state after one graded attempt: a confident miss moves its class to the front (O-215). */
export function recordAttempt(state: QueueState, spotClassKey: string, attempt: ConfidenceAttempt): QueueState {
  const valid = requireState(state);
  const key = requireKey(spotClassKey, "spotClassKey");
  const hypercorrection = promoteConfidentMiss(valid.hypercorrection, key, attempt, (entry) => entry);
  return Object.freeze({ lastFamily: valid.lastFamily, hypercorrection: Object.freeze(hypercorrection) });
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
 * over positive priorities only; the index is clamped so rounding can never step past the end.
 */
function drawByPriority(eligible: readonly QueueCandidate[], random: RandomSource): QueueCandidate {
  const draw = drawUnit(random);
  const positive = eligible.filter((candidate) => candidate.priority > 0);
  const pool = positive.length === 0 ? eligible : positive;
  const weights = pool.map((candidate) => (positive.length === 0 ? 1 : candidate.priority));
  const cumulative = weights.reduce<number[]>((sums, weight) => [...sums, (sums.at(-1) ?? 0) + weight], []);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = draw * total;
  const index = Math.min(cumulative.filter((sum) => sum <= target).length, pool.length - 1);
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
  const pendingKey = valid.hypercorrection.find((key) => eligible.some((candidate) => candidate.spotClassKey === key));
  const pending = eligible.find((candidate) => candidate.spotClassKey === pendingKey);
  const pick =
    pending === undefined ? pickOf(drawByPriority(eligible, random), "priority") : pickOf(pending, "hypercorrection");
  const servedKey = pending?.spotClassKey;
  const hypercorrection = valid.hypercorrection.filter((key) => key !== servedKey);
  return Object.freeze({
    pick,
    state: Object.freeze({ lastFamily: pick.family, hypercorrection: Object.freeze(hypercorrection) }),
  });
}
