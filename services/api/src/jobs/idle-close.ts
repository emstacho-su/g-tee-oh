/**
 * The idle session closer (R4.11, O-275, PM condition: idempotent): every IDLE_CLOSE_PERIOD_MS, the
 * automated and holdout sessions with no decision for IDLE_SESSION_CLOSE_MS are ended through the
 * same end path as POST /sessions/{id}/end (sessions/service.ts endLockedSession), so the rating
 * period, the partial block close, the tier and the unlocks are written exactly as a user's end
 * writes them.
 *
 * Mechanism: the period key is the quarter-hour's start (an RFC 3339 instant), due at that instant.
 * A session is idle when it started before the cutoff (now minus IDLE_SESSION_CLOSE_MS) and has no
 * attempt since; at most IDLE_CLOSE_BATCH candidates, oldest first, are locked with FOR UPDATE SKIP
 * LOCKED, so a session a decision holds right now is left for the next run (PR #27 review MEDIUM
 * 11). The end hooks need solver-query for the tier (O-271): without a client the job throws when
 * it has sessions to end, so nothing is ended without its tier and the run is retried. Each end
 * runs in its own savepoint inside the job's transaction: a session whose end fails for its own
 * reasons is rolled back to its savepoint, logged with its id and skipped (still idle, so the next
 * run tries it again), and never blocks the others; a solver-query failure (unavailable or
 * upstream) is rethrown, so the whole run rolls back and retries with its backoff. An ended session
 * is never a candidate again, so a second run ends nothing.
 *
 * - Prepare (PR #27 review HIGH 3): before each end, learning/prepare.ts prepareLearning runs on the
 *   handle outside the job's transaction (a catalog failure there is null, and cannot abort the
 *   job's transaction), and its result is the end's prepared context, as POST end passes it.
 * - Order (PR #27 review HIGH 5): a user's sessions end in start order, each at an instant
 *   IDLE_END_STEP_MS after the user's previous one in the run, so their rating_history rows never
 *   tie on recorded_at and each end's before-values and tier read the right rows.
 * - Batch (PR #27 review MEDIUM 11): a run that filled its batch and ended at least one session
 *   schedules a follow-up job of its own kind due now (period key: this period, then the parent
 *   job's id, so a retried run schedules the same row once), which the worker claims in the same
 *   tick. A batch made only of sessions whose end fails schedules nothing: the next period retries.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";
import { PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { prepareLearning } from "../learning/prepare.js";
import { findSession } from "../sessions/repository.js";
import { endLockedSession } from "../sessions/service.js";
import type { SolverQuery } from "../solver-query/client.js";
import type { JobContext, JobDefinition } from "./registry.js";
import type { JobPeriod } from "./schedule.js";

/** O-275: a session with no decision for this long is closed. */
export const IDLE_SESSION_CLOSE_MS = 60 * 60 * 1000;
/** O-275: the closer runs every quarter-hour. */
export const IDLE_CLOSE_PERIOD_MS = 15 * 60 * 1000;
/** PR #27 review MEDIUM 11: one run ends at most this many sessions; a follow-up run takes the rest. */
export const IDLE_CLOSE_BATCH = 100;
/** PR #27 review HIGH 5: consecutive ends of one user in a run are this far apart. */
export const IDLE_END_STEP_MS = 1;
/** The modes the closer ends (O-275); drills stay open until their player ends them. */
export const IDLE_CLOSED_MODES = ["automated", "holdout"] as const;
/** registry.ts JOB_KINDS.idleSessionClose; spelled here because registry.ts imports this module (a test pins the two). */
export const IDLE_CLOSE_KIND = "idle_session_close";
/** The savepoint each session's end runs in, released or rolled back before the next. */
const IDLE_CLOSE_SAVEPOINT = "idle_close_session";
/** Separates a follow-up job's period key from its parent's. */
const FOLLOW_UP_KEY_SEPARATOR = "/after/";

/** The quarter-hour that contains `now`. */
export function idleClosePeriod(now: Date): JobPeriod {
  const start = new Date(Math.floor(now.getTime() / IDLE_CLOSE_PERIOD_MS) * IDLE_CLOSE_PERIOD_MS);
  return { periodKey: start.toISOString(), runAt: start };
}

export interface IdleSession {
  id: string;
  userId: string;
}

/** The idle session to end and the instant its end is written at (HIGH 5). */
export interface PlannedEnd extends IdleSession {
  endAt: Date;
}

export interface IdleCloseOptions {
  /** At most this many sessions per run (default IDLE_CLOSE_BATCH). */
  batchSize?: number;
}

