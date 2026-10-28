/**
 * Attempt rows (R3.7, A4 section 2, O-246, O-214, O-247, ADR 0010).
 *
 * insertAttempt writes one graded decision with every A4 column and the S23 columns that make the
 * feedback a function of the row (O-92, O-246); the unique (session_id, state_version) index turns a
 * second grade of the same decision into a 23505, reported as 409 stale-state, so a decision is
 * graded once even if two requests pass the api's own checks together.
 *
 * countRatedToday is ratedTodayInTrack (O-214): the user's rated attempts since midnight in the
 * configured time zone (O-247), counted at an injected instant so a test fixes the clock. Postgres
 * computes the midnight (`date_trunc('day', now at time zone tz) at time zone tz`), which handles
 * daylight saving changes. S31's learning hooks may replace it with a per-track count (O-274).
 *
 * S31 (O-274) adds hand_class (the hero's row label at the node, from solver-query), panels_revealed,
 * track_ids and item_difficulty; the hooks supply the last two (learning/effects.ts).
 */
import { sql } from "kysely";

import type { Database } from "../db.js";
import { HTTP_STATUS, PG_ERROR, PROBLEM_SLUGS, ProblemError, pgErrorCode } from "../http/problem.js";
import { FEEDBACK_COLUMNS, type FeedbackRow } from "./feedback.js";

// The feedback row joins the attempt's solution for its configuration and pair (O-280, O-281).

/** v1 opponents play the equilibrium, and every graded decision records it (ADR 0010, 05 section 3). */
export const REFERENCE_STRATEGY = "equilibrium";

export interface AttemptValues {
  userId: string;
  sessionId: string;
  solutionId: string;
  nodeKey: string;
  spotClassKey: string;
  hand: string;
  actionIndex: number;
  actionToken: string;
  bucket: string | null;
  evChosenBb: number;
  evBestBb: number;
  evLossBb: number;
  evLossPctPot: number;
  floorPctPot: number;
  score: number;
  label: string;
  rngRoll: number | null;
  confidence: "sure" | "unsure" | null;
  responseMs: number;
  rated: boolean;
  weight: number;
  noiseFlags: readonly string[];
  stateVersion: number;
  freqByAction: readonly number[];
  evByAction: readonly number[];
  lossPctPotByAction: readonly number[];
  bestActionIndexes: readonly number[];
  gradedActionIndex: number;
  /** The hero's row label at the node as solver-query answers it (O-274). */
  handClass: string | null;
  /** An answer-revealing panel was on (grading/policy.ts panelsRevealAnswer, or the block's panels). */
  panelsRevealed: boolean;
  trackIds: readonly string[];
  itemDifficulty: number | null;
}

export function staleStateProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.staleState, {
    detail: "The session moved on since this prompt; fetch the next prompt.",
  });
}

export async function insertAttempt(transaction: Database, values: AttemptValues): Promise<FeedbackRow> {
  try {
    return await transaction
      .insertInto("attempt")
      .values({
        user_id: values.userId,
        session_id: values.sessionId,
        solution_id: values.solutionId,
        node_key: values.nodeKey,
        spot_class_key: values.spotClassKey,
        track_ids: [...values.trackIds],
        hand: values.hand,
        action_index: values.actionIndex,
        action_token: values.actionToken,
        bucket: values.bucket,
        ev_chosen_bb: values.evChosenBb,
        ev_best_bb: values.evBestBb,
        ev_loss_bb: values.evLossBb,
        ev_loss_pct_pot: values.evLossPctPot,
        floor_pct_pot: values.floorPctPot,
        score: values.score,
        label: values.label,
        reference_strategy: REFERENCE_STRATEGY,
        rng_roll: values.rngRoll,
        confidence: values.confidence,
        response_ms: values.responseMs,
        rated: values.rated,
        weight: values.weight,
        noise_flags: [...values.noiseFlags],
        state_version: values.stateVersion,
        freq_by_action: [...values.freqByAction],
        ev_by_action: [...values.evByAction],
        loss_pct_pot_by_action: [...values.lossPctPotByAction],
        best_action_indexes: [...values.bestActionIndexes],
        graded_action_index: values.gradedActionIndex,
        hand_class: values.handClass,
        panels_revealed: values.panelsRevealed,
        item_difficulty: values.itemDifficulty,
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((inserted) => selectFeedbackRow(transaction, inserted.id));
  } catch (error: unknown) {
    if (pgErrorCode(error) === PG_ERROR.uniqueViolation) {
      throw Object.assign(staleStateProblem(), { cause: error });
    }
    throw error;
  }
}

/** Attempts with their solution's configuration and pair: the rows renderFeedback reads (O-280, O-281). */
export function feedbackRows(database: Database) {
  return database
    .selectFrom("attempt")
    .innerJoin("solution", "solution.id", "attempt.solution_id")
    .select(FEEDBACK_COLUMNS.map((column) => `attempt.${column}` as const))
    .select(["solution.game_config_id", "solution.position_pair"]);
}

/** One attempt's feedback row; inside the decision's transaction it sees the row just inserted. */
export async function selectFeedbackRow(database: Database, attemptId: string): Promise<FeedbackRow> {
  return feedbackRows(database).where("attempt.id", "=", attemptId).executeTakeFirstOrThrow();
}

/** The user's rated attempts since midnight in `timeZone`, as of `now` (O-214, O-247). */
export async function countRatedToday(database: Database, userId: string, now: Date, timeZone: string): Promise<number> {
  const row = await database
    .selectFrom("attempt")
    .select((eb) => eb.fn.countAll<string>().as("rated"))
    .where("user_id", "=", userId)
    .where("rated", "=", true)
    .where("created_at", "<=", now)
    .where(
      "created_at",
      ">=",
      sql<Date>`(date_trunc('day', cast(${now.toISOString()} as timestamptz) at time zone ${timeZone}) at time zone ${timeZone})`,
    )
    .executeTakeFirstOrThrow();
  return Number(row.rated);
}
