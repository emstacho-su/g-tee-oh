/**
 * The shared practice node resolver (PR #29 review L11, R3.16, R3.17, O-152): prediction and range
 * painting both deal at a hero spot's line, read the start node with every row and require the
 * hero seat to act there. One helper does it with one seat check; a deal with no solution, or a
 * deal or node with another seat to act, is a 502 upstream problem.
 */
import { describe, expect, it } from "vitest";

import { HTTP_STATUS, ProblemError } from "../src/http/problem.js";
import type { SqDeal, SqNode } from "../src/solver-query/client.js";
import { resolvePracticeNode } from "../src/sessions/practice-node.js";
import type { SolverPort } from "../src/sessions/solver-port.js";
import type { HeroSpot } from "../src/sessions/state.js";

const SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const DEAL_SEED = "00000000deadbeef";
const SPOT: HeroSpot = {
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  line: "r250",
  hero_seat: "BB",
  history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
};

function deal(overrides: Partial<SqDeal> = {}): SqDeal {
  return {
    deal_id: "00000000-0000-4000-8000-000000000001",
    solution_ids: [SOLUTION_ID],
    start_node_key: NODE_KEY,
    hero_position: "BB",
    villain_position: "BTN",
    hero_hand: "AhAd",
    villain_hand: "KhKd",
    revealed: {},
    ...overrides,
  };
}

function node(overrides: Partial<SqNode> = {}): SqNode {
  return { solution_id: SOLUTION_ID, node_key: NODE_KEY, to_act: "BB", ...overrides } as SqNode;
}

function port(dealt: SqDeal, read: SqNode, calls: string[] = []): SolverPort {
  const refuse = (): never => {
    throw new Error("not used by the resolver");
  };
  return {
    deal: (filter, seed) => {
      calls.push(`deal ${filter.config_id} ${filter.pair} ${filter.line ?? ""} ${seed}`);
      return Promise.resolve(dealt);
    },
    node: (solutionId, nodeKey) => {
      calls.push(`node ${solutionId} ${nodeKey}`);
      return Promise.resolve(read);
    },
    nodeForHand: refuse,
    sample: refuse,
    reveal: refuse,
    grade: refuse,
    gradeRange: refuse,
    coverage: refuse,
  };
}

async function statusOf(run: Promise<unknown>): Promise<number> {
  const error: unknown = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProblemError)) {
    throw new Error("expected a problem");
  }
  return error.status;
}

describe("R3.16 R3.17 resolvePracticeNode (PR #29 review L11)", () => {
  it("R3.16 R3.17 deals at the spot's line with the given seed and reads the start node of the first solution", async () => {
    const calls: string[] = [];
    const read = node();
    const resolved = await resolvePracticeNode(SPOT, DEAL_SEED, port(deal(), read, calls));
    expect(resolved).toEqual({ solutionId: SOLUTION_ID, node: read });
    expect(calls).toEqual([`deal cfg_6_online_100 BB-BTN r250 ${DEAL_SEED}`, `node ${SOLUTION_ID} ${NODE_KEY}`]);
  });

  it("R3.16 R3.17 a deal with no solution is a 502 and reads no node", async () => {
    const calls: string[] = [];
    expect(await statusOf(resolvePracticeNode(SPOT, DEAL_SEED, port(deal({ solution_ids: [] }), node(), calls)))).toBe(HTTP_STATUS.badGateway);
    expect(calls).toHaveLength(1);
  });

  it("R3.16 R3.17 a deal or a node with another seat to act than the hero's is a 502", async () => {
    expect(await statusOf(resolvePracticeNode(SPOT, DEAL_SEED, port(deal({ hero_position: "BTN" }), node())))).toBe(HTTP_STATUS.badGateway);
    expect(await statusOf(resolvePracticeNode(SPOT, DEAL_SEED, port(deal(), node({ to_act: "BTN" }))))).toBe(HTTP_STATUS.badGateway);
  });
});
