/**
 * The prompt derivation over an in-memory solver-query port (R3.6, A6 section 2, O-245): the
 * postflop paths the machine supports for v1.5 data (reveal to the hero, reveal to the opponent),
 * street mode stopping at the street's end, and the upstream answers the derivation refuses.
 */
import { describe, expect, it } from "vitest";

import { cardsOf, deriveAwaitHero, MAX_DERIVATION_STEPS } from "../src/sessions/derive.js";
import type { SolverPort } from "../src/sessions/solver-port.js";
import type { HandState, PersistedState } from "../src/sessions/state.js";
import type { SqNode } from "../src/solver-query/client.js";

const SOLUTION = "0190f000-0000-7000-8000-00000000501a";
const FLOP_KEY = "cfg_6_online_100/BB-BTN/r250.c/";
const FLOP_BET_KEY = "cfg_6_online_100/BB-BTN/r250.c/b100";

function node(key: string, street: string, toAct: string, tokens: string[], next: (string | null)[]): SqNode {
  return {
    solution_id: SOLUTION,
    node_key: key,
    street,
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    to_act: toAct,
    pot_cbb: 550,
    stacks_cbb: [9750, 9750],
    hand_space: "postflop_1326",
    floor_pct_pot: 0.2,
    actions: tokens.map((token, index) => ({
      index,
      token,
      kind: token === "x" ? "check" : "bet",
      size_cbb: 0,
      bucket: null,
      label: token,
      next_node_key: next[index] ?? null,
    })),
    hands: [],
    range_summary: { oop: { combos: 1, reach_weighted_combos: 1 }, ip: { combos: 1, reach_weighted_combos: 1 }, by_action: [] },
    noise_flags: [],
    synthetic: true,
  };
}

interface PortSetup {
  nodes: Record<string, SqNode>;
  sampleIndex?: number;
  board?: string;
  solutionIds?: string[];
}

function port(setup: PortSetup): SolverPort & { deals: number } {
  const calls = { deals: 0 };
  return Object.assign(calls, {
    deal: () => {
      calls.deals += 1;
      return Promise.resolve({
        deal_id: "0190f000-0000-7000-8000-0000000d0001",
        solution_ids: setup.solutionIds ?? [SOLUTION],
        start_node_key: "cfg_6_online_100/BB-BTN/",
        hero_position: "BTN",
        villain_position: "BB",
        hero_hand: "AhKd",
        villain_hand: "QsQc",
        revealed: {},
      });
    },
    nodeForHand: (_solution: string, key: string) => Promise.resolve(setup.nodes[key]),
    sample: () => Promise.resolve({ action_index: setup.sampleIndex ?? 0, token: "x", roll: 0.5, rng_state: "0000000000000002" }),
    reveal: () => Promise.resolve({ deal_id: "d", street: "flop", cards: [], board: setup.board ?? "3cKh4c" }),
    grade: () => Promise.reject(new Error("not used")),
    coverage: () => Promise.reject(new Error("not used")),
  });
}

const HAND: HandState = {
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  deal_seed: "0000000000000001",
  deal_id: "0190f000-0000-7000-8000-0000000d0001",
  solution_id: SOLUTION,
  hero_position: "BTN",
  villain_position: "BB",
  hero_hand: "AhKd",
  villain_hand: "QsQc",
  street: "preflop",
  node_key: FLOP_KEY,
  end: null,
  last_action_kind: "call",
  history: [{ position: "BTN", token: "r250", label: "r250" }, { position: "BB", token: "c", label: "c" }],
  board: [],
  opponent_rng_state: "0000000000000001",
  roll_rng_state: "0000000000000001",
};

function feedbackState(hand: Partial<HandState> = {}): PersistedState {
  return {
    phase: "feedback",
    seed: "00000000deadbeef",
    hand_no: 0,
    candidates: [{ config_id: "cfg_6_online_100", pair: "BB-BTN" }],
    line: null,
    hand: { ...HAND, ...hand },
    previous_board: null,
    last_attempt_id: null,
  };
}

const FULL = { stopRule: "end_of_hand", rng: false } as const;

