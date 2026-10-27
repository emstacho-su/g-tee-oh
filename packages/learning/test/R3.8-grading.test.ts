/**
 * R3.8 grading policy vectors (R0.11 red half from S05; the green half is S22 on
 * p3/grading-policy, src/grading.ts and src/grouping.ts).
 *
 * Rules (05 section 6, ADR 0008, ADR 0009): score = exp(-max(0, loss - floor) / tau) with tau
 * 4 percent of pot (O-22, O-96); lossPctPot is the raw loss and floorPctPot the floor, both from
 * Rust and never recomputed here (ADR 0004, O-150). Labels: Best when loss is at or below the
 * floor and the action is the hand's highest-frequency action or the RNG-selected one; Correct
 * when loss is at or below the floor otherwise (O-212); Inaccuracy above the floor and under
 * 1 percent; Mistake from 1 to 5 percent inclusive; Blunder above 5 percent. Rated only when
 * mode is automated, first attempt, no revealing panel, no noise flag, under the daily cap of
 * 150 per track (A6 section 4, 06 section 3.6, ADR 0011, O-56, O-214).
 *
 * Most vectors use one three-action node in passive-to-aggressive order [fold, call, raise] with
 * hand frequencies [0, 0.4, 0.6]: fold is out of the mix, call is in the mix, raise is the
 * highest-frequency action. One tick is 0.01 percent of pot, the display precision of EV loss.
 * The grouping vectors use a five-action node with two raise sizes and an all-in (O-210, O-211).
 */
import { describe, expect, it } from "vitest";

import {
  DAILY_RATED_CAP,
  FREQUENCY_TIE_TOLERANCE,
  GRADING_TAU_PCT_POT as POLICY_TAU_PCT_POT,
  grade,
  groupKeys,
  isRated,
  scoreFor,
} from "../src/index.js";
import type { GradeAction, GradeInput, GradeLabel } from "../src/index.js";

export const GRADING_TAU_PCT_POT = 4;
export const GRADING_FLOOR_PCT_POT = 0.2;
export const GRADING_TICK_PCT_POT = 0.01;
export const GRADING_SCORE_TOLERANCE = 1e-8;

/** Label edges of 05 section 6.3: Inaccuracy below 1, Mistake from 1 to 5 inclusive, Blunder above 5. */
export const GRADING_LABEL_EDGES_PCT_POT = Object.freeze({ mistakeFrom: 1, blunderAbove: 5 });

/** Noise flag names of 05 section 9, spelled as solver-query's NoiseFlag enum (O-153). */
export const NOISE_FLAGS = Object.freeze({
  closeEvMix: "close_ev_mix",
  suitMixing: "suit_mixing",
  rareLine: "rare_line",
});

export const ACTION_ORDER = Object.freeze(["fold", "call", "raise"]);
export const ACTION_INDEX = Object.freeze({ fold: 0, call: 1, raise: 2 });

/** A rated automated decision on the fixture node, a preflop node; every row below overrides fields of this one. */
export const BASE_GRADE_INPUT: GradeInput = {
  lossPctPot: 0,
  floorPctPot: GRADING_FLOOR_PCT_POT,
  freqByAction: [0, 0.4, 0.6],
  actionIndex: ACTION_INDEX.call,
  noiseFlags: [],
  mode: "automated",
  firstAttempt: true,
  panelsRevealed: false,
  ratedTodayInTrack: 0,
  street: "preflop",
};

/** The fixture node's tree actions in record order (fold, call, raise to 2.5bb), each at loss 0. */
export const BASE_NODE_ACTIONS: readonly GradeAction[] = Object.freeze([
  { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 0 },
  { kind: "call", bucket: null, sizeCbb: 100, lossPctPot: 0 },
  { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0 },
]);

/**
 * The input with the fixture node's actions list, the chosen action carrying the input's loss.
 * RNG mode needs the list, so the bands follow one order everywhere (O-213).
 */
export function withNodeActions(input: GradeInput): GradeInput {
  const actions = BASE_NODE_ACTIONS.map((action, index) =>
    index === input.actionIndex ? { ...action, lossPctPot: input.lossPctPot } : action,
  );
  return { ...input, actions };
}

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

