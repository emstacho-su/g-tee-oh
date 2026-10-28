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
 * One deadline per request (PR #25 re-review BLOCKER 2): a port is made per api request, and every
 * call it makes shares one AbortSignal that fires SESSION_DEADLINE_MS after the port was made. A
 * call cut off by it, and any call after it, is a 503 unavailable problem: transient, and since
 * the deadline only ever cuts reads or aborts the transaction it runs in, nothing is stored.
 *
 * The one call that may answer "not here" as a fact rather than a failure is the node read for a
 * hand (PR #25 review MEDIUM 5, re-review LOW 3): solver-query answers a hand outside the node's
 * range with a 404 whose problem type is hand-not-in-range, and the derivation ends the hand
 * there. Any other 404 (not-found: no such solution or node) means the library no longer holds
 * what the session was dealt, and is a 502 upstream problem, never silent play. Only the problem
 * type is read, never its detail text.
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
  type SqSchemas,
  type UpstreamResult,
} from "../solver-query/client.js";
import { deadlineProblem } from "./problems.js";

/** One painted class and its action, and solver-query's grade of a painted range (S27, O-300). */
export type SqPaintedHand = SqSchemas["PaintedHand"];
export type SqGradeRange = SqSchemas["GradeRangeResponse"];

/** How long one api request may spend on solver-query calls before it answers 503 (BLOCKER 2). */
export const SESSION_DEADLINE_MS = 2000;

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
  /** A painted range graded by reach-weighted EV loss (S27, R3.17, O-300): every held class, each once. */
  gradeRange(solutionId: string, nodeKey: string, paint: readonly SqPaintedHand[]): Promise<SqGradeRange>;
  coverage(configId: string, pair: string): Promise<SqCoverage>;
}

export interface SolverPortOptions {
  /** The request's deadline; SESSION_DEADLINE_MS unless a test shortens it. */
  deadlineMs?: number;
}

const DEAL_START_STREET = "preflop";
/** The problem type solver-query gives a hand outside the node's range (services/solver-query/src/error.rs). */
export const HAND_OFF_RANGE_TYPE = "urn:g-tee-oh:problem:hand-not-in-range";
const HAND_OFF_RANGE_SLUG = "hand-not-in-range";
const PROBLEM_TYPE_SEPARATOR = ":";

const upstreamProblemSchema = z.object({ type: z.string() });

/** True when a 404 problem's type says the hand has no row at the node, rather than no solution or node. */
export function isHandOffRange(body: unknown): boolean {
  const parsed = upstreamProblemSchema.safeParse(body);
  return parsed.success && parsed.data.type.split(PROBLEM_TYPE_SEPARATOR).at(-1) === HAND_OFF_RANGE_SLUG;
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
    throw Object.assign(
      new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, { detail: "solver-query could not answer for this node." }),
      { cause },
    );
  }
  if (result.response.status === HTTP_STATUS.notFound) {
    if (isHandOffRange(result.error)) {
      return undefined;
    }
    throw libraryLost();
  }
  return expectData(Promise.resolve(result), "this node");
}

type Guard = <T>(call: () => Promise<T>) => Promise<T>;

/** Runs calls under the deadline: refused once it has passed, and a 503 when it cut one off. */
function deadlineGuard(signal: AbortSignal, deadlineMs: number): Guard {
  return async (call) => {
    if (signal.aborted) {
      throw deadlineProblem(deadlineMs);
    }
    try {
      return await call();
    } catch (error: unknown) {
      if (signal.aborted) {
        throw Object.assign(deadlineProblem(deadlineMs), { cause: error });
      }
      throw error;
    }
  };
}

/** The session's solver-query calls over the typed client, carrying the request id (O-158) and one deadline. */
export function solverPort(client: SolverQuery, request: FastifyRequest, options: SolverPortOptions = {}): SolverPort {
  const deadlineMs = options.deadlineMs ?? SESSION_DEADLINE_MS;
  const signal = AbortSignal.timeout(deadlineMs);
  const guard = deadlineGuard(signal, deadlineMs);
  const init = { headers: upstreamHeaders(request), signal };
  return {
    deal: (filter, seed) =>
      guard(() =>
        expectData(
          client.POST("/v1/deal", { body: { seed, filter: { ...filter, start_street: DEAL_START_STREET } }, ...init }),
          "a deal for this spot",
        ),
      ),
    node: (solutionId, nodeKey) =>
      guard(() =>
        expectData(client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey } }, ...init }), "this node"),
      ),
    nodeForHand: (solutionId, nodeKey, hand) =>
      guard(() =>
        nodeOrOffRange(client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey, hands: hand } }, ...init })),
      ),
    sample: (solutionId, nodeKey, hand, rngState) =>
      guard(() =>
        expectData(
          client.POST("/v1/sample-action", { body: { solution_id: solutionId, node_key: nodeKey, hand, rng_state: rngState }, ...init }),
          "an opponent action at this node",
        ),
      ),
    reveal: (dealId, street) =>
      guard(() =>
        expectData(
          client.GET("/v1/deal/{id}/reveal", { params: { path: { id: dealId }, query: { street } }, ...init }),
          "this street of the deal",
        ),
      ),
    grade: (call) => guard(() => expectData(client.POST("/v1/grade", { body: call, ...init }), "a grade for this decision")),
    gradeRange: (solutionId, nodeKey, paint) =>
      guard(() =>
        expectData(
          client.POST("/v1/grade-range", { body: { solution_id: solutionId, node_key: nodeKey, paint: [...paint] }, ...init }),
          "a grade for this painted range",
        ),
      ),
    coverage: (configId, pair) =>
      guard(() =>
        expectData(client.GET("/v1/coverage", { params: { query: { config_id: configId, pair } }, ...init }), "coverage for this spot"),
      ),
  };
}
