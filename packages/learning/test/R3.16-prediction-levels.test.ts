/**
 * R3.16 prediction level vectors (S27, O-301, 05 section 8).
 *
 * Rule: each (spot class, ladder) climbs its own levels 1 to 3. The next level unlocks when the
 * most recent PREDICTION_WINDOW (20) answers at the current level are at least PREDICTION_UNLOCK_PCT
 * (90) percent correct, with at least 20 of them; level 3 is the cap. Unlocking changes difficulty
 * only. The vectors cover the 18 of 20 boundary, 17 of 20, too few answers, the sliding window,
 * the cap and the isolation of ladders and classes.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_PREDICTION_LEVEL,
  PREDICTION_UNLOCK_PCT,
  PREDICTION_WINDOW,
  levelFor,
  type PredictionAnswerRecord,
  type PredictionLadderKey,
} from "../src/prediction-levels.js";

const KEY: PredictionLadderKey = { spotClassKey: "preflop/online/100/facing-open/BB-BTN", ladder: "range" };

function answers(level: number, pattern: readonly boolean[], key: PredictionLadderKey = KEY): PredictionAnswerRecord[] {
  return pattern.map((correct) => ({ spotClassKey: key.spotClassKey, ladder: key.ladder, level, correct }));
}

function run(correct: number, wrong: number): boolean[] {
  return [...Array<boolean>(wrong).fill(false), ...Array<boolean>(correct).fill(true)];
}

describe("R3.16 prediction levels", () => {
  it("R3.16 the constants are 20 answers, 90 percent and three levels", () => {
    expect(PREDICTION_WINDOW).toBe(20);
    expect(PREDICTION_UNLOCK_PCT).toBe(90);
    expect(MAX_PREDICTION_LEVEL).toBe(3);
  });

  it("R3.16 no history starts at level 1 with an empty window", () => {
    expect(levelFor([], KEY)).toEqual({
      level: 1,
      window: { answers: 0, correct: 0, size: 20, required_pct: 90 },
      unlockedNow: false,
    });
  });

  it("R3.16 18 of 20 correct unlocks level 2, and the 20th answer is the one that crossed", () => {
    const result = levelFor(answers(1, run(18, 2)), KEY);
    expect(result).toEqual({ level: 2, window: { answers: 20, correct: 18, size: 20, required_pct: 90 }, unlockedNow: true });
  });

  it("R3.16 17 of 20 correct stays at level 1", () => {
    const result = levelFor(answers(1, run(17, 3)), KEY);
    expect(result.level).toBe(1);
    expect(result.unlockedNow).toBe(false);
    expect(result.window).toEqual({ answers: 20, correct: 17, size: 20, required_pct: 90 });
  });

  it("R3.16 19 answers never unlock, even all correct", () => {
    const result = levelFor(answers(1, run(19, 0)), KEY);
    expect(result.level).toBe(1);
    expect(result.window.answers).toBe(19);
  });

  it("R3.16 the window slides: old misses fall out", () => {
    // 5 misses then 17 right: the last 20 hold 3 misses (17 of 20), then two more right make 19 of 20.
    const stuck = levelFor(answers(1, run(17, 5)), KEY);
    expect(stuck.level).toBe(1);
    expect(stuck.window).toEqual({ answers: 20, correct: 17, size: 20, required_pct: 90 });
    const slid = levelFor(answers(1, [...run(17, 5), true]), KEY);
    expect(slid.level).toBe(2);
    expect(slid.unlockedNow).toBe(true);
    expect(slid.window.correct).toBe(18);
  });

  it("R3.16 unlockedNow is true only for the answer that crossed", () => {
    const history = [...answers(1, run(20, 0)), ...answers(2, [true])];
    const result = levelFor(history, KEY);
    expect(result.level).toBe(2);
    expect(result.unlockedNow).toBe(false);
    expect(result.window).toEqual({ answers: 1, correct: 1, size: 20, required_pct: 90 });
  });

  it("R3.16 level 3 is the cap", () => {
    const history = [...answers(1, run(20, 0)), ...answers(2, run(20, 0)), ...answers(3, run(40, 0))];
    const result = levelFor(history, KEY);
    expect(result.level).toBe(3);
    expect(result.unlockedNow).toBe(false);
    expect(result.window).toEqual({ answers: 20, correct: 20, size: 20, required_pct: 90 });
  });

  it("R3.16 reaching level 3 reports the unlock once", () => {
    const history = [...answers(1, run(20, 0)), ...answers(2, run(20, 0))];
    expect(levelFor(history, KEY)).toMatchObject({ level: 3, unlockedNow: true });
  });

  it("R3.16 answers recorded at another level than the current one do not count toward it", () => {
    const history = [...answers(2, run(20, 0)), ...answers(1, run(5, 0))];
    const result = levelFor(history, KEY);
    expect(result.level).toBe(1);
    expect(result.window.answers).toBe(5);
  });

  it("R3.16 a different ladder or class does not share history", () => {
    const otherLadder: PredictionLadderKey = { ...KEY, ladder: "hand" };
    const otherClass: PredictionLadderKey = { ...KEY, spotClassKey: "preflop/online/100/rfi/BTN" };
    const history = [...answers(1, run(20, 0), otherLadder), ...answers(1, run(20, 0), otherClass), ...answers(1, run(3, 0))];
    const result = levelFor(history, KEY);
    expect(result.level).toBe(1);
    expect(result.window.answers).toBe(3);
    expect(levelFor(history, otherLadder).level).toBe(2);
    expect(levelFor(history, otherClass).level).toBe(2);
  });

  it("R3.16 a level outside 1 to 3 is refused", () => {
    expect(() => levelFor(answers(4, [true]), KEY)).toThrow(RangeError);
    expect(() => levelFor(answers(0, [true]), KEY)).toThrow(RangeError);
  });
});
