/**
 * Synthetic fixtures of GET /progress/frequencies typed against the api contract (S41, R4.12,
 * O-353, O-417, O-26). The card's tests, the Playwright mocked api (e2e/support/mock-progress.ts)
 * and the shots read these, so they agree on every shape.
 *
 * Mechanism: a seasoned learner has two spots, most played first: the big blind facing a button
 * open with 42 counted decisions (above the spot minimum of 30, so it carries the pooled comparison
 * and two hand rows above the hand minimum of 10, the largest gap first, as the api sorts them), and
 * the button's open with 12 (below the spot minimum, so no numbers). A fresh learner has none.
 * Every number is test data chosen here: nothing is a real solution and nothing comes from any
 * reference tool (O-26).
 */
import type { FrequencyComparison } from "../progress/frequency-model.js";

const MIN_SPOT_DECISIONS = 30;
const MIN_HAND_DECISIONS = 10;
const CONFIG_ID = "cfg_6_online_100";
const PAIR = "BB-BTN";
/** Each spot names the solution it was graded on (PR #39 review finding 6); synthetic ids. */
const FACING_OPEN_SOLUTION_ID = "00000000-0000-4000-8000-0000000f0001";
const OPEN_SOLUTION_ID = "00000000-0000-4000-8000-0000000f0002";

export const fixtureFrequencies: FrequencyComparison = {
  min_spot_decisions: MIN_SPOT_DECISIONS,
  min_hand_decisions: MIN_HAND_DECISIONS,
  spots: [
    {
      solution_id: FACING_OPEN_SOLUTION_ID,
      node_key: `${CONFIG_ID}/${PAIR}/r250`,
      spot_class_key: "preflop/online/100/facing-open/BB-BTN",
      config_id: CONFIG_ID,
      pair: PAIR,
      hero_position: "BB",
      action_family: "facing-open",
      decisions: 42,
      actions: [
        { index: 0, label: "Fold", kind: "fold" },
        { index: 1, label: "Call", kind: "call" },
        { index: 2, label: "Raise to 10bb", kind: "raise" },
      ],
      pooled: { your_freq: [0.4, 0.45, 0.15], solver_freq: [0.35, 0.42, 0.23] },
      hands: [
        { hand_class: "A5s", decisions: 12, your_freq: [0.5, 0.25, 0.25], solver_freq: [0.05, 0.2, 0.75] },
        { hand_class: "KTo", decisions: 11, your_freq: [0.6, 0.4, 0], solver_freq: [0.5, 0.45, 0.05] },
      ],
    },
    {
      solution_id: OPEN_SOLUTION_ID,
      node_key: `${CONFIG_ID}/${PAIR}/`,
      spot_class_key: "preflop/online/100/rfi/BB-BTN",
      config_id: CONFIG_ID,
      pair: PAIR,
      hero_position: "BTN",
      action_family: "rfi",
      decisions: 12,
      actions: [
        { index: 0, label: "Fold", kind: "fold" },
        { index: 1, label: "Raise to 2.5bb", kind: "raise" },
      ],
      pooled: null,
      hands: [],
    },
  ],
};

export const fixtureFreshFrequencies: FrequencyComparison = {
  min_spot_decisions: MIN_SPOT_DECISIONS,
  min_hand_decisions: MIN_HAND_DECISIONS,
  spots: [],
};
