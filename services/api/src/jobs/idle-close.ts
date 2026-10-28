/**
 * The idle session closer (R4.11, O-275, PM condition: idempotent): every IDLE_CLOSE_PERIOD_MS, the
 * automated and holdout sessions with no decision for IDLE_SESSION_CLOSE_MS are ended through the
 * same end path as POST /sessions/{id}/end (sessions/service.ts endLockedSession), so the rating
 * period, the partial block close, the tier and the unlocks are written exactly as a user's end
 * writes them.
 *
 * Mechanism: the period key is the quarter-hour's start (an RFC 3339 instant), due at that instant.
 * A session is idle when it started before the cutoff (now minus IDLE_SESSION_CLOSE_MS) and has no
 * attempt since; at most IDLE_CLOSE_BATCH candidates are locked with FOR UPDATE SKIP LOCKED, so a
 * session a decision holds right now is left for the next run (PR #27 review MEDIUM 11). They are
 * taken oldest first, except that sessions whose end has failed before come after every other one,
 * least recently failed first (follow-up LOW 3). The end hooks need solver-query for the tier (O-271): without a client the job throws when
 * it has sessions to end, so nothing is ended without its tier and the run is retried. Each end
 * runs in its own savepoint inside the job's transaction: a session whose end fails for its own
 * reasons is rolled back to its savepoint, logged with its id, recorded on the session
 * (idle_close_failures, idle_close_failed_at: PR #27 review follow-up LOW 3) and skipped. It stays
 * idle, so a later run tries it again, but behind every session that has not failed, so a full batch
 * of failing sessions never keeps the others open. A solver-query failure (unavailable or
 * upstream) is rethrown, so the whole run rolls back and retries with its backoff. An ended session
 * is never a candidate again, so a second run ends nothing.
 *
 * - Prepare (PR #27 review HIGH 3): before each end, learning/prepare.ts prepareLearning runs on the
 *   handle outside the job's transaction (a catalog failure there is null, and cannot abort the
 *   job's transaction), and its result is the end's prepared context, as POST end passes it.
 * - Order (PR #27 review HIGH 5 and follow-up MEDIUM 1): a user's sessions end in the batch's order,
 *   each IDLE_END_STEP_MS after the user's previous end. The first starts at `now` or, when later,
 *   IDLE_END_STEP_MS after the user's latest recorded instant (rating_history.recorded_at,
 *   rating.updated_at, practice_session.ended_at). A follow-up run claimed in the same worker tick
 *   shares that tick's `now`, so without the floor it would restart at `now`. With it, a user's
 *   rating_history rows strictly increase on recorded_at across batches and runs, and each end's
 *   before-values and tier read the right rows.
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
    // Follow-up LOW 3: sessions whose end failed before go last, least recently failed first.
    .orderBy(sql`idle_close_failed_at asc nulls first`)
    .orderBy("started_at")
    .orderBy("id")
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => ({ id: row.id, userId: row.user_id }));
}

/**
 * Each user's latest recorded instant: the newest of their rating_history.recorded_at,
 * rating.updated_at and practice_session.ended_at (follow-up MEDIUM 1). A user with none is absent.
 */
export async function userEndFloors(transaction: Database, userIds: readonly string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const result = await sql<{ user_id: string; floor: Date | null }>`
    select users.user_id, greatest(
      (select max(recorded_at) from rating_history where rating_history.user_id = users.user_id),
      (select max(updated_at) from rating where rating.user_id = users.user_id),
      (select max(ended_at) from practice_session where practice_session.user_id = users.user_id)
    ) as floor
    from unnest(${[...new Set(userIds)]}::uuid[]) as users (user_id)`.execute(transaction);
  return new Map(result.rows.flatMap((row) => (row.floor === null ? [] : [[row.user_id, new Date(row.floor)] as const])));
}

/**
 * Each session's end instant (see the module doc, Order): a user's sessions in the given order,
 * IDLE_END_STEP_MS apart, the first at `now` or IDLE_END_STEP_MS after the user's floor, whichever
 * is later. Pure.
 */
export function planEnds(idle: readonly IdleSession[], now: Date, floors: ReadonlyMap<string, Date> = new Map()): PlannedEnd[] {
  const lastEnd = new Map<string, number>();
  return idle.map((session) => {
    const previous = lastEnd.get(session.userId) ?? floors.get(session.userId)?.getTime();
    const endMs = previous === undefined ? now.getTime() : Math.max(now.getTime(), previous + IDLE_END_STEP_MS);
    lastEnd.set(session.userId, endMs);
    return { ...session, endAt: new Date(endMs) };
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
  const floors = await userEndFloors(context.transaction, idle.map((session) => session.userId));
  for (const planned of planEnds(idle, context.now, floors)) {
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

/** Follow-up LOW 3: one more failed end on the session, so later runs queue it after the others. */
async function recordFailedEnd(context: JobContext, sessionId: string): Promise<void> {
  await context.transaction
    .updateTable("practice_session")
    .set((eb) => ({ idle_close_failures: eb("idle_close_failures", "+", 1), idle_close_failed_at: context.now }))
    .where("id", "=", sessionId)
    .execute();
}

/**
 * Ends one session inside its own savepoint: a session whose end fails for its own reasons (a state
 * that no longer parses, for example) is rolled back to the savepoint, logged with its id, recorded
 * (recordFailedEnd) and skipped, so it never blocks the others; a solver-query failure is rethrown so
 * the run retries.
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
      purpose: "end",
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
    await recordFailedEnd(context, planned.id);
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
