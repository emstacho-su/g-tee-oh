/**
 * Calibration stat and the confident-miss queue rule (05 section 5; R3.11 stat part; O-89,
 * O-215). S22 writes both as pure functions; the confidence tap is S25 and S30's queue selection
 * (R4.9) reuses promoteConfidentMiss for hypercorrection.
 *
 * Mechanism: before anything is revealed the hero taps "sure" or "unsure". A decision is correct
 * when its label is Best or Correct, the reading the BKT (Bayesian Knowledge Tracing) proposal of
 * the package README also uses. Calibration counts attempts and correct decisions per confidence
 * and reports each side's accuracy and the gap (sure minus unsure); a side with no attempts has no
 * accuracy, and then there is no gap. A confident miss, "sure" with any other label, moves the
 * missed item to the front of the queue: high-confidence errors are the ones best corrected when
 * revisited soon (hypercorrection).
 */
import type { GradeLabel } from "./types.js";
import { requireOneOf } from "./validate.js";

/** The confidence tap of 05 section 5. */
export type Confidence = "sure" | "unsure";

/** One graded decision with the confidence tapped before its reveal. */
export type ConfidenceAttempt = { confidence: Confidence; label: GradeLabel };

/** One side of the calibration stat; accuracy is null when the side has no attempts. */
export type CalibrationSide = { attempts: number; correct: number; accuracy: number | null };

/** Accuracy when sure versus unsure, and the gap sure minus unsure (null unless both sides have attempts). */
export type Calibration = { sure: CalibrationSide; unsure: CalibrationSide; gap: number | null };

const CONFIDENCES: readonly Confidence[] = ["sure", "unsure"];
const LABELS: readonly GradeLabel[] = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"];
const CORRECT_LABELS: readonly GradeLabel[] = ["Best", "Correct"];

/** True for Best and Correct, the labels within the floor (O-215). */
export function isCorrectLabel(label: GradeLabel): boolean {
  return CORRECT_LABELS.includes(requireOneOf(label, LABELS, "label"));
}

/**
 * True when the hero was sure and the label is Inaccuracy, Mistake or Blunder (O-215). Both fields
 * are validated before either is used, so a malformed attempt throws a RangeError whatever its
 * confidence.
 */
export function isConfidentMiss(attempt: ConfidenceAttempt): boolean {
  const confidence = requireOneOf(attempt.confidence, CONFIDENCES, "confidence");
  const correct = isCorrectLabel(attempt.label);
  return confidence === "sure" && !correct;
}

function sideOf(attempts: readonly ConfidenceAttempt[], confidence: Confidence): CalibrationSide {
  const mine = attempts.filter((attempt) => attempt.confidence === confidence);
  const correct = mine.filter((attempt) => isCorrectLabel(attempt.label)).length;
  return { attempts: mine.length, correct, accuracy: mine.length === 0 ? null : correct / mine.length };
}

/** The calibration stat over attempts; a RangeError on an unknown confidence or label. */
export function aggregateCalibration(attempts: readonly ConfidenceAttempt[]): Calibration {
  attempts.forEach((attempt, index) => {
    requireOneOf(attempt.confidence, CONFIDENCES, `attempts[${index}].confidence`);
    requireOneOf(attempt.label, LABELS, `attempts[${index}].label`);
  });
  const sure = sideOf(attempts, "sure");
  const unsure = sideOf(attempts, "unsure");
  const gap = sure.accuracy === null || unsure.accuracy === null ? null : sure.accuracy - unsure.accuracy;
  return { sure, unsure, gap };
}

/**
 * The queue after one graded attempt on missed: on a confident miss, a new queue with missed first
 * and any earlier copy (matched by keyOf) removed; otherwise a copy of the queue in its order.
 * Never mutates the queue it reads.
 */
export function promoteConfidentMiss<T>(
  queue: readonly T[],
  missed: T,
  attempt: ConfidenceAttempt,
  keyOf: (item: T) => string,
): T[] {
  if (!isConfidentMiss(attempt)) {
    return [...queue];
  }
  const missedKey = keyOf(missed);
  return [missed, ...queue.filter((item) => keyOf(item) !== missedKey)];
}
