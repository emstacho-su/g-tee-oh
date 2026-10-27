/**
 * Grading policy: score, label, rated flag and weight of one graded decision (A6 section 1 row
 * "Score, label, rated flag, weight"; A6 section 4). S22 (p3/grading-policy), closing R3.8 and,
 * with src/rng-bands.ts, the mapping part of R3.10.
 *
 * Mechanism: grade validates its input once, at the boundary, then works on trusted values. The
 * chosen action's group is found under the grouping mode and the node's street (src/grouping.ts);
 * the group grades at its lowest-loss member, whose raw loss in percent of the pot came from Rust
 * (ADR 0004, O-210). The score is exp(-max(0, loss - floor) / tau). The label compares the raw loss
 * with the floor first: at or below it the decision is Best when its group's summed frequency is
 * the hand's highest within FREQUENCY_TIE_TOLERANCE (every tied group counts) or, in RNG mode, when
 * its group holds the roll-selected action, and Correct otherwise, whatever the frequency (ADR 0008,
 * ADR 0009, O-212); above the floor the loss alone decides Inaccuracy (under 1), Mistake (1 to 5
 * inclusive) or Blunder (above 5). The decision is rated only when every anti-farming rule of 06
 * section 3.6 holds, and a rated decision weighs 1 (v2 adds profile visibility weights, ADR 0010).
 * The bucket and the floor are inputs, never recomputed here (ADR 0004, O-150).
 */
import { requireActions } from "./actions.js";
import { bestMemberOf, exactKeys, groupFrequencies, groupKeys } from "./grouping.js";
import { RNG_ROLL_MAX, RNG_ROLL_MIN, rollSelectedAction } from "./rng-bands.js";
import type { GradeInput, GradeLabel, GradeMode, GradeOutput, Grouping, Street } from "./types.js";
import {
  elementAt,
  requireBoolean,
  requireCount,
  requireFrequencies,
  requireIntegerInRange,
  requireNonNegative,
  requireOneOf,
  requireStringList,
} from "./validate.js";

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

/** The grouping mode when the input names none (05 section 4: standard grades exact tree sizes). */
export const DEFAULT_GROUPING: Grouping = "standard";

/**
 * Summed group frequencies this close count as tied for the top: above the rounding of f32
 * frequencies summed in a double (0.1 + 0.2 against 0.3), far below any real frequency gap.
 */
export const FREQUENCY_TIE_TOLERANCE = 1e-6;

/** The only mode that is rated (06 section 3.6 rule 1). */
const RATED_MODE: GradeMode = "automated";

const GRADE_MODES: readonly GradeMode[] = ["automated", "drill", "holdout", "prediction"];
const GROUPINGS: readonly Grouping[] = ["standard", "grouped", "simple"];
const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

/**
 * A validated input: the grouping resolved once, and in RNG mode the record index of the
 * roll-selected action (undefined when RNG mode is off).
 */
type CheckedInput = GradeInput & { grouping: Grouping; rollSelected: number | undefined };

function scoreOf(lossPctPot: number, floorPctPot: number): number {
  return Math.exp(-Math.max(0, lossPctPot - floorPctPot) / GRADING_TAU_PCT_POT);
}