/** The rated flag per 06 section 3.6 and A6 section 4. Weight 1 when rated and 0 when not (v1; v2 adds visibility weights). */
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
    name: "noise flag close_ev_mix: unrated",
    input: { ...BASE_GRADE_INPUT, noiseFlags: [NOISE_FLAGS.closeEvMix] },
    expected: { rated: false, weight: 0 },
  },
  {
    name: "noise flag rare_line: unrated",
    input: { ...BASE_GRADE_INPUT, noiseFlags: [NOISE_FLAGS.rareLine] },
    expected: { rated: false, weight: 0 },
  },
]);

/** The daily cap of 150 rated decisions per track (ADR 0011, O-56, O-214): ratedTodayInTrack counts those before this one. */
export const GRADING_DAILY_CAP_ROWS: readonly RatedVector[] = Object.freeze([
  {
    name: "149 rated today: the 150th is rated",
    input: { ...BASE_GRADE_INPUT, ratedTodayInTrack: 149 },
    expected: { rated: true, weight: 1 },
  },
  {
    name: "150 rated today: the 151st is unrated",
    input: { ...BASE_GRADE_INPUT, ratedTodayInTrack: 150 },
    expected: { rated: false, weight: 0 },
  },
]);

/** RNG mode (05 section 7, ADR 0009): bands call 1 to 40 and raise 41 to 100; the roll-selected action is Best. */
export const GRADING_RNG_ROWS: readonly GradingVector[] = Object.freeze([
  {
    name: "roll 37 selects call (band 1 to 40): call with loss 0 is Best",
    input: withNodeActions({ ...BASE_GRADE_INPUT, rngRoll: 37, actionIndex: ACTION_INDEX.call }),
    expected: { label: "Best", score: 1 },
  },
  {
    name: "roll 41 selects raise (band 41 to 100): raise with loss 0 is Best",
    input: withNodeActions({ ...BASE_GRADE_INPUT, rngRoll: 41, actionIndex: ACTION_INDEX.raise }),
    expected: { label: "Best", score: 1 },
  },
  {
    name: "roll 41 selects raise: call chosen with loss 0 is Correct, not Best",
    input: withNodeActions({ ...BASE_GRADE_INPUT, rngRoll: 41, actionIndex: ACTION_INDEX.call }),
    expected: { label: "Correct", score: 1 },
  },
  {
    name: "roll 40 selects call: raise chosen with loss 0 is Correct, not Best",
    input: withNodeActions({ ...BASE_GRADE_INPUT, rngRoll: 40, actionIndex: ACTION_INDEX.raise }),
    expected: { label: "Correct", score: 1 },
  },
]);

/**
 * The grouping node (O-210, O-211): fold, call, raise to 2.5bb, raise to 3bb and all-in, with
 * per-action losses as solver-query would report them. Frequencies 0, 0.2, 0.3, 0.45, 0.05: the
 * raise type sums to 0.8 and is the hand's top type in Simple mode.
 */
export const SIZED_NODE_ACTIONS: readonly GradeAction[] = Object.freeze([
  { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 3 },
  { kind: "call", bucket: null, sizeCbb: 100, lossPctPot: 0.1 },
  { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0.6 },
  { kind: "raise", bucket: "pot", sizeCbb: 300, lossPctPot: 0 },
  { kind: "all_in", bucket: "all-in", sizeCbb: 10000, lossPctPot: 1.4 },
]);
export const SIZED_NODE_FREQUENCIES = Object.freeze([0, 0.2, 0.3, 0.45, 0.05]);
export const SIZED_INDEX = Object.freeze({ fold: 0, call: 1, raise250: 2, raise300: 3, allIn: 4 });

function sizedInput(actionIndex: number, overrides: Partial<GradeInput> = {}): GradeInput {
  const action = SIZED_NODE_ACTIONS[actionIndex];
  if (action === undefined) {
    throw new Error(`no action ${actionIndex} on the sized node`);
  }
  return {
    ...BASE_GRADE_INPUT,
    freqByAction: [...SIZED_NODE_FREQUENCIES],
    actions: SIZED_NODE_ACTIONS,
    actionIndex,
    lossPctPot: action.lossPctPot,
    ...overrides,
  };
}

