/**
 * Choosing an automated session's next review block (R4.10, O-270, O-272, ADR 0018), at POST
 * /sessions, when a decision closes a block, and when GET /next resumes a block whose pick waited.
 *
 * Mechanism: the caller hands in the class catalog (class-catalog.ts; POST /sessions loads it, a
 * decision reads context.prepared.catalog, PR #27 review HIGH 3), cut here to the session's scope (an
 * empty scope is every catalog configuration). The user's learning rows are read on the caller's
 * handle, one queue candidate is built per catalog class (queue.ts) and the block is picked with the
 * pick stream. The pairs to request are the catalog's uncovered pairs plus the pairs of carded
 * classes the catalog no longer lists (repository.ts uncoveredCardPairs); the caller records them as
 * coverage_request rows (O-240) in its own transaction, and no solution row is ever written. No class
 * at all leaves pick null; the caller answers the 422 no-coverage problem.
 */
import type { Database } from "../db.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { PairCandidate } from "../sessions/candidates.js";
import type { SessionRow } from "../sessions/repository.js";
import type { AutomatedLearning } from "../sessions/state.js";
import { scopeCatalog, type ClassCatalog } from "./class-catalog.js";
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
  /** The catalog cut to the session's scope. */
  catalog: ClassCatalog;
  /** Pairs to record as coverage requests (O-240). */
  gaps: PairCandidate[];
}

/** The next pick's request for a session's automated learning state, as of `now`. */
export function nextBlockRequest(
  context: { userId: string; now: Date; session: Pick<SessionRow, "state"> },
  learning: AutomatedLearning,
): NextBlockRequest {
  return {
    userId: context.userId,
    configIds: learning.config_ids,
    seed: context.session.state.seed,
    pickNo: learning.pick_no,
    queue: learning.queue,
    now: context.now,
  };
}

export function noClassProblem(gaps: number): ProblemError {
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noCoverage, {
    detail: `The library covers no spot class in this scope; ${gaps} spots were queued for the builder.`,
  });
}

/** The scope's requests to record and the next block (null when no class is covered), over `catalog`. */
export async function chooseNextBlock(database: Database, catalog: ClassCatalog, request: NextBlockRequest): Promise<NextBlock> {
  const scoped = scopeCatalog(catalog, request.configIds);
  const [inputs, cardGaps] = await Promise.all([
    queueInputs(database, request.userId),
    uncoveredCardPairs(database, request.userId, scoped, request.configIds),
  ]);
  const catalogGaps = scoped.uncoveredPairs.map((pair) => ({ config_id: pair.configId, pair: pair.pair }));
  const gaps = dedupePairs([...catalogGaps, ...cardGaps]);
  if (scoped.classes.length === 0) {
    return { pick: null, catalog: scoped, gaps };
  }
  const candidates = queueCandidates(scoped.classes, inputs, request.now);
  const pick = pickBlock({ seed: request.seed, pickNo: request.pickNo, queue: request.queue, candidates, catalog: scoped });
  return { pick, catalog: scoped, gaps };
}
