/**
 * Item difficulty from solver features (A6 section 1 row "Item difficulty from features"; 06
 * section 3.2). Owner: S30 (p4/learning), closing R4.4: difficulty is non-increasing in the EV
 * (expected value) gap between the best and second-best action and in purity, with weights set
 * by hand in v1; items where every action is inside the noise floor carry no information about
 * skill and are excluded from rated play.
 *
 * Mechanism (O-250): v1 uses only what solver-query ships in its DifficultyFeatures, never
 * recomputing anything from the strategy (ADR 0004), and takes only the fields the formula reads:
 * the gap, purity and the all-within-floor flag. solver-query's n_actions and mixed are not inputs
 * here; a later formula that uses them adds them back. difficulty = DIFFICULTY_BASE + GAP_WEIGHT x gapHardness
 * + MIX_WEIGHT x mixHardness with gapHardness = 1 / (1 + evGapPctPot / GAP_SCALE_PCT_POT) and
 * mixHardness = min(1, 2 x (1 - purity)), so items span 1100 to 1900 around the new-track rating
 * of 1500. The item enters Glicko-2 as an opponent at that rating with ITEM_RD 0 (src/glicko2.ts).
 * Distance to the threshold card, reach, street, pot size and the cost of the most tempting wrong
 * action join when solver-query exposes them (v1.5). S22's grade() does not know the item, so the
 * exclusion is applied after it by withItemExclusion rather than inside grade().
 */
import { UNRATED_WEIGHT } from "./grading.js";
import type { GradeOutput } from "./types.js";
import { requireBoolean, requireNonNegative, requireUnitInterval } from "./validate.js";

/** The fields of solver-query's DifficultyFeatures the formula reads (ev_gap_pct_pot, purity, all_within_floor), in camelCase. */
export type DifficultyFeatures = Readonly<{
  evGapPctPot: number;
  purity: number;
  allWithinFloor: boolean;
}>;

/** An item's difficulty on the rating scale and whether it is excluded from rated play. */
export type ItemDifficulty = Readonly<{ difficulty: number; excluded: boolean }>;

/** Difficulty of the easiest possible item. O-250: a hand-set v1 weight, an owner-review item. */
export const DIFFICULTY_BASE = 1100;

/** Rating points a zero EV gap adds. O-250: a hand-set v1 weight, an owner-review item. */
export const GAP_WEIGHT = 400;

/** Rating points a fully mixed decision adds. O-250: a hand-set v1 weight, an owner-review item. */
export const MIX_WEIGHT = 400;

/**
 * The EV gap, in percent of the pot, at which gap hardness halves. O-250: a hand-set v1 weight,
 * an owner-review item.
 */
export const GAP_SCALE_PCT_POT = 2;

/**
 * Slope of mix hardness in (1 - purity): a 50/50 decision is fully mixed. O-250: a hand-set v1
 * weight, an owner-review item.
 */
export const MIX_SLOPE = 2;

/** Upper bound of each hardness term. */
const MAX_HARDNESS = 1;

function validateFeatures(features: DifficultyFeatures): void {
  requireNonNegative(features.evGapPctPot, "evGapPctPot");
  requireUnitInterval(features.purity, "purity");
  requireBoolean(features.allWithinFloor, "allWithinFloor");
}

/**
 * The item's difficulty and exclusion (O-250). Throws a RangeError naming the field on a negative
 * or non-finite gap, a purity outside [0, 1], or a flag that is not a boolean.
 */
export function itemDifficulty(features: DifficultyFeatures): ItemDifficulty {
  validateFeatures(features);
  const gapHardness = MAX_HARDNESS / (1 + features.evGapPctPot / GAP_SCALE_PCT_POT);
  const mixHardness = Math.min(MAX_HARDNESS, MIX_SLOPE * (1 - features.purity));
  return Object.freeze({
    difficulty: DIFFICULTY_BASE + GAP_WEIGHT * gapHardness + MIX_WEIGHT * mixHardness,
    excluded: features.allWithinFloor,
  });
}

/**
 * The graded output with the item's exclusion applied (06 section 3.2): an excluded item's output
 * is unrated with UNRATED_WEIGHT, any other passes through as a copy. Never mutates the output.
 */
export function withItemExclusion(output: GradeOutput, item: ItemDifficulty): GradeOutput {
  return requireBoolean(item.excluded, "excluded")
    ? { ...output, rated: false, weight: UNRATED_WEIGHT }
    : { ...output };
}
