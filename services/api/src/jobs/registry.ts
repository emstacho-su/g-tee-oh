/**
 * The job kinds the api runs (R4.11, R4.13, O-275, O-276): each a schedule (jobs/schedule.ts) and a
 * handler. A handler runs inside one transaction together with the job's completion (worker.ts), so
 * its writes commit exactly when the job is marked done; a throw rolls them back and the job is
 * retried after its backoff. Handlers must be idempotent per period (PM condition: running a job
 * twice leaves identical rows).
 *
 * The lanes add their definitions to JOB_DEFINITIONS when they land:
 * - Lane B: leak_history_weekly (Monday 00:00 APP_TIME_ZONE, jobs/leak-history.ts) and
 *   idle_session_close (every 15 minutes, jobs/idle-close.ts, through sessions/service.ts
 *   endLockedSession);
 * - Lane C: holdout_round_monthly (the 1st, 00:00, jobs/holdout-round.ts) and holdout_draw (daily
 *   until each track's draw is recorded, jobs/holdout-draw.ts).
 */
import type { FastifyBaseLogger } from "fastify";

import type { Database } from "../db.js";
import type { LearningHooks } from "../learning/effects.js";
import type { SolverQuery } from "../solver-query/client.js";
import { HOLDOUT_DRAW_JOB } from "./holdout-draw.js";
import { HOLDOUT_ROUND_JOB } from "./holdout-round.js";
import { IDLE_CLOSE_JOB } from "./idle-close.js";
import { LEAK_HISTORY_JOB } from "./leak-history.js";
import type { ClaimedJob } from "./repository.js";
import type { JobSchedule } from "./schedule.js";

export const JOB_KINDS = {
  leakHistoryWeekly: "leak_history_weekly",
  idleSessionClose: "idle_session_close",
  holdoutRoundMonthly: "holdout_round_monthly",
  holdoutDraw: "holdout_draw",
} as const;

export type JobLog = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

/** What a handler may use beyond its transaction. */
export interface JobServices {
  /** Null when the api runs without solver-query; a handler that needs it throws, and is retried. */
  solverQuery: SolverQuery | null;
  learningHooks: LearningHooks;
  log: JobLog;
}

export interface JobContext {
  /** The transaction the job's completion commits in. */
  transaction: Database;
  /**
   * The pool handle outside that transaction, for reads whose failure must not abort it (the idle
   * closer's prepare phase, PR #27 review HIGH 3). runDueJobs always sets it; optional so direct
   * handler tests may leave it out.
   */
  database?: Database;
  job: ClaimedJob;
  now: Date;
  timeZone: string;
  services: JobServices;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface JobDefinition extends JobSchedule {
  handler: JobHandler;
}

export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  LEAK_HISTORY_JOB,
  IDLE_CLOSE_JOB,
  HOLDOUT_ROUND_JOB,
  HOLDOUT_DRAW_JOB,
];

/** The handlers of `definitions`, by kind. */
export function handlersOf(definitions: readonly JobDefinition[]): Readonly<Record<string, JobHandler>> {
  return Object.fromEntries(definitions.map((definition) => [definition.kind, definition.handler]));
}
