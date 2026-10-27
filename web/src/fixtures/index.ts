/**
 * Synthetic fixtures typed against the api contract (S24, O-38). Unit tests, the Playwright
 * mocked api (O-264) and the component gallery all read these, so the three never disagree on a
 * shape. Every number is generated from the hand's grid position by a fixed formula: nothing here
 * is a real solution and nothing comes from any reference tool (O-26). The strategies sum to 1
 * per hand and the EVs are monotone in hand strength only roughly, which is all a view needs.
 */
import type {
  DecisionFeedback,
  NodeAction,
  NodeHandRow,
  SessionInfo,
  StudyInsights,
  StudyNode,
  TrainerPrompt,
} from "../contracts.js";
import { GRID_SIZE, HAND_GRID } from "../poker/hands.js";

export const FIXTURE_USER_EMAIL = "owner@example.com";
export const FIXTURE_CSRF_TOKEN = "fixture-csrf-token-0001";
const FIXTURE_USER_ID = "00000000-0000-4000-8000-000000000001";
const FIXTURE_SOLUTION_ID = "00000000-0000-4000-8000-000000000002";
const FIXTURE_SESSION_ID = "00000000-0000-4000-8000-000000000003";
const FIXTURE_ATTEMPT_ID = "00000000-0000-4000-8000-000000000004";

export const fixtureSession: SessionInfo = {
  user: { id: FIXTURE_USER_ID, email: FIXTURE_USER_EMAIL, created_at: "2026-10-27T12:00:00Z" },
  csrf_token: FIXTURE_CSRF_TOKEN,
  expires_at: "2026-11-03T12:00:00Z",
};

/** Four preflop actions at a button open: fold, call, raise to 2.5bb, all-in for 100bb. */
export const fixtureActions: readonly NodeAction[] = [
  { index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold" },
  { index: 1, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call" },
  { index: 2, token: "r250", kind: "raise", size_cbb: 250, bucket: "pot", label: "Raise to 2.5bb" },
  { index: 3, token: "r10000", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "All-in 100bb" },
];

const STRENGTH_SCALE = 2 * (GRID_SIZE - 1);
const EV_SPAN_BB = 3;
const FOLD_EV_BB = 0;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** A synthetic hand row: strength falls with the grid distance from AA. */
export function fixtureHandRow(hand: string, row: number, col: number): NodeHandRow {
  const strength = 1 - (row + col) / STRENGTH_SCALE;
  const allIn = round(row === col && row < 2 ? 0.2 : 0);
  const raise = round(Math.max(0, Math.min(1 - allIn, strength * 1.4 - 0.25)));
  const call = round(Math.max(0, Math.min(1 - raise - allIn, 0.3 - Math.abs(strength - 0.5) * 0.6)));
  const fold = round(Math.max(0, 1 - raise - allIn - call));
  const evRaise = round((strength - 0.35) * EV_SPAN_BB);
  const evCall = round((strength - 0.45) * EV_SPAN_BB * 0.8);
  const evAllIn = round((strength - 0.6) * EV_SPAN_BB * 2);
  const ev = [FOLD_EV_BB, evCall, evRaise, evAllIn];
  const best = Math.max(...ev);
  return {
    hand,
    strategy: [fold, call, raise, allIn],
    ev_bb: ev,
    ev_best_bb: best,
    loss_pct_pot: ev.map((value) => round(((best - value) / 1.5) * 100, 2)),
    reach: [round(0.2 + strength * 0.8)],
  };
}

export const fixtureStudyNode: StudyNode = {
  solution_id: FIXTURE_SOLUTION_ID,
  node_key: "synthetic:btn-open",
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  street: "preflop",
  to_act: "BTN",
  pot_cbb: 150,
  stacks_cbb: [10000, 10000, 10000, 10000, 9950, 9900],
  floor_pct_pot: 0.2,
  spot_class_key: "synthetic-rfi-btn",
  actions: [...fixtureActions],
  hands: HAND_GRID.map((cell) => fixtureHandRow(cell.hand, cell.row, cell.col)),
  noise_flags: [],
  next_likely_line: "r250",
};

export const fixtureInsights: StudyInsights = {
  threshold_card: {
    raise: { weakest_hand: "K9o", frequency: 0.52 },
    fold: { strongest_hand: "Q8o", frequency: 0.61 },
    hero: { hand: "AJo", position: "above the raise threshold" },
  },
  equity_distribution: {},
  range_advantage: {},
  nut_advantage: {},
  blockers: {},
  hand_role: "value",
  noise_flags: ["close_ev_mix"],
};

export const fixturePrompt: TrainerPrompt = {
  session_id: FIXTURE_SESSION_ID,
  state: "await_hero",
  state_version: 3,
  hero_position: "BTN",
  hero_hand: ["Ah", "Jd"],
  board: [],
  pot_cbb: 150,
  stacks_cbb: [10000, 10000, 10000, 10000, 9950, 9900],
  history: [
    { position: "UTG", token: "f", label: "Fold" },
    { position: "HJ", token: "f", label: "Fold" },
    { position: "CO", token: "f", label: "Fold" },
  ],
  buttons: [...fixtureActions],
  visible_panels: ["hero_range_matrix", "action_frequency_table", "threshold_card"],
};

export const fixtureFeedback: DecisionFeedback = {
  attempt_id: FIXTURE_ATTEMPT_ID,
  label: "inaccuracy",
  score: 0.84,
  ev_loss_bb: 0.011,
  ev_loss_pct_pot: 0.73,
  best_action_indexes: [2],
  freq_by_action: [0.05, 0.1, 0.8, 0.05],
  ev_by_action: [0, 0.52, 0.62, -0.4],
  rated: true,
  rng_roll: 37,
  state_version: 4,
};
