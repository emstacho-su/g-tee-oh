/**
 * RNG (random number generator) mode band mapping (05 section 7, ADR 0009, R3.10 mapping part).
 *
 * Mechanism: before the hero acts, an integer roll from 1 to 100 is drawn from the injected
 * RandomSource. The hand's actions are put in passive-to-aggressive order by kind and size, from
 * the actions list, which is always required so grade() and the web roller (S25) can never order
 * the same node two ways (O-213); each played action owns a band of rolls as
 * wide as its frequency, and the roll selects the action whose band contains it. Bands are cut
 * once at each cumulative edge (O-213): the frequencies are normalized by their sum, each upper
 * edge is the cumulative percent rounded half up, the last edge is 100, and a band whose edges
 * coincide (an action under half a roll) selects nothing, so the bands always tile 1 to 100 with
 * no gap and no overlap. The chi-square statistic is the goodness-of-fit check of R3.10 (O-90).
 */
import { passiveToAggressiveOrder, requireActions } from "./actions.js";
import type { GradeAction, RandomSource } from "./types.js";
import { elementAt, requireFrequencies, requireIntegerInRange, requireNonNegative } from "./validate.js";

/** Smallest and largest roll of RNG mode (05 section 7). */
export const RNG_ROLL_MIN = 1;
export const RNG_ROLL_MAX = 100;

/** Rolls per band unit: a frequency of 1 spans every roll. */
const ROLLS_PER_UNIT = RNG_ROLL_MAX - RNG_ROLL_MIN + 1;

/**
 * Slack added before rounding a cumulative edge, so a binary fraction that lands a hair under a
 * half (0.405 x 100 = 40.4999...) still rounds up as the decimal frequency says (O-213).
 */
const EDGE_ROUNDING_SLACK = 1e-9;

/** One action's band of rolls, inclusive at both ends; actionIndex is the record index. */
export type RngBand = { actionIndex: number; from: number; to: number };

function cumulativeEdge(cumulativeShare: number): number {
  return Math.min(RNG_ROLL_MAX, Math.floor(cumulativeShare * ROLLS_PER_UNIT + 0.5 + EDGE_ROUNDING_SLACK));
}

/**
 * The bands of a hand's frequencies, in the passive-to-aggressive order of the node's actions
 * (kind, then size). Throws a RangeError on an empty or all-zero frequency list, a negative
 * frequency, or a missing actions list or one of another length (O-213).
 */
export function rngBands(freqByAction: readonly number[], actions: readonly GradeAction[]): RngBand[] {
  const total = requireFrequencies(freqByAction, "freqByAction");
  const order = passiveToAggressiveOrder(requireActions(actions, freqByAction.length));
  const played = order.filter((index) => elementAt(freqByAction, index, "freqByAction") > 0);
  const lastPlayed = played.at(-1);
  const bands: RngBand[] = [];
  let cumulative = 0;
  let previousEdge = RNG_ROLL_MIN - 1;
  for (const index of played) {
    cumulative += elementAt(freqByAction, index, "freqByAction");
    const edge = index === lastPlayed ? RNG_ROLL_MAX : cumulativeEdge(cumulative / total);
    if (edge > previousEdge) {
      bands.push({ actionIndex: index, from: previousEdge + 1, to: edge });
      previousEdge = edge;
    }
  }
  return bands;
}

/** The record index of the action whose band contains the roll; a RangeError for a roll outside 1 to 100. */
export function actionForRoll(bands: readonly RngBand[], roll: number): number {
  requireIntegerInRange(roll, RNG_ROLL_MIN, RNG_ROLL_MAX, "roll");
  const band = bands.find((candidate) => roll >= candidate.from && roll <= candidate.to);
  if (band === undefined) {
    throw new RangeError(`no band contains roll ${roll}; bands must tile ${RNG_ROLL_MIN} to ${RNG_ROLL_MAX}`);
  }
  return band.actionIndex;
}

/**
 * The record index of the action a roll selects for a hand: the bands of its frequencies over the
 * node's actions, then the band containing the roll. This is the one entry for RNG mode: grade()
 * labels this action Best, and the web roller (S25) must call it too, so both always agree.
 */
export function rollSelectedAction(
  freqByAction: readonly number[],
  actions: readonly GradeAction[],
  roll: number,
): number {
  return actionForRoll(rngBands(freqByAction, actions), roll);
}

/** One integer roll from 1 to 100 drawn from the injected source; a RangeError if the source leaves [0, 1). */
export function rollFrom(random: RandomSource): number {
  const unit = random();
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) {
    throw new RangeError(`the random source must return a number in [0, 1), got ${unit}`);
  }
  return Math.floor(unit * ROLLS_PER_UNIT) + RNG_ROLL_MIN;
}

/**
 * Pearson's chi-square statistic, the sum of (observed - expected)^2 / expected over the cells
 * with a positive expectation. A cell expected empty must be observed empty; a RangeError
 * otherwise, and for lists of different lengths or negative counts.
 */
export function chiSquareStatistic(observed: readonly number[], expected: readonly number[]): number {
  if (observed.length !== expected.length) {
    throw new RangeError(`observed and expected differ in length: ${observed.length} and ${expected.length}`);
  }
  return observed.reduce((statistic, count, index) => {
    requireNonNegative(count, `observed[${index}]`);
    const expectation = requireNonNegative(expected[index] ?? Number.NaN, `expected[${index}]`);
    if (expectation === 0) {
      if (count > 0) {
        throw new RangeError(`cell ${index} was expected empty but observed ${count}`);
      }
      return statistic;
    }
    return statistic + (count - expectation) ** 2 / expectation;
  }, 0);
}
