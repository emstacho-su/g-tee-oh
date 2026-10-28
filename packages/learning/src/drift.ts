/**
 * Range drift (S27, R3.18, O-304, 05 section 9): how far the user's choices in one node family
 * (Rust's spot_class_key) sit from the solver's strategy on the same decisions, by action kind.
 *
 * Mechanism:
 * - Each decision carries the kind the user chose, the node's action kinds in record order and the
 *   solver's frequency per action (both from solver-query, stored on the attempt row; ADR 0004:
 *   Rust names the kinds and gives the frequencies, nothing here recomputes a poker number).
 * - The user's share of a kind is the count of decisions that chose it over n. The solver's share
 *   of a kind is the mean over decisions of the summed frequency of that kind's actions (two raise
 *   sizes add up into one raise share).
 * - The distance is the total variation distance: half the sum over kinds of the absolute
 *   difference between the two shares, from 0 (same mix) to 1 (disjoint mixes).
 * - The interval is a percentile bootstrap over decisions: 1,000 resamples of n decisions drawn
 *   with replacement by a SplitMix64 generator at a fixed seed (so the same decisions always give
 *   the same interval), cut at the 2.5 and 97.5 percentiles. A plug-in distance is biased away
 *   from zero in resamples, so the percentile interval can miss a small point estimate; the bounds
 *   are widened to contain it, so the card never shows an estimate outside its own interval.
 * - Below 30 decisions the result is hidden and carries no numbers but the count.
 *
 * PM note 4 (O-304) accepts this as a statistic over the user's choices and Rust's stored
 * frequencies. It is never an input of grade(): drift is an insight only.
 */
import { ACTION_KINDS } from "./actions.js";
import { createSplitMix64, type SplitMix64 } from "./random.js";
import type { ActionKind } from "./types.js";
import { isList, requireNonNegative, requireOneOf } from "./validate.js";

/** Drift is hidden below this many decisions in the node family (O-304). */
export const DRIFT_MIN_DECISIONS = 30;
/** Two-sided confidence of the bootstrap interval (O-304). */
export const DRIFT_CONFIDENCE = 0.95;
/** Bootstrap resamples per interval (O-304). */
export const DRIFT_BOOTSTRAP_RESAMPLES = 1000;
/** The fixed SplitMix64 seed of the bootstrap, so an interval is a function of its decisions (O-304). */
export const DRIFT_BOOTSTRAP_SEED = 0x5327_d81f_7a3c_0b44n;

/** Half of a total variation sum; also half of the tail mass outside the interval. */
const HALF = 0.5;

/** One graded decision: the chosen kind, the node's kinds in record order and the solver's frequencies. */
export interface DriftDecision {
  chosenKind: ActionKind;
  kinds: readonly ActionKind[];
  freqByAction: readonly number[];
}

/** The user's and the solver's share of one action kind. */
export interface DriftKindShare {
  kind: ActionKind;
  userShare: number;
  solverShare: number;
}

export interface HiddenDrift {
  shown: false;
  decisions: number;
}

export interface ShownDrift {
  shown: true;
  decisions: number;
  byKind: readonly DriftKindShare[];
  distance: number;
  ciLow: number;
  ciHigh: number;
  confidence: number;
}

export type DriftResult = HiddenDrift | ShownDrift;

/** One decision's contribution per kind index (ACTION_KINDS order): the chosen indicator and the solver mass. */
interface KindVector {
  chosen: number;
  solver: readonly number[];
}

function requireDecision(row: DriftDecision, index: number): DriftDecision {
  const field = `decisions[${index}]`;
  if (!isList(row.kinds) || !isList(row.freqByAction)) {
    throw new RangeError(`${field} must carry kinds and freqByAction lists`);
  }
  if (row.kinds.length !== row.freqByAction.length) {
    throw new RangeError(`${field} lists ${row.kinds.length} kinds but ${row.freqByAction.length} frequencies`);
  }
  row.kinds.forEach((kind, position) => requireOneOf(kind, ACTION_KINDS, `${field}.kinds[${position}]`));
  row.freqByAction.forEach((frequency, position) => requireNonNegative(frequency, `${field}.freqByAction[${position}]`));
  requireOneOf(row.chosenKind, row.kinds, `${field}.chosenKind`);
  return row;
}

function requireDecisions(decisions: readonly DriftDecision[]): readonly DriftDecision[] {
  if (!isList(decisions)) {
    throw new RangeError("decisions must be a list of graded decisions");
  }
  return decisions.map(requireDecision);
}

function kindVector(row: DriftDecision): KindVector {
  const solver = ACTION_KINDS.map((kind) =>
    row.freqByAction.reduce((sum, frequency, position) => (row.kinds[position] === kind ? sum + frequency : sum), 0),
  );
  return { chosen: ACTION_KINDS.indexOf(row.chosenKind), solver };
}

