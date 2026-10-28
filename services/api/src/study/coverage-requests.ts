/**
 * Coverage requests (R3.4, O-240, O-176, ADR 0018): what POST /coverage/requests writes when the
 * library does not cover the spot. Nothing here starts a solve, inserts a build_job or touches a
 * solution; the app role could not anyway (it may update build_job.priority and nothing else on
 * builder tables, and insert coverage_request).
 *
 * Mechanism, inside the caller's transaction:
 * - With a flop, the spot's build_job in queued or blocked_budget is locked: a queued one first,
 *   then the highest priority, oldest first, if the planner made several.
 * - A queued job's priority is raised to the highest priority among the other queued jobs plus
 *   COVERAGE_PRIORITY_STEP, but only when that is above its own, so a job already at the head is
 *   left as it is and repeated requests do not inflate priorities. The arithmetic runs in SQL on
 *   the stored real values. The answer is status queued with the job id, its priority and its
 *   queue position: 1 plus the queued jobs ahead of it in the builder's claim order (priority
 *   descending, then created_at, then id, ADR 0005; the same order solver-query's queue uses).
 * - A blocked_budget job is outside the claim order until the planner moves it back to queued
 *   with its stored priority (the builder's plan write promotes it and keeps the priority), so a raise now would rest
 *   on a queue snapshot that is stale by then, and a queue position would be false (PR #25 review
 *   M8). It is left at its priority, the request is recorded so the planner sees the demand, and
 *   the answer is status blocked_budget with the job id, its priority and queue_position null.
 * - A failed job is parked for the admin (O-176) and a running or done job is past the queue, so
 *   those, no job at all, or a request with no flop (a preflop gap) record the request and answer
 *   status recorded with job_id null.
 * - A request is recorded at most once per user and spot: the insert does nothing on a conflict
 *   with coverage_request_once_key (PR #25 review M4), so repeats leave one row.
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
/** The job statuses a request may act on; failed is parked (O-176), running and done are past the queue. */
export const REQUESTABLE_STATUSES = ["queued", "blocked_budget"] as const;
const QUEUED_STATUS = "queued";

/** The answer for a spot the library already covers; nothing is written. */
export const COVERED: CoverageRequestResult = Object.freeze({
  status: "covered",
  job_id: null,
  priority: null,
  queue_position: null,
});

/** The answer for a request recorded with no job to raise. */
export const RECORDED: CoverageRequestResult = Object.freeze({
  status: "recorded",
  job_id: null,
  priority: null,
  queue_position: null,
});

/**
 * The conflict target of the unique index coverage_request_once_key (db/migrations
 * 20261028000100_api_trainer.sql); index expressions go in their own parentheses.
 */
const ONCE_KEY_TARGET = sql`user_id, game_config_id, position_pair, (coalesce(flop, '')), (coalesce(line, ''))`;

export interface CoverageSpot {
  userId: string;
  configId: string;
  pair: string;
  flop: string | undefined;
  line: string | undefined;
}

interface RequestableJob {
  id: string;
  status: (typeof REQUESTABLE_STATUSES)[number];
  priority: number;
}

async function lockRequestableJob(transaction: Database, spot: CoverageSpot, flop: string): Promise<RequestableJob | undefined> {
  return transaction
    .selectFrom("build_job")
    .select(["id", "status", "priority"])
    .where("game_config_id", "=", spot.configId)
    .where("position_pair", "=", spot.pair)
    .where("flop", "=", flop)
    .where("status", "in", REQUESTABLE_STATUSES)
    .orderBy(sql`status = ${QUEUED_STATUS}`, "desc")
    .orderBy("priority", "desc")
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .limit(1)
    .forUpdate()
    .$narrowType<{ status: RequestableJob["status"] }>()
    .executeTakeFirst();
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

/** Inserts the spot's coverage_request unless this user already asked for it (PR #25 review M4). */
async function recordRequest(transaction: Database, spot: CoverageSpot): Promise<void> {
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
      .onConflict((conflict) => conflict.expression(ONCE_KEY_TARGET).doNothing())
      .execute();
  } catch (error: unknown) {
    if (pgErrorCode(error) === PG_ERROR.foreignKeyViolation) {
      throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, {
        detail: "The catalog holds no configuration with this id.",
      });
    }
    throw error;
  }
}

/** Raises the spot's queued build or records the request; never starts a solve (ADR 0018). */
export async function requestCoverage(transaction: Database, spot: CoverageSpot): Promise<CoverageRequestResult> {
  const job = spot.flop === undefined ? undefined : await lockRequestableJob(transaction, spot, spot.flop);
  if (job === undefined) {
    await recordRequest(transaction, spot);
    return RECORDED;
  }
  if (job.status !== QUEUED_STATUS) {
    await recordRequest(transaction, spot);
    return { status: "blocked_budget", job_id: job.id, priority: job.priority, queue_position: null };
  }
  const priority = await raiseToHead(transaction, job.id);
  return { status: "queued", job_id: job.id, priority, queue_position: await queuePosition(transaction, job.id) };
}
