/**
 * Synthetic drill, session, prompt, feedback and recap fixtures for S25's trainer tests, the
 * mocked api and the shots (R3.13, R3.10, O-26, O-264). Typed against the contract, so a
 * contract change is a type error here before it is a wrong picture.
 *
 * Shape: one synthetic drill (online 6-max at 100bb, grouping grouped, stop rule after_action, RNG
 * mode, the wire's rng, off by default) and a cycle of three hands. Each hand is a prompt with its
 * roll left null (the mocked api fills the roll only when the session has Mixed-frequency mode on),
 * the roll the mode would show, and the feedback for that hand, with followed_roll null; the mocked
 * api fills it from fixtureFollowedRoll when it serves a roll (O-371). The frequencies are invented;
 * each hand's best_action_indexes is its highest-EV action (ADR 0024), whatever the roll.
 * fixtureRngPrompt and fixturePlainPrompt are the first hand with and without its roll.
 *
 * S26 (R3.13, R3.14, O-312 to O-314) adds a street-mode drill (end_of_street, pause after_mistake,
 * speed fast), a full-hand drill (end_of_hand, pause every_action), a partly covered drill, the
 * coverage answers, and two street hands. A street hand is the hero's first decision, the
 * opponents' answer the mocked api appends to the history before the hero's second decision, the
 * second decision (facing a three-bet), the opponent's closing call after a four-bet, and the flop
 * a full hand reveals.
 */
import { followsRoll } from "@g-tee-oh/learning";

import type {
  DecisionFeedback,
  Grouping,
  NodeAction,
  TrainerPrompt,
  TrainerSettings,
} from "../contracts.js";
import { positionOfIndex } from "../poker/action-index.js";
import { toGradeActions } from "../poker/grade-actions.js";
import type { Drill, PracticeSession, SessionCoverage, SessionRecap } from "../trainer/session-types.js";
import { fixtureActions, fixtureFeedback, fixturePrompt } from "./index.js";

export const FIXTURE_DRILL_ID = "00000000-0000-4000-8000-000000000010";
/** A drill whose spots the library does not cover: POST /sessions answers 422 no-coverage. */
export const FIXTURE_UNCOVERED_DRILL_ID = "00000000-0000-4000-8000-000000000011";
/** A drill in street mode (end_of_street): two hero decisions per hand (S26, R3.13). */
export const FIXTURE_STREET_DRILL_ID = "00000000-0000-4000-8000-000000000012";
/** A drill in full-hand mode (end_of_hand): the hand ends when the flop is dealt in v1. */
export const FIXTURE_FULL_HAND_DRILL_ID = "00000000-0000-4000-8000-000000000013";
/** A drill the library covers in part: the session runs, and the rest is queued (O-312). */
export const FIXTURE_PART_COVERED_DRILL_ID = "00000000-0000-4000-8000-000000000014";
export const FIXTURE_SEED = "0123456789abcdef";
const FIXTURE_TIME = "2026-10-27T12:00:00Z";
const FIXTURE_ENDED_TIME = "2026-10-27T12:20:00Z";

export const fixtureTrainerSettings: TrainerSettings = {
  stop_rule: "after_action",
  input: "actions",
  grouping: "grouped",
  rng: false,
  pause: "every_action",
  speed: "normal",
  quick_result: false,
  tables: 1,
  timebank_s: null,
  panels: { action_frequency_table: true, threshold_card: true, rng_roller: true },
};

