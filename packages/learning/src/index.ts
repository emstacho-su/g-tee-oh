/**
 * @g-tee-oh/learning holds the pure TypeScript learning model. S05 lands the red test vectors and
 * the skeleton (src/types.ts and one placeholder module per A6 section 1 row owned by this
 * package), S22 the grading policy, and S30 the Glicko-2 rating, item difficulty, FSRS (Free
 * Spaced Repetition Scheduler) scheduling, BKT (Bayesian Knowledge Tracing) mastery, leak-cost and
 * queue modules. This package stays pure: no I/O (input/output), no clock, no randomness except an
 * injected random number generator (A1 section 2), so every module is testable with fixed vectors.
 * It depends on no other workspace package. The vectors live under test/, one file per area named
 * by requirement identifier (R ID), and stay pending (it.todo) until their owning session turns
 * them green (R0.11).
 */
export const PACKAGE_NAME = "@g-tee-oh/learning" as const;

export type {
  GradeInput,
  GradeLabel,
  GradeMode,
  GradeOutput,
  ModulePlaceholder,
  RandomSource,
} from "./types.js";

export { GRADING_MODULE } from "./grading.js";
export { GLICKO2_MODULE } from "./glicko2.js";
export { DIFFICULTY_MODULE } from "./difficulty.js";
export { FSRS_MODULE } from "./fsrs.js";
export { BKT_MODULE } from "./bkt.js";
export { LEAK_COST_MODULE } from "./leak-cost.js";
export { QUEUE_MODULE } from "./queue.js";
