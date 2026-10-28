/**
 * Dealing a hand at a stored hero spot (R3.6, O-249, PR #25 re-review BLOCKER 2) over an in-memory
 * solver-query port: the deal starts at the hero's decision, so no opponent action is sampled
 * before it; a manual hands list refuses a deal with one call; a hand that exhausts its attempts
 * advances to the next hand number instead of a permanent 422; and after the bounded advance the
 * filter is relaxed for one hand, so a session never dies on its hands filter.
 */
import { describe, expect, it } from "vitest";

import { dealHand, MAX_DEAL_ATTEMPTS, MAX_HANDS_PER_DEAL } from "../src/sessions/deal-hand.js";
import { dealAttempts, handDraws } from "../src/sessions/randomness.js";
import type { SolverPort } from "../src/sessions/solver-port.js";
import type { PersistedState } from "../src/sessions/state.js";
import type { SqNode } from "../src/solver-query/client.js";

const SOLUTION = "0190f000-0000-7000-8000-00000000501a";
const SEED = "00000000deadbeef";
const ROOT = "cfg_6_online_100/BB-BTN/";
const PASSING = "AhKd";
const FAILING = "7c2d";

function rootNode(): SqNode {
  return {
    solution_id: SOLUTION,
    node_key: ROOT,
    street: "preflop",
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    to_act: "BTN",
    pot_cbb: 150,
    stacks_cbb: [9900, 10000],
    hand_space: "preflop_169",
    floor_pct_pot: 0.5,
    action_family: "rfi",
    actions: [{ index: 0, token: "f", kind: "fold", size_cbb: 0, bucket: null, label: "Fold", next_node_key: null }],
    hands: [{ hand: "AKo", strategy: [1], loss_pct_pot: [0], ev_bb: [0], ev_best_bb: 0 }],
    range_summary: { oop: { combos: 1, reach_weighted_combos: 1 }, ip: { combos: 1, reach_weighted_combos: 1 }, by_action: [] },
    noise_flags: [],
    synthetic: true,
  };
}

interface Counting extends SolverPort {
  calls: Record<string, number>;
}

/** A port dealing `combo(seed)` to BTN at the root; counts every call. */
function port(combo: (seed: string) => string): Counting {
  const calls: Record<string, number> = { deal: 0, node: 0, sample: 0 };
  const bump = (name: string): void => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  return {
    calls,
    deal: (_filter, seed) => {
      bump("deal");
      return Promise.resolve({
        deal_id: "0190f000-0000-7000-8000-0000000d0001",
        solution_ids: [SOLUTION],
        start_node_key: ROOT,
        hero_position: "BTN",
        villain_position: "BB",
        hero_hand: combo(seed),
        villain_hand: "QsQc",
        revealed: {},
      });
    },
    node: () => Promise.reject(new Error("not used")),
    nodeForHand: () => {
      bump("node");
      return Promise.resolve(rootNode());
    },
    sample: () => {
      bump("sample");
      return Promise.reject(new Error("no walk before the hero"));
    },
    reveal: () => Promise.reject(new Error("not used")),
    grade: () => Promise.reject(new Error("not used")),
    coverage: () => Promise.reject(new Error("not used")),
  };
}

function state(handNo = 0): PersistedState {
  return {
    phase: "dealing",
    seed: SEED,
    hand_no: handNo,
    spots: [{ config_id: "cfg_6_online_100", pair: "BB-BTN", line: null, hero_seat: "BTN", history: [] }],
    spot: { preflop_action: ["rfi"], hands: { mode: "manual", hands: ["AKo"] }, alternate_seats: false },
    hand: null,
    previous_board: null,
    last_attempt_id: null,
  };
}

/** The deal seeds hand `handNo` tries, in order. */
function seedsOfHand(handNo: number): Set<string> {
  const seeds = new Set<string>();
  for (const draws of dealAttempts(handDraws(SEED, handNo))) {
    if (seeds.size === MAX_DEAL_ATTEMPTS) {
      break;
    }
    seeds.add(draws.dealSeed);
  }
  return seeds;
}

describe("R3.6 dealing at a stored hero spot", () => {
  it("R3.6 the deal starts at the hero's decision: one deal, one node read, no sampled action", async () => {
    const solver = port(() => PASSING);
    const dealt = await dealHand(state(), solver);
    expect(dealt.handNo).toBe(0);
    expect(dealt.hand).toMatchObject({ hero_position: "BTN", hero_hand: PASSING, node_key: ROOT, line: null, history: [] });
    expect(solver.calls).toEqual({ deal: 1, node: 1, sample: 0 });
  });

  it("R3.6 a manual list refuses a deal with that one deal call, before any node read", async () => {
    const solver = port((seed) => (seed === handDraws(SEED, 0).dealSeed ? FAILING : PASSING));
    await dealHand(state(), solver);
    expect(solver.calls).toEqual({ deal: 2, node: 1, sample: 0 });
  });

  it("R3.6 a hand that exhausts its attempts advances to the next hand number, not a 422", async () => {
    const failing = seedsOfHand(0);
    const solver = port((seed) => (failing.has(seed) ? FAILING : PASSING));
    const dealt = await dealHand(state(), solver);
    expect(dealt.handNo).toBe(1);
    expect(dealt.hand.hero_hand).toBe(PASSING);
    expect(solver.calls.deal).toBe(MAX_DEAL_ATTEMPTS + 1);
  });

  it("R3.6 after the bounded advance the filter is relaxed for one hand, so the session never dies", async () => {
    const solver = port(() => FAILING);
    const dealt = await dealHand(state(), solver);
    expect(dealt.handNo).toBe(MAX_HANDS_PER_DEAL - 1);
    expect(dealt.hand.hero_hand).toBe(FAILING);
  });
});
