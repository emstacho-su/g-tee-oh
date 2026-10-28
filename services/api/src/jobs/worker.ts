/**
 * The job worker (R4.11, O-275, ADR 0005, PM conditions): runs due app_job rows outside any request.
 *
 * Mechanism: runDueJobs first marks failed the jobs whose lease ran out after their last attempt
 * and prunes its kinds' done jobs past their retention (PR #27 review MEDIUM 9), then claims jobs of the kinds it has handlers for, one at a time (repository.ts claimJob, which
 * commits the claim and its lease on its own), up to MAX_JOBS_PER_RUN. Each job's handler and its
 * completion run in one transaction, so the job is done exactly when its writes commit; a throw rolls
 * the writes back and failJob queues it again after its backoff, or fails it after the last attempt.
 * A process that dies mid-job leaves the row running with its lease; once JOB_LEASE_MS has passed,
 * the next claim takes it again. The clock is a parameter, so tests drive the queue through time.
 *
 * startJobWorker polls every JOB_POLL_INTERVAL_MS: each tick schedules every kind's current period
 * (schedule.ts) and runs the due jobs; ticks never overlap. main.ts starts it after the server
 * listens and stops it on shutdown; buildApp and the request path never start it (PM condition).
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { FastifyInstance } from "fastify";

import type { Database } from "../db.js";
import { requireDatabase } from "../http/database.js";
import { JOB_DEFINITIONS, handlersOf, type JobDefinition, type JobHandler, type JobServices } from "./registry.js";
import { claimJob, completeJob, failExhaustedJobs, failJob, pruneDoneJobs, type ClaimedJob } from "./repository.js";
import { ensureScheduled } from "./schedule.js";

/** The worker polls the queue this often (O-275). */
export const JOB_POLL_INTERVAL_MS = 60_000;
/** One run takes at most this many jobs, so a tick stays short. */
export const MAX_JOBS_PER_RUN = 16;

export interface JobRunOptions {
  /** Names the worker in app_job.locked_by. */
  workerId: string;
  timeZone: string;
  services: JobServices;
}

export interface JobRunReport {
  done: string[];
  failed: string[];
}

async function runOne(database: Database, job: ClaimedJob, handler: JobHandler, now: Date, options: JobRunOptions): Promise<boolean> {
  try {
    await database.transaction().execute(async (transaction) => {
      await handler({ transaction, database, job, now, timeZone: options.timeZone, services: options.services });
      await completeJob(transaction, job, now);
    });
    return true;
  } catch (error: unknown) {
    options.services.log.error({ err: error, job_id: job.id, kind: job.kind, attempt: job.attempts }, "job failed");
    await failJob(database, job, error, now);
    return false;
  }
}

/** Runs the due jobs of the handlers' kinds as of `now` (see the module doc). */
export async function runDueJobs(
  database: Database,
  now: Date,
  handlers: Readonly<Record<string, JobHandler>>,
  options: JobRunOptions,
): Promise<JobRunReport> {
  const kinds = Object.keys(handlers);
  await failExhaustedJobs(database, kinds, now);
  await pruneDoneJobs(database, kinds, now);
  const report: JobRunReport = { done: [], failed: [] };
  for (let taken = 0; taken < MAX_JOBS_PER_RUN; taken += 1) {
    const job = await claimJob(database, { now, workerId: options.workerId, kinds });
    if (job === undefined) {
      break;
    }
    const handler = handlers[job.kind];
    if (handler === undefined) {
      // Unreachable while claims filter by the handlers' kinds; failed loudly rather than left running.
      await failJob(database, job, new Error(`no handler for ${job.kind}`), now);
      report.failed.push(job.id);
      continue;
    }
    const succeeded = await runOne(database, job, handler, now, options);
    (succeeded ? report.done : report.failed).push(job.id);
  }
  return report;
}

/**
 * The worker's app_job.locked_by: host, process and a random id (PR #27 review LOW 14), so two
 * workers in one process, or a restarted process reusing a pid, never share a lease identity.
 */
export function jobWorkerId(): string {
  return `${hostname()}:${process.pid}:${randomUUID()}`;
}

export interface JobWorker {
  /** Stops polling and waits for a tick in progress. */
  stop(): Promise<void>;
}

export interface JobWorkerOptions {
  timeZone: string;
  definitions?: readonly JobDefinition[];
  intervalMs?: number;
  clock?: () => Date;
}

/** Starts polling (main.ts only; see the module doc). */
export function startJobWorker(app: FastifyInstance, options: JobWorkerOptions): JobWorker {
  const database = requireDatabase(app);
  const definitions = options.definitions ?? JOB_DEFINITIONS;
  const handlers = handlersOf(definitions);
  const clock = options.clock ?? (() => new Date());
  const runOptions: JobRunOptions = {
    workerId: jobWorkerId(),
    timeZone: options.timeZone,
    services: { solverQuery: app.solverQuery, learningHooks: app.learningHooks, log: app.log },
  };
  // The tick in progress, so ticks never overlap and stop() can wait for it.
  let current: Promise<void> | undefined;
  const tick = (): void => {
    if (current !== undefined) {
      return;
    }
    const now = clock();
    current = ensureScheduled(database, definitions, now, options.timeZone)
      .then(() => runDueJobs(database, now, handlers, runOptions))
      .then(
        () => undefined,
        (error: unknown) => {
          app.log.error({ err: error }, "job worker tick failed");
        },
      )
      .finally(() => {
        current = undefined;
      });
  };
  const timer = setInterval(tick, options.intervalMs ?? JOB_POLL_INTERVAL_MS);
  timer.unref();
  tick();
  return {
    async stop() {
      clearInterval(timer);
      await current;
    },
  };
}
