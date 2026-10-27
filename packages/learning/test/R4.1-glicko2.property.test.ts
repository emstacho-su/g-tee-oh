/**
 * R4.1 Glicko-2 properties and input checks (S30). Only properties that follow from Glickman's
 * update are asserted: the rating change is monotone in the score, a result with weight w counts as
 * w copies of it, the order of results inside one period does not matter, the RD after a period
 * with results stays below the RD an empty period at the new volatility would give, and a new
 * track (RD 350) never gains RD from a session of library items (ADR 0011, O-27, O-56, O-250,
 * O-251). "RD never grows" is not asserted in general: a player with a small RD who meets one
 * high-RD opponent can end with a larger RD, because the volatility term outweighs the little
 * information that result carries.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLICKO2_MAX_RD,
  GLICKO2_DEFAULTS,
  GLICKO2_SCALE,
  INACTIVITY_PERIOD_DAYS,
  ITEM_RD,
  applyInactivity,
  conservativeRating,
  inactivePeriods,
  ratePeriod,
  rateSession,
} from "../src/glicko2.js";
import type { PeriodResult, SessionDecision, TrackRating } from "../src/glicko2.js";

/** Item difficulties span 1100 to 1900 (O-250); opponents in general span a wider band. */
const ITEM_DIFFICULTY_MIN = 1100;
const ITEM_DIFFICULTY_MAX = 1900;
const MAX_RESULTS_PER_PERIOD = 20;

/** Relative tolerance for comparing two arithmetically equivalent updates. */
const EQUIVALENT_DIGITS = 6;

const unitScore = fc.double({ min: 0, max: 1, noNaN: true });

const playerArbitrary = fc.record({
  rating: fc.double({ min: 800, max: 2600, noNaN: true }),
  rd: fc.double({ min: 30, max: 350, noNaN: true }),
  volatility: fc.double({ min: 0.03, max: 0.09, noNaN: true }),
});

const opponentArbitrary = fc.record({
  rating: fc.double({ min: 800, max: 2600, noNaN: true }),
  rd: fc.double({ min: 0, max: 350, noNaN: true }),
});

const resultArbitrary = fc.record({ opponent: opponentArbitrary, score: unitScore });

const resultsArbitrary = fc.array(resultArbitrary, { minLength: 1, maxLength: MAX_RESULTS_PER_PERIOD });

const decisionArbitrary: fc.Arbitrary<SessionDecision> = fc.record({
  difficulty: fc.double({ min: ITEM_DIFFICULTY_MIN, max: ITEM_DIFFICULTY_MAX, noNaN: true }),
  score: unitScore,
  rated: fc.constant(true),
  weight: fc.constant(1),
});

/** Two scores in ascending order. */
const scorePair = fc.tuple(unitScore, unitScore).map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));

function ratingChange(player: TrackRating, result: PeriodResult): number {
  return ratePeriod(player, [result]).rating - player.rating;
}

