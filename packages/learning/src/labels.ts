/**
 * Label reading shared by BKT mastery and leak cost (05 section 6.3, ADR 0008). A decision counts
 * as correct when its label is Best or Correct, the labels within the floor. S22 placed this in
 * calibration.ts; the calibration stat and the confident-miss rule were retired with R3.11
 * (O-345), and this reading moved here unchanged.
 */
import type { GradeLabel } from "./types.js";
import { requireOneOf } from "./validate.js";

export const GRADE_LABELS: readonly GradeLabel[] = Object.freeze(["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"]);
const CORRECT_LABELS: readonly GradeLabel[] = Object.freeze(["Best", "Correct"]);

/** True for Best and Correct, the labels within the floor; a RangeError on an unknown label. */
export function isCorrectLabel(label: GradeLabel): boolean {
  return CORRECT_LABELS.includes(requireOneOf(label, GRADE_LABELS, "label"));
}
