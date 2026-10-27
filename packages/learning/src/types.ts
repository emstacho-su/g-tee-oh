/**
 * Shared types of the pure learning model (A6 section 4). GradeInput and GradeOutput keep every
 * field A6 section 4 names, unchanged, so the grading policy (S22, R3.8) and its caller in
 * services/api agree on one shape; S22 extends them only where A6 section 4 is silent (the
 * grouping mode, the actions list, the daily cap count and the graded action), each extension
 * marked with the open question identifier (O-ID) that decides it. The other types name what every
 * module and vector shares: the injected random number generator (RNG) that is the only
 * randomness this package may use (A1 section 2), and the placeholder descriptor each skeleton
 * module exports until its owning session lands (R0.11).
 */

/** Trainer mode of the graded decision (05 section 1, 06 section 3.6, ADR 0011). */
export type GradeMode = "automated" | "drill" | "holdout" | "prediction";

/** Labels of 05 section 6.3, driven by EV (expected value) loss, never by frequency (ADR 0008). */
export type GradeLabel = "Best" | "Correct" | "Inaccuracy" | "Mistake" | "Blunder";

/**
 * Grouping modes of 05 section 6.4 rule 3: Standard grades the exact tree size, Grouped the bet
 * bucket, Simple the action type by its best size (O-211).
 */
export type Grouping = "standard" | "grouped" | "simple";

/** The street of the graded node; v1 serves preflop only, v1.5 the rest (ADR 0023). */
export type Street = "preflop" | "flop" | "turn" | "river";

/**
 * Action kinds, spelled as solver-query's ActionKind enum. The package depends on no workspace
 * package (A1 section 2), so the union is local and a test pins it to the contract.
 */
export type ActionKind = "fold" | "check" | "call" | "limp" | "straddle" | "bet" | "raise" | "all_in";

/**
 * Bet-size buckets, spelled as gto_model::Bucket::as_str. Rust assigns them at pack time and the
 * policy only compares them (ADR 0004, R2.3).
 */
export type Bucket = "tiny" | "small" | "medium" | "pot" | "overbet-small" | "overbet-large" | "all-in";

/**
 * One tree action of the node in record order, as solver-query reports it: its kind, its bucket
 * (null for fold, check, call, limp and straddle), its total wager in centi-big-blinds, and the
 * hand's loss for it in percent of the pot, raw and computed in Rust (ADR 0004, O-210).
 */
export type GradeAction = {
  kind: ActionKind;
  bucket: Bucket | null;
  sizeCbb: number;
  lossPctPot: number;
};

/**
 * Input of the grading policy (A6 section 4). lossPctPot and floorPctPot arrive from solver-query
 * in percent of the pot at the node and are never recomputed here (R3.8, ADR 0004, O-150).
 * freqByAction lists the hand's equilibrium frequency per tree action in record order; actionIndex
 * is the chosen action in that order; rngRoll is the 1 to 100 roll when RNG mode is on (05
 * section 7, ADR 0009); noiseFlags carries the flags of 05 section 9 (any flag unrates).
 *
 * S22 extensions: grouping (default standard, O-211); actions, the node's actions in record order,
 * required for Grouped and Simple and for RNG mode, whose bands always follow their kind and size
 * order (O-210, O-213); ratedTodayInTrack, the rated decisions already counted today in this
 * decision's track, which the daily cap of 150 needs (O-56, O-214); street, because Grouped shows
 * and grades exact sizes at a preflop node (R3.9, O-22, O-211).
 */
export type GradeInput = {
  lossPctPot: number;
  floorPctPot: number;
  freqByAction: readonly number[];
  actionIndex: number;
  rngRoll?: number;
  noiseFlags: readonly string[];
  mode: GradeMode;
  firstAttempt: boolean;
  panelsRevealed: boolean;
  grouping?: Grouping;
  actions?: readonly GradeAction[];
  ratedTodayInTrack: number;
  street: Street;
};

/**
 * Output of the grading policy (A6 section 4): score = exp(-max(0, loss - floor) / tau), the
 * label per 05 section 6.3, whether the decision moves the rating, and its rating weight. S22
 * adds gradedActionIndex: the action whose loss was graded, which is the chosen action in
 * Standard and the lowest-loss member of the chosen group in Grouped and Simple (O-211), so
 * services/api stores that action's loss and the criterion 3 recompute can follow it (O-60).
 */
export type GradeOutput = {
  score: number;
  label: GradeLabel;
  rated: boolean;
  weight: number;
  gradedActionIndex: number;
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
