/**
 * R4.4 item difficulty from solver features (S30; 06 section 3.2, O-250). v1 uses what
 * solver-query ships: difficulty = 1100 + 400 x gapHardness + 400 x mixHardness with
 * gapHardness = 1 / (1 + evGapPctPot / 2) and mixHardness = min(1, 2 x (1 - purity)), so a smaller
 * EV gap and a less pure decision are harder, and an item whose every action sits inside the noise
 * floor is excluded from rated play. Fixtures are synthetic.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_BASE,
  GAP_SCALE_PCT_POT,
  GAP_WEIGHT,
  MIX_WEIGHT,
  itemDifficulty,
  withItemExclusion,
} from "../src/difficulty.js";
import type { DifficultyFeatures, ItemDifficulty } from "../src/difficulty.js";
import { UNRATED_WEIGHT } from "../src/grading.js";
import type { GradeOutput } from "../src/types.js";

const DIFFICULTY_MIN = 1100;
const DIFFICULTY_MAX = 1900;

const BASE_FEATURES: DifficultyFeatures = Object.freeze({
  evGapPctPot: 1,
  purity: 0.7,
  allWithinFloor: false,
});

const RATED_OUTPUT: GradeOutput = Object.freeze({
  score: 0.904837,
  label: "Inaccuracy",
  rated: true,
  weight: 1,
  gradedActionIndex: 1,
});

const gap = fc.double({ min: 0, max: 1000, noNaN: true });
const purity = fc.double({ min: 0, max: 1, noNaN: true });
const featuresArbitrary: fc.Arbitrary<DifficultyFeatures> = fc.record({
  evGapPctPot: gap,
  purity,
  allWithinFloor: fc.boolean(),
});

function ascending([a, b]: [number, number]): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

describe("R4.4 item difficulty (O-250)", () => {
  it("R4.4 the v1 weights are the O-250 hand-set constants", () => {
    expect([DIFFICULTY_BASE, GAP_WEIGHT, MIX_WEIGHT, GAP_SCALE_PCT_POT]).toEqual([1100, 400, 400, 2]);
  });

  it("R4.4 worked rows: a pure decision with a wide gap is easy, a close mixed one is hard", () => {
    // gap 1, purity 0.7: 1100 + 400 / 1.5 + 400 x 0.6 = 1606.667
    expect(itemDifficulty(BASE_FEATURES).difficulty).toBeCloseTo(1606.6667, 3);
    // gap 0, purity 0.5: 1100 + 400 + 400 = 1900, the hardest item
    expect(itemDifficulty({ ...BASE_FEATURES, evGapPctPot: 0, purity: 0.5 }).difficulty).toBe(DIFFICULTY_MAX);
    // gap 18, purity 1: 1100 + 400 / 10 + 0 = 1140
    expect(itemDifficulty({ ...BASE_FEATURES, evGapPctPot: 18, purity: 1 }).difficulty).toBeCloseTo(1140, 9);
  });

  it("R4.4 difficulty is non-increasing in the EV gap (fast-check)", () => {
    fc.assert(
      fc.property(fc.tuple(gap, gap).map(ascending), purity, ([small, large], p) => {
        const harder = itemDifficulty({ ...BASE_FEATURES, evGapPctPot: small, purity: p }).difficulty;
        const easier = itemDifficulty({ ...BASE_FEATURES, evGapPctPot: large, purity: p }).difficulty;
        expect(easier).toBeLessThanOrEqual(harder);
      }),
    );
  });

  it("R4.4 difficulty is non-increasing in purity (fast-check)", () => {
    fc.assert(
      fc.property(gap, fc.tuple(purity, purity).map(ascending), (g, [mixedPurity, purePurity]) => {
        const harder = itemDifficulty({ ...BASE_FEATURES, evGapPctPot: g, purity: mixedPurity }).difficulty;
        const easier = itemDifficulty({ ...BASE_FEATURES, evGapPctPot: g, purity: purePurity }).difficulty;
        expect(easier).toBeLessThanOrEqual(harder);
      }),
    );
  });

  it("R4.4 difficulty stays within 1100 to 1900 and excluded mirrors allWithinFloor (fast-check)", () => {
    fc.assert(
      fc.property(featuresArbitrary, (features) => {
        const item = itemDifficulty(features);
        expect(item.difficulty).toBeGreaterThanOrEqual(DIFFICULTY_MIN);
        expect(item.difficulty).toBeLessThanOrEqual(DIFFICULTY_MAX);
        expect(item.excluded).toBe(features.allWithinFloor);
      }),
    );
  });
});

describe("R4.4 all-within-floor items are excluded from rated play (06 section 3.2)", () => {
  it("R4.4 allWithinFloor gives excluded, and withItemExclusion unrates the output with weight 0 without mutating it", () => {
    const item = itemDifficulty({ ...BASE_FEATURES, allWithinFloor: true });
    expect(item.excluded).toBe(true);
    const output: GradeOutput = { ...RATED_OUTPUT };
    const before = { ...output };
    const excluded = withItemExclusion(Object.freeze(output), item);
    expect(excluded).toEqual({ ...RATED_OUTPUT, rated: false, weight: UNRATED_WEIGHT });
    expect(excluded.weight).toBe(0);
    expect(output).toEqual(before);
    expect(excluded).not.toBe(output);
  });

  it("R4.4 a not-excluded item passes the output through unchanged as a new object", () => {
    const item = itemDifficulty(BASE_FEATURES);
    const passed = withItemExclusion(RATED_OUTPUT, item);
    expect(passed).toEqual(RATED_OUTPUT);
    expect(passed).not.toBe(RATED_OUTPUT);
  });
});

describe("R4.4 input checks (RangeError naming the field)", () => {
  const rows: [string, DifficultyFeatures, RegExp][] = [
    ["evGapPctPot negative", { ...BASE_FEATURES, evGapPctPot: -0.1 }, /evGapPctPot/],
    ["evGapPctPot NaN", { ...BASE_FEATURES, evGapPctPot: Number.NaN }, /evGapPctPot/],
    ["evGapPctPot infinite", { ...BASE_FEATURES, evGapPctPot: Number.POSITIVE_INFINITY }, /evGapPctPot/],
    ["purity below 0", { ...BASE_FEATURES, purity: -0.01 }, /purity/],
    ["purity above 1", { ...BASE_FEATURES, purity: 1.01 }, /purity/],
    ["purity NaN", { ...BASE_FEATURES, purity: Number.NaN }, /purity/],
    ["allWithinFloor not a boolean", { ...BASE_FEATURES, allWithinFloor: "no" as unknown as boolean }, /allWithinFloor/],
  ];
  it.each(rows)("R4.4 %s is a RangeError", (_label, features, field) => {
    expect(() => itemDifficulty(features)).toThrow(RangeError);
    expect(() => itemDifficulty(features)).toThrow(field);
  });

  it("R4.4 withItemExclusion rejects an item whose excluded flag is not a boolean", () => {
    const item = { difficulty: 1500, excluded: undefined } as unknown as ItemDifficulty;
    expect(() => withItemExclusion(RATED_OUTPUT, item)).toThrow(/excluded/);
  });
});
