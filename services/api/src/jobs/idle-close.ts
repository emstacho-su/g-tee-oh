/**
 * The idle session closer (R4.11, O-275, PM condition: idempotent): every IDLE_CLOSE_PERIOD_MS, the
 * automated and holdout sessions with no decision for IDLE_SESSION_CLOSE_MS are ended through the
 * same end path as POST /sessions/{id}/end (sessions/service.ts endLockedSession), so the rating
 * period, the partial block close, the tier and the unlocks are written exactly as a user's end
 * writes them.
 *
 * Mechanism: the period key is the quarter-hour's start (an RFC 3339 instant), due at that instant.
 * A session is idle when it started before the cutoff (now minus IDLE_SESSION_CLOSE_MS) and has no
 * attempt since; the candidates are locked with FOR UPDATE SKIP LOCKED, so a session a decision
 * holds right now is left for the next run. The end hooks need solver-query for the tier (O-271):
 * without a client the job throws when it has sessions to end, so nothing is ended without its tier
 * and the run is retried. Each end runs in its own savepoint inside the job's transaction: a session
 * whose end fails for its own reasons is rolled back to its savepoint, logged with its id and
 * skipped (still idle, so the next run tries it again), and never blocks the others; a solver-query
 * failure (unavailable or upstream) is rethrown, so the whole run rolls back and retries with its
 * backoff. An ended session is never a candidate again, so a second run ends nothing.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";
import { PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { endLockedSession } from "../sessions/service.js";
import type { SolverQuery } from "../solver-query/client.js";
import type { JobContext, JobDefinition } from "./registry.js";
import type { JobPeriod } from "./schedule.js";

/** O-275: a session with no decision for this long is closed. */
export const IDLE_SESSION_CLOSE_MS = 60 * 60 * 1000;
/** O-275: the closer runs every quarter-hour. */
export const IDLE_CLOSE_PERIOD_MS = 15 * 60 * 1000;
/** The modes the closer ends (O-275); drills stay open until their player ends them. */
export const IDLE_CLOSED_MODES = ["automated", "holdout"] as const;
/** registry.ts JOB_KINDS.idleSessionClose; spelled here because registry.ts imports this module (a test pins the two). */
export const IDLE_CLOSE_KIND = "idle_session_close";
/** The savepoint each session's end runs in, released or rolled back before the next. */
const IDLE_CLOSE_SAVEPOINT = "idle_close_session";

/** The quarter-hour that contains `now`. */
export function idleClosePeriod(now: Date): JobPeriod {
  const start = new Date(Math.floor(now.getTime() / IDLE_CLOSE_PERIOD_MS) * IDLE_CLOSE_PERIOD_MS);
  return { periodKey: start.toISOString(), runAt: start };
}

export interface IdleSession {
  id: string;
  userId: string;
}

/** The idle sessions at `now`, locked for this transaction (see the module doc). */
export async function lockIdleSessions(transaction: Database, now: Date): Promise<IdleSession[]> {
  const cutoff = new Date(now.getTime() - IDLE_SESSION_CLOSE_MS);
  const rows = await transaction
    .selectFrom("practice_session")
    .select(["id", "user_id"])
    .where("ended_at", "is", null)
    .where("mode", "in", [...IDLE_CLOSED_MODES])
    .where("started_at", "<", cutoff)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("attempt")
            .select(sql<number>`1`.as("one"))
            .whereRef("attempt.session_id", "=", "practice_session.id")
            .where("attempt.created_at", ">=", cutoff),
        ),
      ),
    )
    .orderBy("started_at")
    .orderBy("id")
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => ({ id: row.id, userId: row.user_id }));
}

/** Ends every idle session in the job's transaction; returns the ended ids. */
export async function closeIdleSessions(context: JobContext): Promise<string[]> {
  const idle = await lockIdleSessions(context.transaction, context.now);
  if (idle.length === 0) {
    return [];
  }
  const { solverQuery } = context.services;
  if (solverQuery === null) {
    throw new Error("idle_session_close needs solver-query for the session-end tier (O-271); retried on the next run");
  }
  const ended: string[] = [];
  for (const session of idle) {
    if (await endInSavepoint(context, session, solverQuery)) {
      ended.push(session.id);
    }
  }
  context.services.log.info({ ended: ended.length, skipped: idle.length - ended.length, job_id: context.job.id }, "idle sessions closed");
  return ended;
}

/** solver-query's failures (unavailable, deadline, upstream): the whole run must retry (O-271 tier rule). */
function isSolverQueryFailure(error: unknown): boolean {
  return error instanceof ProblemError && (error.slug === PROBLEM_SLUGS.unavailable || error.slug === PROBLEM_SLUGS.upstream);
}

/**
 * Ends one session inside its own savepoint: a session whose end fails for its own reasons (a state
 * that no longer parses, for example) is rolled back to the savepoint, logged with its id and
 * skipped, so it never blocks the others; a solver-query failure is rethrown so the run retries.
 */
async function endInSavepoint(context: JobContext, session: IdleSession, solverQuery: SolverQuery): Promise<boolean> {
  const { transaction } = context;
  await sql`savepoint ${sql.id(IDLE_CLOSE_SAVEPOINT)}`.execute(transaction);
  try {
    await endLockedSession(transaction, {
      hooks: context.services.learningHooks,
      userId: session.userId,
      sessionId: session.id,
      now: context.now,
      timeZone: context.timeZone,
      solverQuery,
    });
    await sql`release savepoint ${sql.id(IDLE_CLOSE_SAVEPOINT)}`.execute(transaction);
    return true;
  } catch (error: unknown) {
    if (isSolverQueryFailure(error)) {
      throw error;
    }
    await sql`rollback to savepoint ${sql.id(IDLE_CLOSE_SAVEPOINT)}`.execute(transaction);
    context.services.log.error({ err: error, session_id: session.id, job_id: context.job.id }, "idle session end failed; skipped");
    return false;
  }
}

export const IDLE_CLOSE_JOB: JobDefinition = {
  kind: IDLE_CLOSE_KIND,
  nextPeriod: (now) => idleClosePeriod(now),
  handler: async (context) => {
    await closeIdleSessions(context);
  },
};
