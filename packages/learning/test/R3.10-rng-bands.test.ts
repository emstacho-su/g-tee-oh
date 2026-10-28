/**
 * R3.10 RNG (random number generator) band mapping vectors (R0.11 red half from S05; the green
 * half is S22 on p3/grading-policy, src/rng-bands.ts; the roller and the explainer snapshot part
 * of R3.10 belong to web, S25).
 *
 * Rule (05 section 7, ADR 0009): before the hero acts the app rolls an integer from 1 to 100; the
 * hand's actions are ordered from passive to aggressive (fold, check or call, then bets from small
 * to large, all-in last) and the roll picks the action whose cumulative frequency band contains
 * it. The worked example of 05 section 7: 40 percent call and 60 percent raise means rolls 1 to
 * 40 call and 41 to 100 raise. The roll-selected action is Best (covered by GRADING_RNG_ROWS in
 * R3.8-grading.test.ts).
 *
 * Test (A6 section 6, O-90): over 10,000 rolls from the injected RandomSource seeded with a fixed
 * seed, the selected-action counts match the frequencies by a chi-square goodness-of-fit test that
 * passes when p is above 0.01, that is when the statistic is under the critical value for
 * actions minus one degrees of freedom. Rolls come only from the injected RNG (A1 section 2), here
 * the SplitMix64 source that test/R3.10-splitmix64.test.ts proves equal to solver-query's (O-151).
 *
 * Rounding (O-213): frequencies are normalized by their sum, each band's upper edge is the
 * cumulative percent rounded half up, the last edge is 100, and an action under half a roll owns
 * no band. The actions list is always required and the order always comes from kind and size,
 * whatever the record order, so grade() and the web roller (S25, through rollSelectedAction) pick
 * the same action for the same roll.
 */
import { describe, expect, it } from "vitest";

import {
  RNG_ROLL_MAX as POLICY_ROLL_MAX,
  RNG_ROLL_MIN as POLICY_ROLL_MIN,
  actionForRoll,
  chiSquareStatistic,
  followsRoll,
  grade,
  passiveToAggressiveOrder,
  rngBands,
  rollFrom,
  rollSelectedAction,
  splitMix64Source,
} from "../src/index.js";
import type { GradeAction } from "../src/index.js";

/** The tree action behind each fixture action name; losses are 0 because only the order matters here. */
export const FIXTURE_ACTIONS: Readonly<Record<string, GradeAction>> = Object.freeze({
  fold: { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 0 },
  call: { kind: "call", bucket: null, sizeCbb: 100, lossPctPot: 0 },
  raise: { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0 },
  "raise 2.5x": { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0 },
  "raise 3x": { kind: "raise", bucket: "pot", sizeCbb: 300, lossPctPot: 0 },
  "all-in": { kind: "all_in", bucket: "all-in", sizeCbb: 10000, lossPctPot: 0 },
});

/** Tree actions already in passive-to-aggressive order, for frequency lists of up to four actions. */
const ORDERED_ACTION_NAMES = ["fold", "call", "raise 2.5x", "raise 3x"] as const;

function actionsNamed(names: readonly string[]): GradeAction[] {
  return names.map((name) => {
    const action = FIXTURE_ACTIONS[name];
    if (action === undefined) {
      throw new Error(`no fixture action named ${name}`);
    }
    return action;
  });
}

/** count actions in passive-to-aggressive order, so record order and band order coincide. */
function orderedActions(count: number): GradeAction[] {
  return actionsNamed(ORDERED_ACTION_NAMES.slice(ORDERED_ACTION_NAMES.length - count));
}

export const RNG_ROLL_COUNT = 10000;
export const RNG_ROLL_MIN = 1;
export const RNG_ROLL_MAX = 100;

/** Fixed seed of the chi-square runs (O-90). */
export const RNG_CHI_SQUARE_SEED = 20261020;

/** Significance level of the chi-square test: pass when p is above this (O-90). */
export const RNG_CHI_SQUARE_P_THRESHOLD = 0.01;

/** Upper critical values of the chi-square distribution at p = 0.01 by degrees of freedom. */
export const CHI_SQUARE_CRITICAL_AT_P_0_01: Readonly<Record<number, number>> = Object.freeze({
  1: 6.635,
  2: 9.21,
  3: 11.345,
  4: 13.277,
});

