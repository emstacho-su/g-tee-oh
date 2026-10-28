/**
 * Holdout results (R4.13, O-276, PR #27 review HIGH 1 and HIGH 4): what became of each item of a
 * user's round. Every outcome resolves the item for the round: it is never served again there.
 *
 * - answered: a decision on the item, with its attempt (its score counts).
 * - skipped: the item was served in a session that ended, or that a new create replaced, before it
 *   was answered; it scores SKIPPED_SCORE (0), so viewing and abandoning items never pays (HIGH 1).
 * - unservable: the item's replay failed deterministically this round (a mismatch, an off-range hand,
 *   or a 4xx from solver-query); it is unscored and counts in neither answered nor the mean (HIGH 4).
 *   A transient failure (a timeout, a network error, a 5xx or 503) writes no result: the item stays
 *   unresolved and is tried again by a later search (O-334).
 * Unique (user, item, round) makes each resolution write once; the first one stands.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";
import type { TrackKey } from "../learning/tracks.js";
import { asTrackKey } from "./repository.js";

export const HOLDOUT_OUTCOMES = { answered: "answered", skipped: "skipped", unservable: "unservable" } as const;
export type HoldoutOutcome = (typeof HOLDOUT_OUTCOMES)[keyof typeof HOLDOUT_OUTCOMES];

/** The score a skipped item counts with (PR #27 review HIGH 1). */
export const SKIPPED_SCORE = 0;

export type NewResult = Readonly<{
  userId: string;
  itemId: string;
  roundId: string;
  takenAt: Date;
}> &
  (Readonly<{ outcome: typeof HOLDOUT_OUTCOMES.answered; attemptId: string }> | Readonly<{ outcome: "skipped" | "unservable" }>);

/** True for the outcomes that count as answered with a score (answered and skipped). */
export function isScored(outcome: HoldoutOutcome): boolean {
  return outcome !== HOLDOUT_OUTCOMES.unservable;
}

function parseOutcome(value: string): HoldoutOutcome {
  const found = Object.values(HOLDOUT_OUTCOMES).find((outcome) => outcome === value);
  if (found === undefined) {
    throw new Error(`holdout result with an unknown outcome ${value}`);
  }
  return found;
}

/** The items the user resolved in a round, with their outcomes. */
export async function resolvedItems(database: Database, userId: string, roundId: string): Promise<ReadonlyMap<string, HoldoutOutcome>> {
  const rows = await database
    .selectFrom("holdout_result")
    .select(["holdout_item_id", "outcome"])
    .where("user_id", "=", userId)
    .where("round_id", "=", roundId)
    .execute();
  return new Map(rows.flatMap((row) => (row.holdout_item_id === null ? [] : [[row.holdout_item_id, parseOutcome(row.outcome)] as const])));
}

/** Records resolutions (each once per user, item and round; an existing one stands). */
export async function insertResults(transaction: Database, results: readonly NewResult[]): Promise<void> {
  if (results.length === 0) {
    return;
  }
  await transaction
    .insertInto("holdout_result")
    .values(
      results.map((result) => ({
        user_id: result.userId,
        holdout_item_id: result.itemId,
        round_id: result.roundId,
        taken_at: result.takenAt,
        outcome: result.outcome,
        attempt_id: result.outcome === HOLDOUT_OUTCOMES.answered ? result.attemptId : null,
      })),
    )
    .onConflict((conflict) => conflict.columns(["user_id", "holdout_item_id", "round_id"]).doNothing())
    .execute();
}

/** Per track of a round: scored items (answered and skipped) and their mean score, a skipped one at SKIPPED_SCORE. */
export async function roundScores(database: Database, roundId: string): Promise<Map<TrackKey, { answered: number; meanScore: number | null }>> {
  const rows = await database
    .selectFrom("holdout_result")
    .innerJoin("holdout_item", "holdout_item.id", "holdout_result.holdout_item_id")
    .innerJoin("track", "track.id", "holdout_item.track_id")
    .leftJoin("attempt", "attempt.id", "holdout_result.attempt_id")
    .select((eb) => [
      "track.key",
      eb.fn.countAll<string>().as("answered"),
      sql<number | null>`avg(case when holdout_result.outcome = ${HOLDOUT_OUTCOMES.skipped} then ${SKIPPED_SCORE} else attempt.score end)::float8`.as(
        "mean_score",
      ),
    ])
    .where("holdout_result.round_id", "=", roundId)
    .where("holdout_result.outcome", "<>", HOLDOUT_OUTCOMES.unservable)
    .groupBy("track.key")
    .execute();
  return new Map(rows.map((row) => [asTrackKey(row.key), { answered: Number(row.answered), meanScore: row.mean_score }]));
}
