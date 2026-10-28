/**
 * The range-paint prompt derivation (R3.17, O-302) over a stub solver port: it is a function of the
 * session seed, counter and stored spots, and refuses a solver-query answer it cannot paint with a
 * 502 upstream problem rather than serving a prompt the grader would refuse.
 */
import { describe, expect, it } from "vitest";

import { ProblemError } from "../src/http/problem.js";
import { derivePaintPrompt, paintCounter, type PaintSession } from "../src/range-paint/prompt.js";
import type { SqDeal, SqNode } from "../src/solver-query/client.js";
import type { SolverPort } from "../src/sessions/solver-port.js";
import { initialState, type HeroSpot } from "../src/sessions/state.js";

const SOLUTION = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const SPOT: HeroSpot = {
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  line: "r250",
  hero_seat: "BB",
  history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
};
const SESSION_SPOT = { preflop_action: ["vs_open" as const], hands: { mode: "all" as const }, alternate_seats: false };

function session(counter = 0): PaintSession {
  const state = initialState("00000000deadbeef", [SPOT], SESSION_SPOT, { practice: "range_paint" });
  return { id: "01a180ad-7838-7c4b-80c3-8700e77e58da", stateVersion: 3, state: { ...state, practice: { kind: "range_paint", counter, data: {} } } };
}

function deal(overrides: Partial<SqDeal> = {}): SqDeal {
  return {
    deal_id: "deal",
    solution_ids: [SOLUTION],
    start_node_key: NODE_KEY,
    hero_position: "BB",
    villain_position: "BTN",
    hero_hand: "QsQc",
    villain_hand: "7d2c",
    ...overrides,
  } as SqDeal;
}

function node(overrides: Partial<SqNode> = {}): SqNode {
  return {
    solution_id: SOLUTION,
    node_key: NODE_KEY,
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    street: "preflop",
    to_act: "BB",
    hand_space: "preflop_169",
    pot_cbb: 400,
    stacks_cbb: [9900, 9750],
    floor_pct_pot: 0.5,
    noise_flags: [],
    synthetic: true,
    spot_class_key: "preflop/online/100/facing-open/BB-BTN",
    actions: [{ index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null }],
    hands: [{ hand: "AA", ev_bb: [0], ev_best_bb: 0, loss_pct_pot: [0], mixed: false, strategy: [1] }],
    range_summary: {} as SqNode["range_summary"],
    ...overrides,
  } as SqNode;
}

function port(dealt: SqDeal, read: SqNode, calls: string[] = []): SolverPort {
  const refuse = (): never => {
    throw new Error("not used by the derivation");
  };
  return {
    deal: (filter, seed) => {
      calls.push(`deal ${filter.line ?? ""} ${seed}`);
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

async function problemOf(run: Promise<unknown>): Promise<ProblemError> {
  const error: unknown = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProblemError)) {
    throw new Error("expected a problem");
  }
  return error;
}

describe("R3.17 derivePaintPrompt", () => {
  it("R3.17 builds the prompt from the stored spot, the deal and the node read", async () => {
    const prompt = await derivePaintPrompt(session(2), port(deal(), node()));
    expect(prompt).toEqual({
      session_id: "01a180ad-7838-7c4b-80c3-8700e77e58da",
      state_version: 3,
      prompt_no: 2,
      solution_id: SOLUTION,
      node_key: NODE_KEY,
      spot_class_key: "preflop/online/100/facing-open/BB-BTN",
      hero_position: "BB",
      history: SPOT.history,
      actions: [{ index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null }],
      hands: ["AA"],
      synthetic: true,
    });
  });

  it("R3.17 the same counter draws the same deal seed and another counter a different one", async () => {
    const first: string[] = [];
    const again: string[] = [];
    const later: string[] = [];
    await derivePaintPrompt(session(0), port(deal(), node(), first));
    await derivePaintPrompt(session(0), port(deal(), node(), again));
    await derivePaintPrompt(session(1), port(deal(), node(), later));
    expect(again).toEqual(first);
    expect(later[0]).not.toEqual(first[0]);
  });

  it("R3.17 a deal without a solution or with another seat to act is a 502", async () => {
    const noSolution = await problemOf(derivePaintPrompt(session(), port(deal({ solution_ids: [] }), node())));
    const otherSeat = await problemOf(derivePaintPrompt(session(), port(deal({ hero_position: "BTN" }), node())));
    expect([noSolution.status, otherSeat.status]).toEqual([502, 502]);
  });

  it("R3.17 a node without the hero to act, a combo space, no rows or no spot class is a 502", async () => {
    const unpaintable = [
      node({ to_act: "BTN" }),
      node({ hand_space: "postflop_1326" }),
      node({ hands: [] }),
      node({ spot_class_key: null }),
    ];
    for (const read of unpaintable) {
      expect((await problemOf(derivePaintPrompt(session(), port(deal(), read)))).status).toBe(502);
    }
  });

  it("R3.17 a state without range-painting state is a 500", () => {
    const drillState = initialState("00000000deadbeef", [SPOT], SESSION_SPOT);
    expect(() => paintCounter(drillState)).toThrow(ProblemError);
  });
});
