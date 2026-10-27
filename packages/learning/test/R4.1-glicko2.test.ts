/**
 * R4.1 Glicko-2 vectors (R0.11 red half; the green half is S30 on p4/learning, src/glicko2.ts).
 *
 * Source of the worked example: Mark Glickman, "Example of the Glicko-2 system" (the paper's own
 * example calculation), repeated in A6 section 6 and 06 section 3.3. The paper rounds its
 * intermediate values, which is why its printed results differ from full-precision arithmetic in
 * the second decimal; the tolerances below cover both readings. Parameters per ADR 0011, accepted
 * at sprint start (O-56). Scores are fractional outcomes in [0, 1] from the grading policy
 * (05 section 6.3); the worked example uses the paper's 1 (win) and 0 (loss).
 *
 * The R0.11 test checks that the vector data carries the A6 section 6 numbers; S30 turned the
 * pending rows green against src/glicko2.ts. The source constants are imported under SRC_ names
 * because this file keeps exporting its own vector constants of the same names.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLICKO2_DEFAULTS as SRC_DEFAULTS,
  GLICKO2_EPSILON as SRC_EPSILON,
  GLICKO2_SCALE as SRC_SCALE,
  GLICKO2_MAX_RD,
  GLICKO2_TAU as SRC_TAU,
  applyInactivity,
  conservativeRating,
  newTrackRating,
  ratePeriod,
  rateSession,
} from "../src/glicko2.js";
import type { PeriodResult, SessionDecision, TrackRating } from "../src/glicko2.js";

/** Conversion factor between the Glicko scale and the internal Glicko-2 scale (paper, step 2). */
export const GLICKO2_SCALE = 173.7178;

/** System constant tau of the worked example and of v1 (A6 section 6, 06 section 3.3). */
export const GLICKO2_TAU = 0.5;

/** Convergence tolerance of the volatility iteration (paper, step 5). */
export const GLICKO2_EPSILON = 0.000001;

/** Starting state of a new track rating (06 section 3.3, ADR 0011, O-56). */
export const GLICKO2_DEFAULTS = Object.freeze({ rating: 1500, rd: 350, volatility: 0.06 });

/** Rating deviation (RD) cap every track must satisfy for promotion (06 section 3.4, O-56). */
export const GLICKO2_PROMOTION_RD_CAP = 120;

/** Daily cap on rated updates per track (06 section 3.6, R4.3, O-56). */
export const RATED_DAILY_CAP_PER_TRACK = 150;

export type Glicko2PlayerVector = { rating: number; rd: number; volatility: number };

export type Glicko2ResultVector = { opponent: { rating: number; rd: number }; score: number };

/** Glickman's worked example: the player, three results in one rating period, and the outcome. */
export const GLICKO2_WORKED_EXAMPLE = Object.freeze({
  player: { rating: 1500, rd: 200, volatility: 0.06 } satisfies Glicko2PlayerVector,
  tau: GLICKO2_TAU,
  results: [
    { opponent: { rating: 1400, rd: 30 }, score: 1 },
    { opponent: { rating: 1550, rd: 100 }, score: 0 },
    { opponent: { rating: 1700, rd: 300 }, score: 0 },
  ] satisfies Glicko2ResultVector[],
  /** As printed in the paper and in A6 section 6. */
  expected: { rating: 1464.06, rd: 151.52, volatility: 0.05999 },
  /** The same update at full precision (recomputed in S05), so a close miss is read as rounding. */
  expectedFullPrecision: { rating: 1464.0507, rd: 151.5165, volatility: 0.059996 },
  /** The paper's intermediate values, for debugging the green implementation step by step. */
  intermediate: {
    g: [0.9955, 0.9531, 0.7242],
    e: [0.639, 0.432, 0.303],
    v: 1.7785,
    delta: -0.4834,
    phiStar: 1.152462,
    phiNew: 0.8722,
    muNew: -0.2069,
  },
  tolerance: { rating: 0.1, rd: 0.1, volatility: 0.0001 },
});

/**
 * A rating period with no results: RD grows to sqrt(RD^2 + (volatility x scale)^2) on the Glicko
 * scale while rating and volatility stay put (paper, step 6 for an inactive player).
 */