/** The oldest idle sessions at `now`, at most `limit`, locked for this transaction (see the module doc). */
export async function lockIdleSessions(transaction: Database, now: Date, limit: number = IDLE_CLOSE_BATCH): Promise<IdleSession[]> {
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
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => ({ id: row.id, userId: row.user_id }));
}

/** Each session's end instant: a user's sessions, in the given (start) order, IDLE_END_STEP_MS apart. */
export function planEnds(idle: readonly IdleSession[], now: Date): PlannedEnd[] {
  const endsPerUser = new Map<string, number>();
  return idle.map((session) => {
    const index = endsPerUser.get(session.userId) ?? 0;
    endsPerUser.set(session.userId, index + 1);
    return { ...session, endAt: new Date(now.getTime() + index * IDLE_END_STEP_MS) };
  });
}

/** Ends the run's batch of idle sessions in the job's transaction; returns the ended ids. */
export async function closeIdleSessions(context: JobContext, options: IdleCloseOptions = {}): Promise<string[]> {
  const batchSize = options.batchSize ?? IDLE_CLOSE_BATCH;
  const idle = await lockIdleSessions(context.transaction, context.now, batchSize);
  if (idle.length === 0) {
    return [];
  }
  const { solverQuery } = context.services;
  if (solverQuery === null) {
    throw new Error("idle_session_close needs solver-query for the session-end tier (O-271); retried on the next run");
  }
  const ended: string[] = [];
  for (const planned of planEnds(idle, context.now)) {
    if (await endInSavepoint(context, planned, solverQuery)) {
      ended.push(planned.id);
    }
  }
  if (idle.length === batchSize && ended.length > 0) {
    await scheduleFollowUp(context);
  }
  context.services.log.info({ ended: ended.length, skipped: idle.length - ended.length, job_id: context.job.id }, "idle sessions closed");
  return ended;
}

/** The follow-up run of a full batch (see the module doc), inserted once per parent job. */
async function scheduleFollowUp(context: JobContext): Promise<void> {
  const base = context.job.periodKey.split(FOLLOW_UP_KEY_SEPARATOR)[0] ?? context.job.periodKey;
  await context.transaction
    .insertInto("app_job")
    .values({ kind: context.job.kind, period_key: `${base}${FOLLOW_UP_KEY_SEPARATOR}${context.job.id}`, run_at: context.now })
    .onConflict((conflict) => conflict.columns(["kind", "period_key"]).doNothing())
    .execute();
}

/** solver-query's failures (unavailable, deadline, upstream): the whole run must retry (O-271 tier rule). */
function isSolverQueryFailure(error: unknown): boolean {
  return error instanceof ProblemError && (error.slug === PROBLEM_SLUGS.unavailable || error.slug === PROBLEM_SLUGS.upstream);
}

/** The handle outside the job's transaction the prepare phase reads through (registry.ts JobContext). */
function outsideHandle(context: JobContext): Database {
  if (context.database === undefined) {
    throw new Error("idle_session_close needs the database handle outside its transaction (JobContext.database)");
  }
  return context.database;
}

/**
 * Ends one session inside its own savepoint: a session whose end fails for its own reasons (a state
 * that no longer parses, for example) is rolled back to the savepoint, logged with its id and
 * skipped, so it never blocks the others; a solver-query failure is rethrown so the run retries.
 */
async function endInSavepoint(context: JobContext, planned: PlannedEnd, solverQuery: SolverQuery): Promise<boolean> {
  const { transaction } = context;
  const hooks = context.services.learningHooks;
  await sql`savepoint ${sql.id(IDLE_CLOSE_SAVEPOINT)}`.execute(transaction);
  try {
    const session = await findSession(transaction, planned.userId, planned.id);
    if (session === undefined) {
      throw new Error(`idle session ${planned.id} vanished while locked`);
    }
    // PR #27 review HIGH 3: the end path's prepare phase, once per session, before its end.
    const prepared = await prepareLearning(hooks, {
      database: outsideHandle(context),
      solverQuery,
      userId: planned.userId,
      session,
      now: planned.endAt,
      log: context.services.log,
    });
    await endLockedSession(transaction, {
      hooks,
      userId: planned.userId,
      sessionId: planned.id,
      now: planned.endAt,
      timeZone: context.timeZone,
      solverQuery,
      prepared,
    });
    await sql`release savepoint ${sql.id(IDLE_CLOSE_SAVEPOINT)}`.execute(transaction);
    return true;
  } catch (error: unknown) {
    if (isSolverQueryFailure(error)) {
      throw error;
    }
    await sql`rollback to savepoint ${sql.id(IDLE_CLOSE_SAVEPOINT)}`.execute(transaction);
    context.services.log.error({ err: error, session_id: planned.id, job_id: context.job.id }, "idle session end failed; skipped");
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
