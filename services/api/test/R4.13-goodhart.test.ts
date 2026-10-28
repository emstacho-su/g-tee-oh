/**
 * The Goodhart rule (R4.13, O-277), as a table: a flag needs two rounds of at least 20 answered
 * items, a rating rise of 50 or more and a holdout mean-score rise of 0.02 or less.
 */
import { describe, expect, it } from "vitest";

import { goodhartFlag, type RoundFigures } from "../src/holdout/goodhart.js";

const PREVIOUS: RoundFigures = { answered: 30, meanScore: 0.7, mu: 1500 };

const CASES: readonly { name: string; previous: RoundFigures | null; current: RoundFigures; flag: boolean }[] = [
  { name: "no previous round", previous: null, current: { answered: 30, meanScore: 0.7, mu: 1600 }, flag: false },
  { name: "rating up 50, score flat", previous: PREVIOUS, current: { answered: 30, meanScore: 0.7, mu: 1550 }, flag: true },
  { name: "rating up 50, score up exactly 0.02", previous: PREVIOUS, current: { answered: 30, meanScore: 0.72, mu: 1550 }, flag: true },
  { name: "rating up 50, score down", previous: PREVIOUS, current: { answered: 30, meanScore: 0.6, mu: 1550 }, flag: true },
  { name: "rating up 50, score up 0.03", previous: PREVIOUS, current: { answered: 30, meanScore: 0.73, mu: 1550 }, flag: false },
  { name: "rating up 49", previous: PREVIOUS, current: { answered: 30, meanScore: 0.7, mu: 1549 }, flag: false },
  { name: "this round under 20 answered", previous: PREVIOUS, current: { answered: 19, meanScore: 0.7, mu: 1600 }, flag: false },
  {
    name: "previous round under 20 answered",
    previous: { ...PREVIOUS, answered: 19 },
    current: { answered: 30, meanScore: 0.7, mu: 1600 },
    flag: false,
  },
  { name: "exactly 20 answered each", previous: { ...PREVIOUS, answered: 20 }, current: { answered: 20, meanScore: 0.7, mu: 1600 }, flag: true },
  { name: "no rating at close", previous: PREVIOUS, current: { answered: 30, meanScore: 0.7, mu: null }, flag: false },
  { name: "no mean score", previous: PREVIOUS, current: { answered: 30, meanScore: null, mu: 1600 }, flag: false },
];

describe("R4.13 Goodhart rule table", () => {
  it.each(CASES)("R4.13 $name", ({ previous, current, flag }) => {
    expect(goodhartFlag(previous, current)).toBe(flag);
  });
});
