/**
 * Range drift for GET /insights/drift (R3.18, O-304, 05 section 9, PM note 4).
 *
 * Mechanism:
 * 1. Read the session user's attempts in one node family (Rust's spot_class_key), newest first and
 *    at most DRIFT_DECISIONS_CAP rows, keeping only rows that carry action_kinds and freq_by_action
 *    (rows graded before S27 stored no kinds and are excluded). The query always filters by
 *    user_id, so another user's attempts never count; the (user_id, spot_class_key, created_at)
 *    index serves it.
 * 2. Each row becomes one learning DriftDecision: the chosen kind is action_kinds[action_index],
 *    the kinds and frequencies are copied as stored. Both lists came from solver-query when the
 *    decision was graded (ADR 0004: Rust names the kinds and gives the frequencies).
 * 3. learning's rangeDrift computes the shares, the total variation distance and its bootstrap
 *    interval, hidden below 30 decisions; this module only maps the result to the RangeDrift
 *    schema (nulls and an empty by_kind while hidden).
 *
 * It only reads: no score, rated flag, weight or label changes, and drift is never an input of
 * grading (O-304). A stored row that does not parse (kinds and frequencies of different lengths,
 * an unknown kind, an action index outside the lists) is a 500: grading wrote it, so it means a
 * corrupted row, not a user error, and the detail names no row content.
 */
import { DRIFT_CONFIDENCE, DRIFT_MIN_DECISIONS, rangeDrift, type DriftDecision, type DriftResult } from "@g-tee-oh/learning";
import { z } from "zod";

import type { Database } from "../db.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { driftSchema } from "../schemas/explain.js";
import { actionKindSchema } from "../schemas/study.js";

/** The newest decisions read per drift request: bounds the query and the bootstrap's work (O-304). */
export const DRIFT_DECISIONS_CAP = 2000;

export type RangeDrift = z.infer<typeof driftSchema>;

const storedDecisionSchema = z
  .object({
    action_index: z.number().int().min(0),
    action_kinds: z.array(actionKindSchema).min(1),
    freq_by_action: z.array(z.number().finite().min(0)).min(1),
  })
  .refine((row) => row.action_kinds.length === row.freq_by_action.length && row.action_index < row.action_kinds.length);

type StoredDecision = z.infer<typeof storedDecisionSchema>;

function unreadableAttempt(cause: unknown): ProblemError {
  return Object.assign(
    new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "A stored attempt cannot be read for range drift." }),
    { cause },
  );
}

/** One stored attempt as a learning drift decision; a 500 for a row grading could not have written. */
export function toDriftDecision(row: unknown): DriftDecision {
  const parsed = storedDecisionSchema.safeParse(row);
  if (!parsed.success) {
    throw unreadableAttempt(parsed.error);
  }
  const stored: StoredDecision = parsed.data;
  return {
    chosenKind: stored.action_kinds[stored.action_index] as DriftDecision["chosenKind"],
    kinds: stored.action_kinds,
    freqByAction: stored.freq_by_action,
  };
}

/** The user's newest drift-ready attempts in one spot class (O-304). */
export async function readDriftRows(database: Database, userId: string, spotClassKey: string): Promise<unknown[]> {
  return database
    .selectFrom("attempt")
    .select(["action_index", "action_kinds", "freq_by_action"])
    .where("user_id", "=", userId)
    .where("spot_class_key", "=", spotClassKey)
    .where("action_kinds", "is not", null)
    .where("freq_by_action", "is not", null)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(DRIFT_DECISIONS_CAP)
    .execute();
}

/** learning's drift result in the RangeDrift contract shape. */
export function toRangeDrift(spotClassKey: string, result: DriftResult): RangeDrift {
  const common = { spot_class_key: spotClassKey, decisions: result.decisions, min_decisions: DRIFT_MIN_DECISIONS, confidence: DRIFT_CONFIDENCE };
  if (!result.shown) {
    return { ...common, shown: false, distance: null, ci_low: null, ci_high: null, by_kind: [] };
  }
  return {
    ...common,
    shown: true,
    distance: result.distance,
    ci_low: result.ciLow,
    ci_high: result.ciHigh,
    by_kind: result.byKind.map((share) => ({ kind: share.kind, user_share: share.userShare, solver_share: share.solverShare })),
  };
}

/** GET /insights/drift: the session user's range drift in one node family; reads only. */
export async function driftFor(database: Database, userId: string, spotClassKey: string): Promise<RangeDrift> {
  const rows = await readDriftRows(database, userId, spotClassKey);
  return toRangeDrift(spotClassKey, rangeDrift(rows.map(toDriftDecision)));
}
