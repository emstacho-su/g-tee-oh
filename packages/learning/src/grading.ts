/**
 * Grading policy: score, label, rated flag and weight (A6 section 1 row "Score, label, rated flag,
 * weight"; A6 section 4). Owner: S22 (p3/grading-policy), closing R3.8 (the policy and the
 * grouping modes Standard, Grouped and Simple) and the calibration aggregation part of R3.11.
 *
 * Rules the module will implement: score = exp(-max(0, loss - floor) / tau) with tau 4 percent
 * of pot (05 section 6.3, ADR 0008); labels per 05 section 6.3 (Best, Correct, Inaccuracy under
 * 1 percent, Mistake 1 to 5 percent, Blunder above 5 percent); any in-mix action within the floor
 * is Correct and the roll-selected action in RNG mode is Best (ADR 0009); rated only when the mode
 * is automated, the attempt is the first, no revealing panel is open, no noise flag is set and the
 * daily cap of 150 per track holds (06 section 3.6, ADR 0011). Bucket mapping and the floor come
 * from Rust (R2.3, R2.13) and are never recomputed here (ADR 0004).
 *
 * Pending vectors: test/R3.8-grading.test.ts and test/R3.10-rng-bands.test.ts.
 */
import type { ModulePlaceholder } from "./types.js";

export const GRADING_MODULE: ModulePlaceholder = Object.freeze({
  module: "grading",
  responsibility: "score, label, rated flag and weight of one graded decision",
  session: "S22",
  requirements: ["R3.8", "R3.10", "R3.11"],
});
