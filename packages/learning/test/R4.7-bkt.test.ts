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

import {
  BKT_PARAMETERS as MODULE_BKT_PARAMETERS,
  MASTERY_THRESHOLD,
  isMastered,
  newMastery,
  observationFromLabel,
  updateMastery,
} from "../src/bkt.js";
import type { BktParameters, Mastery } from "../src/bkt.js";
import { emptyQueueState, pickNext } from "../src/queue.js";
import type { GradeLabel } from "../src/types.js";

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

  /** Runs observations from the prior; returns the posterior and p after the transition per step. */
  function runSequence(observations: readonly boolean[]): { posteriors: number[]; ps: number[] } {
    const steps = observations.reduce<{ mastery: Mastery; posteriors: number[]; ps: number[] }>(
      (run, correct) => {
        const step = updateMastery(run.mastery, correct);
        return {
          mastery: step.mastery,
          posteriors: [...run.posteriors, step.posterior],
          ps: [...run.ps, step.mastery.pKnown],
        };
      },
      { mastery: newMastery(), posteriors: [], ps: [] },
    );
    return { posteriors: steps.posteriors, ps: steps.ps };
  }

  function expectSequence(name: string): void {
    const sequence = BKT_SEQUENCES.find((row) => row.name === name);
    if (sequence === undefined) {
      throw new Error(`no BKT sequence named ${name}`);
    }
    const { posteriors, ps } = runSequence(sequence.observations);
    expect(ps).toHaveLength(sequence.pLearnedAfterTransition.length);
    ps.forEach((p, index) => {
      const expectedP = sequence.pLearnedAfterTransition[index] ?? Number.NaN;
      const expectedPosterior = sequence.posteriorAfterEvidence[index] ?? Number.NaN;
      expect(Math.abs(p - expectedP)).toBeLessThan(BKT_TOLERANCE);
      expect(Math.abs((posteriors[index] ?? Number.NaN) - expectedPosterior)).toBeLessThan(BKT_TOLERANCE);
    });
  }

  it("R4.7 the module's parameters and threshold are the 06 section 5 values the vectors use", () => {
    expect(MODULE_BKT_PARAMETERS).toEqual(BKT_PARAMETERS);
    expect(MASTERY_THRESHOLD).toBe(BKT_MASTERY_THRESHOLD);
    expect(newMastery()).toEqual({ pKnown: BKT_PARAMETERS.prior });
  });

  it("R4.7 four correct in a row from prior 0.2 (learn 0.15, guess 0.2, slip 0.1): p after each update is 0.6, 0.8903225806, 0.9773510972, 0.9956451599", () => {
    expectSequence("four correct in a row");
  });

  it("R4.7 correct, wrong, correct, correct: p after each update is 0.6, 0.2842105263, 0.6949868074, 0.9244676762", () => {
    expectSequence("correct, wrong, correct, correct");
  });

  it("R4.7 wrong, wrong, correct: p after each update is 0.1757575758, 0.1720680394, 0.560775549", () => {
    expectSequence("wrong, wrong, correct");
  });

  it("R4.7 posterior before the learn transition is exposed per step: 0.5294117647 (9/17) then 0.8709677419 (27/31) for two correct answers", () => {
    const first = updateMastery(newMastery(), true);
    expect(first.posterior).toBeCloseTo(9 / 17, 12);
    expect(first.mastery.pKnown).toBeCloseTo(0.6, 12);
    const second = updateMastery(first.mastery, true);
    expect(second.posterior).toBeCloseTo(27 / 31, 12);
    expect(second.mastery.pKnown).toBeCloseTo(27.6 / 31, 12);
  });

  it("R4.7 mastered at 0.95 or more: the four-correct sequence is mastered after the third update and not after the second", () => {
    const { ps } = runSequence([true, true, true, true]);
    expect(ps.map((pKnown) => isMastered({ pKnown }))).toEqual([false, false, true, true]);
    expect(isMastered({ pKnown: MASTERY_THRESHOLD })).toBe(true);
    expect(isMastered({ pKnown: MASTERY_THRESHOLD - 1e-12 })).toBe(false);
  });

  it("R4.7 mastery gates nothing: the mastery state has no lock field and a class at p 0.1 stays eligible for the queue (ADR 0012)", () => {
    const low: Mastery = { pKnown: 0.1 };
    expect(isMastered(low)).toBe(false);
    expect(Object.keys(newMastery())).toEqual(["pKnown"]);
    expect(Object.keys(updateMastery(low, false).mastery)).toEqual(["pKnown"]);
    // pickNext takes no mastery input, so a class at p 0.1 is served like any other.
    const { pick } = pickNext(
      emptyQueueState(),
      [{ spotClassKey: "rfi/CO/100bb/online", family: "rfi", priority: 1, firstExposure: false }],
      () => 0.5,
    );
    expect(pick.spotClassKey).toBe("rfi/CO/100bb/online");
    expect(pick.rated).toBe(true);
  });

  it("R4.7 observation mapping: a decision counts as correct when its label is Best or Correct, that is loss at or below the floor (proposed, S30 confirms)", () => {
    const rows: readonly (readonly [GradeLabel, boolean])[] = [
      ["Best", true],
      ["Correct", true],
      ["Inaccuracy", false],
      ["Mistake", false],
      ["Blunder", false],
    ];
    for (const [label, correct] of rows) {
      expect(observationFromLabel(label)).toBe(correct);
    }
    expect(() => observationFromLabel("Great" as GradeLabel)).toThrow(RangeError);
  });

  it("R4.7 the update returns a new state and never mutates the state it was given", () => {
    const mastery = Object.freeze({ pKnown: 0.4 });
    const params = Object.freeze({ ...BKT_PARAMETERS });
    const step = updateMastery(mastery, true, params);
    expect(step.mastery).not.toBe(mastery);
    expect(mastery).toEqual({ pKnown: 0.4 });
    expect(params).toEqual(BKT_PARAMETERS);
    expect(Object.isFrozen(step.mastery)).toBe(true);
    expect(Object.isFrozen(step)).toBe(true);
  });

  it("R4.7 custom parameters drive the starting state and the update", () => {
    const params: BktParameters = { prior: 0.5, learn: 0, guess: 0.25, slip: 0.25 };
    expect(newMastery(params)).toEqual({ pKnown: 0.5 });
    const step = updateMastery(newMastery(params), true, params);
    // 0.5 x 0.75 / (0.5 x 0.75 + 0.5 x 0.25) = 0.75, and learn 0 leaves it there.
    expect(step.posterior).toBeCloseTo(0.75, 12);
    expect(step.mastery.pKnown).toBeCloseTo(0.75, 12);
  });

  it("R4.7 the update stays a probability at the edges p 0 and p 1", () => {
    expect(updateMastery({ pKnown: 0 }, true).posterior).toBe(0);
    expect(updateMastery({ pKnown: 0 }, true).mastery.pKnown).toBeCloseTo(BKT_PARAMETERS.learn, 12);
    expect(updateMastery({ pKnown: 1 }, false).posterior).toBe(1);
    expect(updateMastery({ pKnown: 1 }, false).mastery.pKnown).toBe(1);
  });

  it("R4.7 invalid input throws a RangeError naming the field", () => {
    expect(() => updateMastery({ pKnown: 1.2 }, true)).toThrow(/mastery\.pKnown/);
    expect(() => updateMastery({ pKnown: Number.NaN }, true)).toThrow(RangeError);
    expect(() => updateMastery({ pKnown: 0.5 }, "yes" as unknown as boolean)).toThrow(/correct/);
    expect(() => newMastery({ ...BKT_PARAMETERS, prior: -0.1 })).toThrow(/params\.prior/);
    expect(() => newMastery({ ...BKT_PARAMETERS, learn: 1.5 })).toThrow(/params\.learn/);
    expect(() => updateMastery({ pKnown: 0.5 }, true, { ...BKT_PARAMETERS, guess: 0 })).toThrow(/params\.guess/);
    expect(() => updateMastery({ pKnown: 0.5 }, true, { ...BKT_PARAMETERS, slip: 1 })).toThrow(/params\.slip/);
    expect(() => isMastered({ pKnown: -1 })).toThrow(/mastery\.pKnown/);
  });
});
