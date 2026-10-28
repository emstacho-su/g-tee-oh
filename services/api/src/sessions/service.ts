/**
 * Training sessions (R3.6, A5 section 3, A6 section 2, O-249, ADR 0018): POST /sessions,
 * GET /sessions/{id}/next and POST /sessions/{id}/end. The route file stays thin and calls these.
 *
 * - create: drill mode only in S23 (O-249). The drill must be the user's (404 otherwise). Its
 *   trainer settings are merged with the body's partial settings. Its spot filter is expanded into
 *   covered (configuration, pair) candidates (candidates.ts); the uncovered rest is recorded as
 *   coverage_request rows (05 section 1, O-240), and a drill with no covered candidate is a 422
 *   no-coverage problem, whose gap rows are still recorded. The seed is the body's or 64 random
 *   bits (O-249). The deal starts at the drill's line, or at the pair's root when it names none.
 *   The session is written in dealing phase at hand 0 through idempotentWrite.
 * - next: pure (the S23 binding rule). It derives the prompt from the persisted state and writes
 *   nothing; two calls in a row answer the same prompt. An ended session is 409 session-ended.
 * - end: ended_at, phase ended, and the recap aggregated from the session's attempts. A second end
 *   returns the same recap without writing (repeat-safe).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import { findDrill } from "../drills/repository.js";
import { sessionNotFound } from "../grading/decide.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { storedSpotFilterSchema, trainerSettingsSchema, type TrainerSettings } from "../schemas/drills.js";
import type { recapSchema, sessionCreateBodySchema, sessionSchema } from "../schemas/training.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { candidatesFor, configIdsFor, pairsFor, splitByCoverage } from "./candidates.js";
import { deriveAwaitHero, sessionEndedProblem } from "./derive.js";
import { transition } from "./machine.js";
import { toPrompt, type Prompt } from "./prompt.js";
import { newSessionSeed } from "./randomness.js";
import {
  findSession,
  insertCoverageRequests,
  insertSession,
  lockSession,
  recapStats,
  writeState,
  type SessionRow,
} from "./repository.js";
import { solverPort } from "./solver-port.js";
import { initialState } from "./state.js";

export type SessionCreateBody = z.infer<typeof sessionCreateBodySchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Recap = z.infer<typeof recapSchema>;

const LATER_OWNER: Readonly<Record<Exclude<SessionCreateBody["mode"], "drill">, string>> = {
  automated: "S31",
  holdout: "S31",
  prediction: "S27",
  range_paint: "S27",
};

export interface SessionCall {
  app: FastifyInstance;
  request: FastifyRequest;
  userId: string;
}

function toSession(row: SessionRow): Session {
  return {
    session_id: row.id,
    mode: row.mode,
    drill_id: row.drillId,
    state: row.state.phase,
    state_version: row.stateVersion,
    started_at: row.startedAt.toISOString(),
  };
}

function requireDrillMode(body: SessionCreateBody): string {
  if (body.mode !== "drill") {
    throw new ProblemError(HTTP_STATUS.notImplemented, PROBLEM_SLUGS.notImplemented, {
      detail: `${body.mode} sessions are built by ${LATER_OWNER[body.mode]}; S23 serves drill sessions (O-249).`,
    });
  }
  if (body.drill_id === undefined) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail: "A drill session needs drill_id." });
  }
  return body.drill_id;
}

function mergedSettings(stored: unknown, overrides: SessionCreateBody["settings"]): TrainerSettings {
  return trainerSettingsSchema.parse({ ...trainerSettingsSchema.parse(stored), ...overrides });
}

export async function createSession(call: SessionCall, body: SessionCreateBody): Promise<Session> {
  const drillId = requireDrillMode(body);
  const database = requireDatabase(call.app);
  const drill = await findDrill(database, call.userId, drillId);
  if (drill === undefined) {
    throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No drill of yours has this id." });
  }
  const settings = mergedSettings(drill.trainer_settings, body.settings);
  const filter = storedSpotFilterSchema.parse(drill.spot_filter);
  const port = solverPort(requireSolverQuery(call.app), call.request);
  const candidates = candidatesFor(await configIdsFor(database, filter), pairsFor(filter));
  const { covered, gaps } = await splitByCoverage(candidates, port);
  const line = filter.line ?? null;
  if (covered.length === 0) {
    await insertCoverageRequests(database, call.userId, gaps, line);
    throw new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noCoverage, {
      detail: `The library covers none of this drill's ${candidates.length} spots; the gaps were queued for the builder.`,
    });
  }
  const state = initialState(body.seed ?? newSessionSeed(), covered, line);
  return idempotentWrite(call.app, call.request, HTTP_STATUS.created, async (transaction) => {
    await insertCoverageRequests(transaction, call.userId, gaps, line);
    const row = await insertSession(transaction, { userId: call.userId, mode: "drill", drillId, settings, state });
    return toSession(row);
  });
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
  const { settings } = session;
  const derived = await deriveAwaitHero(session.state, { stopRule: settings.stop_rule, rng: settings.rng }, port);
  return toPrompt(session.id, session.stateVersion, derived, settings);
}

async function recapOf(database: Parameters<typeof recapStats>[0], row: SessionRow): Promise<Recap> {
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
  };
}

/** Ends the session and returns its recap; ending an ended session returns the same recap. */
export async function endSession(call: SessionCall, sessionId: string): Promise<Recap> {
  return idempotentWrite(call.app, call.request, HTTP_STATUS.ok, async (transaction) => {
    const locked = await lockSession(transaction, call.userId, sessionId);
    if (locked === undefined) {
      throw sessionNotFound();
    }
    if (locked.state.phase === "ended") {
      return recapOf(transaction, locked);
    }
    const phase = transition({ phase: locked.state.phase, stopRule: locked.settings.stop_rule }, { type: "session_ended" }).phase;
    const ended = await writeState(transaction, {
      userId: call.userId,
      sessionId,
      expectedVersion: locked.stateVersion,
      state: { ...locked.state, phase },
      end: true,
    });
    if (ended === undefined) {
      throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.staleState, { detail: "The session moved on; end it again." });
    }
    return recapOf(transaction, ended);
  });
}