describe("R4.1 Glicko-2 properties (fast-check)", () => {
  it("R4.1 the rating change is non-decreasing in the score against any one opponent", () => {
    fc.assert(
      fc.property(playerArbitrary, opponentArbitrary, scorePair, (player, opponent, [low, high]) => {
        expect(ratingChange(player, { opponent, score: low })).toBeLessThanOrEqual(
          ratingChange(player, { opponent, score: high }),
        );
      }),
    );
  });

  it("R4.1 against an opponent at the player's own rating a score above 0.5 raises the rating and one below lowers it", () => {
    fc.assert(
      fc.property(playerArbitrary, unitScore, (player, score) => {
        fc.pre(score !== 0.5);
        const change = ratingChange(player, { opponent: { rating: player.rating, rd: player.rd }, score });
        expect(Math.sign(change)).toBe(Math.sign(score - 0.5));
      }),
    );
  });

  it("R4.1 a result with weight 2 counts exactly as the same result listed twice (O-251)", () => {
    fc.assert(
      fc.property(playerArbitrary, resultArbitrary, (player, result) => {
        const weighted = ratePeriod(player, [{ ...result, weight: 2 }]);
        const doubled = ratePeriod(player, [result, result]);
        expect(weighted.rating).toBeCloseTo(doubled.rating, EQUIVALENT_DIGITS);
        expect(weighted.rd).toBeCloseTo(doubled.rd, EQUIVALENT_DIGITS);
        expect(weighted.volatility).toBeCloseTo(doubled.volatility, EQUIVALENT_DIGITS);
      }),
    );
  });

  it("R4.1 the order of results inside one period does not change the update", () => {
    fc.assert(
      fc.property(playerArbitrary, resultsArbitrary, (player, results) => {
        const forward = ratePeriod(player, results);
        const reversed = ratePeriod(player, [...results].reverse());
        expect(forward.rating).toBeCloseTo(reversed.rating, EQUIVALENT_DIGITS);
        expect(forward.rd).toBeCloseTo(reversed.rd, EQUIVALENT_DIGITS);
      }),
    );
  });

  it("R4.1 after a period with results RD stays below the RD an empty period at the new volatility gives, and the state stays finite", () => {
    fc.assert(
      fc.property(playerArbitrary, resultsArbitrary, (player, results) => {
        const updated = ratePeriod(player, results);
        const inactiveRd = Math.hypot(player.rd, updated.volatility * GLICKO2_SCALE);
        expect(updated.rd).toBeLessThan(inactiveRd);
        expect(updated.rd).toBeGreaterThan(0);
        expect(updated.volatility).toBeGreaterThan(0);
        expect(Number.isFinite(updated.rating)).toBe(true);
      }),
    );
  });

  it("R4.1 a new track (RD 350) never gains RD from a session of library items (O-250)", () => {
    fc.assert(
      fc.property(fc.array(decisionArbitrary, { minLength: 1, maxLength: MAX_RESULTS_PER_PERIOD }), (decisions) => {
        expect(rateSession(GLICKO2_DEFAULTS, decisions).rd).toBeLessThan(GLICKO2_DEFAULTS.rd);
      }),
    );
  });

  it("R4.1 rateSession enters each item as an opponent at its difficulty with ITEM_RD 0 (O-250)", () => {
    expect(ITEM_RD).toBe(0);
    fc.assert(
      fc.property(playerArbitrary, fc.array(decisionArbitrary, { minLength: 1, maxLength: 5 }), (player, decisions) => {
        const results = decisions.map((decision) => ({
          opponent: { rating: decision.difficulty, rd: ITEM_RD },
          score: decision.score,
        }));
        expect(rateSession(player, decisions)).toEqual(ratePeriod(player, results));
      }),
    );
  });

  it("R4.1 inactivity grows RD with the number of empty periods up to the 350 cap and never moves the rating (O-259)", () => {
    fc.assert(
      fc.property(playerArbitrary, fc.integer({ min: 0, max: 520 }), (player, periods) => {
        const now = applyInactivity(player, periods);
        const later = applyInactivity(player, periods + 1);
        if (now.rd < GLICKO2_MAX_RD) {
          expect(later.rd).toBeGreaterThan(now.rd);
          expect(conservativeRating(later)).toBeLessThan(conservativeRating(now));
        } else {
          expect(later.rd).toBe(now.rd);
        }
        expect(later.rd).toBeLessThanOrEqual(Math.max(player.rd, GLICKO2_MAX_RD));
        expect(now.rating).toBe(player.rating);
        expect(now.volatility).toBe(player.volatility);
      }),
    );
  });

  it("R4.1 inactive periods are whole weeks since the last rated session (O-251)", () => {
    expect(INACTIVITY_PERIOD_DAYS).toBe(7);
    expect(inactivePeriods(0)).toBe(0);
    expect(inactivePeriods(6.99)).toBe(0);
    expect(inactivePeriods(7)).toBe(1);
    expect(inactivePeriods(13.5)).toBe(1);
    expect(inactivePeriods(70)).toBe(10);
  });

  it("R4.1 applyInactivity with zero periods returns an equal copy", () => {
    const player = { rating: 1612.5, rd: 88.25, volatility: 0.061 };
    const copy = applyInactivity(player, 0);
    expect(copy).toEqual(player);
    expect(copy).not.toBe(player);
  });

  it("R4.1 a large tau with a large volatility still converges when the bracket search steps down more than once", () => {
    const player = { rating: 1500, rd: 2, volatility: 100 };
    const results = Array.from({ length: 100 }, () => ({ opponent: { rating: 1500, rd: 0 }, score: 0.5 }));
    const updated = ratePeriod(player, results, 10);
    expect(updated.rating).toBeCloseTo(1500, 9);
    expect(Number.isFinite(updated.volatility)).toBe(true);
    expect(updated.volatility).toBeGreaterThan(0);
  });

  it("R4.1 a surprising result against a settled player takes the branch where delta squared exceeds phi squared plus v", () => {
    const player = { rating: 1500, rd: 50, volatility: 0.06 };
    const results = Array.from({ length: 10 }, () => ({ opponent: { rating: 2200, rd: 0 }, score: 1 }));
    const updated = ratePeriod(player, results);
    expect(updated.volatility).toBeGreaterThan(player.volatility);
    expect(updated.rating).toBeGreaterThan(player.rating);
  });
});

