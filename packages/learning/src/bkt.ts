/**
 * BKT (Bayesian Knowledge Tracing) mastery per spot class (A6 section 1 row "BKT mastery"; 06
 * section 5; ADR 0012). Owner: S30 (p4/learning), closing R4.7.
 *
 * Mechanism: a class's mastery is one probability, pKnown, that the hero has learned it. It starts
 * at the prior. After each graded instance the posterior given the evidence is computed with the
 * guess and slip rates (a correct answer is p (1 - slip) / (p (1 - slip) + (1 - p) guess), a wrong
 * one p slip / (p slip + (1 - p) (1 - guess))), then the learn transition adds (1 - posterior)
 * learn. Both numbers are returned so the heat map and the tests can see each step. A decision is
 * evidence of knowing when its label is Best or Correct (isCorrectLabel, O-215). Mastered means
 * pKnown of 0.95 or more.
 *
 * Mastery gates nothing and locks no content (ADR 0012): Mastery carries pKnown only, and queue
 * selection (src/queue.ts) takes no mastery input. Its one scheduling effect is that FSRS spaces a
 * mastered class at the lower retention of retentionFor in src/fsrs.ts (O-253).
 */
import { isCorrectLabel } from "./calibration.js";
import type { GradeLabel, ModulePlaceholder } from "./types.js";
import { requireBoolean } from "./validate.js";

/** Starting parameters of 06 section 5, tuned once data exists. */
export const BKT_PARAMETERS = Object.freeze({ prior: 0.2, learn: 0.15, guess: 0.2, slip: 0.1 });

/** A class is mastered at pKnown of 0.95 or more (06 section 5). */
export const MASTERY_THRESHOLD = 0.95;

/** The four BKT parameters: prior and learn in [0, 1], guess and slip in (0, 1). */
export type BktParameters = Readonly<{ prior: number; learn: number; guess: number; slip: number }>;

/** Mastery of one class; no lock or gate field, because mastery gates nothing (ADR 0012). */
export type Mastery = Readonly<{ pKnown: number }>;

/** One update: the posterior given the evidence, and the mastery after the learn transition. */
export type MasteryUpdate = Readonly<{ posterior: number; mastery: Mastery }>;

/** A probability in [0, 1], or a RangeError naming the field. */
function requireProbability(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be a number from 0 to 1, got ${String(value)}`);
  }
  return value;
}

/** A probability strictly between 0 and 1, so neither evidence denominator can vanish. */
function requireOpenProbability(value: number, field: string): number {
  if (requireProbability(value, field) === 0 || value === 1) {
    throw new RangeError(`${field} must be strictly between 0 and 1, got ${value}`);
  }
  return value;
}

function requireParameters(params: BktParameters): BktParameters {
  return {
    prior: requireProbability(params.prior, "params.prior"),
    learn: requireProbability(params.learn, "params.learn"),
    guess: requireOpenProbability(params.guess, "params.guess"),
    slip: requireOpenProbability(params.slip, "params.slip"),
  };
}

/** The starting mastery of a class: pKnown at the prior. */
export function newMastery(params: BktParameters = BKT_PARAMETERS): Mastery {
  return Object.freeze({ pKnown: requireParameters(params).prior });
}

/** p given one observation, before the learn transition. */
function posteriorOf(p: number, correct: boolean, params: BktParameters): number {
  const known = correct ? p * (1 - params.slip) : p * params.slip;
  const unknown = correct ? (1 - p) * params.guess : (1 - p) * (1 - params.guess);
  return known / (known + unknown);
}

/** One instance: the posterior given the evidence, then the learn transition. Never mutates mastery. */
export function updateMastery(
  mastery: Mastery,
  correct: boolean,
  params: BktParameters = BKT_PARAMETERS,
): MasteryUpdate {
  const p = requireProbability(mastery.pKnown, "mastery.pKnown");
  const valid = requireParameters(params);
  const posterior = posteriorOf(p, requireBoolean(correct, "correct"), valid);
  const pKnown = posterior + (1 - posterior) * valid.learn;
  return Object.freeze({ posterior, mastery: Object.freeze({ pKnown }) });
}

/** The BKT observation of a graded decision: correct when the label is Best or Correct (O-215). */
export function observationFromLabel(label: GradeLabel): boolean {
  return isCorrectLabel(label);
}

/** True when pKnown is at or above MASTERY_THRESHOLD. */
export function isMastered(mastery: Mastery): boolean {
  return requireProbability(mastery.pKnown, "mastery.pKnown") >= MASTERY_THRESHOLD;
}

/** Placeholder kept until the S30 integration step removes it from src/index.ts (R0.11). */
export const BKT_MODULE: ModulePlaceholder = Object.freeze({
  module: "bkt",
  responsibility: "BKT mastery probability per spot class, mastered at 0.95, gating nothing",
  session: "S30",
  requirements: ["R4.7"],
});
