/**
 * Range painting (R3.17, A5 section 3, O-300, O-302, ADR 0004, ADR 0018): GET
 * /range-paint/{session}/next and POST /range-paint/submit over a drill-backed range_paint session.
 * The route file stays thin and calls these.
 *
 * - next: pure. The session must be the caller's (404 otherwise, ADR 0001), of mode range_paint
 *   (409 wrong-session-mode) and not ended (409 session-ended); the prompt is derived from the
 *   session state (prompt.ts) and nothing is written, so two calls answer the same prompt.
 * - submit: first, with no lock held, the session is read, the body's state_version must be the
 *   row's and its node_key the derived prompt's node (409 stale-state otherwise, so a paint of an
 *   old prompt is never graded against a new one), the paint must cover the prompt's classes
 *   exactly with node actions (paint.ts, 400), and solver-query's POST /v1/grade-range grades it;
 *   every number of its answer is relayed unchanged (ADR 0004: the per-class losses, weights and
 *   their sum are Rust's). Then one idempotent write (http/idempotent-write.ts, O-232) locks the
 *   row, re-checks its version (409 stale-state when another submit won meanwhile) and advances
 *   the practice counter by one through the optimistic state write, so no row lock is held across
 *   a solver-query call (PR #29 review M5). Painting is unrated: no attempt row is written and no
 *   rating state is touched (O-300).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import { sessionNotFound } from "../grading/decide.js";
import { staleStateProblem } from "../grading/attempts.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS } from "../http/problem.js";
import type { rangePaintBodySchema, rangePaintResultSchema } from "../schemas/range-paint.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { requireSessionMode, sessionEndedProblem } from "../sessions/problems.js";
import { findSession, lockSession, writeState, type SessionRow } from "../sessions/repository.js";
import { solverPort, type SqGradeRange } from "../sessions/solver-port.js";
import type { PersistedState } from "../sessions/state.js";
import { paintedHands } from "./paint.js";
import { derivePaintPrompt, paintCounter, type RangePaintPrompt } from "./prompt.js";

export type RangePaintBody = z.infer<typeof rangePaintBodySchema>;
export type RangePaintResult = z.infer<typeof rangePaintResultSchema>;

const PAINT_MODE = "range_paint";

export interface PaintCall {
  app: FastifyInstance;
  request: FastifyRequest;
  userId: string;
}

/** A session the paint routes may serve: the caller's, of mode range_paint, not ended. */
function requirePaintable(session: SessionRow | undefined): SessionRow {
  if (session === undefined) {
    throw sessionNotFound();
  }
  requireSessionMode(session, PAINT_MODE);
  if (session.state.phase === "ended") {
    throw sessionEndedProblem();
  }
  return session;
}

/** The next node to paint, derived and never written (GET is pure, O-302). */
export async function nextPaintPrompt(call: PaintCall, sessionId: string): Promise<RangePaintPrompt> {
  const session = requirePaintable(await findSession(requireDatabase(call.app), call.userId, sessionId));
  return derivePaintPrompt(session, solverPort(requireSolverQuery(call.app), call.request));
}

/** The state after one graded paint: the practice counter advanced by one. */
function advanced(state: PersistedState): PersistedState {
  const counter = paintCounter(state);
  return { ...state, practice: { kind: "range_paint", counter: counter + 1, data: { ...state.practice?.data } } };
}

function toResult(sessionId: string, stateVersion: number, grade: SqGradeRange): RangePaintResult {
  return {
    session_id: sessionId,
    state_version: stateVersion,
    node_key: grade.node_key,
    floor_pct_pot: grade.floor_pct_pot,
    total_weighted_loss_bb: grade.total_weighted_loss_bb,
    per_hand: grade.per_hand.map((row) => ({
      hand: row.hand,
      action_index: row.action_index,
      best_action_index: row.best_action_index,
      loss_bb: row.loss_bb,
      loss_pct_pot: row.loss_pct_pot,
      weight: row.weight,
      weighted_loss_bb: row.weighted_loss_bb,
    })),
  };
}

/** The session as the body names it, unlocked: the caller's, paintable and at the body's version. */
async function readForPaint(call: PaintCall, body: RangePaintBody): Promise<SessionRow> {
  const session = requirePaintable(await findSession(requireDatabase(call.app), call.userId, body.session_id));
  if (session.stateVersion !== body.state_version) {
    throw staleStateProblem();
  }
  return session;
}

/** The prompt derived and the paint graded, every solver-query call made before any lock is taken. */
async function gradeOutsideLock(call: PaintCall, session: SessionRow, body: RangePaintBody): Promise<SqGradeRange> {
  const port = solverPort(requireSolverQuery(call.app), call.request);
  const prompt = await derivePaintPrompt(session, port);
  if (prompt.node_key !== body.node_key) {
    throw staleStateProblem();
  }
  return port.gradeRange(prompt.solution_id, prompt.node_key, paintedHands(prompt, body.paint));
}

/**
 * Grades the painted range and advances the session; unrated (O-300). The upstream reads run
 * first, outside the transaction, then the row is locked and its version re-checked, so no row
 * lock is held across a solver-query call and a submit that won in between makes this one 409
 * stale-state (PR #29 review M5, the pattern of grading/decide.ts).
 */
export async function submitPaint(call: PaintCall, body: RangePaintBody): Promise<RangePaintResult> {
  const session = await readForPaint(call, body);
  const grade = await gradeOutsideLock(call, session, body);
  return idempotentWrite(call.app, call.request, HTTP_STATUS.ok, async (transaction) => {
    const locked = requirePaintable(await lockSession(transaction, call.userId, session.id));
    if (locked.stateVersion !== session.stateVersion) {
      throw staleStateProblem();
    }
    const written = await writeState(transaction, {
      userId: call.userId,
      sessionId: session.id,
      expectedVersion: session.stateVersion,
      state: advanced(locked.state),
    });
    if (written === undefined) {
      throw staleStateProblem();
    }
    return toResult(session.id, written.stateVersion, grade);
  });
}
