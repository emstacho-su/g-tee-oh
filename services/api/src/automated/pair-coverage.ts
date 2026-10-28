/**
 * One (configuration, pair) of the class catalog asked of solver-query's GET /v1/coverage?classes=true
 * (R4.10, O-270; automated/class-catalog.ts reads every pair through askPair).
 *
 * - A pair whose preflop solution is held is covered, one with none uncovered.
 * - A 503 whose problem type is solver-query's SOLUTION_UNAVAILABLE_TAG names one solution marked
 *   unavailable: the pair is unavailable, neither served nor requested.
 * - A coverage answer whose database did not answer may be missing classes, so it is a failure
 *   (PR #27 review MEDIUM 7).
 * - Solver-query itself unavailable fails the whole load, so it is never cached as an empty or
 *   partial catalog (PR #27 review follow-up LOW 4). That covers any other 503 (no problem type, as
 *   from a proxy, or its database-unavailable type) and also every pair answering unavailable
 *   (failWhenServiceUnavailable).
 * - Any other failure throws the client's mapped problem (expectData).
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import {
  expectData,
  upstreamProblemTag,
  type SolverQuery,
  type SqCoverage,
  type SqSpotClassEntry,
  type UpstreamResult,
} from "../solver-query/client.js";

/** SqCoverage.database when solver-query could not reach its database (O-172). */
const DATABASE_UNAVAILABLE = "unavailable";
/** solver-query's problem tag for one solution marked unavailable (its ApiError::Unavailable), as opposed to the service. */
const SOLUTION_UNAVAILABLE_TAG = "unavailable";
const PAIR_CLASSES_WHAT = "the spot classes of this spot";

/** A catalog configuration: its id and table size. */
export interface ScopedConfig {
  id: string;
  tableSize: number;
}

/** What solver-query answered for one (configuration, pair). */
export type PairAnswer = Readonly<{
  configId: string;
  pair: string;
  tableSize: number;
  status: "covered" | "uncovered" | "unavailable";
  spotClasses: readonly SqSpotClassEntry[];
}>;

/** solver-query's database did not answer: its classes may be missing, so the answer is a failure (MEDIUM 7). */
function databaseUnavailableProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, {
    detail: "solver-query could not reach its database for the spot classes of this spot.",
  });
}

/** True when the 503 names one solution marked unavailable rather than solver-query as a whole. */
function isOneSolutionUnavailable(result: UpstreamResult<SqCoverage>): boolean {
  return result.response.status === HTTP_STATUS.unavailable && upstreamProblemTag(result.error) === SOLUTION_UNAVAILABLE_TAG;
}

/** solver-query's answer for one (configuration, pair), or the problem that fails the load (see the module doc). */
export async function askPair(solverQuery: SolverQuery, config: ScopedConfig, pair: string, signal: AbortSignal): Promise<PairAnswer> {
  const base = { configId: config.id, pair, tableSize: config.tableSize };
  let result: UpstreamResult<SqCoverage>;
  try {
    result = await solverQuery.GET("/v1/coverage", { params: { query: { config_id: config.id, pair, classes: true } }, signal });
  } catch (cause: unknown) {
    // No answer at all: expectData's 502.
    return expectData<PairAnswer>(Promise.reject(cause instanceof Error ? cause : new Error(String(cause))), PAIR_CLASSES_WHAT);
  }
  if (isOneSolutionUnavailable(result)) {
    return { ...base, status: "unavailable", spotClasses: [] };
  }
  // Any other failure, a service-wide 503 among them, throws its mapped problem and fails the load.
  const coverage = await expectData(Promise.resolve(result), PAIR_CLASSES_WHAT);
  if (coverage.database === DATABASE_UNAVAILABLE) {
    throw databaseUnavailableProblem();
  }
  const status = coverage.preflop.available ? "covered" : "uncovered";
  return { ...base, status, spotClasses: coverage.spot_classes };
}

/** Every pair answered unavailable: solver-query itself is unavailable, not one solution, so the load fails. */
export function failWhenServiceUnavailable(answers: readonly PairAnswer[]): void {
  if (answers.length > 0 && answers.every((answer) => answer.status === "unavailable")) {
    throw new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, {
      detail: "solver-query answered every spot unavailable, so the spot classes could not be read.",
    });
  }
}
