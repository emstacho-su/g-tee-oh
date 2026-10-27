/**
 * R4.2 simulated learner (S30; 06 section 3.3, ADR 0011, O-27, O-56, O-65, O-250, O-258).
 *
 * Risk R-7 says Glicko-2 was built for outcomes of 0, 0.5 and 1, while the grading policy feeds it
 * fractional scores in [0, 1] (05 section 6.3). This file verifies by simulation that the update
 * still finds a learner's true skill. A learner of known skill answers items whose difficulty is
 * uniform over 1100 to 1900 (O-250); each item's expected score E comes from the Glicko-2 E
 * function, and the observed score is uniform on [E - a, E + a] with a = min(E, 1 - E), so it is
 * fractional, stays in [0, 1] and has mean E (O-258). Every session of 20 items is one rating
 * period (O-27). After 300 items the rating must sit within 25 points of the skill (O-65), at the
 * fixed seed for each of the three skills and in at least 95 percent of a 100-seed sweep.
 *
 * The last rows tie the simulation to the anti-farming rules (R4.3): a session of repeats or drills
 * graded through grade() leaves a converged track identical, while the same session rated moves it.
 * Fixtures are synthetic numbers; randomness comes only from splitMix64Source.
 */
import { describe, expect, it } from "vitest";

import { rateSession } from "../src/glicko2.js";
import type { SessionDecision, TrackRating } from "../src/glicko2.js";
import { grade } from "../src/grading.js";
import { splitMix64Source } from "../src/random.js";
import type { GradeInput } from "../src/types.js";
import {
  CONVERGENCE_TOLERANCE,
  ITEM_COUNT,
  LEARNER_ITEM_MAX,
  LEARNER_ITEM_MIN,
  SESSION_SIZE,
  SIMULATION_SEED,
  expectedScore,
  observedScore,
  simulateLearner,
} from "./support/simulated-learner.js";

/** The three learner skills of O-258. */
const SKILLS: readonly number[] = [1300, 1500, 1700];

/** Seeds in the sweep: SIMULATION_SEED + k for k = 0 to 99 (O-258). */
const SWEEP_SEED_COUNT = 100;

/** Share of sweep runs that must land within the tolerance (O-258). */
const SWEEP_PASS_SHARE = 0.95;

/** Draws and tolerance of the observed-score sanity row. */
const SANITY_DRAWS = 10_000;
const SANITY_MEAN_TOLERANCE = 0.01;
const SANITY_EXPECTED: readonly number[] = [0.1, 0.5, 0.9];

/** The sweep runs 300 learners of 300 items, so it gets more than the default five seconds. */
const SWEEP_TIMEOUT_MS = 120_000;

/** A rated automated preflop decision in the style of the R4.3 fixture; loss varies per item. */
const RATED_INPUT: GradeInput = Object.freeze({
  lossPctPot: 0.6,
  floorPctPot: 0.2,
  freqByAction: Object.freeze([0, 0.4, 0.6]),
  actionIndex: 1,
  noiseFlags: Object.freeze([]),
  mode: "automated",
  firstAttempt: true,
  panelsRevealed: false,
  ratedTodayInTrack: 0,
  street: "preflop",
});

/** Synthetic losses in percent of the pot and item difficulties of one replayed session. */
const SESSION_LOSSES: readonly number[] = [0, 0.1, 0.3, 0.6, 1, 1.5, 2.5, 4, 0.2, 0.8];
const SESSION_DIFFICULTIES: readonly number[] = [1150, 1250, 1350, 1450, 1500, 1550, 1650, 1750, 1850, 1600];

function sessionOf(input: Partial<GradeInput>): SessionDecision[] {
  return SESSION_LOSSES.map((lossPctPot, index) => {
    const output = grade({ ...RATED_INPUT, ...input, lossPctPot });
    return { difficulty: SESSION_DIFFICULTIES[index] ?? LEARNER_ITEM_MIN, score: output.score, rated: output.rated, weight: output.weight };
  });
}

function absoluteError(final: TrackRating, skill: number): number {
  return Math.abs(final.rating - skill);
}

/** Distribution of the sweep, kept so the verifier's report can quote it. */
type SweepDistribution = Readonly<{ runs: number; within: number; maxAbsError: number; meanAbsError: number }>;

function sweep(): SweepDistribution {
  const errors = SKILLS.flatMap((skill) =>
    Array.from({ length: SWEEP_SEED_COUNT }, (_unused, k) =>
      absoluteError(simulateLearner(skill, splitMix64Source(BigInt(SIMULATION_SEED + k))).final, skill),
    ),
  );
  return {
    runs: errors.length,
    within: errors.filter((error) => error <= CONVERGENCE_TOLERANCE).length,
    maxAbsError: Math.max(...errors),
    meanAbsError: errors.reduce((sum, error) => sum + error, 0) / errors.length,
  };
}

