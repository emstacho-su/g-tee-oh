/**
 * The hand log's step in POST /sessions/{id}/decisions (R3.13, S40, O-400 as amended in PR #42
 * review round 1 A): which hand this decision ends, if any, as validated row values.
 *
 * Mechanism: before the decision's transaction opens, the machine runs forward from the decided
 * state (sessions/derive.ts deriveFinishedHand): the steps GET /next will take from the same stored
 * generator states, stopping on the edge into hand_end, before the next hand is dealt, and writing
 * nothing. The finished hand is validated (hands/repository.ts handRecordValues, security review L3).
 *
 * Best effort: the log never blocks a decision. When the forward run fails (a solver-query error,
 * a timeout, a lost node) or the hand does not validate, the step answers null and logs a warning
 * naming only the session and the cause (a problem's status and slug, or an error's name), never the
 * player, the cards or the history. The decision then commits without a hand_record, and GET /next
 * meets the same upstream fault as it did before S40.
 */
import type { FastifyBaseLogger } from "fastify";
import { ZodError } from "zod";

import { ProblemError } from "../http/problem.js";
import type { StopRule } from "../sessions/machine.js";
import { deriveFinishedHand, stateAfterHeroAction, type DerivedPrompt, type DeriveSettings } from "../sessions/derive.js";
import type { SolverPort } from "../sessions/solver-port.js";
import type { SqAction } from "../solver-query/client.js";
import { handRecordValues, type HandRecordValues } from "./repository.js";

export const HAND_LOG_SKIPPED = "hand log: the hand this decision ended is not logged; the decision commits without it";

const INVALID_HAND = "invalid hand record";
const UNKNOWN_CAUSE = "unknown";

export interface HandLogStep {
  sessionId: string;
  /** The prompt the decision answers, as the preview derived it. */
  derived: DerivedPrompt;
  /** The hero's action; the transaction persists the same one (settleMember changes only the graded member). */
  action: SqAction;
  stopRule: StopRule;
  settings: DeriveSettings;
  port: SolverPort;
  log: FastifyBaseLogger;
}

/** Why the step gave up, in words that carry no user data. */
function causeOf(error: unknown): string {
  if (error instanceof ProblemError) return `${error.status} ${error.slug}`;
  if (error instanceof ZodError) return INVALID_HAND;
  return error instanceof Error ? error.name : UNKNOWN_CAUSE;
}

/** The row values of the hand this decision ends; null when it goes on, or when the step failed. */
export async function handToLog(step: HandLogStep): Promise<HandRecordValues | null> {
  try {
    const decided = stateAfterHeroAction(step.derived, step.action, step.stopRule);
    const finished = await deriveFinishedHand(decided, step.settings, step.port);
    return finished === null ? null : handRecordValues(finished);
  } catch (error: unknown) {
    step.log.warn({ session_id: step.sessionId, cause: causeOf(error) }, HAND_LOG_SKIPPED);
    return null;
  }
}