const VALID_PLAYER: TrackRating = { rating: 1500, rd: 200, volatility: 0.06 };
const VALID_RESULT: PeriodResult = { opponent: { rating: 1500, rd: 100 }, score: 0.5 };
const VALID_DECISION: SessionDecision = { difficulty: 1500, score: 0.5, rated: true, weight: 1 };

describe("R4.1 Glicko-2 input checks (RangeError naming the field)", () => {
  const playerRows: [string, TrackRating, RegExp][] = [
    ["rating NaN", { ...VALID_PLAYER, rating: Number.NaN }, /rating/],
    ["rating infinite", { ...VALID_PLAYER, rating: Number.POSITIVE_INFINITY }, /rating/],
    ["rd negative", { ...VALID_PLAYER, rd: -1 }, /rd/],
    ["rd infinite", { ...VALID_PLAYER, rd: Number.POSITIVE_INFINITY }, /rd/],
    ["volatility zero", { ...VALID_PLAYER, volatility: 0 }, /volatility/],
    ["volatility NaN", { ...VALID_PLAYER, volatility: Number.NaN }, /volatility/],
  ];
  it.each(playerRows)("R4.1 a player with %s is a RangeError", (_label, player, field) => {
    expect(() => ratePeriod(player, [VALID_RESULT])).toThrow(RangeError);
    expect(() => ratePeriod(player, [VALID_RESULT])).toThrow(field);
    expect(() => applyInactivity(player, 1)).toThrow(RangeError);
    expect(() => rateSession(player, [VALID_DECISION])).toThrow(RangeError);
    expect(() => conservativeRating(player)).toThrow(RangeError);
  });

  const resultRows: [string, PeriodResult, RegExp][] = [
    ["opponent rating NaN", { ...VALID_RESULT, opponent: { rating: Number.NaN, rd: 0 } }, /results\[0\]\.opponent\.rating/],
    ["opponent rd negative", { ...VALID_RESULT, opponent: { rating: 1500, rd: -1 } }, /results\[0\]\.opponent\.rd/],
    ["score above 1", { ...VALID_RESULT, score: 1.1 }, /results\[0\]\.score/],
    ["score below 0", { ...VALID_RESULT, score: -0.1 }, /results\[0\]\.score/],
    ["score NaN", { ...VALID_RESULT, score: Number.NaN }, /results\[0\]\.score/],
    ["weight negative", { ...VALID_RESULT, weight: -1 }, /results\[0\]\.weight/],
    ["weight infinite", { ...VALID_RESULT, weight: Number.POSITIVE_INFINITY }, /results\[0\]\.weight/],
  ];
  it.each(resultRows)("R4.1 a result with %s is a RangeError", (_label, result, field) => {
    expect(() => ratePeriod(VALID_PLAYER, [result])).toThrow(RangeError);
    expect(() => ratePeriod(VALID_PLAYER, [result])).toThrow(field);
  });

  it("R4.1 results that are not a list and a non-positive tau are RangeErrors", () => {
    expect(() => ratePeriod(VALID_PLAYER, "results" as unknown as PeriodResult[])).toThrow(/results/);
    expect(() => ratePeriod(VALID_PLAYER, [VALID_RESULT], 0)).toThrow(/tau/);
    expect(() => ratePeriod(VALID_PLAYER, [VALID_RESULT], Number.NaN)).toThrow(/tau/);
  });

  it("R4.1 results too far away to inform the rating leave the player unchanged instead of throwing, and a session degrades the same way", () => {
    const unreachable = { opponent: { rating: 1e9, rd: 0 }, score: 1 };
    expect(ratePeriod(VALID_PLAYER, [unreachable])).toEqual(VALID_PLAYER);
    const extremeGap: SessionDecision = { difficulty: 1e9, score: 0, rated: true, weight: 1 };
    expect(rateSession(VALID_PLAYER, [extremeGap, extremeGap])).toEqual(VALID_PLAYER);
    // An informative result in the same session still counts; only the empty one is skipped.
    const informative: SessionDecision = { difficulty: VALID_PLAYER.rating, score: 1, rated: true, weight: 1 };
    const mixed = rateSession(VALID_PLAYER, [extremeGap, informative]);
    expect(mixed.rating).toBeGreaterThan(VALID_PLAYER.rating);
    expect(mixed).toEqual(rateSession(VALID_PLAYER, [informative]));
  });

  it("R4.1 results whose weights are all zero form an empty period (the inactivity step)", () => {
    expect(ratePeriod(VALID_PLAYER, [{ ...VALID_RESULT, weight: 0 }])).toEqual(ratePeriod(VALID_PLAYER, []));
  });

  it("R4.1 invalid inactivity counts are RangeErrors", () => {
    expect(() => applyInactivity(VALID_PLAYER, -1)).toThrow(/periods/);
    expect(() => applyInactivity(VALID_PLAYER, 1.5)).toThrow(/periods/);
    expect(() => inactivePeriods(-1)).toThrow(/daysSinceLastRatedSession/);
    expect(() => inactivePeriods(Number.NaN)).toThrow(/daysSinceLastRatedSession/);
    expect(() => inactivePeriods(Number.POSITIVE_INFINITY)).toThrow(/daysSinceLastRatedSession/);
  });

  const decisionRows: [string, SessionDecision, RegExp][] = [
    ["difficulty NaN", { ...VALID_DECISION, difficulty: Number.NaN }, /decisions\[0\]\.difficulty/],
    ["score above 1", { ...VALID_DECISION, score: 2 }, /decisions\[0\]\.score/],
    ["rated not a boolean", { ...VALID_DECISION, rated: "yes" as unknown as boolean }, /decisions\[0\]\.rated/],
    ["weight negative", { ...VALID_DECISION, weight: -1 }, /decisions\[0\]\.weight/],
  ];
  it.each(decisionRows)("R4.1 a session decision with %s is a RangeError, rated or not", (_label, decision, field) => {
    expect(() => rateSession(VALID_PLAYER, [decision])).toThrow(field);
    expect(() => rateSession(VALID_PLAYER, [{ ...decision, rated: decision.rated === true ? false : decision.rated }])).toThrow(
      RangeError,
    );
  });

  it("R4.1 session decisions that are not a list are a RangeError", () => {
    expect(() => rateSession(VALID_PLAYER, null as unknown as SessionDecision[])).toThrow(/decisions/);
  });
});