export const fixtureDrill: Drill = {
  id: FIXTURE_DRILL_ID,
  name: "Button opens, online 6-max 100bb (synthetic)",
  tags: ["synthetic"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BTN"],
    villain_positions: ["BB"],
    preflop_action: ["rfi"],
    hands: { mode: "all" },
    alternate_seats: false,
  },
  trainer: fixtureTrainerSettings,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

export const fixturePracticeSession: PracticeSession = {
  session_id: fixturePrompt.session_id,
  mode: "drill",
  drill_id: FIXTURE_DRILL_ID,
  state: "await_hero",
  state_version: fixturePrompt.state_version,
  started_at: FIXTURE_TIME,
  rated_eligible: false,
  // The fixture drill grades with grouped grouping (fixtureDrill.trainer.grouping).
  grouping: "grouped",
  automated: null,
  holdout: null,
};

/** The big blind facing a button open: fold, call, three-bet to 9bb, all-in. */
const BB_VERSUS_OPEN_ACTIONS: readonly NodeAction[] = [
  { index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null },
  { index: 1, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call", next_node_key: null },
  { index: 2, token: "r900", kind: "raise", size_cbb: 900, bucket: "pot", label: "Raise to 9bb", next_node_key: null },
  { index: 3, token: "r10000", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "All-in 100bb", next_node_key: null },
];

export interface FixtureHand {
  /** The prompt with rng_roll null; the roll is added when the session has Mixed-frequency mode on. */
  readonly prompt: TrainerPrompt;
  /** The roll Mixed-frequency mode shows before the decision (1 to 100). */
  readonly roll: number;
  /** The feedback for this hand; rng_roll is null here and set by whoever serves it with RNG on. */
  readonly feedback: DecisionFeedback;
}

const BUTTON_OPEN: FixtureHand = {
  prompt: { ...fixturePrompt, rng_roll: null },
  roll: 37,
  feedback: { ...fixtureFeedback, rng_roll: null, followed_roll: null },
};

const CUTOFF_OPEN: FixtureHand = {
  prompt: {
    ...fixturePrompt,
    hero_position: "CO",
    hero_hand: ["Ks", "Qs"],
    history: [
      { position: "UTG", token: "f", label: "Fold" },
      { position: "HJ", token: "f", label: "Fold" },
    ],
  },
  roll: 82,
  feedback: {
    ...fixtureFeedback,
    label: "best",
    score: 1,
    ev_loss_bb: 0,
    ev_loss_pct_pot: 0,
    freq_by_action: [0.3, 0, 0.7, 0],
    ev_by_action: [0, -0.2, 0.41, -1.1],
    best_action_indexes: [2],
    node_key: "cfg_6_online_100/CO-BB/",
    pair: "CO-BB",
    hand: "KQs",
    rng_roll: null,
    followed_roll: null,
  },
};

const BIG_BLIND_DEFENSE: FixtureHand = {
  prompt: {
    ...fixturePrompt,
    hero_position: "BB",
    hero_hand: ["9h", "8h"],
    pot_cbb: 400,
    stacks_cbb: [10000, 10000, 10000, 9750, 10000, 9900],
    history: [
      { position: "UTG", token: "f", label: "Fold" },
      { position: "HJ", token: "f", label: "Fold" },
      { position: "CO", token: "f", label: "Fold" },
      { position: "BTN", token: "r250", label: "Raise to 2.5bb" },
      { position: "SB", token: "f", label: "Fold" },
    ],
    buttons: [...BB_VERSUS_OPEN_ACTIONS],
  },
  roll: 64,
  feedback: {
    ...fixtureFeedback,
    label: "mistake",
    score: 0.42,
    ev_loss_bb: 0.18,
    ev_loss_pct_pot: 4.5,
    freq_by_action: [0.45, 0.4, 0.15, 0],
    ev_by_action: [0, 0.02, -0.05, -2.4],
    best_action_indexes: [1],
    node_key: "cfg_6_online_100/BB-BTN/r250",
    hand: "98s",
    rng_roll: null,
    followed_roll: null,
  },
};

/** The hands a fixture session deals, in order, then again from the first. */
export const fixtureTrainerHands: readonly FixtureHand[] = [BUTTON_OPEN, CUTOFF_OPEN, BIG_BLIND_DEFENSE];

/**
 * The followed-the-roll mark a mocked api reports for a choice (ADR 0024 rule 2, O-371): learning's
 * followsRoll over the prompt's buttons, the hand's frequencies and the roll, with the chosen
 * NodeAction.index taken to its record position (O-198); null without a roll or for an index the
 * prompt does not offer. The fixture hands are preflop, where Standard and Grouped both key exact
 * actions, so the mocks pass the session's grouping or Standard.
 */
export function fixtureFollowedRoll(
  prompt: TrainerPrompt,
  feedback: DecisionFeedback,
  actionIndex: number,
  roll: number | null,
  grouping: Grouping = "standard",
): boolean | null {
  const position = positionOfIndex(prompt.buttons, actionIndex);
  if (roll === null || position === undefined) return null;
  return followsRoll({
    freqByAction: feedback.freq_by_action,
    actions: toGradeActions(prompt.buttons),
    grouping,
    street: prompt.street,
    roll,
    actionIndex: position,
  });
}

/** The first hand as Mixed-frequency mode serves it: the roll is shown before the decision (O-282). */
export const fixtureRngPrompt: TrainerPrompt = { ...BUTTON_OPEN.prompt, rng_roll: BUTTON_OPEN.roll };
/** The first hand with the mode off. */
export const fixturePlainPrompt: TrainerPrompt = BUTTON_OPEN.prompt;
/**
 * The first hand's feedback with the mode on, after the hero raised: roll 37 falls in the raise band,
 * so the hero followed the roll (O-371).
 */
export const fixtureRngFeedback: DecisionFeedback = { ...BUTTON_OPEN.feedback, rng_roll: BUTTON_OPEN.roll, followed_roll: true };
/** The first hand's feedback with Mixed-frequency mode off. */
export const fixturePlainFeedback: DecisionFeedback = BUTTON_OPEN.feedback;

export const fixtureRecap: SessionRecap = {
  session_id: fixturePrompt.session_id,
  ended_at: FIXTURE_ENDED_TIME,
  decisions: 3,
  rated_decisions: 3,
  mean_score: 0.75,
  ev_loss_bb_total: 0.19,
  rating_changes: [],
  tier: null,
  unlocks: [],
};

/** The NodeAction rows of the first hand, for tests that pick a button by its index (O-198). */
export const fixtureTrainerActions: readonly NodeAction[] = fixtureActions;

/** Street mode: a reveal pauses only after an inaccuracy, a mistake or a blunder (O-314). */
export const fixtureStreetDrill: Drill = {
  ...fixtureDrill,
  id: FIXTURE_STREET_DRILL_ID,
  name: "Opens and three-bets, street mode (synthetic)",
  trainer: { ...fixtureTrainerSettings, stop_rule: "end_of_street", pause: "after_mistake", speed: "fast" },
};

/** Full-hand mode: every reveal pauses; in v1 the hand ends when the flop is dealt (O-314). */
export const fixtureFullHandDrill: Drill = {
  ...fixtureDrill,
  id: FIXTURE_FULL_HAND_DRILL_ID,
  name: "Opens to the flop, full-hand mode (synthetic)",
  trainer: { ...fixtureTrainerSettings, stop_rule: "end_of_hand", pause: "every_action" },
};

/** Spot mode over a filter the library covers in part (O-312). */
export const fixturePartCoveredDrill: Drill = {
  ...fixtureDrill,
  id: FIXTURE_PART_COVERED_DRILL_ID,
  name: "Late-position opens, partly covered (synthetic)",
  spot_filter: { ...fixtureDrill.spot_filter, hero_positions: ["CO", "BTN", "SB"] },
};

/** Every pair the drill reaches is covered. */
export const fixtureFullCoverage: SessionCoverage = { pairs_total: 1, pairs_covered: 1, pairs_queued: 0 };
/** Two of three pairs covered; the third was queued for the builder. */
export const fixturePartCoverage: SessionCoverage = { pairs_total: 3, pairs_covered: 2, pairs_queued: 1 };

export type FixtureHistoryEntry = TrainerPrompt["history"][number];

/** The hero facing a three-bet to 9bb: fold, call, four-bet to 22bb, all-in. */
const FACING_THREE_BET_ACTIONS: readonly NodeAction[] = [
  { index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null },
  { index: 1, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call", next_node_key: null },
  { index: 2, token: "r2200", kind: "raise", size_cbb: 2200, bucket: "pot", label: "Raise to 22bb", next_node_key: null },
  { index: 3, token: "r10000", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "All-in 100bb", next_node_key: null },
];

const BIG_BLIND_THREE_BET: FixtureHistoryEntry = { position: "BB", token: "r900", label: "Raise to 9bb" };
const BIG_BLIND_CALL: FixtureHistoryEntry = { position: "BB", token: "c", label: "Call" };
const FACING_THREE_BET_POT_CBB = 1150;
/** The second decision's hand_decision_no: the hero's second decision in the hand (O-335). */
const SECOND_DECISION_NO = 2;

export interface FixtureStreetHand {
  /** The hero's first decision. */
  readonly first: FixtureHand;
  /** The opponents' answer to the hero's open, appended before the second decision. */
  readonly answer: readonly FixtureHistoryEntry[];
  /** The second decision; its history shows the hero's best first action (the mock puts in the chosen one). */
  readonly second: FixtureHand;
  /** The opponent's call that closes the street after a four-bet. */
  readonly closing: FixtureHistoryEntry;
  /** The flop a full hand reveals when the street closes (v1 ends the hand there). */
  readonly flop: readonly string[];
}

/** The hero's history entry for an action of a prompt. */
export function heroEntry(prompt: TrainerPrompt, action: NodeAction): FixtureHistoryEntry {
  return { position: prompt.hero_position, token: action.token, label: action.label };
}

function secondDecision(first: FixtureHand, answer: readonly FixtureHistoryEntry[], feedback: Partial<DecisionFeedback>): FixtureHand {
  const open = first.prompt.buttons.find((button) => button.index === first.feedback.best_action_indexes[0]);
  if (open === undefined) throw new RangeError("a fixture hand's best action names no button");
  return {
    prompt: {
      ...first.prompt,
      history: [...first.prompt.history, heroEntry(first.prompt, open), ...answer],
      hand_decision_no: SECOND_DECISION_NO,
      pot_cbb: FACING_THREE_BET_POT_CBB,
      buttons: [...FACING_THREE_BET_ACTIONS],
    },
    roll: 58,
    feedback: {
      ...first.feedback,
      label: "mistake",
      score: 0.38,
      ev_loss_bb: 0.42,
      ev_loss_pct_pot: 3.65,
      freq_by_action: [0.2, 0.6, 0.2, 0],
      ev_by_action: [0, 0.35, 0.12, -1.8],
      best_action_indexes: [1],
      ...feedback,
    },
  };
}

const BUTTON_ANSWER: readonly FixtureHistoryEntry[] = [{ position: "SB", token: "f", label: "Fold" }, BIG_BLIND_THREE_BET];
const CUTOFF_ANSWER: readonly FixtureHistoryEntry[] = [
  { position: "BTN", token: "f", label: "Fold" },
  { position: "SB", token: "f", label: "Fold" },
  BIG_BLIND_THREE_BET,
];

/** The hands a street or full-hand session deals, in order, then again from the first. */
export const fixtureStreetHands: readonly FixtureStreetHand[] = [
  {
    first: BUTTON_OPEN,
    answer: BUTTON_ANSWER,
    second: secondDecision(BUTTON_OPEN, BUTTON_ANSWER, { node_key: "cfg_6_online_100/BTN-BB/r250-r900" }),
    closing: BIG_BLIND_CALL,
    flop: ["Qs", "7c", "2d"],
  },
  {
    first: CUTOFF_OPEN,
    answer: CUTOFF_ANSWER,
    second: secondDecision(CUTOFF_OPEN, CUTOFF_ANSWER, { node_key: "cfg_6_online_100/CO-BB/r250-r900" }),
    closing: BIG_BLIND_CALL,
    flop: ["Jh", "Td", "4s"],
  },
];