/**
 * The sized node with both raise sizes in one bucket. ADR 0020 keeps one size per bucket in a
 * simple postflop tree; preflop nodes may hold two, and Grouped shows them as exact sizes there
 * (R3.9, O-22), so this fixture merges postflop and stays split preflop.
 */
const TWO_SIZE_BUCKET_ACTIONS: readonly GradeAction[] = SIZED_NODE_ACTIONS.map((action) =>
  action.kind === "raise" ? { ...action, bucket: "medium" as const } : action,
);

const ALL_SCORE_ROWS = [...GRADING_THRESHOLD_ROWS, ...GRADING_MIXED_HAND_ROWS, ...GRADING_RNG_ROWS];

function expectGraded(row: GradingVector): void {
  const output = grade(row.input);
  expect(output.label, row.name).toBe(row.expected.label);
  expect(Math.abs(output.score - row.expected.score), row.name).toBeLessThan(GRADING_SCORE_TOLERANCE);
}

function rowNamed(rows: readonly GradingVector[], prefix: string): GradingVector {
  const row = rows.find((candidate) => candidate.name.startsWith(prefix));
  if (row === undefined) {
    throw new Error(`no row starts with ${prefix}`);
  }
  return row;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

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

  it("R3.8 tau is the named constant 4 percent of pot (O-22, O-96) and the daily cap is 150 (O-56)", () => {
    expect(POLICY_TAU_PCT_POT).toBe(GRADING_TAU_PCT_POT);
    expect(DAILY_RATED_CAP).toBe(150);
  });

  it("R3.8 floor boundary: EV loss equal to the floor (0.2 percent of pot) on an in-mix action is Correct with score 1", () => {
    expectGraded(rowNamed(GRADING_THRESHOLD_ROWS, "loss equal to the floor, in-mix"));
  });

  it("R3.8 floor boundary: one tick above the floor (0.21) is Inaccuracy with score 0.99750312", () => {
    expectGraded(rowNamed(GRADING_THRESHOLD_ROWS, "one tick above the floor"));
  });

  it("R3.8 label thresholds: 0.99 Inaccuracy, 1.0 Mistake, 5.0 Mistake, 5.01 Blunder, 12.5 Blunder with the scores of GRADING_THRESHOLD_ROWS", () => {
    for (const row of GRADING_THRESHOLD_ROWS) {
      expectGraded(row);
    }
  });

  it("R3.8 label edges hold one tick either side of 1 and 5 percent of pot", () => {
    const { mistakeFrom, blunderAbove } = GRADING_LABEL_EDGES_PCT_POT;
    const at = (loss: number): GradeLabel => grade({ ...BASE_GRADE_INPUT, lossPctPot: loss }).label;
    expect(at(mistakeFrom - GRADING_TICK_PCT_POT)).toBe("Inaccuracy");
    expect(at(mistakeFrom)).toBe("Mistake");
    expect(at(mistakeFrom + GRADING_TICK_PCT_POT)).toBe("Mistake");
    expect(at(blunderAbove - GRADING_TICK_PCT_POT)).toBe("Mistake");
    expect(at(blunderAbove)).toBe("Mistake");
    expect(at(blunderAbove + GRADING_TICK_PCT_POT)).toBe("Blunder");
  });

  it("R3.8 Best requires loss at or below the floor and the highest-frequency action (05 section 6.3)", () => {
    expectGraded(rowNamed(GRADING_THRESHOLD_ROWS, "loss equal to the floor, highest-frequency"));
    const raiseAboveFloor = grade({ ...BASE_GRADE_INPUT, lossPctPot: 0.21, actionIndex: ACTION_INDEX.raise });
    expect(raiseAboveFloor.label).toBe("Inaccuracy");
  });

  it("R3.8 every action tied for the highest frequency is Best (O-212)", () => {
    const tied = { ...BASE_GRADE_INPUT, freqByAction: [0, 0.5, 0.5] };
    expect(grade({ ...tied, actionIndex: ACTION_INDEX.call }).label).toBe("Best");
    expect(grade({ ...tied, actionIndex: ACTION_INDEX.raise }).label).toBe("Best");
  });

  it("R3.8 an out-of-mix action within the floor is Correct, because labels follow EV loss (O-212, ADR 0008)", () => {
    const output = grade({ ...BASE_GRADE_INPUT, lossPctPot: 0.1, actionIndex: ACTION_INDEX.fold });
    expect(output.label).toBe("Correct");
    expect(output.score).toBe(1);
  });

  it("R3.8 mixed hand inside the floor: the in-mix call with loss 0.05 is Correct, score 1", () => {
    expectGraded(rowNamed(GRADING_MIXED_HAND_ROWS, "mixed hand inside the floor"));
    expectGraded(rowNamed(GRADING_MIXED_HAND_ROWS, "mixed hand, highest-frequency"));
  });

  it("R3.8 mixed hand outside the floor: the in-mix call with loss 0.35 is Inaccuracy, score 0.96319442, because labels follow EV loss not frequency", () => {
    expectGraded(rowNamed(GRADING_MIXED_HAND_ROWS, "mixed hand outside the floor"));
  });

  it("R3.8 out-of-mix fold with loss 2.3 is Mistake, score 0.59155536", () => {
    expectGraded(rowNamed(GRADING_MIXED_HAND_ROWS, "out-of-mix fold"));
  });

  it("R3.8 score is 1 for every loss at or below the floor, including loss 0", () => {
    for (const loss of [0, 0.05, 0.1, 0.19, 0.2]) {
      expect(scoreFor(loss, GRADING_FLOOR_PCT_POT)).toBe(1);
      expect(grade({ ...BASE_GRADE_INPUT, lossPctPot: loss }).score).toBe(1);
    }
  });

  it("R3.8 a floor above 1 percent of pot keeps losses under it Correct and moves the first loss above it straight to Mistake", () => {
    const wideFloor = { ...BASE_GRADE_INPUT, floorPctPot: 1.5 };
    expect(grade({ ...wideFloor, lossPctPot: 1.2 }).label).toBe("Correct");
    expect(grade({ ...wideFloor, lossPctPot: 1.6 }).label).toBe("Mistake");
  });

  it("R3.8 rated flag: automated, first attempt, panels hidden, no noise flags gives rated true and weight 1; each other row of GRADING_RATED_ROWS gives rated false", () => {
    for (const row of GRADING_RATED_ROWS) {
      const output = grade(row.input);
      expect({ rated: output.rated, weight: output.weight }, row.name).toEqual(row.expected);
    }
  });

  it("R3.8 rated flag under the daily cap: the 151st rated decision of a track in one day is unrated (O-214)", () => {
    for (const row of GRADING_DAILY_CAP_ROWS) {
      const output = grade(row.input);
      expect({ rated: output.rated, weight: output.weight }, row.name).toEqual(row.expected);
    }
  });

  it("R3.8 the rated flag never changes the score or the label", () => {
    const rated = grade({ ...BASE_GRADE_INPUT, lossPctPot: 2.3 });
    const unrated = grade({ ...BASE_GRADE_INPUT, lossPctPot: 2.3, mode: "drill" });
    expect(unrated.score).toBe(rated.score);
    expect(unrated.label).toBe(rated.label);
  });

  it("R3.8 RNG mode: the roll-selected action is Best and the other in-mix action is Correct (ADR 0009)", () => {
    for (const row of GRADING_RNG_ROWS) {
      expectGraded(row);
    }
  });

  it("R3.8 RNG mode: the roll-selected action above the floor is labelled by its loss", () => {
    const input = withNodeActions({ ...BASE_GRADE_INPUT, rngRoll: 37, lossPctPot: 1.5, actionIndex: ACTION_INDEX.call });
    expect(grade(input).label).toBe("Mistake");
  });

  it("R3.8 RNG mode needs the actions list, so the bands follow one order everywhere (O-213)", () => {
    expect(() => grade({ ...BASE_GRADE_INPUT, rngRoll: 37 })).toThrow(RangeError);
  });

  it("R3.8 grouping modes: Standard grades the exact size and Grouped grades the bucket mapped in Rust (R2.3), never recomputed here (ADR 0004)", () => {
    const standard = grade(sizedInput(SIZED_INDEX.raise250));
    expect(standard.label).toBe("Inaccuracy");
    expect(standard.score).toBeCloseTo(Math.exp(-0.4 / GRADING_TAU_PCT_POT), 12);
    expect(standard.gradedActionIndex).toBe(SIZED_INDEX.raise250);

    const grouped = grade(sizedInput(SIZED_INDEX.raise250, { grouping: "grouped" }));
    expect(grouped).toEqual(standard);

    const postflopBucket = grade(
      sizedInput(SIZED_INDEX.raise250, { grouping: "grouped", actions: TWO_SIZE_BUCKET_ACTIONS, street: "flop" }),
    );
    expect(postflopBucket.label, "postflop Grouped grades the bucket at its best size").toBe("Best");
    expect(postflopBucket.gradedActionIndex).toBe(SIZED_INDEX.raise300);
  });

  it("R3.8 Grouped on a preflop node grades the exact size, as Standard does: two raise sizes in one bucket never merge (R3.9, O-22, O-211)", () => {
    const preflopInput = sizedInput(SIZED_INDEX.raise250, { actions: TWO_SIZE_BUCKET_ACTIONS, street: "preflop" });
    const standard = grade(preflopInput);
    const grouped = grade({ ...preflopInput, grouping: "grouped" });
    expect(grouped).toEqual(standard);
    expect(grouped.label).toBe("Inaccuracy");
    expect(grouped.gradedActionIndex).toBe(SIZED_INDEX.raise250);
  });

  it("R3.8 Best ties use FREQUENCY_TIE_TOLERANCE: a call at 0.3 ties a Simple raise type summing 0.1 + 0.2", () => {
    expect(FREQUENCY_TIE_TOLERANCE).toBe(1e-6);
    expect(0.1 + 0.2).not.toBe(0.3);
    const actions: GradeAction[] = [
      { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 2 },
      { kind: "call", bucket: null, sizeCbb: 100, lossPctPot: 0 },
      { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0.1 },
      { kind: "raise", bucket: "pot", sizeCbb: 300, lossPctPot: 0 },
    ];
    const input: GradeInput = {
      ...BASE_GRADE_INPUT,
      grouping: "simple",
      freqByAction: [0, 0.3, 0.1, 0.2],
      actions,
      actionIndex: 1,
      lossPctPot: 0,
    };
    expect(grade(input).label).toBe("Best");
    expect(grade({ ...input, actionIndex: 3 }).label).toBe("Best");
  });

  it("R3.8 Simple grouping grades the action type by its best size: raise 2.5x at loss 0.6 and raise 3x at loss 0 grade a Simple raise at loss 0, Best (05 section 6.4 rule 3)", () => {
    const output = grade(sizedInput(SIZED_INDEX.raise250, { grouping: "simple" }));
    expect(output).toEqual({ score: 1, label: "Best", rated: true, weight: 1, gradedActionIndex: SIZED_INDEX.raise300 });
  });

  it("R3.8 Simple grouping: all-in joins the node's raise type, and the call is Correct beside the top raise type (O-211)", () => {
    const allIn = grade(sizedInput(SIZED_INDEX.allIn, { grouping: "simple" }));
    expect(allIn.label).toBe("Best");
    expect(allIn.gradedActionIndex).toBe(SIZED_INDEX.raise300);
    const call = grade(sizedInput(SIZED_INDEX.call, { grouping: "simple" }));
    expect(call.label).toBe("Correct");
    expect(call.gradedActionIndex).toBe(SIZED_INDEX.call);
  });

  it("R3.8 Simple grouping in RNG mode: a roll on either raise size makes the raise type Best (O-211)", () => {
    const rollOnRaise250 = grade(sizedInput(SIZED_INDEX.raise300, { grouping: "simple", rngRoll: 30 }));
    expect(rollOnRaise250.label).toBe("Best");
    const rollOnCall = grade(sizedInput(SIZED_INDEX.raise300, { grouping: "simple", rngRoll: 15 }));
    expect(rollOnCall.label).toBe("Correct");
  });

  it("R3.8 group keys: limp joins call, all-in joins bet or raise or stands alone, straddle stands alone; Grouped keys by bucket postflop and by exact action preflop (O-211)", () => {
    const action = (kind: GradeAction["kind"], sizeCbb = 0): GradeAction => ({
      kind,
      bucket: null,
      sizeCbb,
      lossPctPot: 0,
    });
    expect(groupKeys([action("fold"), action("limp"), action("raise", 400)], "simple", "preflop")).toEqual([
      "fold",
      "call",
      "raise",
    ]);
    expect(groupKeys([action("check"), action("bet", 300), action("all_in", 9000)], "simple", "flop")).toEqual([
      "check",
      "bet",
      "bet",
    ]);
    expect(groupKeys([action("fold"), action("call"), action("all_in", 9000)], "simple", "river")).toEqual([
      "fold",
      "call",
      "all_in",
    ]);
    expect(groupKeys([action("straddle", 200)], "simple", "preflop")).toEqual(["straddle"]);
    expect(groupKeys(SIZED_NODE_ACTIONS, "grouped", "turn")).toEqual([
      "fold/none",
      "call/none",
      "raise/medium",
      "raise/pot",
      "all_in/all-in",
    ]);
    const exact = ["0", "1", "2", "3", "4"];
    expect(groupKeys(SIZED_NODE_ACTIONS, "grouped", "preflop")).toEqual(exact);
    expect(groupKeys(SIZED_NODE_ACTIONS, "standard", "flop")).toEqual(exact);
  });

  it("R3.8 Grouped and Simple need the actions list with a loss per action (O-210)", () => {
    expect(() => grade({ ...BASE_GRADE_INPUT, grouping: "simple" })).toThrow(RangeError);
    expect(() => grade({ ...BASE_GRADE_INPUT, grouping: "grouped" })).toThrow(RangeError);
  });

  it("R3.8 isRated validates every field up front, as grade does, whatever the short-circuit order", () => {
    const bad: Partial<GradeInput>[] = [
      { mode: "drill", ratedTodayInTrack: -1 },
      { firstAttempt: false, mode: "bogus" as GradeInput["mode"] },
      { panelsRevealed: true, ratedTodayInTrack: 1.5 },
      { noiseFlags: ["rare_line"], firstAttempt: "yes" as unknown as boolean },
      { mode: "drill", panelsRevealed: undefined as unknown as boolean },
      { mode: "drill", noiseFlags: "rare_line" as unknown as string[] },
    ];
    for (const overrides of bad) {
      expect(() => isRated({ ...BASE_GRADE_INPUT, ...overrides }), JSON.stringify(overrides)).toThrow(RangeError);
    }
    expect(isRated(BASE_GRADE_INPUT)).toBe(true);
  });

  it("R3.8 grade rejects malformed input with a RangeError", () => {
    const bad: Partial<GradeInput>[] = [
      { lossPctPot: Number.NaN },
      { lossPctPot: -0.1 },
      { lossPctPot: Number.POSITIVE_INFINITY },
      { floorPctPot: -1 },
      { actionIndex: 3 },
      { actionIndex: -1 },
      { actionIndex: 1.5 },
      { freqByAction: [] },
      { freqByAction: [0, -0.1, 1.1] },
      { freqByAction: [0, 0, 0] },
      { freqByAction: [0, Number.NaN, 1] },
      { ratedTodayInTrack: -1 },
      { ratedTodayInTrack: 1.5 },
      { actions: SIZED_NODE_ACTIONS },
      { street: "preflopp" as GradeInput["street"] },
      { grouping: "exact" as NonNullable<GradeInput["grouping"]> },
    ];
    for (const overrides of bad) {
      expect(() => grade({ ...BASE_GRADE_INPUT, ...overrides }), JSON.stringify(overrides)).toThrow(RangeError);
    }
    for (const rngRoll of [0, 101, 40.5]) {
      expect(() => grade(withNodeActions({ ...BASE_GRADE_INPUT, rngRoll })), `roll ${rngRoll}`).toThrow(RangeError);
    }
    expect(() => grade(sizedInput(SIZED_INDEX.raise250, { lossPctPot: 0.5 }))).toThrow(RangeError);
  });

  it("R3.8 grade returns a new GradeOutput and never mutates the GradeInput", () => {
    const input = deepFreeze(sizedInput(SIZED_INDEX.raise250, { grouping: "simple", rngRoll: 30 }));
    const snapshot = structuredClone(input);
    const first = grade(input);
    const second = grade(input);
    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
