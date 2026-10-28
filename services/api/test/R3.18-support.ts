/**
 * Test data for the R3.18 policy tests (S27): one solver-query node with fold, call and raise and
 * a /v1/grade answer for the call, shaped like packages/contracts/src/solver-query.generated.ts.
 * The numbers are test data chosen so the call is the best action at zero loss; nothing here is
 * poker math (ADR 0004).
 */
import type { SqGrade, SqNode } from "../src/solver-query/client.js";

const SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const FREQS = [0.2, 0.5, 0.3];
const EVS = [0, 0.2, 0.2];
const LOSSES = [5, 0, 0];
const FLOOR_PCT_POT = 0.5;

/** A big blind facing an open: fold, call and raise, in record order. */
export function policyNode(): SqNode {
  return {
    solution_id: SOLUTION_ID,
    node_key: NODE_KEY,
    street: "preflop",
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    to_act: "BB",
    pot_cbb: 400,
    stacks_cbb: [9900, 9750],
    hand_space: "preflop_169",
    accuracy_pct_pot: null,
    floor_pct_pot: FLOOR_PCT_POT,
    spot_class_key: "preflop/online/100/facing-open/BB-BTN",
    action_family: "facing-open",
    actions: [
      { index: 0, token: "f", kind: "fold", size_cbb: 0, bucket: null, label: "f", next_node_key: null },
      { index: 1, token: "c", kind: "call", size_cbb: 250, bucket: null, label: "c", next_node_key: null },
      { index: 2, token: "r1000", kind: "raise", size_cbb: 1000, bucket: "overbet-large", label: "r1000", next_node_key: null },
    ],
    hands: [],
    range_summary: { oop: { combos: 1, reach_weighted_combos: 1 }, ip: { combos: 1, reach_weighted_combos: 1 }, by_action: [] },
    noise_flags: [],
    synthetic: true,
  };
}

/** The grade of the call (index 1) with the given noise flags. */
export function flaggedGrade(noiseFlags: SqGrade["noise_flags"]): SqGrade {
  return {
    solution_id: SOLUTION_ID,
    node_key: NODE_KEY,
    hand: "AhKd",
    action_index: 1,
    reference: null,
    ev_by_action: EVS,
    freq_by_action: FREQS,
    best_action_index: 1,
    ev_chosen_bb: 0.2,
    ev_best_bb: 0.2,
    loss_bb: 0,
    loss_pct_pot: 0,
    loss_pct_pot_by_action: LOSSES,
    floor_pct_pot: FLOOR_PCT_POT,
    floor_source: "fallback_bb",
    bucket: null,
    noise_flags: noiseFlags,
    difficulty_features: { ev_gap_pct_pot: 0, purity: 1, n_actions: 3, mixed: false, all_within_floor: false },
  };
}
