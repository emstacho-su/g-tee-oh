/**
 * R3.10 RNG (random number generator) band mapping vectors (R0.11 red half; the green half is S22
 * on p3/grading-policy, src/grading.ts; the explainer snapshot part of R3.10 belongs to web).
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
 * actions minus one degrees of freedom. Rolls come only from the injected RNG (A1 section 2).
 */
import { describe, expect, it } from "vitest";

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

  it.todo(
    "R3.10 cumulative bands run from passive to aggressive: call 40 and raise 60 map rolls 1 to 40 to call and 41 to 100 to raise (05 section 7)",
  );
  it.todo(
    "R3.10 band edges: roll 40 is call and 41 is raise; in the three-way mix 20 is fold, 21 and 70 are call, 71 is raise",
  );
  it.todo(
    "R3.10 bet sizes order small to large after the passive actions with all-in last: rolls 75 and 76 fall on raise 2.5x and raise 3x, 96 on all-in",
  );
  it.todo(
    "R3.10 chi-square over 10,000 seeded rolls (seed 20261020): call and raise counts near 4,000 and 6,000 with the statistic under 6.635 (p above 0.01, O-90)",
  );
  it.todo(
    "R3.10 chi-square over 10,000 seeded rolls: the three-way mix lands near 2,000, 5,000 and 3,000 with the statistic under 9.21",
  );
  it.todo(
    "R3.10 chi-square over 10,000 seeded rolls: the five-action hand lands near 1,000, 3,000, 3,500, 2,000 and 500 with the statistic under 13.277",
  );
  it.todo("R3.10 a pure action takes every roll: 10,000 of 10,000 rolls select raise and no chi-square is computed");
  it.todo(
    "R3.10 rolls are integers from 1 to 100 drawn only from the injected RandomSource, and the same seed replays the same 10,000 rolls (A1 section 2)",
  );
  it.todo(
    "R3.10 non-integer percentages: cumulative bands are rounded once at the edge so every roll from 1 to 100 maps to exactly one action (S22 fixes the rounding rule)",
  );
});