/** score = exp(-max(0, loss - floor) / tau), in (0, 1]; a RangeError on a negative or non-finite input. */
export function scoreFor(lossPctPot: number, floorPctPot: number): number {
  return scoreOf(requireNonNegative(lossPctPot, "lossPctPot"), requireNonNegative(floorPctPot, "floorPctPot"));
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

function validateRatingFields(input: GradeInput): void {
  requireOneOf(input.mode, GRADE_MODES, "mode");
  requireBoolean(input.firstAttempt, "firstAttempt");
  requireBoolean(input.panelsRevealed, "panelsRevealed");
  requireStringList(input.noiseFlags, "noiseFlags");
  requireCount(input.ratedTodayInTrack, "ratedTodayInTrack");
}

function ratedOf(input: GradeInput): boolean {
  return (
    input.mode === RATED_MODE &&
    input.firstAttempt &&
    !input.panelsRevealed &&
    input.noiseFlags.length === 0 &&
    input.ratedTodayInTrack < DAILY_RATED_CAP
  );
}

/**
 * Whether the decision moves the rating (A6 section 4, 06 section 3.6): automated mode, first
 * attempt, no revealing panel, no noise flag, and fewer than DAILY_RATED_CAP rated decisions
 * already counted today in the track (O-214). Every field it reads is validated first, so a
 * malformed input throws a RangeError whatever the other fields say.
 */
export function isRated(input: GradeInput): boolean {
  validateRatingFields(input);
  return ratedOf(input);
}

/**
 * Checks the actions list against the modes that need it and the chosen loss, and returns the
 * roll-selected action in RNG mode (undefined otherwise).
 */
function validateActions(input: GradeInput, grouping: Grouping): number | undefined {
  if (input.actions === undefined) {
    if (grouping !== DEFAULT_GROUPING || input.rngRoll !== undefined) {
      throw new RangeError("Grouped, Simple and RNG mode need the actions list with a loss per action (O-210, O-213)");
    }
    return undefined;
  }
  const actions = requireActions(input.actions, input.freqByAction.length);
  const chosen = elementAt(actions, input.actionIndex, "actions");
  if (chosen.lossPctPot !== input.lossPctPot) {
    throw new RangeError(
      `lossPctPot ${input.lossPctPot} differs from actions[${input.actionIndex}].lossPctPot ${chosen.lossPctPot}`,
    );
  }
  return input.rngRoll === undefined ? undefined : rollSelectedAction(input.freqByAction, actions, input.rngRoll);
}

function validateInput(input: GradeInput): CheckedInput {
  requireNonNegative(input.lossPctPot, "lossPctPot");
  requireNonNegative(input.floorPctPot, "floorPctPot");
  requireFrequencies(input.freqByAction, "freqByAction");
  requireIntegerInRange(input.actionIndex, 0, input.freqByAction.length - 1, "actionIndex");
  if (input.rngRoll !== undefined) {
    requireIntegerInRange(input.rngRoll, RNG_ROLL_MIN, RNG_ROLL_MAX, "rngRoll");
  }
  requireOneOf(input.street, STREETS, "street");
  const grouping = requireOneOf(input.grouping ?? DEFAULT_GROUPING, GROUPINGS, "grouping");
  validateRatingFields(input);
  const rollSelected = validateActions(input, grouping);
  return { ...input, grouping, rollSelected };
}

/** One group key per action: record indices when no actions list is given (Standard only). */
function keysOf(input: CheckedInput): string[] {
  return input.actions === undefined
    ? exactKeys(input.freqByAction.length)
    : groupKeys(input.actions, input.grouping, input.street);
}

/** Best rule: the roll-selected action's group in RNG mode, else every group at the top summed frequency. */
function isBestGroup(input: CheckedInput, keys: readonly string[]): boolean {
  const chosenKey = elementAt(keys, input.actionIndex, "keys");
  if (input.rollSelected !== undefined) {
    return keys[input.rollSelected] === chosenKey;
  }
  const totals = groupFrequencies(keys, input.freqByAction);
  const top = Math.max(...totals.values());
  return top - (totals.get(chosenKey) ?? 0) <= FREQUENCY_TIE_TOLERANCE;
}

/** The action the decision grades at and its loss: the chosen action, or its group's lowest-loss member. */
function gradedAction(input: CheckedInput, keys: readonly string[]): { index: number; lossPctPot: number } {
  if (input.actions === undefined) {
    return { index: input.actionIndex, lossPctPot: input.lossPctPot };
  }
  const index = bestMemberOf(keys, input.actions, input.actionIndex);
  return { index, lossPctPot: elementAt(input.actions, index, "actions").lossPctPot };
}

/**
 * Grades one decision (R3.8). Pure: returns a new GradeOutput and never mutates the input.
 * Throws a RangeError on malformed input (a negative or non-finite loss or floor, a frequency list
 * with no played action, an index, roll or street out of range, a malformed rating field, a
 * Grouped, Simple or RNG input without its actions list, or an actions list that disagrees with
 * lossPctPot).
 */
export function grade(input: GradeInput): GradeOutput {
  const checked = validateInput(input);
  const keys = keysOf(checked);
  const graded = gradedAction(checked, keys);
  const rated = ratedOf(checked);
  return {
    score: scoreOf(graded.lossPctPot, checked.floorPctPot),
    label: labelFor(graded.lossPctPot, checked.floorPctPot, isBestGroup(checked, keys)),
    rated,
    weight: rated ? RATED_WEIGHT : UNRATED_WEIGHT,
    gradedActionIndex: graded.index,
  };
}
