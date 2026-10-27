/**
 * Simulated learner for R4.2 (S30, O-65, O-250, O-258). Test-only: it lives outside src, so it is
 * neither shipped nor measured by the coverage gate, but it keeps the package's purity rules
 * anyway. Randomness comes only from the RandomSource argument, and nothing reads a clock or does
 * input or output.
 *
 * Mechanism: a learner of fixed skill answers ITEM_COUNT items in sessions of SESSION_SIZE. Each
 * item's difficulty is uniform over [LEARNER_ITEM_MIN, LEARNER_ITEM_MAX] (O-250). The expected score
 * E is the Glicko-2 E function on the internal scale against an item at ITEM_RD, and the observed
 * score is uniform on [E - a, E + a] with a = min(E, 1 - E), so it is fractional, stays in [0, 1]
 * and has mean E (O-258). Each session is one rateSession call (one rating period, O-27) with every
 * decision rated at weight 1. The trajectory holds the track after each session.
 */
import { GLICKO2_SCALE, ITEM_RD, newTrackRating, rateSession } from "../../src/glicko2.js";
import type { SessionDecision, TrackRating } from "../../src/glicko2.js";
import type { RandomSource } from "../../src/types.js";

/** Lowest and highest item difficulty a learner meets (O-250). */
export const LEARNER_ITEM_MIN = 1100;
export const LEARNER_ITEM_MAX = 1900;

/** Items per session, one rating period each (O-27, O-258). */
export const SESSION_SIZE = 20;

/** Items a learner answers before the convergence check (O-65). */
export const ITEM_COUNT = 300;

/** Rating points the final rating may sit from the true skill (O-65). */
export const CONVERGENCE_TOLERANCE = 25;

/** The fixed seed of the simulation (O-258). */
export const SIMULATION_SEED = 20261020;

/** The rating that maps to mu 0 on the internal scale (Glickman, step 2). */
const CENTER_RATING = 1500;

/** Options of one simulated run; defaults are the O-258 values. */
export type SimulationOptions = Readonly<{ itemCount?: number; sessionSize?: number }>;

/** The track after the last session and after each session in order. */
export type SimulationResult = Readonly<{ final: TrackRating; trajectory: readonly TrackRating[] }>;

/** g(phi) = 1 / sqrt(1 + 3 phi^2 / pi^2) (Glickman, step 3); g(0) is 1. */
function gOf(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** The Glicko-2 expected score of a learner of this skill against an item of this difficulty. */
export function expectedScore(skill: number, difficulty: number): number {
  const muSkill = (skill - CENTER_RATING) / GLICKO2_SCALE;
  const muItem = (difficulty - CENTER_RATING) / GLICKO2_SCALE;
  const g = gOf(ITEM_RD / GLICKO2_SCALE);
  return 1 / (1 + Math.exp(-g * (muSkill - muItem)));
}

/** A fractional observed score: uniform on [E - a, E + a] with a = min(E, 1 - E) (O-258). */
export function observedScore(expected: number, random: RandomSource): number {
  if (!(Number.isFinite(expected) && expected >= 0 && expected <= 1)) {
    throw new RangeError(`expected must be from 0 to 1, got ${expected}`);
  }
  const halfWidth = Math.min(expected, 1 - expected);
  const score = expected - halfWidth + 2 * halfWidth * random();
  return Math.min(1, Math.max(0, score));
}

function drawDifficulty(random: RandomSource): number {
  return LEARNER_ITEM_MIN + (LEARNER_ITEM_MAX - LEARNER_ITEM_MIN) * random();
}

function drawSession(skill: number, size: number, random: RandomSource): SessionDecision[] {
  return Array.from({ length: size }, () => {
    const difficulty = drawDifficulty(random);
    const score = observedScore(expectedScore(skill, difficulty), random);
    return { difficulty, score, rated: true, weight: 1 };
  });
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Runs one learner from a new track: itemCount items in sessions of sessionSize, the last session
 * shorter when sessionSize does not divide itemCount.
 */
export function simulateLearner(skill: number, random: RandomSource, options: SimulationOptions = {}): SimulationResult {
  if (!Number.isFinite(skill)) {
    throw new RangeError(`skill must be a finite number, got ${skill}`);
  }
  const itemCount = requirePositiveInteger(options.itemCount ?? ITEM_COUNT, "itemCount");
  const sessionSize = requirePositiveInteger(options.sessionSize ?? SESSION_SIZE, "sessionSize");
  const sessionCount = Math.ceil(itemCount / sessionSize);
  const trajectory = Array.from({ length: sessionCount }).reduce<readonly TrackRating[]>((tracks, _unused, index) => {
    const size = Math.min(sessionSize, itemCount - index * sessionSize);
    const before = tracks.at(-1) ?? newTrackRating();
    return [...tracks, rateSession(before, drawSession(skill, size, random))];
  }, []);
  return Object.freeze({ final: trajectory.at(-1) ?? newTrackRating(), trajectory: Object.freeze(trajectory) });
}
