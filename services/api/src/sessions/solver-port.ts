/**
 * The solver-query calls a training session makes (R3.6, R3.7, A5 section 2, ADR 0004, O-158):
 * deal, node reads, opponent samples, reveals, grades and coverage, each through the typed client
 * with the caller's request id (upstreamHeaders) and the status mapping of expectData, so no
 * upstream body reaches a browser.
 *
 * Every call here is a pure read of solver-query's library: the deal is a function of the seed and
 * filter (O-152), a sample is a function of the generator state (O-151), and a reveal answers the
 * same cards on a repeat; that is what lets GET /sessions/{id}/next recompute a prompt on every
 * request without writing anything. The one call that may answer "not here" as a fact rather than
 * a failure is the node read for a hand: a 404 means the solution holds no row for that hand at
 * that node (a line the equilibrium never plays it to), and the derivation ends the hand there.
 */
import type { FastifyRequest } from "fastify";

import { HTTP_STATUS, ProblemError } from "../http/problem.js";
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
  /** The node with the rows of one hand, or undefined when the solution holds no row for it there. */
  nodeForHand(solutionId: string, nodeKey: string, hand: string): Promise<SqNode | undefined>;
  sample(solutionId: string, nodeKey: string, hand: string, rngState: string): Promise<SqSampleAction>;
  reveal(dealId: string, street: string): Promise<SqReveal>;
  grade(call: GradeCall): Promise<SqGrade>;
  coverage(configId: string, pair: string): Promise<SqCoverage>;
}

const DEAL_START_STREET = "preflop";

function isNotFound(error: unknown): boolean {
  return error instanceof ProblemError && error.status === HTTP_STATUS.notFound;
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
    nodeForHand: async (solutionId, nodeKey, hand) => {
      try {
        return await expectData(
          client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey, hands: hand } }, headers }),
          "this node",
        );
      } catch (error: unknown) {
        if (isNotFound(error)) {
          return undefined;
        }
        throw error;
      }
    },
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