export const GLICKO2_INACTIVITY_VECTOR = Object.freeze({
  player: { rating: 1500, rd: 200, volatility: 0.06 } satisfies Glicko2PlayerVector,
  afterOnePeriod: { rating: 1500, rd: 200.2714, volatility: 0.06 },
  afterTenPeriods: { rating: 1500, rd: 202.6978, volatility: 0.06 },
  tolerance: { rd: 0.001 },
});

/** Ranking uses the conservative figure rating minus two RD (06 section 3.3). */
export const GLICKO2_CONSERVATIVE_VECTOR = Object.freeze({
  rating: 1464.06,
  rd: 151.52,
  conservative: 1161.02,
});

/** Full-precision readings of the worked example (S05 recompute), tighter than the paper's rounding. */
const FULL_PRECISION_TOLERANCE = Object.freeze({ rating: 0.01, rd: 0.01, volatility: 0.000001 });

/** Fractional scores strictly between 0 and 1, ascending. */
const FRACTIONAL_SCORES = Object.freeze([0.05, 0.25, 0.5, 0.75, 0.95]);

/** Rating points by which one session of three results and three one-result periods must differ. */
const SESSION_DIFFERENCE_MIN = 0.01;

/** Empty periods in the ten-period inactivity vector. */
const INACTIVE_PERIODS = 10;

const unitScore = fc.double({ min: 0, max: 1, noNaN: true });

/** Players over the range a track rating can reach in practice. */
const playerArbitrary = fc.record({
  rating: fc.double({ min: 800, max: 2600, noNaN: true }),
  rd: fc.double({ min: 30, max: 350, noNaN: true }),
  volatility: fc.double({ min: 0.03, max: 0.09, noNaN: true }),
});

