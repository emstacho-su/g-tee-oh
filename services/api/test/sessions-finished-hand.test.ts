/**
 * The forward run to the hand's end (R3.13, S40, O-400) over an in-memory solver-query port.
 * deriveFinishedHand takes the decided state (phase feedback) through the steps GET /next would
 * take and stops on the edge into hand_end, before the next hand is dealt: the finished hand with
 * the end its edge names, or null when the hero acts again in the same hand. It writes nothing and
 * returns no state, so the stored opponent and roll generator states are untouched, and what it
 * returns is exactly the previous_hand the next derivation carries.
 */
import { describe, expect, it } from "vitest";

import { deriveAwaitHero, deriveFinishedHand, stateAfterHeroAction, type DeriveSettings } from "../src/sessions/derive.js";
import type { SolverPort } from "../src/sessions/solver-port.js";
import type { HandState, PersistedState } from "../src/sessions/state.js";
import type { SqNode } from "../src/solver-query/client.js";

const SOLUTION = "0190f000-0000-7000-8000-00000000501a";
const ROOT_KEY = "cfg_6_online_100/BB-BTN/";
const OPEN_KEY = "cfg_6_online_100/BB-BTN/r250";
const THREE_BET_KEY = "cfg_6_online_100/BB-BTN/r250.r900";
const SPOT = "after_action";
const STREET = "end_of_street";
const FULL = "end_of_hand";

type Token = "f" | "c" | "r250" | "r900";

function node(key: string, toAct: string, tokens: readonly Token[], next: readonly (string | null)[]): SqNode {
  return {
    solution_id: SOLUTION,
    node_key: key,
    street: "preflop",
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    to_act: toAct,
    pot_cbb: 350,
    stacks_cbb: [9750, 9750],
    hand_space: "preflop_169",
    floor_pct_pot: 0.2,
    actions: tokens.map((token, index) => ({
      index,
      token,
      kind: token === "f" ? "fold" : token === "c" ? "call" : "raise",
      size_cbb: 0,
      bucket: null,
      label: token,
      next_node_key: next[index] ?? null,
    })),
    hands: [{ hand: "AKo", strategy: tokens.map(() => 1 / tokens.length), loss_pct_pot: tokens.map(() => 0), ev_bb: tokens.map(() => 0), ev_best_bb: 0, mixed: true }],
    range_summary: { oop: { combos: 1, reach_weighted_combos: 1 }, ip: { combos: 1, reach_weighted_combos: 1 }, by_action: [] },
    noise_flags: [],
    synthetic: true,
  };
}

/** BTN opens at the root; BB folds, calls (closing the street) or 3-bets; BTN answers a 3-bet. */
const NODES: Readonly<Record<string, SqNode>> = {
  [ROOT_KEY]: node(ROOT_KEY, "BTN", ["f", "r250"], [null, OPEN_KEY]),
  [OPEN_KEY]: node(OPEN_KEY, "BB", ["f", "c", "r900"], [null, null, THREE_BET_KEY]),
  [THREE_BET_KEY]: node(THREE_BET_KEY, "BTN", ["f", "c"], [null, null]),
};

interface Calls {
  readonly paths: string[];
}

function port(sampleIndex: number): SolverPort & Calls {
  const paths: string[] = [];
  return {
    paths,
    deal: () => {
      paths.push("deal");
      return Promise.resolve({
        deal_id: "0190f000-0000-7000-8000-0000000d0002",
        solution_ids: [SOLUTION],
        start_node_key: ROOT_KEY,
        hero_position: "BTN",
        villain_position: "BB",
        hero_hand: "QhQd",
        villain_hand: "7s7c",
        revealed: {},
      });
    },
    node: (_solution: string, key: string) => Promise.resolve(NODES[key] ?? Promise.reject(new Error(`no node ${key}`))),
    nodeForHand: (_solution: string, key: string) => {
      paths.push(`node:${key}`);
      return Promise.resolve(NODES[key]);
    },
    sample: () => {
      paths.push("sample");
      return Promise.resolve({ action_index: sampleIndex, token: "x", roll: 0.5, rng_state: "00000000000000ff" });
    },
    reveal: () => {
      paths.push("reveal");
      return Promise.resolve({ deal_id: "d", street: "flop", cards: [], board: "3cKh4c" });
    },
    grade: () => Promise.reject(new Error("not used")),
    coverage: () => Promise.reject(new Error("not used")),
    gradeRange: () => Promise.reject(new Error("not used")),
  };
}

const HAND: HandState = {
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  line: null,
  deal_seed: "0000000000000001",
  deal_id: "0190f000-0000-7000-8000-0000000d0001",
  solution_id: SOLUTION,
  hero_position: "BTN",
  villain_position: "BB",
  hero_hand: "AhKd",
  villain_hand: "QsQc",
  street: "preflop",
  node_key: ROOT_KEY,
  end: null,
  last_action_kind: null,
  history: [],
  board: [],
  opponent_rng_state: "0000000000000001",
  roll_rng_state: "0000000000000001",
};

