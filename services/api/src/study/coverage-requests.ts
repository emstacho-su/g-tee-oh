/**
 * Coverage requests (R3.4, O-240, O-176, ADR 0018): what POST /coverage/requests writes when the
 * library does not cover the spot. Nothing here starts a solve, inserts a build_job or touches a
 * solution; the app role could not anyway (it may update build_job.priority and nothing else on
 * builder tables, and insert coverage_request).
 *
 * Mechanism, inside the caller's transaction:
 * - With a flop, the spot's build_job in queued or blocked_budget is locked (the highest priority
 *   one, oldest first, if the planner made several). Its priority is raised to the highest
 *   priority among the other queued jobs plus COVERAGE_PRIORITY_STEP, but only when that is above
 *   its own, so a job already at the head is left as it is and repeated requests do not inflate
 *   priorities. The arithmetic runs in SQL on the stored real values. The answer carries the job id,
 *   its priority and its queue position: 1 plus the queued jobs ahead of it in the builder's claim
 *   order (priority descending, then created_at, then id, ADR 0005; the same order solver-query's
 *   queue uses).
 * - A failed job is parked for the admin (O-176) and a running or done job is past the queue, so
 *   those, no job at all, or a request with no flop (a preflop gap) record one coverage_request row
 *   for the builder's planner to read later (O-240) and answer job_id null.
 * - A configuration the catalog does not hold fails the coverage_request foreign key, reported as
 *   a 404 problem.
 */
import { sql } from "kysely";
import type { z } from "zod";

import type { Database } from "../db.js";
import { HTTP_STATUS, PG_ERROR, PROBLEM_SLUGS, ProblemError, pgErrorCode } from "../http/problem.js";
import type { coverageRequestResultSchema } from "../schemas/study.js";

export type CoverageRequestResult = z.infer<typeof coverageRequestResultSchema>;

/** How far above the current queue head a requested job is placed (O-240). */
export const COVERAGE_PRIORITY_STEP = 1;
/** The job statuses a request may raise; failed is parked (O-176), running and done are past the queue. */
export const RAISABLE_STATUSES = ["queued", "blocked_budget"] as const;
const QUEUED_STATUS = "queued";

export const NOTHING_RAISED: CoverageRequestResult = Object.freeze({ job_id: null, priority: null, queue_position: null });

export interface CoverageSpot {
  userId: string;
  configId: string;
  pair: string;
  flop: string | undefined;
  line: string | undefined;
}

async function lockRaisableJob(transaction: Database, spot: CoverageSpot, flop: string): Promise<string | undefined> {
  const row = await transaction
    .selectFrom("build_job")
    .select("id")
    .where("game_config_id", "=", spot.configId)
    .where("position_pair", "=", spot.pair)
    .where("flop", "=", flop)
    .where("status", "in", RAISABLE_STATUSES)
    .orderBy("priority", "desc")
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  return row?.id;
}

/** Raises the job above every other queued job unless it already is; returns its priority after. */
async function raiseToHead(transaction: Database, jobId: string): Promise<number> {
  const target = sql<number>`(select max(other.priority) + ${COVERAGE_PRIORITY_STEP}
    from build_job as other where other.status = ${QUEUED_STATUS} and other.id <> ${jobId})`;
  await transaction
    .updateTable("build_job")
    .set({ priority: target })
    .where("id", "=", jobId)
    .where("priority", "<", target)
    .execute();
  const row = await transaction.selectFrom("build_job").select("priority").where("id", "=", jobId).executeTakeFirstOrThrow();
  return row.priority;
}

/** 1 plus the queued jobs the builder would claim before this one. */
async function queuePosition(transaction: Database, jobId: string): Promise<number> {
  const row = await transaction
    .selectFrom("build_job as ahead")
    .innerJoin("build_job as job", (join) => join.on("job.id", "=", jobId))
    .select((eb) => eb.fn.countAll<string>().as("ahead"))
    .where("ahead.status", "=", QUEUED_STATUS)
    .whereRef("ahead.id", "<>", "job.id")
    .where((eb) =>
      eb.or([
        eb("ahead.priority", ">", eb.ref("job.priority")),
        eb.and([
          eb("ahead.priority", "=", eb.ref("job.priority")),
          eb(eb.refTuple("ahead.created_at", "ahead.id"), "<", eb.refTuple("job.created_at", "job.id")),
        ]),
      ]),
    )
    .executeTakeFirstOrThrow();
  return Number(row.ahead) + 1;
}

async function recordRequest(transaction: Database, spot: CoverageSpot): Promise<CoverageRequestResult> {
  try {
    await transaction
      .insertInto("coverage_request")
      .values({
        user_id: spot.userId,
        game_config_id: spot.configId,
        position_pair: spot.pair,
        flop: spot.flop ?? null,
        line: spot.line ?? null,
      })
      .execute();
  } catch (error: unknown) {
    if (pgErrorCode(error) === PG_ERROR.foreignKeyViolation) {
      throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, {
        detail: "The catalog holds no configuration with this id.",
      });
    }
    throw error;
  }
  return NOTHING_RAISED;
}

/** Raises the spot's build or records the request; never starts a solve (ADR 0018). */
export async function requestCoverage(transaction: Database, spot: CoverageSpot): Promise<CoverageRequestResult> {
  const jobId = spot.flop === undefined ? undefined : await lockRaisableJob(transaction, spot, spot.flop);
  if (jobId === undefined) {
    return recordRequest(transaction, spot);
  }
  const priority = await raiseToHead(transaction, jobId);
  return { job_id: jobId, priority, queue_position: await queuePosition(transaction, jobId) };
}
