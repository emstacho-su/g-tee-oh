/**
 * Fixed grounding sources for the explanation tests (R3.19, R3.20): the attempt columns, node and
 * insights solver-query gives for the near-indifferent class 55 (dealt 5h5d) at the fixture node
 * cfg_6_online_100/BB-BTN/r250, copied from the fixture library's answers (validation/fixtures,
 * synthetic). The pure template and validator tests use them so a snapshot never depends on a
 * running service; the route tests read the same node live.
 */
import type { AttemptGroundingRow, GroundingSources } from "../../src/explain/grounding.js";
import type { SqInsights, SqNode } from "../../src/solver-query/client.js";

export const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
export const FIXTURE_NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
export const FIXTURE_CONFIG = "cfg_6_online_100";
export const FIXTURE_PAIR = "BB-BTN";

export const ATTEMPT_55: AttemptGroundingRow = {
  id: "0192a000-0000-7000-8000-000000000055",
  solution_id: FIXTURE_SOLUTION_ID,
  node_key: FIXTURE_NODE_KEY,
  hand: "5h5d",
  action_index: 0,
  ev_loss_bb: 0.6504,
  ev_loss_pct_pot: 16.26,
  best_action_indexes: [1],
  noise_flags: ["close_ev_mix"],
};

export const NODE_55: SqNode = {
  solution_id: FIXTURE_SOLUTION_ID,
  node_key: FIXTURE_NODE_KEY,
  street: "preflop",
  config_id: FIXTURE_CONFIG,
  pair: FIXTURE_PAIR,
  to_act: "BB",
  pot_cbb: 400,
  stacks_cbb: [9900, 9750],
  hand_space: "preflop_169",
  accuracy_pct_pot: null,
  floor_pct_pot: 0.5,
  action_family: "facing-open",
  spot_class_key: "preflop/online/100/facing-open/BB-BTN",
  actions: [
    { index: 0, token: "f", kind: "fold", size_cbb: 0, bucket: null, label: "Fold", next_node_key: null },
    { index: 1, token: "c", kind: "call", size_cbb: 250, bucket: null, label: "Call", next_node_key: null },
    {
      index: 2,
      token: "r1000",
      kind: "raise",
      size_cbb: 1000,
      bucket: "overbet-large",
      label: "Raise to 10bb",
      next_node_key: "cfg_6_online_100/BB-BTN/r250.r1000",
    },
  ],
  hands: [
    {
      hand: "55",
      reach: [1.0, 1.0],
      strategy: [0.0, 0.5019608, 0.49803922],
      ev_bb: [-0.00009091415, 0.6503091, 0.6483091],
      loss_pct_pot: [16.26, 0.0, 0.05],
      ev_best_bb: 0.6503091,
      mixed: true,
    },
  ],
  range_summary: {
    oop: { combos: 1326, reach_weighted_combos: 1326.0 },
    ip: { combos: 1326, reach_weighted_combos: 470.558 },
    by_action: [
      { index: 0, share: 0.7718274, combos: 363.2 },
      { index: 1, share: 0.09679118, combos: 45.5 },
      { index: 2, share: 0.13138142, combos: 61.8 },
    ],
  },
  noise_flags: [],
  synthetic: true,
};

export const INSIGHTS_55: SqInsights = {
  threshold_card: {
    actions: [{ index: 2, token: "r1000", weakest_hand_taking_half: "KTs", share_taking: 0.13138142 }],
    strongest_folding_hand: "44",
    hand_position: {
      hand: "5h5d",
      equity_vs_villain: 0.5162465,
      rank_in_range: 0.8687783,
      relative: [{ index: 2, position: "above" }],
    },
  },
  equity_distribution: {
    bin_edges: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    oop: [0.0, 0.0, 0.037906006, 0.6604601, 0.16525638, 0.0861992, 0.03787502, 0.008451433, 0.0038518743, 0.0],
    ip: [0.0, 0.0, 0.0, 0.0, 0.0, 0.60047436, 0.32302073, 0.051003274, 0.025501637, 0.0],
  },
  range_advantage: { oop_mean_equity: 0.39421502, ip_mean_equity: 0.605785, to_act_advantage_pct_points: -10.5785 },
  nut_advantage: { threshold_equity: 0.8, oop_share: 0.0038518743, ip_share: 0.025501637, to_act_advantage: -0.021649763 },
  blockers: {
    hand: "5h5d",
    villain_combos_removed: 21,
    villain_reach_removed_share: 0.036184326,
    top_blocked: [
      { hand: "A5o", reach_removed: 6.0 },
      { hand: "55", reach_removed: 5.0 },
      { hand: "K5o", reach_removed: 2.0268254 },
      { hand: "A5s", reach_removed: 2.0 },
      { hand: "K5s", reach_removed: 2.0 },
    ],
  },
  hand_role: "trap",
  noise_flags: ["close_ev_mix"],
};

export const SOURCES_55: GroundingSources = { attempt: ATTEMPT_55, node: NODE_55, insights: INSIGHTS_55 };

/** The same node with no insight cards beyond the blockers Rust always gives (the optional fields absent). */
export const SOURCES_55_BARE: GroundingSources = {
  attempt: { ...ATTEMPT_55, best_action_indexes: null },
  node: NODE_55,
  insights: { blockers: INSIGHTS_55.blockers, noise_flags: [] },
};