/** Freezes a value and every object inside it, so a mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value) as unknown[]) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe("R4.1 Glicko-2 per track (S30, ADR 0011, O-56)", () => {
  it("R0.11 Glicko-2 vector data parses and carries the A6 section 6 numbers", () => {
    expect(GLICKO2_WORKED_EXAMPLE.results).toHaveLength(3);
    expect(GLICKO2_WORKED_EXAMPLE.player).toEqual({ rating: 1500, rd: 200, volatility: 0.06 });
    expect(GLICKO2_WORKED_EXAMPLE.expected).toEqual({ rating: 1464.06, rd: 151.52, volatility: 0.05999 });
    const { expected, expectedFullPrecision, tolerance } = GLICKO2_WORKED_EXAMPLE;
    expect(Math.abs(expectedFullPrecision.rating - expected.rating)).toBeLessThan(tolerance.rating);
    expect(Math.abs(expectedFullPrecision.rd - expected.rd)).toBeLessThan(tolerance.rd);
    expect(Math.abs(expectedFullPrecision.volatility - expected.volatility)).toBeLessThan(
      tolerance.volatility,
    );
    expect(GLICKO2_CONSERVATIVE_VECTOR.rating - 2 * GLICKO2_CONSERVATIVE_VECTOR.rd).toBeCloseTo(
      GLICKO2_CONSERVATIVE_VECTOR.conservative,
      6,
    );
    expect(GLICKO2_DEFAULTS).toEqual({ rating: 1500, rd: 350, volatility: 0.06 });
  });

  it("R4.1 Glickman worked example: 1500, RD 200, volatility 0.06 against (1400, 30) win, (1550, 100) loss, (1700, 300) loss with tau 0.5 gives about 1464.06, RD about 151.52, volatility about 0.05999", () => {
    const { player, results, tau, expected, expectedFullPrecision, tolerance } = GLICKO2_WORKED_EXAMPLE;
    const updated = ratePeriod(player, results, tau);
    expect(Math.abs(updated.rating - expected.rating)).toBeLessThan(tolerance.rating);
    expect(Math.abs(updated.rd - expected.rd)).toBeLessThan(tolerance.rd);
    expect(Math.abs(updated.volatility - expected.volatility)).toBeLessThan(tolerance.volatility);
    expect(Math.abs(updated.rating - expectedFullPrecision.rating)).toBeLessThan(FULL_PRECISION_TOLERANCE.rating);
    expect(Math.abs(updated.rd - expectedFullPrecision.rd)).toBeLessThan(FULL_PRECISION_TOLERANCE.rd);
    expect(Math.abs(updated.volatility - expectedFullPrecision.volatility)).toBeLessThan(
      FULL_PRECISION_TOLERANCE.volatility,
    );
  });

  it("R4.1 fractional outcomes: a score of 0.5 against one opponent at the same rating leaves the rating unchanged and still shrinks RD", () => {
    const player = GLICKO2_WORKED_EXAMPLE.player;
    const updated = ratePeriod(player, [{ opponent: { rating: player.rating, rd: player.rd }, score: 0.5 }]);
    expect(updated.rating).toBeCloseTo(player.rating, 9);
    expect(updated.rd).toBeLessThan(player.rd);
    expect(updated.volatility).toBeCloseTo(player.volatility, 3);
  });

  it("R4.1 fractional outcomes: scores strictly between 0 and 1 against one opponent give rating changes that increase monotonically with the score", () => {
    const player = GLICKO2_WORKED_EXAMPLE.player;
    const opponent = { rating: 1550, rd: 100 };
    const changes = FRACTIONAL_SCORES.map((score) => ratePeriod(player, [{ opponent, score }]).rating - player.rating);
    changes.slice(1).forEach((change, index) => {
      expect(change).toBeGreaterThan(changes[index] ?? Number.POSITIVE_INFINITY);
    });
  });

  it("R4.1 one rating period per session (O-27): three decisions in one session update once with all three results, and the result differs from three one-result updates", () => {
    const { player, results } = GLICKO2_WORKED_EXAMPLE;
    const oneSession = ratePeriod(player, results);
    const threePeriods = results.reduce<TrackRating>((state, result) => ratePeriod(state, [result]), player);
    expect(Math.abs(oneSession.rating - threePeriods.rating)).toBeGreaterThan(SESSION_DIFFERENCE_MIN);
    expect(Math.abs(oneSession.rd - threePeriods.rd)).toBeGreaterThan(SESSION_DIFFERENCE_MIN);

    const decisions: SessionDecision[] = results.map((result) => ({
      difficulty: result.opponent.rating,
      score: result.score,
      rated: true,
      weight: 1,
    }));
    const itemResults: PeriodResult[] = results.map((result) => ({
      opponent: { rating: result.opponent.rating, rd: 0 },
      score: result.score,
    }));
    expect(rateSession(player, decisions)).toEqual(ratePeriod(player, itemResults));
  });

  it("R4.1 inactivity raises RD only: an empty period takes RD 200 to about 200.2714 and leaves rating 1500 and volatility 0.06 unchanged", () => {
    const { player, afterOnePeriod, tolerance } = GLICKO2_INACTIVITY_VECTOR;
    for (const updated of [ratePeriod(player, []), applyInactivity(player, 1)]) {
      expect(updated.rating).toBe(afterOnePeriod.rating);
      expect(updated.volatility).toBe(afterOnePeriod.volatility);
      expect(Math.abs(updated.rd - afterOnePeriod.rd)).toBeLessThan(tolerance.rd);
    }
  });

  it("R4.1 inactivity RD is capped at the starting RD of 350, so an idle track is never less certain than a newcomer (O-259)", () => {
    expect(GLICKO2_MAX_RD).toBe(SRC_DEFAULTS.rd);
    for (const periods of [52, 104]) {
      expect(applyInactivity(newTrackRating(), periods).rd).toBe(GLICKO2_MAX_RD);
      const nearCap = { rating: 1600, rd: 340, volatility: 0.06 };
      const idle = applyInactivity(nearCap, periods);
      expect(idle.rd).toBeLessThanOrEqual(GLICKO2_MAX_RD);
      expect(idle.rating).toBe(nearCap.rating);
      const stepwise = Array.from({ length: periods }).reduce<TrackRating>((state) => ratePeriod(state, []), nearCap);
      expect(stepwise.rd).toBeLessThanOrEqual(GLICKO2_MAX_RD);
      expect(conservativeRating(idle)).toBeGreaterThanOrEqual(conservativeRating(newTrackRating()));
    }
    // Uncapped, 104 periods from 340 would reach about 356; the cap holds it at 350.
    expect(applyInactivity({ rating: 1600, rd: 340, volatility: 0.06 }, 104).rd).toBe(GLICKO2_MAX_RD);
    // A track already above the cap never has its RD lowered by inactivity.
    expect(applyInactivity({ rating: 1500, rd: 400, volatility: 0.06 }, 1).rd).toBe(400);
  });

  it("R4.1 inactivity never subtracts points: ten empty periods take RD to about 202.6978 and the rating stays 1500", () => {
    const { player, afterTenPeriods, tolerance } = GLICKO2_INACTIVITY_VECTOR;
    const closedForm = applyInactivity(player, INACTIVE_PERIODS);
    const stepwise = Array.from({ length: INACTIVE_PERIODS }).reduce<TrackRating>(
      (state) => ratePeriod(state, []),
      player,
    );
    for (const updated of [closedForm, stepwise]) {
      expect(updated.rating).toBe(afterTenPeriods.rating);
      expect(updated.volatility).toBe(afterTenPeriods.volatility);
      expect(Math.abs(updated.rd - afterTenPeriods.rd)).toBeLessThan(tolerance.rd);
    }
    expect(closedForm.rd).toBeCloseTo(stepwise.rd, 9);
  });

  it("R4.1 defaults: a new track starts at rating 1500, RD 350, volatility 0.06 (ADR 0011, O-56)", () => {
    expect(newTrackRating()).toEqual(GLICKO2_DEFAULTS);
    expect(newTrackRating()).not.toBe(newTrackRating());
    expect(SRC_DEFAULTS).toEqual(GLICKO2_DEFAULTS);
    expect(SRC_TAU).toBe(GLICKO2_TAU);
    expect(SRC_SCALE).toBe(GLICKO2_SCALE);
    expect(SRC_EPSILON).toBe(GLICKO2_EPSILON);
  });

  it("R4.1 conservative rating is rating minus two RD: 1464.06 and 151.52 give 1161.02 (06 section 3.3)", () => {
    const { rating, rd, conservative } = GLICKO2_CONSERVATIVE_VECTOR;
    expect(conservativeRating({ rating, rd, volatility: GLICKO2_DEFAULTS.volatility })).toBeCloseTo(conservative, 6);
  });

  it("R4.1 fast-check update symmetry: against an opponent at the player's own rating and RD, scores s and 1 - s move the rating by equal and opposite amounts (S30 adds fast-check as a devDependency)", () => {
    fc.assert(
      fc.property(playerArbitrary, unitScore, (player, score) => {
        const opponent = { rating: player.rating, rd: player.rd };
        const up = ratePeriod(player, [{ opponent, score }]);
        const down = ratePeriod(player, [{ opponent, score: 1 - score }]);
        expect(up.rating - player.rating + (down.rating - player.rating)).toBeCloseTo(0, 9);
        expect(up.rd).toBeCloseTo(down.rd, 9);
        expect(up.volatility).toBeCloseTo(down.volatility, 12);
      }),
    );
  });

  it("R4.1 the update returns a new state and never mutates the input player or results", () => {
    const player = deepFreeze({ ...GLICKO2_WORKED_EXAMPLE.player });
    const results = deepFreeze(
      GLICKO2_WORKED_EXAMPLE.results.map((result) => ({ ...result, opponent: { ...result.opponent } })),
    );
    const decisions = deepFreeze(
      results.map((result) => ({ difficulty: result.opponent.rating, score: result.score, rated: true, weight: 1 })),
    );
    const before = structuredClone({ player, results, decisions });
    const outputs = [
      ratePeriod(player, results),
      ratePeriod(player, []),
      applyInactivity(player, 0),
      rateSession(player, decisions),
      rateSession(player, []),
    ];
    expect({ player, results, decisions }).toEqual(before);
    outputs.forEach((output) => expect(output).not.toBe(player));
  });
});
