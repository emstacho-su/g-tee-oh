/**
 * Grading policy: score, label, rated flag and weight of one graded decision (A6 section 1 row
 * "Score, label, rated flag, weight"; A6 section 4). S22 (p3/grading-policy), closing R3.8 and,
 * with src/rng-bands.ts, the mapping part of R3.10.
 *
 * Mechanism: the chosen action's group is found under the grouping mode (src/grouping.ts); the
 * group grades at its lowest-loss member, whose raw loss in percent of the pot came from Rust
 * (ADR 0004, O-210). The score is exp(-max(0, loss - floor) / tau). The label compares the raw
 * loss with the floor first: at or below it the decision is Best when its group is the hand's
 * highest-frequency group (every tied group counts) or, in RNG mode, holds the roll-selected action,
 * and Correct otherwise, whatever the frequency (ADR 0008, ADR 0009, O-212); above the floor the
 * loss alone decides Inaccuracy (under 1), Mistake (1 to 5 inclusive) or Blunder (above 5). The
 * decision is rated only when every anti-farming rule of 06 section 3.6 holds, and a rated decision
 * weighs 1 (v2 adds profile visibility weights, ADR 0010). The bucket and the floor are inputs,
 * never recomputed here (ADR 0004, O-150).
 */
import { requireActions } from "./actions.js";
import { bestMemberOf, groupFrequencies, groupKeys } from "./grouping.js";
import { RNG_ROLL_MAX, RNG_ROLL_MIN, actionForRoll, rngBands } from "./rng-bands.js";
import type { GradeInput, GradeLabel, GradeMode, GradeOutput, Grouping } from "./types.js";
import { requireCount, requireFrequencies, requireIntegerInRange, requireNonNegative, requireOneOf } from "./validate.js";

/** tau of the score in percent of the pot (05 section 6.3, O-22); tuned in Phase 4 (R4.15, O-96). */
export const GRADING_TAU_PCT_POT = 4;

/** A loss at or above this, in percent of the pot, is at least a Mistake (05 section 6.3). */
export const MISTAKE_FROM_PCT_POT = 1;

/** A loss above this, in percent of the pot, is a Blunder (05 section 6.3). */
export const BLUNDER_ABOVE_PCT_POT = 5;

/** Rated decisions per track per day (06 section 3.6 rule 5, ADR 0011, O-56). */
export const DAILY_RATED_CAP = 150;

/** Rating weight of a rated and an unrated decision in v1 (A6 section 4; v2 adds visibility weights). */
export const RATED_WEIGHT = 1;
export const UNRATED_WEIGHT = 0;

/** The only mode that is rated (06 section 3.6 rule 1). */
const RATED_MODE: GradeMode = "automated";

const GRADE_MODES: readonly GradeMode[] = ["automated", "drill", "holdout", "prediction"];
const GROUPINGS: readonly Grouping[] = ["standard", "grouped", "simple"];

/** score = exp(-max(0, loss - floor) / tau), in (0, 1]; a RangeError on a negative or non-finite input. */
export function scoreFor(lossPctPot: number, floorPctPot: number): number {
  requireNonNegative(lossPctPot, "lossPctPot");
  requireNonNegative(floorPctPot, "floorPctPot");
  return Math.exp(-Math.max(0, lossPctPot - floorPctPot) / GRADING_TAU_PCT_POT);
}

function labelFor(lossPctPot: number, floorPctPot: number, isBest: boolean): GradeLabel {
  if (lossPctPot <= floorPctPot) {
    return isBest ? "Best" : "Correct";
  }
  if (lossPctPot < MISTAKE_FROM_PCT_POT) {
    return "Inaccuracy";
  }
  return lossPctPot <= BLUNDER_ABOVE_PCT_POT ? "Mistake" : "Blunder";
}

/**
 * Whether the decision moves the rating (A6 section 4, 06 section 3.6): automated mode, first
 * attempt, no revealing panel, no noise flag, and fewer than DAILY_RATED_CAP rated decisions
 * already counted today in the track (O-214).
 */
