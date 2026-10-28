/**
 * The prediction routes' handlers (R3.16, O-301, O-302, A5 section 3): GET next and POST answer.
 *
 * - next: the user's session (404 otherwise), of mode prediction (409 wrong-session-mode), not
 *   ended (409 session-ended); the prompt is derived (derive.ts) and nothing is written, so two
 *   calls answer the same prompt. The truth never leaves the server here (predict before peek).
 * - answer: the same checks, then the body's state_version must be the session's and its prompt_id
 *   one of the current counter's (409 stale-state otherwise). The prompt is rebuilt at the ladder
 *   and level its id was shown at, not the level the history reads now, so an unlock from another
 *   session of the user never makes an open prompt unanswerable (derive.ts, PR #29 review M6).
 *   The answer is judged (judge.ts), and in one idempotentWrite transaction the session row is locked and its version
 *   checked again, one prediction_answer row is inserted and the state is written with the counter
 *   advanced (state_version moves). The level after the answer is learning's levelFor over the
 *   stored answers, so next_level_unlocked is true exactly for the answer that crossed. The
 *   result copies the truth's Rust numbers; no attempt row is written and no rating is touched.
 * - S41 (O-410, O-412, O-413): the body's reason is cleaned and checked first (rationale.ts, a 400
 *   before anything is read or written) and stored with the validated answer in the same row; it is
 *   never echoed. level_passed is learning's windowAtLevel at the asked level, the quiz's passed mark.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import { levelFor, windowAtLevel } from "@g-tee-oh/learning";

import { sessionNotFound } from "../grading/decide.js";
import { staleStateProblem } from "../grading/attempts.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS } from "../http/problem.js";
import type { predictionAnswerBodySchema, predictionPromptSchema, predictionResultSchema } from "../schemas/prediction.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { requireSessionMode, sessionEndedProblem } from "../sessions/problems.js";
import { findSession, lockSession, writeState, type SessionRow } from "../sessions/repository.js";
import { solverPort } from "../sessions/solver-port.js";
import { derivePrediction, deriveShownPrediction, practiceOf, type DerivedPrediction } from "./derive.js";
import { judgeAnswer } from "./judge.js";
import { requireRationale } from "./rationale.js";
import { answerHistory, insertAnswer } from "./repository.js";

export type PredictionPrompt = z.infer<typeof predictionPromptSchema>;
export type PredictionResult = z.infer<typeof predictionResultSchema>;
export type PredictionAnswerBody = z.infer<typeof predictionAnswerBodySchema>;

const PREDICTION_MODE = "prediction";

export interface PredictionCall {
  app: FastifyInstance;
  request: FastifyRequest;
  userId: string;
}

async function readPredictionSession(call: PredictionCall, sessionId: string): Promise<SessionRow> {
  const session = await findSession(requireDatabase(call.app), call.userId, sessionId);
  if (session === undefined) {
    throw sessionNotFound();
  }
  requireSessionMode(session, PREDICTION_MODE);
  if (session.state.phase === "ended") {
    throw sessionEndedProblem();
  }
  return session;
}

async function derive(call: PredictionCall, session: SessionRow): Promise<DerivedPrediction> {
  const database = requireDatabase(call.app);
  const port = solverPort(requireSolverQuery(call.app), call.request);
  return derivePrediction(session, port, (spotClassKey) => answerHistory(database, call.userId, spotClassKey));
}

function toPrompt(session: SessionRow, derived: DerivedPrediction): PredictionPrompt {
  const { question, node, spot } = derived;
  return {
    prompt_id: derived.promptId,
    session_id: session.id,
    state_version: session.stateVersion,
    ladder: question.ladder,
    level: question.level,
    answer_kind: question.answer_kind,
    question: question.question,
    spot_class_key: derived.spotClassKey,
    node_key: node.node_key,
    hero_position: spot.hero_seat,
    history: spot.history.map((entry) => ({ ...entry })),
    hand: question.hand,
    actions: node.actions.map((action) => ({
      index: action.index,
      token: action.token,
      kind: action.kind,
      size_cbb: action.size_cbb,
      bucket: action.bucket ?? null,
      label: action.label,
      next_node_key: action.next_node_key ?? null,
    })),
    action_index: question.action_index,
    threshold_pct: question.threshold_pct,
    regions: question.regions === null ? null : [...question.regions],
    bands: question.bands === null ? null : [...question.bands],
    synthetic: node.synthetic,
  };
}

/** GET /prediction/{session}/next: derived, never written. */
export async function nextPrediction(call: PredictionCall, sessionId: string): Promise<PredictionPrompt> {
  const session = await readPredictionSession(call, sessionId);
  return toPrompt(session, await derive(call, session));
}

/**
 * The prompt the body answers, as it was shown: the session's current version and a prompt id of
 * its current counter, rebuilt at the ladder and level the GET showed it at, never the level the
 * history reads now (PR #29 review M6). Anything else is 409 stale-state, so the client moves on.
 */
async function shownPrompt(call: PredictionCall, session: SessionRow, body: PredictionAnswerBody): Promise<DerivedPrediction> {
  if (session.stateVersion !== body.state_version) {
    throw staleStateProblem();
  }
  const port = solverPort(requireSolverQuery(call.app), call.request);
  const derived = await deriveShownPrediction(session, port, body.prompt_id);
  if (derived === undefined) {
    throw staleStateProblem();
  }
  return derived;
}

/** POST /prediction/{session}/answer: judged, recorded unrated, the counter advanced. */
export async function answerPrediction(call: PredictionCall, sessionId: string, body: PredictionAnswerBody): Promise<PredictionResult> {
  const rationale = requireRationale(body.rationale);
  const session = await readPredictionSession(call, sessionId);
  const derived = await shownPrompt(call, session, body);
  const correct = judgeAnswer(derived.question, derived.node, body.answer);
  const { question, spotClassKey } = derived;
  return idempotentWrite(call.app, call.request, HTTP_STATUS.ok, async (transaction) => {
    const locked = await lockSession(transaction, call.userId, session.id);
    if (locked === undefined) {
      throw sessionNotFound();
    }
    if (locked.stateVersion !== session.stateVersion) {
      throw staleStateProblem();
    }
    const record = {
      userId: call.userId,
      sessionId: session.id,
      spotClassKey,
      ladder: question.ladder,
      level: question.level,
      correct,
      rationale,
      answer: body.answer,
    };
    await insertAnswer(transaction, record);
    // The counter moves on; the kind, data and S41 quiz options are kept as they are.
    const practice = { ...practiceOf(locked), counter: derived.counter + 1 };
    const written = await writeState(transaction, {
      userId: call.userId,
      sessionId: session.id,
      expectedVersion: session.stateVersion,
      state: { ...locked.state, practice },
    });
    if (written === undefined) {
      throw staleStateProblem();
    }
    const history = await answerHistory(transaction, call.userId, spotClassKey);
    const key = { spotClassKey, ladder: question.ladder };
    const after = levelFor(history, key);
    // A quiz asks its own level, so its window and passed mark are that level's (PR #39 review finding 1).
    const asked = windowAtLevel(history, key, question.level);
    const isQuiz = practiceOf(locked).quiz !== undefined;
    return {
      prompt_id: derived.promptId,
      correct,
      ladder: question.ladder,
      level: question.level,
      truth: { ...question.truth },
      window: isQuiz ? asked.window : after.window,
      next_level_unlocked: after.unlockedNow,
      level_passed: asked.passed,
      new_level: after.level,
      state_version: written.stateVersion,
    };
  });
}
