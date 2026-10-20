/**
 * R3.8 grading policy vectors (R0.11 red half; the green half is S22 on p3/grading-policy,
 * src/grading.ts).
 *
 * Rules (05 section 6, ADR 0008, ADR 0009): score = exp(-max(0, loss - floor) / tau) with tau
 * 4 percent of pot (proposed, tuned in Phase 4); the floor is max(0.2 percent of pot, the
 * solution's exploitability) and arrives from Rust already applied to nothing, so lossPctPot is
 * the raw loss and floorPctPot the floor (ADR 0004). Labels: Best when loss is at or below the
 * floor and the action is the hand's highest-frequency action or the RNG-selected one; Correct
 * when loss is at or below the floor and the action is in the mix; Inaccuracy above the floor and
 * under 1 percent; Mistake from 1 to 5 percent inclusive; Blunder above 5 percent. Rated only when
 * mode is automated, first attempt, no revealing panel, no noise flag, under the daily cap
 * (A6 section 4, 06 section 3.6, ADR 0011).
 *
 * Every vector uses one three-action node in passive-to-aggressive order [fold, call, raise] with
 * hand frequencies [0, 0.4, 0.6]: fold is out of the mix, call is in the mix, raise is the
 * highest-frequency action. One tick is 0.01 percent of pot, the display precision of EV loss.
 */
import { describe, expect, it } from "vitest";

import type { GradeInput, GradeLabel } from "../src/index.js";

export const GRADING_TAU_PCT_POT = 4;
export const GRADING_FLOOR_PCT_POT = 0.2;
export const GRADING_TICK_PCT_POT = 0.01;
export const GRADING_SCORE_TOLERANCE = 1e-8;

/** Label edges of 05 section 6.3: Inaccuracy below 1, Mistake from 1 to 5 inclusive, Blunder above 5. */
export const GRADING_LABEL_EDGES_PCT_POT = Object.freeze({ mistakeFrom: 1, blunderAbove: 5 });

/** Noise flag names of 05 section 9 (proposed spellings; S22 fixes them with the solver-query contract). */
export const NOISE_FLAGS = Object.freeze({
  closeEvMix: "close-ev-mix",
  suitMixing: "suit-mixing",
  rareLine: "rare-line",
});

export const ACTION_ORDER = Object.freeze(["fold", "call", "raise"]);
export const ACTION_INDEX = Object.freeze({ fold: 0, call: 1, raise: 2 });

/** A rated automated decision on the fixture node; every row below overrides fields of this one. */
export const BASE_GRADE_INPUT: GradeInput = {
  lossPctPot: 0,
  floorPctPot: GRADING_FLOOR_PCT_POT,
  freqByAction: [0, 0.4, 0.6],
  actionIndex: ACTION_INDEX.call,
  noiseFlags: [],
  mode: "automated",
  firstAttempt: true,
  panelsRevealed: false,
};

export type GradingVector = {
  name: string;
  input: GradeInput;
  expected: { label: GradeLabel; score: number };
};

/** Score and label at every threshold. Scores are exp(-max(0, loss - 0.2) / 4) to eight decimals. */
export const GRADING_THRESHOLD_ROWS: readonly GradingVector[] = Object.freeze([
  {
    name: "loss equal to the floor, in-mix action: Correct, score 1",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0.2 },
    expected: { label: "Correct", score: 1 },
  },
  {
    name: "loss equal to the floor, highest-frequency action: Best, score 1",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0.2, actionIndex: ACTION_INDEX.raise },
    expected: { label: "Best", score: 1 },
  },
  {
    name: "one tick above the floor: Inaccuracy, score 0.99750312",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0.21 },
    expected: { label: "Inaccuracy", score: 0.99750312 },
  },
  {
    name: "one tick under 1 percent: Inaccuracy, score 0.82078014",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0.99 },
    expected: { label: "Inaccuracy", score: 0.82078014 },
  },
  {
    name: "exactly 1 percent: Mistake, score 0.81873075",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 1 },
    expected: { label: "Mistake", score: 0.81873075 },
  },
  {
    name: "exactly 5 percent: Mistake, score 0.30119421",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 5 },
    expected: { label: "Mistake", score: 0.30119421 },
  },
  {
    name: "one tick above 5 percent: Blunder, score 0.30044217",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 5.01 },
    expected: { label: "Blunder", score: 0.30044217 },
  },
  {
    name: "12.5 percent: Blunder, score 0.04618963",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 12.5 },
    expected: { label: "Blunder", score: 0.04618963 },
  },
]);

