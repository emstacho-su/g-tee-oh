/**
 * R3.11 calibration stat and confident-miss queue rule (S22; the confidence tap itself is S25).
 *
 * Rules (05 section 5, O-89, O-215): before anything is revealed the hero taps "sure" or "unsure".
 * A decision counts as correct when its label is Best or Correct, the same reading the BKT
 * proposal of the learning README uses. Calibration is accuracy when sure versus accuracy when
 * unsure, aggregated over attempts, with the gap between them (sure minus unsure); a side with no
 * attempts has no accuracy and then there is no gap. A confident miss is a "sure" decision with
 * any other label (Inaccuracy, Mistake or Blunder); it moves the missed item to the front of the
 * automated queue (hypercorrection), and S30's queue selection reuses the same pure function.
 */
import { describe, expect, it } from "vitest";

import { aggregateCalibration, isConfidentMiss, isCorrectLabel, promoteConfidentMiss } from "../src/index.js";
import type { ConfidenceAttempt, GradeLabel } from "../src/index.js";

/** Fixture attempts: six sure (four correct) and four unsure (one correct). */
export const CALIBRATION_FIXTURE_ATTEMPTS: readonly ConfidenceAttempt[] = Object.freeze([
  { confidence: "sure", label: "Best" },
  { confidence: "sure", label: "Correct" },
  { confidence: "unsure", label: "Mistake" },
  { confidence: "sure", label: "Correct" },
  { confidence: "unsure", label: "Correct" },
  { confidence: "sure", label: "Mistake" },
  { confidence: "unsure", label: "Blunder" },
  { confidence: "sure", label: "Best" },
  { confidence: "unsure", label: "Inaccuracy" },
  { confidence: "sure", label: "Inaccuracy" },
]);

export const CALIBRATION_FIXTURE_EXPECTED = Object.freeze({
  sure: { attempts: 6, correct: 4, accuracy: 4 / 6 },
  unsure: { attempts: 4, correct: 1, accuracy: 1 / 4 },
  gap: 4 / 6 - 1 / 4,
});

type QueueItem = { readonly id: string; readonly spotClass: string };

const QUEUE: readonly QueueItem[] = Object.freeze([
  Object.freeze({ id: "a", spotClass: "rfi/CO/100bb/online" }),
  Object.freeze({ id: "b", spotClass: "facing-open/BTN-vs-CO/100bb/online" }),
  Object.freeze({ id: "c", spotClass: "facing-3bet/CO-vs-BTN/100bb/online" }),
]);

const keyOf = (item: QueueItem): string => item.id;

function item(id: string): QueueItem {
  const found = QUEUE.find((candidate) => candidate.id === id);
  return found ?? { id, spotClass: "squeeze/BB-vs-CO-BTN/100bb/online" };
}

const ids = (queue: readonly QueueItem[]): string[] => queue.map(keyOf);

const ALL_LABELS: readonly GradeLabel[] = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"];