describe("R4.2 simulated learner: fractional outcomes recover the true skill (O-65, O-258, risk R-7)", () => {
  it("R4.2 the simulation constants are the O-250, O-65 and O-258 values", () => {
    expect([LEARNER_ITEM_MIN, LEARNER_ITEM_MAX]).toEqual([1100, 1900]);
    expect([SESSION_SIZE, ITEM_COUNT, CONVERGENCE_TOLERANCE, SIMULATION_SEED]).toEqual([20, 300, 25, 20261020]);
  });

  it.each(SKILLS)("R4.2 a learner of skill %i is rated within 25 points after 300 items at seed 20261020", (skill) => {
    const { final, trajectory } = simulateLearner(skill, splitMix64Source(BigInt(SIMULATION_SEED)));
    expect(trajectory).toHaveLength(ITEM_COUNT / SESSION_SIZE);
    expect(trajectory.at(-1)).toEqual(final);
    expect(absoluteError(final, skill)).toBeLessThanOrEqual(CONVERGENCE_TOLERANCE);
  });

  it(
    "R4.2 across a 100-seed sweep of the three skills at least 95 percent of runs land within 25 points",
    () => {
      const distribution = sweep();
      expect(distribution.runs).toBe(SKILLS.length * SWEEP_SEED_COUNT);
      expect(distribution.within / distribution.runs, JSON.stringify(distribution)).toBeGreaterThanOrEqual(SWEEP_PASS_SHARE);
    },
    SWEEP_TIMEOUT_MS,
  );

  it("R4.2 the same seed replays the same trajectory", () => {
    const first = simulateLearner(1500, splitMix64Source(BigInt(SIMULATION_SEED)));
    const second = simulateLearner(1500, splitMix64Source(BigInt(SIMULATION_SEED)));
    expect(second).toEqual(first);
  });
});

describe("R4.2 simulated learner helper sanity (O-258)", () => {
  it("R4.2 expectedScore is one half against an equal item and rises with the skill gap", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 12);
    expect(expectedScore(1700, 1500)).toBeGreaterThan(0.5);
    expect(expectedScore(1300, 1500)).toBeCloseTo(1 - expectedScore(1700, 1500), 12);
  });

  it.each(SANITY_EXPECTED)("R4.2 observedScore around E %f stays in [0, 1] and its mean over 10,000 draws is within 0.01 of E", (e) => {
    const random = splitMix64Source(BigInt(SIMULATION_SEED));
    const draws = Array.from({ length: SANITY_DRAWS }, () => observedScore(e, random));
    expect(draws.every((score) => score >= 0 && score <= 1)).toBe(true);
    const mean = draws.reduce((sum, score) => sum + score, 0) / draws.length;
    expect(Math.abs(mean - e)).toBeLessThanOrEqual(SANITY_MEAN_TOLERANCE);
  });

  it("R4.2 observed scores are fractional, not only 0, 0.5 and 1", () => {
    const random = splitMix64Source(BigInt(SIMULATION_SEED));
    const draws = Array.from({ length: 100 }, () => observedScore(0.5, random));
    expect(draws.some((score) => score !== 0 && score !== 0.5 && score !== 1)).toBe(true);
  });
});

describe("R4.2 repeat and drill attempts leave a converged rating unchanged (R4.3, O-251)", () => {
  const converged = simulateLearner(1500, splitMix64Source(BigInt(SIMULATION_SEED))).final;

  it("R4.2 the rated session is rated and moves the converged rating", () => {
    const rated = sessionOf({});
    expect(rated.every((decision) => decision.rated && decision.weight > 0)).toBe(true);
    expect(rateSession(converged, rated).rating).not.toBe(converged.rating);
  });

  it("R4.2 the same session as repeats (firstAttempt false) leaves rating, RD and volatility identical", () => {
    const repeats = sessionOf({ firstAttempt: false });
    expect(repeats.every((decision) => !decision.rated)).toBe(true);
    expect(rateSession(converged, repeats)).toEqual(converged);
  });

  it("R4.2 the same session as drills leaves rating, RD and volatility identical", () => {
    const drills = sessionOf({ mode: "drill" });
    expect(drills.every((decision) => !decision.rated)).toBe(true);
    expect(rateSession(converged, drills)).toEqual(converged);
  });
});