/** The mixed hand (call 40, raise 60) inside and outside the floor. */
export const GRADING_MIXED_HAND_ROWS: readonly GradingVector[] = Object.freeze([
  {
    name: "mixed hand inside the floor: in-mix call with loss 0.05 is Correct, score 1",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0.05, actionIndex: ACTION_INDEX.call },
    expected: { label: "Correct", score: 1 },
  },
  {
    name: "mixed hand, highest-frequency action: raise with loss 0 is Best, score 1",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0, actionIndex: ACTION_INDEX.raise },
    expected: { label: "Best", score: 1 },
  },
  {
    name: "mixed hand outside the floor: in-mix call with loss 0.35 is Inaccuracy, score 0.96319442",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 0.35, actionIndex: ACTION_INDEX.call },
    expected: { label: "Inaccuracy", score: 0.96319442 },
  },
  {
    name: "out-of-mix fold with loss 2.3 is Mistake, score 0.59155536",
    input: { ...BASE_GRADE_INPUT, lossPctPot: 2.3, actionIndex: ACTION_INDEX.fold },
    expected: { label: "Mistake", score: 0.59155536 },
  },
]);

export type RatedVector = {
  name: string;
  input: GradeInput;
  expected: { rated: boolean; weight: number };
};

/** The rated flag per 06 section 3.6 and A6 section 4. Weight 1 when rated and 0 when not (v1 proposal; v2 adds visibility weights). */
export const GRADING_RATED_ROWS: readonly RatedVector[] = Object.freeze([
  {
    name: "automated, first attempt, panels hidden, no noise flags: rated, weight 1",
    input: { ...BASE_GRADE_INPUT },
    expected: { rated: true, weight: 1 },
  },
  {
    name: "drill mode is never rated",
    input: { ...BASE_GRADE_INPUT, mode: "drill" },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "holdout retest is unrated",
    input: { ...BASE_GRADE_INPUT, mode: "holdout" },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "prediction drill is unrated",
    input: { ...BASE_GRADE_INPUT, mode: "prediction" },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "repeat attempt is unrated",
    input: { ...BASE_GRADE_INPUT, firstAttempt: false },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "revealing panels open: unrated",
    input: { ...BASE_GRADE_INPUT, panelsRevealed: true },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "noise flag close-ev-mix: unrated",
    input: { ...BASE_GRADE_INPUT, noiseFlags: [NOISE_FLAGS.closeEvMix] },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "noise flag rare-line: unrated",
    input: { ...BASE_GRADE_INPUT, noiseFlags: [NOISE_FLAGS.rareLine] },
    expected: { rated: false, weight: 0 },
  },
]);

/** RNG mode (05 section 7, ADR 0009): bands call 1 to 40 and raise 41 to 100; the roll-selected action is Best. */
export const GRADING_RNG_ROWS: readonly GradingVector[] = Object.freeze([
  {
    name: "roll 37 selects call (band 1 to 40): call with loss 0 is Best",
    input: { ...BASE_GRADE_INPUT, rngRoll: 37, actionIndex: ACTION_INDEX.call },
    expected: { label: "Best", score: 1 },
  },
  {
    name: "roll 41 selects raise (band 41 to 100): raise with loss 0 is Best",
    input: { ...BASE_GRADE_INPUT, rngRoll: 41, actionIndex: ACTION_INDEX.raise },
    expected: { label: "Best", score: 1 },
  },
  {
    name: "roll 41 selects raise: call chosen with loss 0 is Correct, not Best",
    input: { ...BASE_GRADE_INPUT, rngRoll: 41, actionIndex: ACTION_INDEX.call },
    expected: { label: "Correct", score: 1 },
  },
  {
    name: "roll 40 selects call: raise chosen with loss 0 is Correct, not Best",
    input: { ...BASE_GRADE_INPUT, rngRoll: 40, actionIndex: ACTION_INDEX.raise },
    expected: { label: "Correct", score: 1 },
  },
]);

