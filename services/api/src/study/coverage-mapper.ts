/**
 * solver-query's /v1/coverage body to the api's Coverage shape (R3.4, O-172, O-229).
 *
 * solver-query is the single source: preflop availability from its registry and the solution
 * table, flops and the queue from the database. When its database is unconfigured or unavailable
 * (O-172) those lists arrive empty and the database field says why; the api passes that through
 * rather than reading the library tables itself. A flop counts as held only when a published
 * solution holds its scenarios; superseded or unavailable rows are not study coverage.
 */
import type { z } from "zod";

import type { coverageSchema } from "../schemas/study.js";
import type { SqCoverage } from "../solver-query/client.js";

export type Coverage = z.infer<typeof coverageSchema>;

/** The solution status whose scenarios a user can study (db/migrations library.sql). */
export const PUBLISHED_STATUS = "published";

export function toCoverage(coverage: SqCoverage): Coverage {
  return {
    config_id: coverage.config_id,
    pair: coverage.pair,
    preflop_available: coverage.preflop.available,
    flops: coverage.flops
      .filter((flop) => flop.status === PUBLISHED_STATUS)
      .map((flop) => ({ flop: flop.flop, texture_family: flop.texture_family, scenarios: flop.scenarios })),
    queue: coverage.queue.map((job) => ({
      job_id: job.job_id,
      flop: job.flop,
      priority: job.priority,
      position: job.position,
    })),
    synthetic: coverage.preflop.synthetic,
    database: coverage.database,
  };
}

/**
 * Whether the library already covers the spot: a preflop solution is held and, when a flop is
 * named, a published solution holds that flop (O-240).
 */
export function isSpotCovered(coverage: SqCoverage, flop: string | undefined): boolean {
  if (!coverage.preflop.available) {
    return false;
  }
  return flop === undefined || coverage.flops.some((held) => held.flop === flop && held.status === PUBLISHED_STATUS);
}
