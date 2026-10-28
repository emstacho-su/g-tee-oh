/**
 * app_job rows (R4.11, O-275, ADR 0005): the api's job queue, one row per kind and period.
 *
 * Mechanism:
 * - claimJob takes the earliest claimable job of the given kinds in one statement: `update ... where
 *   id = (select id ... order by run_at limit 1 for update skip locked) returning *`. A job is
 *   claimable when it is queued and due (run_at at or before now), or running with a lease that ran
 *   out (locked_at before now minus JOB_LEASE_MS), which is how a job whose process died mid-run is
 *   taken again. SKIP LOCKED makes concurrent claims take different rows, so two workers never run
 *   one job. The claim commits on its own, before the handler runs, so the lease survives a crash.
 * - completeJob marks the job done only while this worker still holds it; a lease another worker
 *   took over completes nothing and throws JobLeaseLostError, which rolls back the handler's writes.
 * - failJob queues the job again JOB_RETRY_BACKOFF_MS times its attempts later, or marks it failed
 *   once it has made JOB_MAX_ATTEMPTS attempts. A running job whose lease ran out after its last
 *   attempt is never claimed again; failExhaustedJobs marks it failed.
 * - pruneDoneJobs deletes the done rows of the given kinds last updated more than
 *   APP_JOB_RETENTION_MS ago (PR #27 review MEDIUM 9), so the queue does not grow by a row per
 *   period forever. The age is longer than the longest period (holdout_round_monthly), so a pruned
 *   row is never the current period ensureScheduled would insert again. Failed rows are kept for
 *   an operator to read.
 * Every instant is passed in (now), never read from the database clock, so tests fix the clock.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";

/** A claimed job not completed within this long may be claimed again (O-275, plan decision 10). */
export const JOB_LEASE_MS = 10 * 60 * 1000;
/** A failed attempt waits this long times its attempt count before the next (O-275). */
export const JOB_RETRY_BACKOFF_MS = 5 * 60 * 1000;
/** Attempts before a job is marked failed (O-275). */
export const JOB_MAX_ATTEMPTS = 5;
/** PR #27 review MEDIUM 9: done jobs are kept this long (90 days, longer than any job period). */
export const APP_JOB_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** last_error keeps at most this many characters of the error message. */
export const MAX_JOB_ERROR_LENGTH = 1000;

export const JOB_STATUS = { queued: "queued", running: "running", done: "done", failed: "failed" } as const;

export interface ClaimedJob {
  id: string;
  kind: string;
  periodKey: string;
  runAt: Date;
  attempts: number;
  lockedBy: string;
  lockedAt: Date;
}

export interface ClaimRequest {
  now: Date;
  workerId: string;
  /** Only these kinds are claimed: a worker never takes a job it has no handler for. */
  kinds: readonly string[];
}

/** A completion found the job no longer held by this worker (its lease was taken over). */
export class JobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`job ${jobId} is no longer held by this worker`);
    this.name = "JobLeaseLostError";
  }
}

interface RawJob {
  id: string;
  kind: string;
  period_key: string;
  run_at: Date;
  attempts: number;
  locked_by: string;
  locked_at: Date;
}

/** Claims the earliest claimable job of `kinds`, or undefined when none is (see the module doc). */
export async function claimJob(database: Database, claim: ClaimRequest): Promise<ClaimedJob | undefined> {
  if (claim.kinds.length === 0) {
    return undefined;
  }
  const leaseCutoff = new Date(claim.now.getTime() - JOB_LEASE_MS);
  const result = await sql<RawJob>`
    update app_job
    set status = ${JOB_STATUS.running}, locked_by = ${claim.workerId}, locked_at = ${claim.now},
        attempts = attempts + 1, updated_at = ${claim.now}
    where id = (
      select id from app_job
      where kind = any(${[...claim.kinds]}::text[])
        and attempts < ${JOB_MAX_ATTEMPTS}
        and ((status = ${JOB_STATUS.queued} and run_at <= ${claim.now})
          or (status = ${JOB_STATUS.running} and locked_at < ${leaseCutoff}))
      order by run_at
      limit 1
      for update skip locked
    )
    returning id, kind, period_key, run_at, attempts, locked_by, locked_at`.execute(database);
  const row = result.rows[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    kind: row.kind,
    periodKey: row.period_key,
    runAt: row.run_at,
    attempts: Number(row.attempts),
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
  };
}

/** Marks a held job done; throws JobLeaseLostError when this worker no longer holds it. */
export async function completeJob(transaction: Database, job: ClaimedJob, now: Date): Promise<void> {
  const result = await transaction
    .updateTable("app_job")
    .set({ status: JOB_STATUS.done, updated_at: now, last_error: null })
    .where("id", "=", job.id)
    .where("status", "=", JOB_STATUS.running)
    .where("locked_by", "=", job.lockedBy)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    throw new JobLeaseLostError(job.id);
  }
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_JOB_ERROR_LENGTH);
}

/** Queues a held job again after its backoff, or marks it failed after its last attempt. */
export async function failJob(database: Database, job: ClaimedJob, error: unknown, now: Date): Promise<void> {
  const exhausted = job.attempts >= JOB_MAX_ATTEMPTS;
  await database
    .updateTable("app_job")
    .set({
      status: exhausted ? JOB_STATUS.failed : JOB_STATUS.queued,
      run_at: new Date(now.getTime() + JOB_RETRY_BACKOFF_MS * job.attempts),
      locked_by: null,
      locked_at: null,
      last_error: errorText(error),
      updated_at: now,
    })
    .where("id", "=", job.id)
    .where("status", "=", JOB_STATUS.running)
    .where("locked_by", "=", job.lockedBy)
    .execute();
}

/** Marks failed every running job of `kinds` whose lease ran out after its last attempt. */
export async function failExhaustedJobs(database: Database, kinds: readonly string[], now: Date): Promise<number> {
  if (kinds.length === 0) {
    return 0;
  }
  const result = await database
    .updateTable("app_job")
    .set({ status: JOB_STATUS.failed, last_error: "the lease ran out after the last attempt", updated_at: now })
    .where("kind", "in", [...kinds])
    .where("status", "=", JOB_STATUS.running)
    .where("attempts", ">=", JOB_MAX_ATTEMPTS)
    .where("locked_at", "<", new Date(now.getTime() - JOB_LEASE_MS))
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Deletes the done jobs of `kinds` last updated before now minus APP_JOB_RETENTION_MS (see the module doc). */
export async function pruneDoneJobs(database: Database, kinds: readonly string[], now: Date): Promise<number> {
  if (kinds.length === 0) {
    return 0;
  }
  const result = await database
    .deleteFrom("app_job")
    .where("kind", "in", [...kinds])
    .where("status", "=", JOB_STATUS.done)
    .where("updated_at", "<", new Date(now.getTime() - APP_JOB_RETENTION_MS))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