export type RngBand = { action: string; from: number; to: number };

export type RngBandHandVector = {
  name: string;
  /** Actions in passive-to-aggressive order, the order the bands follow. */
  actions: string[];
  frequencies: number[];
  bands: RngBand[];
  expectedCounts: number[];
  degreesOfFreedom: number;
  spotChecks: { roll: number; action: string }[];
};

export const RNG_BAND_HANDS: readonly RngBandHandVector[] = Object.freeze([
  {
    name: "05 section 7 example: call 40 percent, raise 60 percent",
    actions: ["call", "raise"],
    frequencies: [0.4, 0.6],
    bands: [
      { action: "call", from: 1, to: 40 },
      { action: "raise", from: 41, to: 100 },
    ],
    expectedCounts: [4000, 6000],
    degreesOfFreedom: 1,
    spotChecks: [
      { roll: 1, action: "call" },
      { roll: 40, action: "call" },
      { roll: 41, action: "raise" },
      { roll: 100, action: "raise" },
    ],
  },
  {
    name: "three-way mix: fold 20, call 50, raise 30",
    actions: ["fold", "call", "raise"],
    frequencies: [0.2, 0.5, 0.3],
    bands: [
      { action: "fold", from: 1, to: 20 },
      { action: "call", from: 21, to: 70 },
      { action: "raise", from: 71, to: 100 },
    ],
    expectedCounts: [2000, 5000, 3000],
    degreesOfFreedom: 2,
    spotChecks: [
      { roll: 20, action: "fold" },
      { roll: 21, action: "call" },
      { roll: 70, action: "call" },
      { roll: 71, action: "raise" },
    ],
  },
  {
    name: "sizes ordered small to large after the passive actions, all-in last",
    actions: ["fold", "call", "raise 2.5x", "raise 3x", "all-in"],
    frequencies: [0.1, 0.3, 0.35, 0.2, 0.05],
    bands: [
      { action: "fold", from: 1, to: 10 },
      { action: "call", from: 11, to: 40 },
      { action: "raise 2.5x", from: 41, to: 75 },
      { action: "raise 3x", from: 76, to: 95 },
      { action: "all-in", from: 96, to: 100 },
    ],
    expectedCounts: [1000, 3000, 3500, 2000, 500],
    degreesOfFreedom: 4,
    spotChecks: [
      { roll: 10, action: "fold" },
      { roll: 11, action: "call" },
      { roll: 75, action: "raise 2.5x" },
      { roll: 76, action: "raise 3x" },
      { roll: 96, action: "all-in" },
    ],
  },
  {
    name: "pure raise: every roll selects raise, no chi-square",
    actions: ["fold", "call", "raise"],
    frequencies: [0, 0, 1],
    bands: [{ action: "raise", from: 1, to: 100 }],
    expectedCounts: [0, 0, 10000],
    degreesOfFreedom: 0,
    spotChecks: [
      { roll: 1, action: "raise" },
      { roll: 100, action: "raise" },
    ],
  },
]);