const ALL_SCORE_ROWS = [...GRADING_THRESHOLD_ROWS, ...GRADING_MIXED_HAND_ROWS, ...GRADING_RNG_ROWS];

describe("R3.8 grading policy (S22, ADR 0008, ADR 0009)", () => {
  it("R0.11 grading vector data parses and every expected score follows exp(-max(0, loss - floor) / tau)", () => {
    expect(GRADING_TAU_PCT_POT).toBe(4);
    expect(GRADING_FLOOR_PCT_POT).toBe(0.2);
    expect(BASE_GRADE_INPUT.freqByAction.reduce((sum, f) => sum + f, 0)).toBeCloseTo(1, 9);
    for (const row of ALL_SCORE_ROWS) {
      const excess = Math.max(0, row.input.lossPctPot - row.input.floorPctPot);
      const formula = Math.exp(-excess / GRADING_TAU_PCT_POT);
      expect(Math.abs(formula - row.expected.score)).toBeLessThan(GRADING_SCORE_TOLERANCE);
    }
    const labels = GRADING_THRESHOLD_ROWS.map((row) => row.expected.label);
    expect(labels).toEqual([
      "Correct",
      "Best",
      "Inaccuracy",
      "Inaccuracy",
      "Mistake",
      "Mistake",
      "Blunder",
      "Blunder",
    ]);
    expect(GRADING_RATED_ROWS.filter((row) => row.expected.rated)).toHaveLength(1);
  });

  it.todo(
    "R3.8 floor boundary: EV loss equal to the floor (0.2 percent of pot) on an in-mix action is Correct with score 1",
  );
  it.todo("R3.8 floor boundary: one tick above the floor (0.21) is Inaccuracy with score 0.99750312");
  it.todo(
    "R3.8 label thresholds: 0.99 Inaccuracy, 1.0 Mistake, 5.0 Mistake, 5.01 Blunder, 12.5 Blunder with the scores of GRADING_THRESHOLD_ROWS",
  );
  it.todo("R3.8 Best requires loss at or below the floor and the highest-frequency action (05 section 6.3)");
  it.todo("R3.8 mixed hand inside the floor: the in-mix call with loss 0.05 is Correct, score 1");
  it.todo(
    "R3.8 mixed hand outside the floor: the in-mix call with loss 0.35 is Inaccuracy, score 0.96319442, because labels follow EV loss not frequency",
  );
  it.todo("R3.8 out-of-mix fold with loss 2.3 is Mistake, score 0.59155536");
  it.todo("R3.8 score is 1 for every loss at or below the floor, including loss 0");
  it.todo(
    "R3.8 rated flag: automated, first attempt, panels hidden, no noise flags gives rated true and weight 1; each other row of GRADING_RATED_ROWS gives rated false",
  );
  it.todo(
    "R3.8 rated flag under the daily cap: the 151st rated decision of a track in one day is unrated (GradeInput carries no cap field in A6 section 4; S22 adds one or leaves the cap to services/api, see README)",
  );
  it.todo("R3.8 RNG mode: the roll-selected action is Best and the other in-mix action is Correct (ADR 0009)");
  it.todo(
    "R3.8 grouping modes: Standard grades the exact size and Grouped grades the bucket mapped in Rust (R2.3), never recomputed here (ADR 0004)",
  );
  it.todo(
    "R3.8 Simple grouping grades the action type by its best size: raise 2.5x at loss 0.6 and raise 3x at loss 0 grade a Simple raise at loss 0, Best (05 section 6.4 rule 3)",
  );
  it.todo(
    "R3.8 fast-check: score is monotone non-increasing in loss and equals 1 at or below the floor (S22 adds fast-check as a devDependency)",
  );
  it.todo("R3.8 grade returns a new GradeOutput and never mutates the GradeInput");
});