describe("R3.11 calibration and the confident-miss rule (S22, O-89, O-215)", () => {
  it("R3.11 a decision is correct exactly when its label is Best or Correct (O-215)", () => {
    expect(ALL_LABELS.filter((label) => isCorrectLabel(label))).toEqual(["Best", "Correct"]);
  });

  it("R3.11 a confident miss is sure with Inaccuracy, Mistake or Blunder; unsure misses and sure hits are not", () => {
    const sureMisses = ALL_LABELS.filter((label) => isConfidentMiss({ confidence: "sure", label }));
    expect(sureMisses).toEqual(["Inaccuracy", "Mistake", "Blunder"]);
    expect(ALL_LABELS.some((label) => isConfidentMiss({ confidence: "unsure", label }))).toBe(false);
  });

  it("R3.11 calibration aggregation on fixture attempts: accuracy when sure 4 of 6, when unsure 1 of 4, gap 5/12", () => {
    const calibration = aggregateCalibration(CALIBRATION_FIXTURE_ATTEMPTS);
    expect(calibration.sure).toEqual(CALIBRATION_FIXTURE_EXPECTED.sure);
    expect(calibration.unsure).toEqual(CALIBRATION_FIXTURE_EXPECTED.unsure);
    expect(calibration.gap).toBeCloseTo(CALIBRATION_FIXTURE_EXPECTED.gap, 12);
  });

  it("R3.11 calibration with an empty side reports no accuracy for it and no gap", () => {
    expect(aggregateCalibration([])).toEqual({
      sure: { attempts: 0, correct: 0, accuracy: null },
      unsure: { attempts: 0, correct: 0, accuracy: null },
      gap: null,
    });
    const sureOnly = aggregateCalibration([{ confidence: "sure", label: "Best" }]);
    expect(sureOnly.sure).toEqual({ attempts: 1, correct: 1, accuracy: 1 });
    expect(sureOnly.unsure.accuracy).toBeNull();
    expect(sureOnly.gap).toBeNull();
  });

  it("R3.11 calibration rejects an unknown confidence or label with a RangeError", () => {
    const badConfidence = [{ confidence: "maybe", label: "Best" }] as unknown as ConfidenceAttempt[];
    const badLabel = [{ confidence: "sure", label: "Great" }] as unknown as ConfidenceAttempt[];
    expect(() => aggregateCalibration(badConfidence)).toThrow(RangeError);
    expect(() => aggregateCalibration(badLabel)).toThrow(RangeError);
  });

  it("R3.11 queue rule: after a confident miss on c, c is next (05 section 5, hypercorrection)", () => {
    const queue = promoteConfidentMiss(QUEUE, item("c"), { confidence: "sure", label: "Mistake" }, keyOf);
    expect(queue[0]?.id).toBe("c");
    expect(ids(queue)).toEqual(["c", "a", "b"]);
  });

  it("R3.11 queue rule: a confident miss on an item not yet queued goes in front of the whole queue", () => {
    const queue = promoteConfidentMiss(QUEUE, item("d"), { confidence: "sure", label: "Blunder" }, keyOf);
    expect(ids(queue)).toEqual(["d", "a", "b", "c"]);
  });

  it("R3.11 queue rule: an unsure miss or a sure hit leaves the order unchanged", () => {
    for (const attempt of [
      { confidence: "unsure", label: "Blunder" },
      { confidence: "sure", label: "Best" },
      { confidence: "sure", label: "Correct" },
    ] as const) {
      const queue = promoteConfidentMiss(QUEUE, item("c"), attempt, keyOf);
      expect(ids(queue), JSON.stringify(attempt)).toEqual(["a", "b", "c"]);
      expect(queue).not.toBe(QUEUE);
    }
  });

  it("R3.11 queue rule: repeated confident misses stack most recent first and never duplicate an item", () => {
    const afterC = promoteConfidentMiss(QUEUE, item("c"), { confidence: "sure", label: "Mistake" }, keyOf);
    const afterB = promoteConfidentMiss(afterC, item("b"), { confidence: "sure", label: "Inaccuracy" }, keyOf);
    expect(ids(afterB)).toEqual(["b", "c", "a"]);
    const againC = promoteConfidentMiss(afterB, item("c"), { confidence: "sure", label: "Blunder" }, keyOf);
    expect(ids(againC)).toEqual(["c", "b", "a"]);
  });

  it("R3.11 queue rule returns a new queue and never mutates the queue it reads", () => {
    const snapshot = ids(QUEUE);
    const queue = promoteConfidentMiss(QUEUE, item("b"), { confidence: "sure", label: "Mistake" }, keyOf);
    expect(ids(QUEUE)).toEqual(snapshot);
    expect(Object.isFrozen(QUEUE)).toBe(true);
    expect(queue).not.toBe(QUEUE);
  });
});