describe("R3.10 RNG mode band mapping and the chi-square test (S22, ADR 0009, O-90)", () => {
  it("R0.11 RNG band vector data parses: bands tile 1 to 100 in action order and expected counts follow the frequencies", () => {
    for (const hand of RNG_BAND_HANDS) {
      expect(hand.frequencies.reduce((sum, f) => sum + f, 0)).toBeCloseTo(1, 9);
      expect(hand.expectedCounts).toHaveLength(hand.actions.length);
      hand.expectedCounts.forEach((count, index) => {
        expect(count).toBeCloseTo((hand.frequencies[index] ?? Number.NaN) * RNG_ROLL_COUNT, 9);
      });
      const firstBand = hand.bands.at(0);
      const lastBand = hand.bands.at(-1);
      expect(firstBand?.from).toBe(RNG_ROLL_MIN);
      expect(lastBand?.to).toBe(RNG_ROLL_MAX);
      hand.bands.slice(1).forEach((band, index) => {
        expect(band.from).toBe((hand.bands[index]?.to ?? Number.NaN) + 1);
      });
      for (const check of hand.spotChecks) {
        const band = hand.bands.find((candidate) => check.roll >= candidate.from && check.roll <= candidate.to);
        expect(band?.action).toBe(check.action);
      }
      if (hand.degreesOfFreedom > 0) {
        expect(CHI_SQUARE_CRITICAL_AT_P_0_01[hand.degreesOfFreedom]).toBeDefined();
      }
    }
  });

  it("R3.10 the roll range and significance level are the policy's named constants (O-90)", () => {
    expect(POLICY_ROLL_MIN).toBe(RNG_ROLL_MIN);
    expect(POLICY_ROLL_MAX).toBe(RNG_ROLL_MAX);
    expect(RNG_CHI_SQUARE_P_THRESHOLD).toBe(0.01);
  });

  it("R3.10 cumulative bands run from passive to aggressive: call 40 and raise 60 map rolls 1 to 40 to call and 41 to 100 to raise (05 section 7)", () => {
    const hand = handNamed("05 section 7 example");
    expect(namedBands(hand)).toEqual(hand.bands);
  });

  it("R3.10 band edges: roll 40 is call and 41 is raise; in the three-way mix 20 is fold, 21 and 70 are call, 71 is raise", () => {
    for (const prefix of ["05 section 7 example", "three-way mix"]) {
      const hand = handNamed(prefix);
      expect(namedBands(hand)).toEqual(hand.bands);
      expectSpotChecks(hand);
    }
  });

  it("R3.10 bet sizes order small to large after the passive actions with all-in last: rolls 75 and 76 fall on raise 2.5x and raise 3x, 96 on all-in", () => {
    const hand = handNamed("sizes ordered");
    expect(namedBands(hand)).toEqual(hand.bands);
    expectSpotChecks(hand);
  });

  it("R3.10 the actions list orders the bands by kind and size whatever the record order (O-213)", () => {
    const records: GradeAction[] = [
      { kind: "all_in", bucket: "all-in", sizeCbb: 10000, lossPctPot: 0 },
      { kind: "raise", bucket: "pot", sizeCbb: 300, lossPctPot: 0 },
      { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 0 },
      { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0 },
      { kind: "call", bucket: null, sizeCbb: 100, lossPctPot: 0 },
    ];
    expect(passiveToAggressiveOrder(records)).toEqual([2, 4, 3, 1, 0]);
    expect(rngBands([0.05, 0.2, 0.1, 0.35, 0.3], records)).toEqual([
      { actionIndex: 2, from: 1, to: 10 },
      { actionIndex: 4, from: 11, to: 40 },
      { actionIndex: 3, from: 41, to: 75 },
      { actionIndex: 1, from: 76, to: 95 },
      { actionIndex: 0, from: 96, to: 100 },
    ]);
  });

  it("R3.10 chi-square over 10,000 seeded rolls (seed 20261020): call and raise counts near 4,000 and 6,000 with the statistic under 6.635 (p above 0.01, O-90)", () => {
    expectChiSquarePasses(handNamed("05 section 7 example"));
  });

  it("R3.10 chi-square over 10,000 seeded rolls: the three-way mix lands near 2,000, 5,000 and 3,000 with the statistic under 9.21", () => {
    expectChiSquarePasses(handNamed("three-way mix"));
  });

  it("R3.10 chi-square over 10,000 seeded rolls: the five-action hand lands near 1,000, 3,000, 3,500, 2,000 and 500 with the statistic under 13.277", () => {
    expectChiSquarePasses(handNamed("sizes ordered"));
  });

  it("R3.10 a pure action takes every roll: 10,000 of 10,000 rolls select raise and no chi-square is computed", () => {
    const hand = handNamed("pure raise");
    expect(namedBands(hand)).toEqual(hand.bands);
    expect(countSelections(hand, RNG_CHI_SQUARE_SEED)).toEqual(hand.expectedCounts);
    expect(hand.degreesOfFreedom).toBe(0);
  });

  it("R3.10 rolls are integers from 1 to 100 drawn only from the injected RandomSource, and the same seed replays the same 10,000 rolls (A1 section 2)", () => {
    const first = drawRolls(RNG_CHI_SQUARE_SEED);
    const replay = drawRolls(RNG_CHI_SQUARE_SEED);
    expect(replay).toEqual(first);
    expect(first.every((value) => Number.isInteger(value) && value >= RNG_ROLL_MIN && value <= RNG_ROLL_MAX)).toBe(true);
    expect(new Set(first).size).toBe(RNG_ROLL_MAX);
    expect(drawRolls(RNG_CHI_SQUARE_SEED + 1)).not.toEqual(first);
    expect(rollFrom(() => 0)).toBe(RNG_ROLL_MIN);
    expect(rollFrom(() => 0.999_999_999)).toBe(RNG_ROLL_MAX);
  });

  it("R3.10 rollFrom rejects a source that leaves [0, 1)", () => {
    for (const draw of [1, -0.1, Number.NaN, 2]) {
      expect(() => rollFrom(() => draw), String(draw)).toThrow(RangeError);
    }
  });

  it("R3.10 non-integer percentages: cumulative bands are rounded once at the edge so every roll from 1 to 100 maps to exactly one action (O-213)", () => {
    const third = 1 / 3;
    const bandsOf = (frequencies: number[]) => rngBands(frequencies, orderedActions(frequencies.length));
    expect(bandsOf([third, third, third])).toEqual([
      { actionIndex: 0, from: 1, to: 33 },
      { actionIndex: 1, from: 34, to: 67 },
      { actionIndex: 2, from: 68, to: 100 },
    ]);
    expect(bandsOf([0.405, 0.595])).toEqual([
      { actionIndex: 0, from: 1, to: 41 },
      { actionIndex: 1, from: 42, to: 100 },
    ]);
    expect(bandsOf([0.004, 0.996]), "a band under half a roll selects nothing").toEqual([
      { actionIndex: 1, from: 1, to: 100 },
    ]);
    expect(bandsOf([0.2, 0.2]), "frequencies are normalized by their sum").toEqual([
      { actionIndex: 0, from: 1, to: 50 },
      { actionIndex: 1, from: 51, to: 100 },
    ]);
    const float32Mix = [0.4000000059604645, 0.6000000238418579];
    expect(bandsOf(float32Mix)).toEqual([
      { actionIndex: 0, from: 1, to: 40 },
      { actionIndex: 1, from: 41, to: 100 },
    ]);
    for (const frequencies of [[third, third, third], [0.405, 0.595], [0.004, 0.996], [0.123, 0.456, 0.421]]) {
      const bands = bandsOf(frequencies);
      for (let roll = RNG_ROLL_MIN; roll <= RNG_ROLL_MAX; roll += 1) {
        const owners = bands.filter((band) => roll >= band.from && roll <= band.to);
        expect(owners, `roll ${roll}`).toHaveLength(1);
        expect(actionForRoll(bands, roll)).toBe(owners[0]?.actionIndex);
      }
    }
  });

  it("R3.10 band mapping rejects malformed input with a RangeError, including a missing actions list (O-213)", () => {
    expect(() => rngBands([], [])).toThrow(RangeError);
    expect(() => rngBands([0, 0], orderedActions(2))).toThrow(RangeError);
    expect(() => rngBands([-0.5, 1.5], orderedActions(2))).toThrow(RangeError);
    expect(() => rngBands([0.5, 0.5], orderedActions(1))).toThrow(RangeError);
    const withoutActions = rngBands as unknown as (frequencies: readonly number[]) => unknown;
    expect(() => withoutActions([0.4, 0.6])).toThrow(RangeError);
    const bands = rngBands([0.4, 0.6], orderedActions(2));
    for (const roll of [0, 101, 40.5, Number.NaN]) {
      expect(() => actionForRoll(bands, roll), String(roll)).toThrow(RangeError);
    }
  });

  it("R3.10 rollSelectedAction is the one entry the web roller (S25) and grade() share: for every roll it picks the action grade() marks as following the roll (ADR 0024 rule 2, O-344)", () => {
    const records = actionsNamed(["all-in", "raise 3x", "fold", "raise 2.5x", "call"]);
    const frequencies = [0.05, 0.2, 0.1, 0.35, 0.3];
    for (let roll = RNG_ROLL_MIN; roll <= RNG_ROLL_MAX; roll += 1) {
      const selected = rollSelectedAction(frequencies, records, roll);
      expect(selected).toBe(actionForRoll(rngBands(frequencies, records), roll));
      const output = grade({
        lossPctPot: 0,
        floorPctPot: 0.2,
        freqByAction: frequencies,
        actionIndex: selected,
        actions: records,
        rngRoll: roll,
        noiseFlags: [],
        mode: "drill",
        firstAttempt: true,
        panelsRevealed: false,
        ratedTodayInTrack: 0,
        street: "flop",
      });
      expect(output.followedRoll, `roll ${roll}`).toBe(true);
      expect(output.label, `roll ${roll}: every loss is 0, so the label is Best whatever the roll`).toBe("Best");
      const otherIndex = (selected + 1) % records.length;
      expect(followsRoll({ freqByAction: frequencies, actions: records, street: "flop", roll, actionIndex: otherIndex }), `roll ${roll}`).toBe(
        false,
      );
    }
  });

  it("R3.10 the chi-square statistic sums (observed - expected)^2 / expected over the played cells", () => {
    expect(chiSquareStatistic([10, 20], [15, 15])).toBeCloseTo(10 / 3, 12);
    expect(chiSquareStatistic([0, 4000, 6000], [0, 4000, 6000])).toBe(0);
    expect(() => chiSquareStatistic([1, 9], [0, 10])).toThrow(RangeError);
    expect(() => chiSquareStatistic([1, 2], [3])).toThrow(RangeError);
  });
});

