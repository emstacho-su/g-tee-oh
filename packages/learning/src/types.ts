/**
 * Shared types of the pure learning model (A6 section 4). GradeInput and GradeOutput are
 * transcribed from A6 section 4 unchanged, so the grading policy (S22, R3.8) and its caller in
 * services/api agree on one shape. The other types name what every module and vector shares: the
 * injected random number generator (RNG) that is the only randomness this package may use
 * (A1 section 2), and the placeholder descriptor each skeleton module exports until its owning
 * session lands (R0.11).
 */

/** Trainer mode of the graded decision (05 section 1, 06 section 3.6, ADR 0011). */
export type GradeMode = "automated" | "drill" | "holdout" | "prediction";

/** Labels of 05 section 6.3, driven by EV (expected value) loss, never by frequency (ADR 0008). */
export type GradeLabel = "Best" | "Correct" | "Inaccuracy" | "Mistake" | "Blunder";

/**
 * Input of the grading policy (A6 section 4). lossPctPot and floorPctPot arrive from solver-query
 * in percent of the pot at the node and are never recomputed here (R3.8, ADR 0004). freqByAction
 * lists the hand's equilibrium frequency per tree action in the node's action order, passive to
 * aggressive; actionIndex is the chosen action in that order; rngRoll is the 1 to 100 roll when
 * RNG mode is on (05 section 7, ADR 0009); noiseFlags carries the flags of 05 section 9.
 */
export type GradeInput = {
  lossPctPot: number;
  floorPctPot: number;
  freqByAction: number[];
  actionIndex: number;
  rngRoll?: number;
  noiseFlags: string[];
  mode: GradeMode;
  firstAttempt: boolean;
  panelsRevealed: boolean;
};

/**
 * Output of the grading policy (A6 section 4): score = exp(-max(0, loss - floor) / tau), the
 * label per 05 section 6.3, whether the decision moves the rating, and its rating weight.
 */
export type GradeOutput = {
  score: number;
  label: GradeLabel;
  rated: boolean;
  weight: number;
};

/**
 * Injected random number generator (A1 section 2): returns a float in [0, 1). The package never
 * calls Math.random. Queue selection (R4.9), RNG mode rolls (R3.10) and the simulated learner
 * (R4.2) each take one of these, so a seed replays identically (R3.6).
 */
export type RandomSource = () => number;

/**
 * Descriptor each skeleton module exports until its owning session replaces the placeholder with
 * the module's functions (R0.11). It carries no logic: the session and requirement identifiers
 * (R IDs) are what the scaffolding test checks.
 */
export type ModulePlaceholder = {
  readonly module: string;
  readonly responsibility: string;
  readonly session: string;
  readonly requirements: readonly string[];
};