/** Kinds (as ACTION_KINDS indexes) that appear in any decision's actions, in the fixed order. */
function presentKinds(rows: readonly DriftDecision[]): readonly number[] {
  const present = new Set(rows.flatMap((row) => row.kinds));
  return ACTION_KINDS.flatMap((kind, index) => (present.has(kind) ? [index] : []));
}

/**
 * Per-kind sums over a set of decisions: how many chose each kind and the summed solver mass.
 * Indexes are ACTION_KINDS positions, valid by construction, hence the reads without a fallback.
 * The arrays are local accumulators filled in one pass, because the bootstrap tallies up to 2,000
 * decisions 1,000 times per request; nothing outside the tally sees them change.
 */
interface Tally {
  count: number;
  userCounts: Float64Array;
  solverSums: Float64Array;
}

function emptyTally(): Tally {
  return { count: 0, userCounts: new Float64Array(ACTION_KINDS.length), solverSums: new Float64Array(ACTION_KINDS.length) };
}

function addToTally(tally: Tally, vector: KindVector): void {
  tally.count += 1;
  tally.userCounts[vector.chosen] = (tally.userCounts[vector.chosen] as number) + 1;
  vector.solver.forEach((mass, kindIndex) => {
    tally.solverSums[kindIndex] = (tally.solverSums[kindIndex] as number) + mass;
  });
}

function sharesOfTally(tally: Tally, kinds: readonly number[]): readonly DriftKindShare[] {
  return kinds.map((kindIndex) => ({
    kind: ACTION_KINDS[kindIndex] as ActionKind,
    userShare: (tally.userCounts[kindIndex] as number) / tally.count,
    solverShare: (tally.solverSums[kindIndex] as number) / tally.count,
  }));
}

function sharesOf(vectors: readonly KindVector[], kinds: readonly number[]): readonly DriftKindShare[] {
  const tally = emptyTally();
  vectors.forEach((vector) => addToTally(tally, vector));
  return sharesOfTally(tally, kinds);
}

/** Each listed kind's user and solver share over the decisions (O-304); validates every row. */
export function driftKindShares(decisions: readonly DriftDecision[]): readonly DriftKindShare[] {
  const rows = requireDecisions(decisions);
  if (rows.length === 0) {
    return [];
  }
  return sharesOf(rows.map(kindVector), presentKinds(rows));
}

/** Half the summed absolute share differences: 0 for the same mix, 1 for disjoint mixes. */
export function totalVariationDistance(shares: readonly DriftKindShare[]): number {
  return HALF * shares.reduce((sum, share) => sum + Math.abs(share.userShare - share.solverShare), 0);
}

/** The distance of one resample: n decision indexes drawn with replacement. */
function resampleDistance(vectors: readonly KindVector[], kinds: readonly number[], random: SplitMix64): number {
  const tally = emptyTally();
  for (let draw = 0; draw < vectors.length; draw += 1) {
    addToTally(tally, vectors[Math.floor(random.nextUnit() * vectors.length)] as KindVector);
  }
  return totalVariationDistance(sharesOfTally(tally, kinds));
}

/** The 2.5 and 97.5 percentiles (nearest rank) of the sorted resample distances. */
function percentileBounds(sorted: readonly number[]): { low: number; high: number } {
  const tail = HALF * (1 - DRIFT_CONFIDENCE);
  const lowRank = Math.floor(tail * sorted.length);
  const highRank = Math.ceil((1 - tail) * sorted.length) - 1;
  return { low: sorted[lowRank] as number, high: sorted[highRank] as number };
}

function bootstrapInterval(vectors: readonly KindVector[], kinds: readonly number[], distance: number): { ciLow: number; ciHigh: number } {
  const random = createSplitMix64(DRIFT_BOOTSTRAP_SEED);
  const distances = Array.from({ length: DRIFT_BOOTSTRAP_RESAMPLES }, () => resampleDistance(vectors, kinds, random));
  const { low, high } = percentileBounds([...distances].sort((left, right) => left - right));
  return { ciLow: Math.min(low, distance), ciHigh: Math.max(high, distance) };
}

/** Range drift over one node family's decisions: hidden below 30, else shares, distance and interval (O-304). */
export function rangeDrift(decisions: readonly DriftDecision[]): DriftResult {
  const rows = requireDecisions(decisions);
  if (rows.length < DRIFT_MIN_DECISIONS) {
    return { shown: false, decisions: rows.length };
  }
  const vectors = rows.map(kindVector);
  const kinds = presentKinds(rows);
  const byKind = sharesOf(vectors, kinds);
  const distance = totalVariationDistance(byKind);
  return { shown: true, decisions: rows.length, byKind, distance, ...bootstrapInterval(vectors, kinds, distance), confidence: DRIFT_CONFIDENCE };
}