function handNamed(prefix: string): RngBandHandVector {
  const hand = RNG_BAND_HANDS.find((candidate) => candidate.name.startsWith(prefix));
  if (hand === undefined) {
    throw new Error(`no RNG band hand starts with ${prefix}`);
  }
  return hand;
}

function actionName(hand: RngBandHandVector, index: number): string {
  const name = hand.actions[index];
  if (name === undefined) {
    throw new Error(`hand ${hand.name} has no action ${index}`);
  }
  return name;
}

/** The policy's bands for a fixture hand, from its frequencies and the tree actions its names stand for. */
function handBands(hand: RngBandHandVector): ReturnType<typeof rngBands> {
  return rngBands(hand.frequencies, actionsNamed(hand.actions));
}

/** The policy's bands for a fixture hand, with action names in place of indices. */
function namedBands(hand: RngBandHandVector): RngBand[] {
  return handBands(hand).map((band) => ({
    action: actionName(hand, band.actionIndex),
    from: band.from,
    to: band.to,
  }));
}

function expectSpotChecks(hand: RngBandHandVector): void {
  const bands = handBands(hand);
  for (const check of hand.spotChecks) {
    expect(actionName(hand, actionForRoll(bands, check.roll)), `roll ${check.roll}`).toBe(check.action);
  }
}

function drawRolls(seed: number): number[] {
  const random = splitMix64Source(BigInt(seed));
  return Array.from({ length: RNG_ROLL_COUNT }, () => rollFrom(random));
}

/** Selected-action counts over RNG_ROLL_COUNT rolls from the seeded source, in the hand's action order. */
function countSelections(hand: RngBandHandVector, seed: number): number[] {
  const bands = handBands(hand);
  const selections = drawRolls(seed).map((roll) => actionForRoll(bands, roll));
  return hand.actions.map((_, index) => selections.filter((selected) => selected === index).length);
}

function expectChiSquarePasses(hand: RngBandHandVector): void {
  const observed = countSelections(hand, RNG_CHI_SQUARE_SEED);
  expect(observed.reduce((sum, count) => sum + count, 0)).toBe(RNG_ROLL_COUNT);
  const statistic = chiSquareStatistic(observed, hand.expectedCounts);
  const critical = CHI_SQUARE_CRITICAL_AT_P_0_01[hand.degreesOfFreedom];
  expect(critical, `critical value for ${hand.degreesOfFreedom} degrees of freedom`).toBeDefined();
  expect(statistic, `${hand.name}: observed ${observed.join(", ")}`).toBeLessThan(critical ?? 0);
}
