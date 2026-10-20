/**
 * R4.7 BKT (Bayesian Knowledge Tracing) vectors (R0.11 red half; the green half is S30 on
 * p4/learning, src/bkt.ts).
 *
 * Parameters from 06 section 5 (ADR 0012): prior 0.2, learn 0.15, guess 0.2, slip 0.1; mastered
 * at p of 0.95 or more; gates nothing. Hand computation, with p the current probability of having
 * learned the class:
 *
 *   posterior after a correct answer   = p (1 - slip) / (p (1 - slip) + (1 - p) guess)
 *   posterior after a wrong answer     = p slip / (p slip + (1 - p) (1 - guess))
 *   p after the learn transition       = posterior + (1 - posterior) learn
 *
 * Each sequence lists both numbers per step. Step 1 of the first sequence in fractions: posterior
 * 0.18 / 0.34 = 9/17, then 9/17 + (8/17)(0.15) = 10.2/17 = 0.6. Step 2: 0.54 / 0.62 = 27/31, then
 * 27.6/31. Values are rounded to ten decimals; BKT_TOLERANCE covers that rounding.
 */
import { describe, expect, it } from "vitest";

export const BKT_PARAMETERS = Object.freeze({ prior: 0.2, learn: 0.15, guess: 0.2, slip: 0.1 });

export const BKT_MASTERY_THRESHOLD = 0.95;

export const BKT_TOLERANCE = 1e-9;

export type BktSequenceVector = {
  name: string;
  /** true is a correct answer, false a wrong one. */
  observations: boolean[];
  /** p given the evidence, before the learn transition, per step. */
  posteriorAfterEvidence: number[];
  /** p after the learn transition, per step; this is the state the next step starts from. */
  pLearnedAfterTransition: number[];
  /** 1-based index of the step after which p first reaches 0.95, or null if it never does. */
  masteredAfterStep: number | null;
};

export const BKT_SEQUENCES: readonly BktSequenceVector[] = Object.freeze([
  {
    name: "four correct in a row",
    observations: [true, true, true, true],
    posteriorAfterEvidence: [0.5294117647, 0.8709677419, 0.973354232, 0.9948766587],
    pLearnedAfterTransition: [0.6, 0.8903225806, 0.9773510972, 0.9956451599],
    masteredAfterStep: 3,
  },
  {
    name: "correct, wrong, correct, correct",
    observations: [true, false, true, true],
    posteriorAfterEvidence: [0.5294117647, 0.1578947368, 0.6411609499, 0.9111384426],
    pLearnedAfterTransition: [0.6, 0.2842105263, 0.6949868074, 0.9244676762],
    masteredAfterStep: null,
  },
  {
    name: "wrong, wrong, correct",
    observations: [false, false, true],
    posteriorAfterEvidence: [0.0303030303, 0.0259623993, 0.4832653517],
    pLearnedAfterTransition: [0.1757575758, 0.1720680394, 0.560775549],
    masteredAfterStep: null,
  },
]);

describe("R4.7 BKT mastery per spot class (S30, ADR 0012)", () => {
  it("R0.11 BKT vector data parses and is internally consistent with the 06 section 5 parameters", () => {
    expect(BKT_PARAMETERS).toEqual({ prior: 0.2, learn: 0.15, guess: 0.2, slip: 0.1 });
    expect(BKT_SEQUENCES).toHaveLength(3);
    for (const sequence of BKT_SEQUENCES) {
      const steps = sequence.observations.length;
      expect(sequence.posteriorAfterEvidence).toHaveLength(steps);
      expect(sequence.pLearnedAfterTransition).toHaveLength(steps);
      sequence.pLearnedAfterTransition.forEach((p, index) => {
        const posterior = sequence.posteriorAfterEvidence[index] ?? Number.NaN;
        // The learn transition only adds probability, so p after it is at least the posterior.
        expect(p).toBeGreaterThanOrEqual(posterior - BKT_TOLERANCE);
        expect(p).toBeLessThanOrEqual(1);
        expect(posterior).toBeGreaterThanOrEqual(0);
      });
      const firstMastered = sequence.pLearnedAfterTransition.findIndex((p) => p >= BKT_MASTERY_THRESHOLD);
      expect(firstMastered === -1 ? null : firstMastered + 1).toBe(sequence.masteredAfterStep);
    }
  });

  it.todo(
    "R4.7 four correct in a row from prior 0.2 (learn 0.15, guess 0.2, slip 0.1): p after each update is 0.6, 0.8903225806, 0.9773510972, 0.9956451599",
  );
  it.todo(
    "R4.7 correct, wrong, correct, correct: p after each update is 0.6, 0.2842105263, 0.6949868074, 0.9244676762",
  );
  it.todo("R4.7 wrong, wrong, correct: p after each update is 0.1757575758, 0.1720680394, 0.560775549");
  it.todo(
    "R4.7 posterior before the learn transition is exposed per step: 0.5294117647 (9/17) then 0.8709677419 (27/31) for two correct answers",
  );
  it.todo(
    "R4.7 mastered at 0.95 or more: the four-correct sequence is mastered after the third update and not after the second",
  );
  it.todo(
    "R4.7 mastery gates nothing: the mastery state has no lock field and a class at p 0.1 stays eligible for the queue (ADR 0012)",
  );
  it.todo(
    "R4.7 observation mapping: a decision counts as correct when its label is Best or Correct, that is loss at or below the floor (proposed, S30 confirms)",
  );
  it.todo("R4.7 the update returns a new state and never mutates the state it was given");
});
