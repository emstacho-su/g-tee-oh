/**
 * R3.16 the quiz difficulty's passed mark (S41, O-410).
 *
 * Rule: a quiz asks the level its difficulty names, whatever the unlocks say, so the passed mark of
 * (spot class, ladder, level) reads only the answers given at exactly that level: the last
 * PREDICTION_WINDOW (20) of them, passed at PREDICTION_UNLOCK_PCT (90) percent with a full window.
 * Unlike levelFor, answers at a level the ladder has not unlocked count, and answers at other levels,
 * ladders or classes never do. Level 3 can be passed (levelFor caps the unlock there).
 */
import { describe, expect, it } from "vitest";

import { windowAtLevel } from "../src/index.js";
import type { PredictionAnswerRecord, PredictionLadderKey } from "../src/prediction-levels.js";

const KEY: PredictionLadderKey = { spotClassKey: "preflop/online/100/facing-open/BB-BTN", ladder: "hand" };

function answers(level: number, correct: number, wrong: number, key: PredictionLadderKey = KEY): PredictionAnswerRecord[] {
  const pattern = [...Array<boolean>(wrong).fill(false), ...Array<boolean>(correct).fill(true)];
  return pattern.map((value) => ({ spotClassKey: key.spotClassKey, ladder: key.ladder, level, correct: value }));
}

describe("R3.16 windowAtLevel", () => {
  it("R3.16 no answer at the level is an empty window, not passed", () => {
    expect(windowAtLevel([], KEY, 2)).toEqual({ window: { answers: 0, correct: 0, size: 20, required_pct: 90 }, passed: false });
  });

  it("R3.16 a full window at 90 percent passes; 17 of 20 or 19 answers do not", () => {
    expect(windowAtLevel(answers(2, 18, 2), KEY, 2).passed).toBe(true);
    expect(windowAtLevel(answers(2, 17, 3), KEY, 2).passed).toBe(false);
    expect(windowAtLevel(answers(2, 19, 0), KEY, 2).passed).toBe(false);
  });

  it("R3.16 only the last 20 answers count, so old misses slide out", () => {
    const history = [...answers(3, 0, 10), ...answers(3, 20, 0)];
    expect(windowAtLevel(history, KEY, 3)).toEqual({ window: { answers: 20, correct: 20, size: 20, required_pct: 90 }, passed: true });
  });

  it("R3.16 a level the ladder never unlocked still counts, and other levels, ladders and classes never do", () => {
    const other: PredictionLadderKey = { spotClassKey: "preflop/online/100/rfi/BB-BTN", ladder: "hand" };
    const history = [
      ...answers(1, 20, 0),
      ...answers(3, 20, 0, { ...KEY, ladder: "range" }),
      ...answers(3, 20, 0, other),
      ...answers(3, 5, 0),
    ];
    expect(windowAtLevel(history, KEY, 3)).toEqual({ window: { answers: 5, correct: 5, size: 20, required_pct: 90 }, passed: false });
  });

  it("R3.16 a level outside 1 to 3 is a range error", () => {
    expect(() => windowAtLevel([], KEY, 0)).toThrow(RangeError);
    expect(() => windowAtLevel([], KEY, 4)).toThrow(RangeError);
  });
});
