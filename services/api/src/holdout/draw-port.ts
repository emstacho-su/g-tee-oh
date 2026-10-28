/**
 * The solver-query reads the holdout draw and the item replay make (R4.13, O-276, ADR 0004): a deal
 * at a line, the hero's node with the hero's row, and a grade for its difficulty features. Every
 * call is a pure read of the library (the deal is a function of seed and filter, O-152).
 *
 * Unlike a session's port (sessions/solver-port.ts) this one is not tied to an api request's
 * deadline: the calls carry a request id naming the caller, and a signal of the caller's choosing.
 * - drawPort (the draw job): every call shares one deadline, which bounds the whole run inside the
 *   job lease.
 * - replayPort (serving a holdout item, PR #27 review HIGH 4): each call gets its own deadline, and
 *   all of them stop when the caller's budget signal fires, so one slow replay costs one call's
 *   deadline and never the whole budget. It is only used before a transaction opens.
 * A hand outside the node's range answers undefined; any other failure is the client's mapped
 * problem (expectData), carrying solver-query's own status when it answered (UPSTREAM_STATUS_KEY),
 * so isDeterministicReplayFailure can tell a library that cannot replay an item from a service that
 * could not answer right now (O-334).
 */
import { HTTP_STATUS } from "../http/problem.js";
import { isHandOffRange } from "../sessions/solver-port.js";
import {
  expectData,
  REQUEST_ID_HEADER,
  type SolverQuery,
  type SqDeal,
  type SqGrade,
  type SqNode,
  type UpstreamResult,
} from "../solver-query/client.js";

const DEAL_START_STREET = "preflop";

/** The property of a thrown problem that holds the status solver-query answered with (O-334). */
export const UPSTREAM_STATUS_KEY = "upstreamStatus";
const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;
/** Request Timeout: a 4xx that says "not now", not "never". */
const REQUEST_TIMEOUT_STATUS = 408;
/** 4xx answers that are transient, so they never make an item unservable (O-334). */
const TRANSIENT_CLIENT_STATUSES: ReadonlySet<number> = new Set([REQUEST_TIMEOUT_STATUS, HTTP_STATUS.tooManyRequests]);

/**
 * True when a replay call failed because the library cannot serve the request (a 4xx answer other
 * than 408 or 429), so the same call will fail again (O-334). False for everything transient: a
 * timeout or abort, a network error, a 5xx (503 among them), or a 408 or 429.
 */
export function isDeterministicReplayFailure(error: unknown): boolean {
  const status: unknown = typeof error === "object" && error !== null ? (error as Record<string, unknown>)[UPSTREAM_STATUS_KEY] : undefined;
  return typeof status === "number" && status >= CLIENT_ERROR_MIN && status < SERVER_ERROR_MIN && !TRANSIENT_CLIENT_STATUSES.has(status);
}

/** expectData, with solver-query's status kept on the problem it throws when solver-query answered. */
async function expectAnswered<T>(call: Promise<UpstreamResult<T>>, what: string): Promise<T> {
  let result: UpstreamResult<T>;
  try {
    result = await call;
  } catch (cause: unknown) {
    // No answer at all (network failure, abort): expectData's 502, with no upstream status.
    return expectData(Promise.reject(cause as Error), what);
  }
  try {
    return await expectData(Promise.resolve(result), what);
  } catch (problem: unknown) {
    throw Object.assign(problem as Error, { [UPSTREAM_STATUS_KEY]: result.response.status });
  }
}

export interface ReplaySpot {
  configId: string;
  pair: string;
  line: string | null;
}

export interface DrawPort {
  deal(spot: ReplaySpot, seed: string): Promise<SqDeal>;
  /** The node with the hero's row, or undefined when the hand has no row there. */
  heroNode(solutionId: string, nodeKey: string, hand: string): Promise<SqNode | undefined>;
  grade(solutionId: string, nodeKey: string, hand: string): Promise<SqGrade>;
}

/** The first action: the draw needs the hand's difficulty features, which every action's grade carries. */
const ANY_ACTION_INDEX = 0;

/** A port whose every call aborts on the signal `signalFor` returns for it. */
function portWith(client: SolverQuery, requestId: string, signalFor: () => AbortSignal): DrawPort {
  const init = () => ({ headers: { [REQUEST_ID_HEADER]: requestId }, signal: signalFor() });
  return {
    deal: (spot, seed) =>
      expectAnswered(
        client.POST("/v1/deal", {
          body: {
            seed,
            filter: {
              config_id: spot.configId,
              pair: spot.pair,
              start_street: DEAL_START_STREET,
              ...(spot.line === null ? {} : { line: spot.line }),
            },
          },
          ...init(),
        }),
        "a deal for this holdout spot",
      ),
    heroNode: async (solutionId, nodeKey, hand) => {
      const result = await client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey, hands: hand } }, ...init() });
      if (result.response.status === HTTP_STATUS.notFound && isHandOffRange(result.error)) {
        return undefined;
      }
      return expectAnswered(Promise.resolve(result), "this holdout node");
    },
    grade: (solutionId, nodeKey, hand) =>
      expectAnswered(
        client.POST("/v1/grade", {
          body: { solution_id: solutionId, node_key: nodeKey, hand, action_index: ANY_ACTION_INDEX, reference: requestId },
          ...init(),
        }),
        "a grade for this holdout item",
      ),
  };
}

/** The draw job's port: every call shares one deadline of `deadlineMs` from now. */
export function drawPort(client: SolverQuery, requestId: string, deadlineMs: number): DrawPort {
  const signal = AbortSignal.timeout(deadlineMs);
  return portWith(client, requestId, () => signal);
}

export interface ReplayDeadlines {
  /** Each call's own deadline. */
  callDeadlineMs: number;
  /** Fires when the caller's whole replay budget is spent; every call in flight stops with it. */
  budget: AbortSignal;
}

/** The serving port (PR #27 review HIGH 4): a deadline per call, under the caller's budget. */
export function replayPort(client: SolverQuery, requestId: string, deadlines: ReplayDeadlines): DrawPort {
  return portWith(client, requestId, () => AbortSignal.any([deadlines.budget, AbortSignal.timeout(deadlines.callDeadlineMs)]));
}
