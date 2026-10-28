/**
 * Choosing an automated session's next review block (R4.10, O-270, O-272, ADR 0018), at POST
 * /sessions and when a decision closes a block.
 *
 * Mechanism: load the class catalog of the session's scope (class-catalog.ts; an empty scope is
 * every catalog configuration), read the user's learning rows on the caller's handle, build one
 * queue candidate per catalog class (queue.ts) and pick the block with the pick stream. The pairs to
 * request are the catalog's uncovered pairs plus the pairs of carded classes the catalog no longer
 * lists (repository.ts uncoveredCardPairs); the caller records them as coverage_request rows (O-240)
 * in its own transaction, and no solution row is ever written. No class at all is a 422 no-coverage
 * problem.
 */
import type { Database } from "../db.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { PairCandidate } from "../sessions/candidates.js";
import type { AutomatedLearning } from "../sessions/state.js";
import type { SolverQuery } from "../solver-query/client.js";
import { loadClassCatalog, type ClassCatalog } from "./class-catalog.js";
import { pickBlock, queueCandidates, type BlockPick } from "./queue.js";
import { dedupePairs, queueInputs, uncoveredCardPairs } from "./repository.js";

export interface NextBlockRequest {
  userId: string;
  /** The session's scope; empty means every catalog configuration. */
  configIds: readonly string[];
  seed: string;
  pickNo: number;
  queue: AutomatedLearning["queue"];
  now: Date;
}

export interface NextBlock {
  pick: BlockPick | null;
  catalog: ClassCatalog;
  /** Pairs to record as coverage requests (O-240). */
  gaps: PairCandidate[];
}

export function noClassProblem(gaps: number): ProblemError {
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noCoverage, {
    detail: `The library covers no spot class in this scope; ${gaps} spots were queued for the builder.`,
  });
}

/** The scope's catalog, the requests to record, and the next block (null when no class is covered). */
export async function chooseNextBlock(database: Database, solverQuery: SolverQuery, request: NextBlockRequest): Promise<NextBlock> {
  const catalog = await loadClassCatalog(solverQuery, database, request.configIds.length === 0 ? undefined : request.configIds);
  const [inputs, cardGaps] = await Promise.all([
    queueInputs(database, request.userId),
    uncoveredCardPairs(database, request.userId, catalog, request.configIds),
  ]);
  const catalogGaps = catalog.uncoveredPairs.map((pair) => ({ config_id: pair.configId, pair: pair.pair }));
  const gaps = dedupePairs([...catalogGaps, ...cardGaps]);
  if (catalog.classes.length === 0) {
    return { pick: null, catalog, gaps };
  }
  const candidates = queueCandidates(catalog.classes, inputs, request.now);
  const pick = pickBlock({ seed: request.seed, pickNo: request.pickNo, queue: request.queue, candidates, catalog });
  return { pick, catalog, gaps };
}
