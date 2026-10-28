/**
 * Decision feedback (R3.7, O-92, A5 section 3): one pure function renders the feedback from the
 * stored attempt row, never from the grade response, so what the player saw is exactly what was
 * stored, an Idempotency-Key replay and a later re-render agree, and S29's recompute can compare the
 * row with an independent recompute.
 *
 * The learning package labels in capitals ("Best"); the contract and the attempt row use lowercase
 * ("best"). CONTRACT_LABELS is the one place that maps them. state_version in the feedback is the
 * session's version after the decision: the row stores the version the decision was made at
 * (O-246), and a decision always moves the session exactly one version on.
 */
import type { GradeLabel } from "@g-tee-oh/learning";
import type { Selectable } from "kysely";
import type { z } from "zod";

import type { DB } from "@g-tee-oh/contracts";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { noiseFlagSchema } from "../schemas/study.js";
import { gradeLabelSchema, type feedbackSchema } from "../schemas/training.js";

export type ContractLabel = z.infer<typeof gradeLabelSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;

export const CONTRACT_LABELS: Readonly<Record<GradeLabel, ContractLabel>> = {
  Best: "best",
  Correct: "correct",
  Inaccuracy: "inaccuracy",
  Mistake: "mistake",
  Blunder: "blunder",
};

/**
 * The attempt columns the feedback reads, plus the configuration and pair of the attempt's
 * solution row (O-280, O-281): the attempt stores solution_id and node_key, and the solution row
 * names its configuration and pair, so the feedback panel can fetch the node just decided without
 * the api parsing a node key (O-245).
 */
export type FeedbackRow = Pick<
  Selectable<DB["attempt"]>,
  | "id"
  | "label"
  | "score"
  | "ev_loss_bb"
  | "ev_loss_pct_pot"
  | "best_action_indexes"
  | "freq_by_action"
  | "ev_by_action"
  | "rated"
  | "rng_roll"
  | "state_version"
  | "solution_id"
  | "node_key"
  | "hand"
  | "noise_flags"
  | "spot_class_key"
> &
  Pick<Selectable<DB["solution"]>, "game_config_id" | "position_pair">;

/** The attempt's own columns of a FeedbackRow; the solution's two come from a join (attempts.ts). */
export const FEEDBACK_COLUMNS = [
  "id",
  "label",
  "score",
  "ev_loss_bb",
  "ev_loss_pct_pot",
  "best_action_indexes",
  "freq_by_action",
  "ev_by_action",
  "rated",
  "rng_roll",
  "state_version",
  "solution_id",
  "node_key",
  "hand",
  "noise_flags",
  "spot_class_key",
] as const;

export function toContractLabel(label: GradeLabel): ContractLabel {
  return CONTRACT_LABELS[label];
}

function required<T>(value: T | null, column: string): T {
  if (value === null) {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, {
      detail: `The attempt row has no ${column}, so its feedback cannot be rendered.`,
    });
  }
  return value;
}

/** The feedback of one attempt, from its row alone (O-92). */
export function renderFeedback(row: FeedbackRow): Feedback {
  return {
    attempt_id: row.id,
    label: gradeLabelSchema.parse(row.label),
    score: row.score,
    ev_loss_bb: row.ev_loss_bb,
    ev_loss_pct_pot: row.ev_loss_pct_pot,
    best_action_indexes: [...required(row.best_action_indexes, "best_action_indexes")],
    freq_by_action: [...required(row.freq_by_action, "freq_by_action")],
    ev_by_action: [...required(row.ev_by_action, "ev_by_action")],
    rated: row.rated,
    rng_roll: row.rng_roll,
    state_version: required(row.state_version, "state_version") + 1,
    solution_id: row.solution_id,
    node_key: row.node_key,
    config_id: row.game_config_id,
    pair: required(row.position_pair, "position_pair"),
    hand: row.hand,
    noise_flags: row.noise_flags.map((flag) => noiseFlagSchema.parse(flag)),
    spot_class_key: row.spot_class_key,
  };
}
