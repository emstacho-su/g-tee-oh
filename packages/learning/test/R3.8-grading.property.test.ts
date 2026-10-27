/**
 * R3.8 grading policy properties (S22, A9 section 1: "grading monotone in loss" is the named
 * fast-check example). The generators draw raw losses and floors in percent of the pot over the
 * whole range the trainer can show, the fixture node of R3.8-grading.test.ts supplies the rest of
 * the input, and every property holds for any floor, any action and with or without a roll.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { grade, scoreFor } from "../src/index.js";
import type { GradeAction, GradeInput, GradeLabel } from "../src/index.js";

/** Largest loss and floor the generators draw, in percent of the pot. */
const MAX_LOSS_PCT_POT = 200;
const MAX_FLOOR_PCT_POT = 5;

/** Severity order of the labels: Best and Correct are both "within the floor". */
const LABEL_SEVERITY: Readonly<Record<GradeLabel, number>> = Object.freeze({
  Best: 0,
  Correct: 0,
  Inaccuracy: 1,
  Mistake: 2,
  Blunder: 3,
});

const BASE: GradeInput = {
  lossPctPot: 0,
  floorPctPot: 0.2,
  freqByAction: [0, 0.4, 0.6],
  actionIndex: 1,
  noiseFlags: [],
  mode: "automated",
  firstAttempt: true,
  panelsRevealed: false,
  ratedTodayInTrack: 0,
  street: "preflop",
};

/** The fixture node's actions (fold, call, raise to 2.5bb); RNG mode needs them (O-213). */
const NODE_ACTIONS: readonly GradeAction[] = [
  { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 0 },
  { kind: "call", bucket: null, sizeCbb: 100, lossPctPot: 0 },
  { kind: "raise", bucket: "medium", sizeCbb: 250, lossPctPot: 0 },
];

const loss = fc.double({ min: 0, max: MAX_LOSS_PCT_POT, noNaN: true, noDefaultInfinity: true });
const floor = fc.double({ min: 0, max: MAX_FLOOR_PCT_POT, noNaN: true, noDefaultInfinity: true });
const actionIndex = fc.constantFrom(0, 1, 2);
const roll = fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined });

/** Two losses in ascending order. */
const lossPair = fc.tuple(loss, loss).map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));

function inputFor(lossPctPot: number, floorPctPot: number, index: number, rngRoll: number | undefined): GradeInput {
  const actions = NODE_ACTIONS.map((action, actionIndex) => (actionIndex === index ? { ...action, lossPctPot } : action));
  const input: GradeInput = { ...BASE, lossPctPot, floorPctPot, actionIndex: index, actions };
  return rngRoll === undefined ? input : { ...input, rngRoll };
}

describe("R3.8 grading policy properties (fast-check)", () => {
  it("R3.8 fast-check: score is monotone non-increasing in loss for any floor, action and roll", () => {
    fc.assert(
      fc.property(lossPair, floor, actionIndex, roll, ([lower, higher], floorPctPot, index, rngRoll) => {
        const atLower = grade(inputFor(lower, floorPctPot, index, rngRoll)).score;
        const atHigher = grade(inputFor(higher, floorPctPot, index, rngRoll)).score;
        expect(atHigher).toBeLessThanOrEqual(atLower);
      }),
    );
  });

  it("R3.8 fast-check: score equals 1 at or below the floor and lies in (0, 1] everywhere", () => {
    fc.assert(
      fc.property(loss, floor, (lossPctPot, floorPctPot) => {
        const score = scoreFor(lossPctPot, floorPctPot);
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThanOrEqual(1);
        if (lossPctPot <= floorPctPot) {
          expect(score).toBe(1);
        }
      }),
    );
  });

  it("R3.8 fast-check: label severity is monotone non-decreasing in loss", () => {
    fc.assert(
      fc.property(lossPair, floor, actionIndex, roll, ([lower, higher], floorPctPot, index, rngRoll) => {
        const atLower = grade(inputFor(lower, floorPctPot, index, rngRoll)).label;
        const atHigher = grade(inputFor(higher, floorPctPot, index, rngRoll)).label;
        expect(LABEL_SEVERITY[atHigher]).toBeGreaterThanOrEqual(LABEL_SEVERITY[atLower]);
      }),
    );
  });

  it("R3.8 fast-check: the label is Best or Correct exactly when the loss is at or below the floor", () => {
    fc.assert(
      fc.property(loss, floor, actionIndex, roll, (lossPctPot, floorPctPot, index, rngRoll) => {
        const { label } = grade(inputFor(lossPctPot, floorPctPot, index, rngRoll));
        expect(LABEL_SEVERITY[label] === 0).toBe(lossPctPot <= floorPctPot);
      }),
    );
  });
});
