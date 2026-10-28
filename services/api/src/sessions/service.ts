/**
 * Training sessions (R3.6, R4.10, R4.13, A5 section 3, A6 section 2, O-249, ADR 0018): POST /sessions,
 * GET /sessions/{id}/next and POST /sessions/{id}/end. The route file stays thin and calls these.
 *
 * - create: dispatches by mode (the S31 mode split): drill to sessions/modes/drill.ts (S23's code),
 *   automated to modes/automated.ts, holdout to modes/holdout.ts; prediction and range_paint answer
 *   501 naming S27 (O-249).
 * - next: pure (the S23 binding rule). It derives the prompt from the persisted state with the
 *   session's holdout guard (derive-settings.ts, read only) and writes nothing; two calls in a row
 *   answer the same prompt. An ended session is 409 session-ended.
 * - end: ended_at, phase ended, and the recap aggregated from the session's attempts, plus the
 *   learning hooks' extras (onSessionEnd, inside the same transaction: rating, tier, unlocks). A
 *   second end returns the same recap without writing (repeat-safe; the hooks run with firstEnd
 *   false and write nothing). endLockedSession is the end path inside a caller's transaction, so
 *   the idle-session job ends a session exactly as POST end does (O-275).
 */
import type { z } from "zod";

import { sessionNotFound } from "../grading/decide.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { LearningHooks } from "../learning/effects.js";
import type { Database } from "../db.js";
import type { recapSchema } from "../schemas/training.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { deriveAwaitHero } from "./derive.js";
import { deriveSettingsFor } from "./derive-settings.js";
import { transition } from "./machine.js";
import { createAutomatedSession } from "./modes/automated.js";
import { createDrillSession } from "./modes/drill.js";
import { createHoldoutSession } from "./modes/holdout.js";
import { sessionEndedProblem } from "./problems.js";
import { toPrompt, type Prompt } from "./prompt.js";
import { findSession, lockSession, recapStats, writeState, type SessionRow } from "./repository.js";
import type { SessionCall, SessionCreateBody } from "./session-call.js";
import type { Session } from "./session-view.js";
import { solverPort } from "./solver-port.js";

export type { SessionCall, SessionCreateBody } from "./session-call.js";
export type { Session } from "./session-view.js";
export type Recap = z.infer<typeof recapSchema>;

const S27 = "S27";

/** POST /sessions/{id}/end, with the clock and the day's time zone the end hooks use. */
export interface EndCall extends SessionCall {
  now: Date;
  timeZone: string;
}

/** One end inside a caller's transaction (POST end, the idle-session job). */
export interface SessionEnd {
  hooks: LearningHooks;
  userId: string;
  sessionId: string;
  now: Date;
  timeZone: string;
}

export async function createSession(call: SessionCall, body: SessionCreateBody): Promise<Session> {
  switch (body.mode) {
    case "drill":
      return createDrillSession(call, body);
    case "automated":
      return createAutomatedSession(call, body);
    case "holdout":
      return createHoldoutSession(call, body);
    default:
      throw new ProblemError(HTTP_STATUS.notImplemented, PROBLEM_SLUGS.notImplemented, {
        detail: `${body.mode} sessions are built by ${S27}; S23 serves drill sessions (O-249).`,
      });
  }
}

async function requireSession(call: SessionCall, sessionId: string): Promise<SessionRow> {
  const session = await findSession(requireDatabase(call.app), call.userId, sessionId);
  if (session === undefined) {
    throw sessionNotFound();
  }
  return session;
}

/** The next prompt, derived and never written (GET is pure). */
export async function nextPrompt(call: SessionCall, sessionId: string): Promise<Prompt> {
  const session = await requireSession(call, sessionId);
  if (session.state.phase === "ended") {
    throw sessionEndedProblem();
  }
  const port = solverPort(requireSolverQuery(call.app), call.request);
  const settings = await deriveSettingsFor(call.app, call.userId, session);
  const derived = await deriveAwaitHero(session.state, settings, port);
  return toPrompt(session.id, session.stateVersion, derived, session.settings);
}

async function recapOf(database: Database, row: SessionRow): Promise<Recap> {
  const stats = await recapStats(database, row.id);
  if (row.endedAt === null) {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "The ended session has no end time." });
  }
  return {
    session_id: row.id,
    ended_at: row.endedAt.toISOString(),
    decisions: stats.decisions,
    rated_decisions: stats.ratedDecisions,
    mean_score: stats.meanScore,
    ev_loss_bb_total: stats.evLossBbTotal,
    rating_changes: [],
    tier: null,
    unlocks: [],
  };
}

/**
 * Ends the session inside `transaction` and returns its recap; an ended session returns the same
 * recap without writing. Locks the row first, so two ends never both write.
 */
export async function endLockedSession(transaction: Database, end: SessionEnd): Promise<Recap> {
  const locked = await lockSession(transaction, end.userId, end.sessionId);
  if (locked === undefined) {
    throw sessionNotFound();
  }
  const hookContext = { transaction, now: end.now, timeZone: end.timeZone, userId: end.userId, session: locked };
  if (locked.state.phase === "ended") {
    const extras = await end.hooks.onSessionEnd({ ...hookContext, ended: locked, firstEnd: false });
    return { ...(await recapOf(transaction, locked)), ...extras };
  }
  const phase = transition({ phase: locked.state.phase, stopRule: locked.settings.stop_rule }, { type: "session_ended" }).phase;
  const ended = await writeState(transaction, {
    userId: end.userId,
    sessionId: end.sessionId,
    expectedVersion: locked.stateVersion,
    state: { ...locked.state, phase },
    end: true,
  });
  if (ended === undefined) {
    throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.staleState, { detail: "The session moved on; end it again." });
  }
  const extras = await end.hooks.onSessionEnd({ ...hookContext, ended, firstEnd: true });
  return { ...(await recapOf(transaction, ended)), ...extras };
}

/** Ends the session and returns its recap; ending an ended session returns the same recap. */
export async function endSession(call: EndCall, sessionId: string): Promise<Recap> {
  const end: SessionEnd = {
    hooks: call.app.learningHooks,
    userId: call.userId,
    sessionId,
    now: call.now,
    timeZone: call.timeZone,
  };
  return idempotentWrite(call.app, call.request, HTTP_STATUS.ok, (transaction) => endLockedSession(transaction, end));
}
