/**
 * The frequency view's node reads (R4.12, S41, O-418, ADR 0004, ADR 0018): one GET /v1/nodes per
 * listed spot, for its most played hand class only, so the read is light. The node gives the action
 * labels and kinds, the seat to act, the pair, the configuration and the action family; the api
 * names none of them itself.
 *
 * Mechanism: at most MAX_CONCURRENT_SOLVER_CALLS reads at a time, all under one deadline of
 * SESSION_DEADLINE_MS for the request (as a session port). A 404 means the library no longer holds
 * that node or the hand's row there, and the spot is left out (undefined); a deadline cut is the 503
 * unavailable problem and any other failure the usual upstream problem, so the card offers Try again.
 * Nothing is written and nothing is solved.
 */
import type { FastifyRequest } from "fastify";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "../sessions/concurrency.js";
import { deadlineProblem } from "../sessions/problems.js";
import { SESSION_DEADLINE_MS } from "../sessions/solver-port.js";
import { expectData, upstreamHeaders, type SolverQuery, type SqNode, type UpstreamResult } from "../solver-query/client.js";
import type { FrequencySpotRow } from "./frequency-repository.js";

async function nodeOrGone(call: Promise<UpstreamResult<SqNode>>, signal: AbortSignal): Promise<SqNode | undefined> {
  let result: UpstreamResult<SqNode>;
  try {
    result = await call;
  } catch (error: unknown) {
    if (signal.aborted) {
      throw Object.assign(deadlineProblem(SESSION_DEADLINE_MS), { cause: error });
    }
    const problem = new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, { detail: "solver-query could not answer for this node." });
    throw Object.assign(problem, { cause: error });
  }
  if (result.response.status === HTTP_STATUS.notFound) {
    return undefined;
  }
  return expectData(Promise.resolve(result), "this node");
}

/** Each spot's node, in spot order; undefined where the library no longer holds it. */
export async function readSpotNodes(
  client: SolverQuery,
  request: FastifyRequest,
  spots: readonly FrequencySpotRow[],
): Promise<Array<SqNode | undefined>> {
  const signal = AbortSignal.timeout(SESSION_DEADLINE_MS);
  const init = { headers: upstreamHeaders(request), signal };
  return mapBounded(spots, MAX_CONCURRENT_SOLVER_CALLS, (spot) => {
    if (signal.aborted) {
      return Promise.reject(deadlineProblem(SESSION_DEADLINE_MS));
    }
    const query = { solution_id: spot.solutionId, node_key: spot.nodeKey, hands: spot.sampleHand };
    return nodeOrGone(client.GET("/v1/nodes", { params: { query }, ...init }), signal);
  });
}
