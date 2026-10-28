/**
 * The learning hooks' prepare phase (R4.10, R4.11, R4.13, O-270, PR #27 review HIGH 3 and MEDIUM 12):
 * everything the hooks read from solver-query is read here, before the decision's or the end's
 * transaction opens, so no hook waits on an upstream (or fails on one) while it holds the session
 * row's lock.
 *
 * Mechanism: prepareLearning loads the all-configs class catalog once when any part needsCatalog,
 * through the client's catalog cache (automated/class-catalog.ts: its own CATALOG_DEADLINE_MS, not
 * the request deadline). A catalog that cannot load (solver-query down, its database unavailable, no
 * client configured) is logged at warn level and prepared as null, never thrown: each hook decides
 * what a missing catalog means (the automated part closes the block and leaves the next pick to the
 * next GET /next). Then every part's own prepare runs in order (learning/effects.ts).
 *
 * Callers: grading/decide.ts (before idempotentWrite), sessions/service.ts endSession (before the
 * end transaction) and the idle-session job (once per session, before ending it).
 */
import type { FastifyBaseLogger } from "fastify";

import { loadClassCatalog, type ClassCatalog } from "../automated/class-catalog.js";
import type { Database } from "../db.js";
import type { SessionRow } from "../sessions/repository.js";
import type { SolverQuery } from "../solver-query/client.js";
import type { LearningHooks, PreparedLearning } from "./effects.js";

export interface PrepareRequest {
  /** A handle outside the transaction the hooks will run in (the catalog reads game_config). */
  database: Database;
  /** The app's client; null when the api runs without one (the catalog is then null). */
  solverQuery: SolverQuery | null;
  userId: string;
  /** The session row as read before the transaction. */
  session: SessionRow;
  now: Date;
  /** Where a catalog failure is logged. */
  log: Pick<FastifyBaseLogger, "warn">;
}

async function catalogOrNull(request: PrepareRequest): Promise<ClassCatalog | null> {
  if (request.solverQuery === null) {
    return null;
  }
  try {
    return await loadClassCatalog(request.solverQuery, request.database);
  } catch (error: unknown) {
    request.log.warn({ err: error, session_id: request.session.id }, "class catalog unavailable; the hooks run without it");
    return null;
  }
}

/** The prepared learning context of one decision or end (see the module doc). */
export async function prepareLearning(hooks: LearningHooks, request: PrepareRequest): Promise<PreparedLearning> {
  const catalog = hooks.needsCatalog ? await catalogOrNull(request) : null;
  const { database, solverQuery, userId, session, now } = request;
  const parts = await hooks.prepareParts({ database, solverQuery, userId, session, now, catalog });
  return Object.freeze({ catalog, parts });
}
