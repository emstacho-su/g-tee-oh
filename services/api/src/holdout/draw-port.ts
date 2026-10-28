/**
 * The solver-query reads the holdout draw and the item replay make (R4.13, O-276, ADR 0004): a deal
 * at a line, the hero's node with the hero's row, and a grade for its difficulty features. Every
 * call is a pure read of the library (the deal is a function of seed and filter, O-152).
 *
 * Unlike a session's port (sessions/solver-port.ts) this one is not tied to an api request: the
 * draw runs in a job, so the calls carry a request id naming the caller and share one deadline of
 * the caller's choosing. A hand outside the node's range answers undefined; any other failure is
 * the client's mapped problem (expectData).
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
} from "../solver-query/client.js";

const DEAL_START_STREET = "preflop";

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

export function drawPort(client: SolverQuery, requestId: string, deadlineMs: number): DrawPort {
  const signal = AbortSignal.timeout(deadlineMs);
  const init = { headers: { [REQUEST_ID_HEADER]: requestId }, signal };
  return {
    deal: (spot, seed) =>
      expectData(
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
          ...init,
        }),
        "a deal for this holdout spot",
      ),
    heroNode: async (solutionId, nodeKey, hand) => {
      const result = await client.GET("/v1/nodes", { params: { query: { solution_id: solutionId, node_key: nodeKey, hands: hand } }, ...init });
      if (result.response.status === HTTP_STATUS.notFound && isHandOffRange(result.error)) {
        return undefined;
      }
      return expectData(Promise.resolve(result), "this holdout node");
    },
    grade: (solutionId, nodeKey, hand) =>
      expectData(
        client.POST("/v1/grade", {
          body: { solution_id: solutionId, node_key: nodeKey, hand, action_index: ANY_ACTION_INDEX, reference: requestId },
          ...init,
        }),
        "a grade for this holdout item",
      ),
  };
}