describe("R3.6 prompt derivation", () => {
  it("R3.6 a next node on a later street closes the street, reveals it, and the hero acts there (v1.5)", async () => {
    const solver = port({ nodes: { [FLOP_KEY]: node(FLOP_KEY, "flop", "BTN", ["x", "b100"], [null, FLOP_BET_KEY]) } });
    const derived = await deriveAwaitHero(feedbackState(), FULL, solver);
    expect(derived.state.phase).toBe("await_hero");
    expect(derived.hand).toMatchObject({ street: "flop", board: ["3c", "Kh", "4c"], node_key: FLOP_KEY, end: null });
    expect(derived.node.node_key).toBe(FLOP_KEY);
    expect(solver.deals).toBe(1);
  });

  it("R3.6 after a reveal the opponent may act first, then the hero (v1.5)", async () => {
    const solver = port({
      nodes: {
        [FLOP_KEY]: node(FLOP_KEY, "flop", "BB", ["x", "b100"], [FLOP_BET_KEY, FLOP_BET_KEY]),
        [FLOP_BET_KEY]: node(FLOP_BET_KEY, "flop", "BTN", ["f", "c"], [null, null]),
      },
    });
    const hand = { ...HAND, street: "flop" as const, board: ["3c", "Kh", "4c"], end: "street_closed" as const };
    const state = { ...feedbackState(), phase: "street_end" as const, hand: { ...hand, street: "preflop" as const, board: [] } };
    const derived = await deriveAwaitHero(state, FULL, solver);
    expect(derived.hand.history.at(-1)).toEqual({ position: "BB", token: "x", label: "x" });
    expect(derived.node.node_key).toBe(FLOP_BET_KEY);
    expect(derived.hand.opponent_rng_state).toBe("0000000000000002");
  });

  it("R3.6 street mode deals the next hand instead of revealing", async () => {
    const solver = port({
      nodes: {
        [FLOP_KEY]: node(FLOP_KEY, "flop", "BTN", ["x"], [null]),
        "cfg_6_online_100/BB-BTN/": node("cfg_6_online_100/BB-BTN/", "preflop", "BTN", ["f", "r250"], [null, "x"]),
      },
    });
    const derived = await deriveAwaitHero(feedbackState(), { stopRule: "end_of_street", rng: true }, solver);
    expect(derived.state.hand_no).toBe(1);
    expect(derived.hand.history).toEqual([]);
    expect(derived.roll?.roll).toBeGreaterThanOrEqual(1);
  });

  it("R3.6 refuses upstream answers it cannot follow with a 502", async () => {
    const sampledMissing = port({ nodes: { [FLOP_KEY]: node(FLOP_KEY, "preflop", "BB", ["x"], [null]) }, sampleIndex: 5 });
    await expect(deriveAwaitHero(feedbackState(), FULL, sampledMissing)).rejects.toMatchObject({ status: 502 });
    const noSolution = port({ nodes: {}, solutionIds: [] });
    await expect(deriveAwaitHero({ ...feedbackState(), phase: "dealing", hand: null }, FULL, noSolution)).rejects.toMatchObject({ status: 502 });
    const villainAtHeroTurn = port({ nodes: { "cfg_6_online_100/BB-BTN/": node("cfg_6_online_100/BB-BTN/", "preflop", "BB", ["x"], [null]) } });
    await expect(deriveAwaitHero({ ...feedbackState(), phase: "dealing", hand: null }, FULL, villainAtHeroTurn)).rejects.toMatchObject({ status: 502 });
    const badBoard = port({ nodes: { [FLOP_KEY]: node(FLOP_KEY, "flop", "BTN", ["x"], [null]) }, board: "3cK" });
    await expect(deriveAwaitHero(feedbackState(), FULL, badBoard)).rejects.toMatchObject({ status: 502 });
  });

  it("R3.6 an ended session derives nothing (409 session-ended)", async () => {
    await expect(deriveAwaitHero({ ...feedbackState(), phase: "ended" }, FULL, port({ nodes: {} }))).rejects.toMatchObject({
      status: 409,
      slug: "session-ended",
    });
  });

  it("R3.6 cards parse from solver-query's text and the step bound is named", () => {
    expect(cardsOf("AhKd")).toEqual(["Ah", "Kd"]);
    expect(() => cardsOf("Ah1x")).toThrow();
    expect(MAX_DERIVATION_STEPS).toBeGreaterThan(10);
  });
});
