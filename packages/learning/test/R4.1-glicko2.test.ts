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
 * Every it.todo below is pending until S30; the one green test checks that this file parses and
 * that the vector data carries the A6 section 6 numbers.
 */
import { describe, expect, it } from "vitest";

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

  it.todo(
    "R4.1 Glickman worked example: 1500, RD 200, volatility 0.06 against (1400, 30) win, (1550, 100) loss, (1700, 300) loss with tau 0.5 gives about 1464.06, RD about 151.52, volatility about 0.05999",
  );
  it.todo(
    "R4.1 fractional outcomes: a score of 0.5 against one opponent at the same rating leaves the rating unchanged and still shrinks RD",
  );
  it.todo(
    "R4.1 fractional outcomes: scores strictly between 0 and 1 against one opponent give rating changes that increase monotonically with the score",
  );
  it.todo(
    "R4.1 one rating period per session (O-27): three decisions in one session update once with all three results, and the result differs from three one-result updates",
  );
  it.todo(
    "R4.1 inactivity raises RD only: an empty period takes RD 200 to about 200.2714 and leaves rating 1500 and volatility 0.06 unchanged",
  );
  it.todo(
    "R4.1 inactivity never subtracts points: ten empty periods take RD to about 202.6978 and the rating stays 1500",
  );
  it.todo("R4.1 defaults: a new track starts at rating 1500, RD 350, volatility 0.06 (ADR 0011, O-56)");
  it.todo(
    "R4.1 conservative rating is rating minus two RD: 1464.06 and 151.52 give 1161.02 (06 section 3.3)",
  );
  it.todo(
    "R4.1 fast-check update symmetry: against an opponent at the player's own rating and RD, scores s and 1 - s move the rating by equal and opposite amounts (S30 adds fast-check as a devDependency)",
  );
  it.todo("R4.1 the update returns a new state and never mutates the input player or results");
});
