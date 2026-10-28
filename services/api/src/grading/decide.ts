/**
 * POST /sessions/{id}/decisions (R3.7, A5 section 3, A6 sections 2 and 4, O-92, O-156, O-246,
 * O-248): grade one decision and persist it with the session's next state, all or nothing.
 *
 * Mechanism:
 * 1. Read the session (404 when it is not the user's, 409 session-ended, 409 stale-state when the
 *    body's state_version is not the persisted one), and derive its await_hero state exactly as
 *    GET /next does (sessions/derive.ts), so the decision answers the prompt the player saw. The
 *    action_index must be one of the node's actions (400).
 * 2. Grade with solver-query /v1/grade, timed into Server-Timing as sq-grade (O-248), with the
 *    reference `${session_id}:${state_version}` (O-156). In Grouped and Simple modes the policy may
 *    grade a group at another member (O-211); its loss in big blinds then comes from a second grade
 *    call for that member, so the stored EV loss is always Rust's (ADR 0004).
 * 3. In idempotentWrite's transaction (O-232): lock the session row, re-check its version, count
 *    ratedTodayInTrack (O-214, O-247), grade with learning's grade(), insert the attempt row, move
 *    the state to feedback with state_version + 1 (an optimistic write), and render the feedback
 *    from the inserted row (O-92). Any failure rolls back the attempt with the state, and under an
 *    Idempotency-Key the stored response commits with them, so a retry replays it, graded once.
 */
import { grade as gradeDecision, type GradeOutput } from "@g-tee-oh/learning";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import type { AppConfig } from "../config.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { SQ_GRADE_METRIC, timed } from "../http/server-timing.js";
import type { decisionBodySchema } from "../schemas/training.js";
import { actionAt, afterHeroDecision, deriveAwaitHero, type DerivedPrompt } from "../sessions/derive.js";
import { findSession, lockSession, writeState, type SessionRow } from "../sessions/repository.js";
import { solverPort, type SolverPort } from "../sessions/solver-port.js";
import { requireSolverQuery, type SqAction, type SqGrade } from "../solver-query/client.js";
import { countRatedToday, insertAttempt, staleStateProblem, type AttemptValues } from "./attempts.js";
import { renderFeedback, toContractLabel, type Feedback } from "./feedback.js";
import { bestActionIndexes, buildGradeInput, gradeActions } from "./policy.js";
import { sessionEndedProblem } from "../sessions/derive.js";

export type DecisionBody = z.infer<typeof decisionBodySchema>;

/** The spot-class key stored for a node solver-query gives none (a configuration outside the catalog). */
export const UNCLASSIFIED_SPOT_CLASS = "unclassified";
/** The grade reference is opaque to solver-query and at most this long (O-156). */
const MAX_REFERENCE_LENGTH = 64;
/** ratedTodayInTrack does not change which action a group grades at, so the preview passes zero. */
const PREVIEW_RATED_TODAY = 0;

export interface DecisionRequest {
  app: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  config: AppConfig;
  userId: string;
  sessionId: string;
  body: DecisionBody;
  now: Date;
}

interface Graded {
  derived: DerivedPrompt;
  action: SqAction;
  chosen: SqGrade;
  gradedLossBb: number;
}

export function sessionNotFound(): ProblemError {
  return new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No session of yours has this id." });
}

function referenceOf(sessionId: string, stateVersion: number): string {
  return `${sessionId}:${stateVersion}`.slice(0, MAX_REFERENCE_LENGTH);
}

function policyOutput(session: SessionRow, graded: Graded, actionIndex: number, ratedToday: number): GradeOutput {
  return gradeDecision(
    buildGradeInput({
      node: graded.derived.node,
      grade: graded.chosen,
      actionIndex,
      rngRoll: graded.derived.roll?.roll ?? null,
      settings: session.settings,
      ratedTodayInTrack: ratedToday,
    }),
  );
}