export function isRated(input: GradeInput): boolean {
  return (
    input.mode === RATED_MODE &&
    input.firstAttempt &&
    !input.panelsRevealed &&
    input.noiseFlags.length === 0 &&
    requireCount(input.ratedTodayInTrack, "ratedTodayInTrack") < DAILY_RATED_CAP
  );
}

function validateInput(input: GradeInput): void {
  requireNonNegative(input.lossPctPot, "lossPctPot");
  requireNonNegative(input.floorPctPot, "floorPctPot");
  requireFrequencies(input.freqByAction, "freqByAction");
  requireIntegerInRange(input.actionIndex, 0, input.freqByAction.length - 1, "actionIndex");
  if (input.rngRoll !== undefined) {
    requireIntegerInRange(input.rngRoll, RNG_ROLL_MIN, RNG_ROLL_MAX, "rngRoll");
  }
  requireOneOf(input.mode, GRADE_MODES, "mode");
  requireOneOf(input.grouping ?? "standard", GROUPINGS, "grouping");
  requireCount(input.ratedTodayInTrack, "ratedTodayInTrack");
  validateActions(input);
}

function validateActions(input: GradeInput): void {
  if (input.actions === undefined) {
    if ((input.grouping ?? "standard") !== "standard") {
      throw new RangeError(`grouping ${input.grouping} needs the actions list with a loss per action (O-210)`);
    }
    return;
  }
  const chosen = requireActions(input.actions, input.freqByAction.length)[input.actionIndex];
  if (chosen?.lossPctPot !== input.lossPctPot) {
    throw new RangeError(
      `lossPctPot ${input.lossPctPot} differs from actions[${input.actionIndex}].lossPctPot ${chosen?.lossPctPot}`,
    );
  }
}

/** One group key per action: record indices when no actions list is given (Standard only). */
function keysOf(input: GradeInput): string[] {
  return input.actions === undefined
    ? input.freqByAction.map((_, index) => String(index))
    : groupKeys(input.actions, input.grouping ?? "standard");
}

/** Best rule: the roll-selected action's group in RNG mode, else every group at the top summed frequency. */
function isBestGroup(input: GradeInput, keys: readonly string[]): boolean {
  const chosenKey = keys[input.actionIndex];
  if (input.rngRoll !== undefined) {
    const selected = actionForRoll(rngBands(input.freqByAction, input.actions), input.rngRoll);
    return keys[selected] === chosenKey;
  }
  const totals = groupFrequencies(keys, input.freqByAction);
  return totals.get(chosenKey ?? "") === Math.max(...totals.values());
}

/** The action the decision grades at and its loss: the chosen action, or its group's lowest-loss member. */
function gradedAction(input: GradeInput, keys: readonly string[]): { index: number; lossPctPot: number } {
  if (input.actions === undefined) {
    return { index: input.actionIndex, lossPctPot: input.lossPctPot };
  }
  const index = bestMemberOf(keys, input.actions, input.actionIndex);
  return { index, lossPctPot: input.actions[index]?.lossPctPot ?? input.lossPctPot };
}

/**
 * Grades one decision (R3.8). Pure: returns a new GradeOutput and never mutates the input.
 * Throws a RangeError on malformed input (a negative or non-finite loss or floor, a frequency list
 * with no played action, an index or roll out of range, a Grouped or Simple input without its
 * actions list, or an actions list that disagrees with lossPctPot).
 */
export function grade(input: GradeInput): GradeOutput {
  validateInput(input);
  const keys = keysOf(input);
  const graded = gradedAction(input, keys);
  const rated = isRated(input);
  return {
    score: scoreFor(graded.lossPctPot, input.floorPctPot),
    label: labelFor(graded.lossPctPot, input.floorPctPot, isBestGroup(input, keys)),
    rated,
    weight: rated ? RATED_WEIGHT : UNRATED_WEIGHT,
    gradedActionIndex: graded.index,
  };
}