const STATE: PersistedState = {
  phase: "await_hero",
  seed: "00000000deadbeef",
  hand_no: 3,
  spots: [{ config_id: "cfg_6_online_100", pair: "BB-BTN", line: null, hero_seat: "BTN", history: [] }],
  spot: { preflop_action: ["rfi"], hands: { mode: "all" }, alternate_seats: false },
  hand: HAND,
  previous_board: null,
  last_attempt_id: null,
};

function settings(stopRule: DeriveSettings["stopRule"]): DeriveSettings {
  return { stopRule, rng: false };
}

/** The decided state after the hero takes `token` at the hand's node, as POST decisions builds it. */
async function decided(stopRule: DeriveSettings["stopRule"], token: Token, hand: Partial<HandState> = {}): Promise<PersistedState> {
  const state = { ...STATE, hand: { ...HAND, ...hand } };
  const derived = await deriveAwaitHero(state, settings(stopRule), port(0));
  const action = derived.node.actions.find((candidate) => candidate.token === token);
  if (action === undefined) throw new Error(`no action ${token}`);
  return stateAfterHeroAction(derived, action, stopRule);
}

describe("R3.13 the forward run to the hand's end (O-400)", () => {
  it("R3.13 spot mode ends every hand at the decision with stop_rule and reads nothing", async () => {
    const solver = port(0);
    const finished = await deriveFinishedHand(await decided(SPOT, "r250"), settings(SPOT), solver);
    expect(finished).toEqual({
      previous: { hand_no: 3, history: [{ position: "BTN", token: "r250", label: "r250", street: "preflop" }], board: [], end: "stop_rule" },
      heroPosition: "BTN",
      heroHand: "AhKd",
    });
    expect(solver.paths).toEqual([]);
  });

  it("R3.13 the hero's fold ends the hand with fold and reads nothing", async () => {
    const solver = port(0);
    const finished = await deriveFinishedHand(await decided(STREET, "f"), settings(STREET), solver);
    expect(finished?.previous.end).toBe("fold");
    expect(solver.paths).toEqual([]);
  });

  it("R3.13 street mode: the opponent's fold after the hero's open ends the hand with the fold in its history", async () => {
    const solver = port(0);
    const finished = await deriveFinishedHand(await decided(STREET, "r250"), settings(STREET), solver);
    expect(finished?.previous).toEqual({
      hand_no: 3,
      history: [
        { position: "BTN", token: "r250", label: "r250", street: "preflop" },
        { position: "BB", token: "f", label: "f", street: "preflop" },
      ],
      board: [],
      end: "fold",
    });
    expect(solver.paths).toEqual([`node:${OPEN_KEY}`, "sample"]);
  });

  it("R3.13 street mode: the opponent's call closes the street and ends the hand", async () => {
    const finished = await deriveFinishedHand(await decided(STREET, "r250"), settings(STREET), port(1));
    expect(finished?.previous).toMatchObject({ end: "street_closed", board: [] });
  });

  it("R3.13 full-hand mode: the call closes the street, the flop is revealed and the hand ends there (v1)", async () => {
    const solver = port(1);
    const finished = await deriveFinishedHand(await decided(FULL, "r250"), settings(FULL), solver);
    expect(finished?.previous).toMatchObject({ end: "street_closed", board: ["3c", "Kh", "4c"] });
    // Review round 1 E: exactly the reads the hand's end needs, one sample, and the reveal for its
    // board; nothing of the next hand (no root node, no second deal).
    expect(solver.paths).toEqual([`node:${OPEN_KEY}`, "sample", "deal", "reveal"]);
  });

  it("R3.13 the hero acts again in the same hand (facing a 3-bet): null after one sample and the hero's node, no deal", async () => {
    const solver = port(2);
    expect(await deriveFinishedHand(await decided(FULL, "r250"), settings(FULL), solver)).toBeNull();
    expect(solver.paths).toEqual([`node:${OPEN_KEY}`, "sample", `node:${THREE_BET_KEY}`]);
  });

  it("R3.13 street mode: the opponent's call ends the hand after one read and one sample (review round 1 E)", async () => {
    const solver = port(1);
    await deriveFinishedHand(await decided(STREET, "r250"), settings(STREET), solver);
    expect(solver.paths).toEqual([`node:${OPEN_KEY}`, "sample"]);
  });

  it("R3.13 the run changes nothing: the decided state keeps its generator states and phase", async () => {
    const state = await decided(STREET, "r250");
    const before = structuredClone(state);
    await deriveFinishedHand(state, settings(STREET), port(0));
    expect(state).toEqual(before);
  });

  it.each([
    ["spot", SPOT, 0],
    ["street, opponent folds", STREET, 0],
    ["street, opponent calls", STREET, 1],
    ["full hand, opponent calls", FULL, 1],
  ] as const)("R3.13 %s: the finished hand equals the previous_hand the next derivation carries", async (_name, stopRule, sample) => {
    const state = await decided(stopRule, "r250");
    const finished = await deriveFinishedHand(state, settings(stopRule), port(sample));
    const next = await deriveAwaitHero(state, settings(stopRule), port(sample));
    expect(finished?.previous).toEqual(next.state.previous_hand);
    expect(next.state.hand_no).toBe(4);
  });
});