async function gradeWithSolverQuery(session: SessionRow, decision: DecisionRequest, port: SolverPort): Promise<Graded> {
  const { settings } = session;
  const derived = await deriveAwaitHero(session.state, { stopRule: settings.stop_rule, rng: settings.rng }, port);
  const action = actionAt(derived.node, decision.body.action_index);
  if (action === undefined) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
      detail: "action_index is not one of this node's actions.",
    });
  }
  const call = {
    solution_id: derived.hand.solution_id,
    node_key: derived.node.node_key,
    hand: derived.hand.hero_hand,
    reference: referenceOf(session.id, session.stateVersion),
  };
  const chosen = await timed(decision.reply, SQ_GRADE_METRIC, () => port.grade({ ...call, action_index: action.index }));
  const partial: Graded = { derived, action, chosen, gradedLossBb: chosen.loss_bb };
  const gradedIndex = policyOutput(session, partial, action.index, PREVIEW_RATED_TODAY).gradedActionIndex;
  if (gradedIndex === action.index) {
    return partial;
  }
  const member = await timed(decision.reply, SQ_GRADE_METRIC, () => port.grade({ ...call, action_index: gradedIndex }));
  return { ...partial, gradedLossBb: member.loss_bb };
}

function attemptValues(session: SessionRow, decision: DecisionRequest, graded: Graded, outcome: GradeOutput): AttemptValues {
  const { chosen, derived, action } = graded;
  const actions = gradeActions(derived.node, chosen);
  const roll = derived.roll?.roll ?? null;
  return {
    userId: decision.userId,
    sessionId: session.id,
    solutionId: derived.hand.solution_id,
    nodeKey: derived.node.node_key,
    spotClassKey: derived.node.spot_class_key ?? UNCLASSIFIED_SPOT_CLASS,
    hand: derived.hand.hero_hand,
    actionIndex: action.index,
    actionToken: action.token,
    bucket: action.bucket ?? null,
    evChosenBb: chosen.ev_chosen_bb,
    evBestBb: chosen.ev_best_bb,
    evLossBb: graded.gradedLossBb,
    evLossPctPot: chosen.loss_pct_pot_by_action[outcome.gradedActionIndex] ?? chosen.loss_pct_pot,
    floorPctPot: chosen.floor_pct_pot,
    score: outcome.score,
    label: toContractLabel(outcome.label),
    rngRoll: roll,
    confidence: decision.body.confidence ?? null,
    responseMs: decision.body.response_ms,
    rated: outcome.rated,
    weight: outcome.weight,
    noiseFlags: chosen.noise_flags,
    stateVersion: session.stateVersion,
    freqByAction: chosen.freq_by_action,
    evByAction: chosen.ev_by_action,
    lossPctPotByAction: chosen.loss_pct_pot_by_action,
    bestActionIndexes: bestActionIndexes(chosen.freq_by_action, actions, roll),
    gradedActionIndex: outcome.gradedActionIndex,
  };
}

async function readForDecision(decision: DecisionRequest): Promise<SessionRow> {
  const session = await findSession(requireDatabase(decision.app), decision.userId, decision.sessionId);
  if (session === undefined) {
    throw sessionNotFound();
  }
  if (session.state.phase === "ended") {
    throw sessionEndedProblem();
  }
  if (session.stateVersion !== decision.body.state_version) {
    throw staleStateProblem();
  }
  return session;
}

/** Grades one decision and persists it with the next state in one transaction (R3.7). */
export async function submitDecision(decision: DecisionRequest): Promise<Feedback> {
  const session = await readForDecision(decision);
  const port = solverPort(requireSolverQuery(decision.app), decision.request);
  const graded = await gradeWithSolverQuery(session, decision, port);
  return idempotentWrite(decision.app, decision.request, HTTP_STATUS.ok, async (transaction) => {
    const locked = await lockSession(transaction, decision.userId, session.id);
    if (locked === undefined) {
      throw sessionNotFound();
    }
    if (locked.stateVersion !== session.stateVersion) {
      throw staleStateProblem();
    }
    const ratedToday = await countRatedToday(transaction, decision.userId, decision.now, decision.config.timeZone);
    const outcome = policyOutput(session, graded, graded.action.index, ratedToday);
    const row = await insertAttempt(transaction, attemptValues(session, decision, graded, outcome));
    const next = afterHeroDecision(graded.derived, graded.action, row.id, session.settings.stop_rule);
    const written = await writeState(transaction, {
      userId: decision.userId,
      sessionId: session.id,
      expectedVersion: session.stateVersion,
      state: next,
    });
    if (written === undefined) {
      throw staleStateProblem();
    }
    return renderFeedback(row);
  });
}
