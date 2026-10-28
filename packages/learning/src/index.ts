/**
 * @g-tee-oh/learning holds the pure TypeScript learning model. S05 landed the red test vectors and
 * the skeleton (src/types.ts and one placeholder module per A6 section 1 row owned by this
 * package, all replaced now); S22 landed the grading policy (grade, the grouping modes, the RNG band mapping and the
 * SplitMix64 RandomSource; S37 moved Best to the highest-EV rule of ADR 0024 in src/best.ts and retired
 * calibration and the confident-miss rule with R3.11, O-345); S30 lands the Glicko-2
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
export { LOSS_TIE_TOLERANCE_PCT_POT, bestActionIndexes, followsRoll, lowestLossIndexes } from "./best.js";
export type { BestActionsInput, RollFollowInput } from "./best.js";
export { GRADE_LABELS, isCorrectLabel } from "./labels.js";
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

// S30: rating (R4.1, R4.3, R4.4, R4.5)
export {
  GLICKO2_DEFAULTS,
  GLICKO2_EPSILON,
  GLICKO2_SCALE,
  GLICKO2_TAU,
  INACTIVITY_PERIOD_DAYS,
  ITEM_RD,
  applyInactivity,
  conservativeRating,
  inactivePeriods,
  newTrackRating,
  ratePeriod,
  rateSession,
} from "./glicko2.js";
export type { Opponent, PeriodResult, SessionDecision, TrackRating } from "./glicko2.js";
export {
  DIFFICULTY_BASE,
  GAP_SCALE_PCT_POT,
  GAP_WEIGHT,
  MIX_SLOPE,
  MIX_WEIGHT,
  itemDifficulty,
  withItemExclusion,
} from "./difficulty.js";
export type { DifficultyFeatures, ItemDifficulty } from "./difficulty.js";
export { PROMOTION_RD_CAP, TIER_FLOORS, bandTier, overallRating, tierFor, trackWeight } from "./rank.js";
export type { Tier, TierFloor, TierResult, TrackStanding } from "./rank.js";

// S30: scheduling (R4.6, R4.7, R4.9)
export {
  DESIRED_RETENTION,
  FSRS_LIBRARY_VERSION,
  GRADE_THRESHOLDS,
  MASTERED_RETENTION,
  gradeFromMean,
  isDue,
  memoryState,
  newSpotClassCard,
  overdueFactor,
  retentionFor,
  retrievability,
  reviewGrade,
  reviewInDeck,
  reviewSpotClass,
} from "./fsrs.js";
export type { Deck, FsrsGrade, FsrsOptions, MemoryStep, ReviewOutcome, SpotClassCard } from "./fsrs.js";
export { BKT_PARAMETERS, MASTERY_THRESHOLD, isMastered, newMastery, observationFromLabel, updateMastery } from "./bkt.js";
export type { BktParameters, Mastery, MasteryUpdate } from "./bkt.js";
export { emptyQueueState, pickNext, queuePriority } from "./queue.js";
export type { QueueCandidate, QueuePick, QueuePickReason, QueueState, QueueStep } from "./queue.js";

// S30: leak cost (R4.8)
export {
  HANDS_PER_UNIT,
  SHRINKAGE_MIN_DECISIONS,
  classStat,
  frequencyPriorPer1000,
  leakCost,
  leakHistorySnapshot,
  leakStat,
  rankLeaks,
  shrinkTowardTrack,
  startingLeakCost,
  trackAverage,
} from "./leak-cost.js";
export type {
  ClassStat,
  LeakCostInput,
  LeakDecision,
  LeakHistoryRow,
  LeakStat,
  ShrunkStat,
  TrackAverage,
} from "./leak-cost.js";

// S27: prediction levels (R3.16)
export { MAX_PREDICTION_LEVEL, PREDICTION_UNLOCK_PCT, PREDICTION_WINDOW, levelFor, windowAtLevel, windowUnlocks } from "./prediction-levels.js";
export type {
  PredictionAnswerRecord,
  PredictionLadder,
  PredictionLadderKey,
  LevelWindow,
  PredictionLevel,
  PredictionWindow,
} from "./prediction-levels.js";

// S27: range drift (R3.18)
export {
  DRIFT_BOOTSTRAP_RESAMPLES,
  DRIFT_BOOTSTRAP_SEED,
  DRIFT_CONFIDENCE,
  DRIFT_MIN_DECISIONS,
  driftKindShares,
  rangeDrift,
  totalVariationDistance,
} from "./drift.js";
export type { DriftDecision, DriftKindShare, DriftResult, HiddenDrift, ShownDrift } from "./drift.js";
