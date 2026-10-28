/**
 * Training sessions (R3.6, R4.10, R4.13, A5 section 3, A6 section 2, O-249, ADR 0018): POST /sessions,
 * GET /sessions/{id}/next and POST /sessions/{id}/end. The route file stays thin and calls these.
 *
 * - create: dispatches by mode (the S31 mode split): drill, and S27's drill-backed prediction and
 *   range_paint modes (O-302, which start with a practice state instead of a hand), to
 *   sessions/modes/drill.ts (S23's code), or, when the body names a catalog_spot instead of a
 *   drill (S41, O-415), to modes/catalog-spot.ts, after practice-rules.ts has checked the S41
 *   fields fit the mode; automated to modes/automated.ts; holdout to
 *   modes/holdout.ts (which ends the user's open holdout session through endLockedSession first,
 *   PR #27 review HIGH 1).
 * - next: pure (the S23 binding rule). It serves the graded modes only (drill, automated, holdout;
 *   a prediction or range_paint session is 409 wrong-session-mode, S27 O-302). It derives the
 *   prompt from the persisted state with the session's holdout guard (derive-settings.ts, read
 *   only) and writes nothing; two calls in a row answer the same prompt. An ended session is 409
 *   session-ended. One exception (PR #27 review HIGH 3): an automated session whose closed block
 *   waits for its next pick gets that pick first, in one write (automated/resume-block.ts); the
 *   prompts after it are again write-free.
 * - end: ended_at, phase ended, and the recap aggregated from the session's attempts, plus the
 *   learning hooks' extras (onSessionEnd, inside the same transaction: rating, tier, unlocks). A
 *   second end returns the same recap without writing (repeat-safe; the hooks run with firstEnd
 *   false and write nothing). endLockedSession is the end path inside a caller's transaction, so
 *   the idle-session job ends a session exactly as POST end does (O-275). The hooks' prepare phase
 *   (learning/prepare.ts) runs before the end transaction opens, so no end hook loads the class
 *   catalog under the lock (PR #27 review HIGH 3); the idle job prepares each session the same way.
 */
import type { z } from "zod";

import { sessionNotFound } from "../grading/decide.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { resumePendingBlock } from "../automated/resume-block.js";
import { EMPTY_PREPARED_LEARNING, type LearningHooks, type PreparedLearning } from "../learning/effects.js";
import { prepareLearning } from "../learning/prepare.js";
import type { Database } from "../db.js";
import type { recapSchema } from "../schemas/training.js";
import { requireSolverQuery, type SolverQuery } from "../solver-query/client.js";
import { deriveAwaitHero } from "./derive.js";
import { deriveSettingsFor } from "./derive-settings.js";
import { transition } from "./machine.js";
import { createAutomatedSession } from "./modes/automated.js";
import { createCatalogSpotSession } from "./modes/catalog-spot.js";
import { createDrillSession } from "./modes/drill.js";
import { checkPracticeStartRules } from "./modes/practice-rules.js";
import { createHoldoutSession, type ReplaceOpenSession } from "./modes/holdout.js";
import { requireGradedSessionMode, sessionEndedProblem } from "./problems.js";
import { toPrompt, type Prompt } from "./prompt.js";
import { findSession, lockSession, recapStats, writeState, type SessionRow } from "./repository.js";
import type { SessionCall, SessionCreateBody } from "./session-call.js";
import type { Session } from "./session-view.js";
import { solverPort } from "./solver-port.js";

export type { SessionCall, SessionCreateBody } from "./session-call.js";
export type { Session } from "./session-view.js";
export type Recap = z.infer<typeof recapSchema>;

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
  /** The app's solver-query client, for the end hooks' class catalog (O-271); null without one. */
  solverQuery: SolverQuery | null;
  /** What prepareLearning read for this session before the transaction opened. */
  prepared: PreparedLearning;
}

/** The clock and APP_TIME_ZONE a create reads (S31: the holdout round's month, O-276, O-247). */
export interface CreateClock {
  now: Date;
  timeZone: string;
}

export async function createSession(call: SessionCall, body: SessionCreateBody, clock: CreateClock): Promise<Session> {
  checkPracticeStartRules(body);
  switch (body.mode) {
    case "drill":
      return createDrillSession(call, body, body.mode);
    case "prediction":
    case "range_paint": {
      const { catalog_spot: catalogSpot } = body;
      return catalogSpot === undefined
        ? createDrillSession(call, body, body.mode)
        : createCatalogSpotSession(call, { ...body, catalog_spot: catalogSpot }, body.mode);
    }
    case "automated":
      return createAutomatedSession(call, body, clock.now);
    case "holdout":
      return createHoldoutSession(call, body, clock, replaceOpenHoldout(call, clock));
  }
}

/**
 * PR #27 review HIGH 1: a holdout create ends the user's open holdout session through the shared end
 * path, so its served item is skipped exactly as a POST end skips it. Nothing is prepared: a holdout
 * session's end hooks read no prepared context (only the holdout part acts on it, writing the skip).
 */
function replaceOpenHoldout(call: SessionCall, clock: CreateClock): ReplaceOpenSession {
  return async (transaction, sessionId) => {
    await endLockedSession(transaction, {
      hooks: call.app.learningHooks,
      userId: call.userId,
      sessionId,
      now: clock.now,
      timeZone: clock.timeZone,
      solverQuery: call.app.solverQuery,
      prepared: EMPTY_PREPARED_LEARNING,
    });
  };
}

async function requireSession(call: SessionCall, sessionId: string): Promise<SessionRow> {
  const session = await findSession(requireDatabase(call.app), call.userId, sessionId);
  if (session === undefined) {
    throw sessionNotFound();
  }
  return session;
}

/** The next prompt, derived and never written (GET is pure). */
export async function nextPrompt(call: SessionCall, sessionId: string, now: Date = new Date()): Promise<Prompt> {
  const stored = await requireSession(call, sessionId);
  if (stored.state.phase === "ended") {
    throw sessionEndedProblem();
  }
  requireGradedSessionMode(stored);
  const session = await resumePendingBlock(call, stored, now);
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
  const hookContext = {
    transaction,
    now: end.now,
    timeZone: end.timeZone,
    userId: end.userId,
    session: locked,
    solverQuery: end.solverQuery,
    prepared: end.prepared,
  };
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
  const session = await requireSession(call, sessionId);
  const prepared = await prepareLearning(call.app.learningHooks, {
    database: requireDatabase(call.app),
    solverQuery: call.app.solverQuery,
    userId: call.userId,
    session,
    now: call.now,
    log: call.request.log,
    purpose: "end",
  });
  const end: SessionEnd = {
    hooks: call.app.learningHooks,
    userId: call.userId,
    sessionId,
    now: call.now,
    timeZone: call.timeZone,
    solverQuery: call.app.solverQuery,
    prepared,
  };
  return idempotentWrite(call.app, call.request, HTTP_STATUS.ok, (transaction) => endLockedSession(transaction, end));
}
