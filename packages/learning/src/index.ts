/**
 * @g-tee-oh/learning holds the pure TypeScript learning model. S05 landed the red test vectors and
 * the skeleton (src/types.ts and one placeholder module per A6 section 1 row owned by this
 * package); S22 landed the grading policy (grade, the grouping modes, the RNG band mapping, the
 * SplitMix64 RandomSource, calibration and the confident-miss rule); S30 lands the Glicko-2
 * rating, item difficulty, FSRS (Free Spaced Repetition Scheduler) scheduling, BKT (Bayesian
 * Knowledge Tracing) mastery, leak-cost and queue modules. This package stays pure: no I/O
 * (input/output), no clock, no randomness except an injected random number generator (A1
 * section 2), so every module is testable with fixed vectors. It depends on no other workspace
 * package. The vectors live under test/, one file per area named by requirement identifier (R ID).
 */
export const PACKAGE_NAME = "@g-tee-oh/learning" as const;

export type {
  ActionKind,
  Bucket,
  GradeAction,
  GradeInput,
  GradeLabel,
  GradeMode,
  GradeOutput,
  Grouping,
  ModulePlaceholder,
  RandomSource,
  Street,
} from "./types.js";

export {
  BLUNDER_ABOVE_PCT_POT,
  DAILY_RATED_CAP,
  DEFAULT_GROUPING,
  FREQUENCY_TIE_TOLERANCE,
  GRADING_TAU_PCT_POT,
  MISTAKE_FROM_PCT_POT,
  RATED_WEIGHT,
  UNRATED_WEIGHT,
  grade,
  isRated,
  scoreFor,
} from "./grading.js";
export { ACTION_KINDS, BUCKETS, passiveToAggressiveOrder } from "./actions.js";
export { groupKeys } from "./grouping.js";
export {
  RNG_ROLL_MAX,
  RNG_ROLL_MIN,
  actionForRoll,
  chiSquareStatistic,
  rngBands,
  rollFrom,
  rollSelectedAction,
} from "./rng-bands.js";
export type { RngBand } from "./rng-bands.js";
export { createSplitMix64, splitMix64Source, splitMix64Step } from "./random.js";
export type { SplitMix64, SplitMix64Step } from "./random.js";
export { aggregateCalibration, isConfidentMiss, isCorrectLabel, promoteConfidentMiss } from "./calibration.js";
export type { Calibration, CalibrationSide, Confidence, ConfidenceAttempt } from "./calibration.js";

export { GLICKO2_MODULE } from "./glicko2.js";
export { DIFFICULTY_MODULE } from "./difficulty.js";
export { FSRS_MODULE } from "./fsrs.js";
export { BKT_MODULE } from "./bkt.js";
export { LEAK_COST_MODULE } from "./leak-cost.js";
export { QUEUE_MODULE } from "./queue.js";
