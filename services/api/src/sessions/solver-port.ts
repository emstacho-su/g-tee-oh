/**
 * The solver-query calls a training session makes (R3.6, R3.7, A5 section 2, ADR 0004, O-158):
 * deal, node reads, opponent samples, reveals, grades and coverage, each through the typed client
 * with the caller's request id (upstreamHeaders) and the status mapping of expectData, so no
 * upstream body reaches a browser.
 *
 * Every call here is a pure read of solver-query's library: the deal is a function of the seed and
 * filter (O-152), a sample is a function of the generator state (O-151), and a reveal answers the
 * same cards on a repeat; that is what lets GET /sessions/{id}/next recompute a prompt on every
 * request without writing anything.
 *
 * The one call that may answer "not here" as a fact rather than a failure is the node read for a
 * hand (PR #25 review MEDIUM 5). solver-query answers every 404 with the not-found problem type,
 * so its problem body decides (isHandOffRange): the detail "hand <class> is not in the node's
 * range" (services/solver-query/src/routes/nodes.rs) means the solution holds no row for that hand
 * at that node, a line the equilibrium never plays it to, and the derivation ends the hand there.
 * Any other 404 ("solution ... is not in the library", "node ... is not in this solution") means
 * the library no longer holds what the session was dealt, and is a 502 upstream problem, never
 * silent play. A distinct problem type, HAND_OFF_RANGE_TYPE, is honoured as well, for when
 * solver-query gives the case its own slug.
 */
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import {
  expectData,
  upstreamHeaders,
  type SolverQuery,
  type SqCoverage,
  type SqDeal,
  type SqGrade,
  type SqNode,
  type SqReveal,
  type SqSampleAction,
  type UpstreamResult,
} from "../solver-query/client.js";

/** The deal filter the api sends: preflop only in v1 (O-145). */
export interface DealFilter {
  config_id: string;
  pair: string;
  line?: string;
}

export interface GradeCall {
  solution_id: string;
  node_key: string;
  hand: string;
  action_index: number;
  reference: string;
}

export interface SolverPort {
  deal(filter: DealFilter, seed: string): Promise<SqDeal>;
  /** The node with every hand row (POST /sessions' spot search). */
  node(solutionId: string, nodeKey: string): Promise<SqNode>;
  /** The node with the rows of one hand, or undefined when the solution holds no row for it there. */
  nodeForHand(solutionId: string, nodeKey: string, hand: string): Promise<SqNode | undefined>;
  sample(solutionId: string, nodeKey: string, hand: string, rngState: string): Promise<SqSampleAction>;
  reveal(dealId: string, street: string): Promise<SqReveal>;
  grade(call: GradeCall): Promise<SqGrade>;
  coverage(configId: string, pair: string): Promise<SqCoverage>;
}

const DEAL_START_STREET = "preflop";
const PROBLEM_TYPE_PREFIX = "urn:g-tee-oh:problem:";
const NOT_FOUND_TYPE = `${PROBLEM_TYPE_PREFIX}not-found`;
/** The type solver-query would give a hand outside the node's range under its own slug (proposed). */
export const HAND_OFF_RANGE_TYPE = `${PROBLEM_TYPE_PREFIX}hand-not-in-range`;
/** solver-query's detail for a hand without a row at the node (routes/nodes.rs hand_rows). */
const HAND_OFF_RANGE_DETAIL = /^hand .+ is not in the node's range$/;

const upstreamProblemSchema = z.object({ type: z.string(), detail: z.string() });

/** True when a 404 problem body says the hand has no row at the node, rather than no solution or node. */
export function isHandOffRange(body: unknown): boolean {
  const parsed = upstreamProblemSchema.safeParse(body);
  if (!parsed.success) {
    return false;
  }
  const { type, detail } = parsed.data;
  return type === HAND_OFF_RANGE_TYPE || (type === NOT_FOUND_TYPE && HAND_OFF_RANGE_DETAIL.test(detail));
}

function libraryLost(): ProblemError {
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, {
    detail: "The library no longer holds the solution or node this hand reached.",
  });
}

/** One node read for a hand: its node, undefined when the hand has no row there, or a problem. */
async function nodeOrOffRange(call: Promise<UpstreamResult<SqNode>>): Promise<SqNode | undefined> {
  let result: UpstreamResult<SqNode>;
  try {
    result = await call;
  } catch (cause: unknown) {
    throw Object.assign(new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, {
      detail: "solver-query could not answer for this node.",
    }), { cause });
  }
  if (result.response.status === HTTP_STATUS.notFound) {
    if (isHandOffRange(result.error)) {
      return undefined;
    }
    throw libraryLost();
  }
  return expectData(Promise.resolve(result), "this node");
}

/** The session's solver-query calls over the typed client, carrying the request id (O-158). */
export function solverPort(client: SolverQuery, request: FastifyRequest): SolverPort {
  const headers = upstreamHeaders(request);
  return {
    deal: (filter, seed) =>
      expectData(
        client.POST("/v1/deal", { body: { seed, filter: { ...filter, start_street: DEAL_START_STREET } }, headers }),
        "a deal for this spot",
      ),
    node: (solutionId, nodeKey) =>
      expectData(client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey } }, headers }), "this node"),
    nodeForHand: (solutionId, nodeKey, hand) =>
      nodeOrOffRange(client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey, hands: hand } }, headers })),
    sample: (solutionId, nodeKey, hand, rngState) =>
      expectData(
        client.POST("/v1/sample-action", {
          body: { solution_id: solutionId, node_key: nodeKey, hand, rng_state: rngState },
          headers,
        }),
        "an opponent action at this node",
      ),
    reveal: (dealId, street) =>
      expectData(
        client.GET("/v1/deal/{id}/reveal", { params: { path: { id: dealId }, query: { street } }, headers }),
        "this street of the deal",
      ),
    grade: (call) => expectData(client.POST("/v1/grade", { body: call, headers }), "a grade for this decision"),
    coverage: (configId, pair) =>
      expectData(
        client.GET("/v1/coverage", { params: { query: { config_id: configId, pair } }, headers }),
        "coverage for this spot",
      ),
  };
}
