/**
 * Synthetic catalog and study fixtures for S25's study screen tests, the mocked api and the shots
 * (R3.12, O-26, O-57, O-264). Typed against the contract; no number comes from a real solution.
 *
 * Mechanism: three stakes, three configurations (the online 6-max set at 100 bb and 200 bb, and a
 * live 9-handed one), pairs per configuration with some not preflop_available, and a two-node line
 * in cfg_6_online_100 BB-BTN: the root (the shared fixtureStudyNode with its actions given child
 * keys) and the child one step down the next likely line (r250). The child's hand rows reuse
 * fixtureHandRow shifted three grid steps towards weaker hands, so the two matrices look
 * different. FIXTURE_STUDY_LINES maps (config, pair, line) to a node, which is how the mocked
 * api answers GET /study/node; fixtureInsightsFor builds a hand's insights from the shared
 * fixtureInsights. Every node is synthetic: true, so the O-57 banner always shows.
 */
import type { NodeAction, StudyInsights, StudyNode } from "../contracts.js";
import type { GameConfig, PositionPairEntry, Stake } from "../study/queries.js";
import { GRID_SIZE, HAND_GRID } from "../poker/hands.js";
import { fixtureActions, fixtureHandRow, fixtureInsights, fixtureStudyNode } from "./index.js";

export const FIXTURE_ONLINE_STAKE_ID = "00000000-0000-4000-8000-0000000000a1";
export const FIXTURE_LIVE_STAKE_ID = "00000000-0000-4000-8000-0000000000a2";
const FIXTURE_LIVE_25_STAKE_ID = "00000000-0000-4000-8000-0000000000a3";
const FIXTURE_DEEP_SOLUTION_ID = "00000000-0000-4000-8000-0000000000b2";

export const FIXTURE_STUDY_CONFIG_ID = "cfg_6_online_100";
export const FIXTURE_DEEP_CONFIG_ID = "cfg_6_online_200";
export const FIXTURE_LIVE_CONFIG_ID = "cfg_9_live_13_100";
export const FIXTURE_STUDY_PAIR = "BB-BTN";
/** The root's next likely line: one step down the tree. */
export const FIXTURE_CHILD_LINE = "r250";
/** A hand the mocked insights route answers with hand-not-in-range (S23 problem type). */
export const FIXTURE_OUT_OF_RANGE_HAND = "72o";

const CBB_100 = 10_000;
const CBB_200 = 20_000;
/** How many grid steps the child's synthetic rows shift towards weaker hands. */
const CHILD_STRENGTH_SHIFT = 3;

export const fixtureStakes: readonly Stake[] = [
  {
    id: FIXTURE_ONLINE_STAKE_ID,
    format: "online",
    label: "online",
    bb_cents: 50,
    rake_percent_bp: 500,
    rake_cap_cents: 150,
    no_flop_no_drop: false,
    note: null,
  },
  {
    id: FIXTURE_LIVE_STAKE_ID,
    format: "live",
    label: "1/3",
    bb_cents: 300,
    rake_percent_bp: 1000,
    rake_cap_cents: 500,
    no_flop_no_drop: true,
    note: null,
  },
  {
    id: FIXTURE_LIVE_25_STAKE_ID,
    format: "live",
    label: "2/5",
    bb_cents: 500,
    rake_percent_bp: 1000,
    rake_cap_cents: 500,
    no_flop_no_drop: true,
    note: "synthetic note",
  },
];

function onlineConfig(configId: string, depthCbb: number): GameConfig {
  return {
    config_id: configId,
    format: "online",
    table_size: 6,
    stake_id: FIXTURE_ONLINE_STAKE_ID,
    stake_label: "online",
    depth_cbb: depthCbb,
    straddle: false,
    ante_cbb: 0,
  };
}

export const fixtureConfigs: readonly GameConfig[] = [
  onlineConfig(FIXTURE_STUDY_CONFIG_ID, CBB_100),
  onlineConfig(FIXTURE_DEEP_CONFIG_ID, CBB_200),
  {
    config_id: FIXTURE_LIVE_CONFIG_ID,
    format: "live",
    table_size: 9,
    stake_id: FIXTURE_LIVE_STAKE_ID,
    stake_label: "1/3",
    depth_cbb: CBB_100,
    straddle: false,
    ante_cbb: 0,
  },
];

function pairEntry(oop: PositionPairEntry["oop"], ip: PositionPairEntry["ip"], available: boolean): PositionPairEntry {
  return { pair: `${oop}-${ip}`, oop, ip, preflop_available: available };
}

export const fixturePairsByConfig: Readonly<Record<string, readonly PositionPairEntry[]>> = {
  [FIXTURE_STUDY_CONFIG_ID]: [
    pairEntry("BB", "BTN", true),
    pairEntry("SB", "BTN", true),
    pairEntry("CO", "BTN", false),
    pairEntry("UTG", "HJ", false),
  ],
  [FIXTURE_DEEP_CONFIG_ID]: [pairEntry("BB", "BTN", true), pairEntry("SB", "BB", false)],
  [FIXTURE_LIVE_CONFIG_ID]: [pairEntry("BB", "BTN", true)],
};

function rootKey(configId: string, pair: string): string {
  return `${configId}/${pair}/`;
}

function childKey(configId: string, pair: string, line: string): string {
  return `${rootKey(configId, pair)}${line}`;
}

/** The root's actions: fold ends the line, the others lead on (O-280). */
function rootActions(configId: string, pair: string): NodeAction[] {
  return fixtureActions.map((action) =>
    action.kind === "fold" ? { ...action } : { ...action, next_node_key: childKey(configId, pair, action.token) },
  );
}

/** The child's actions after the open: fold, call and all-in end the line, the three-bet leads on. */
const childActions: readonly NodeAction[] = [
  { index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null },
  { index: 1, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call", next_node_key: null },
  {
    index: 2,
    token: "r1100",
    kind: "raise",
    size_cbb: 1100,
    bucket: "pot",
    label: "Raise to 11bb",
    next_node_key: childKey(FIXTURE_STUDY_CONFIG_ID, FIXTURE_STUDY_PAIR, `${FIXTURE_CHILD_LINE}.r1100`),
  },
  { index: 3, token: "r10000", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "All-in 100bb", next_node_key: null },
];

function shifted(value: number): number {
  return Math.min(GRID_SIZE - 1, value + CHILD_STRENGTH_SHIFT);
}

export const fixtureRootNode: StudyNode = {
  ...fixtureStudyNode,
  node_key: rootKey(FIXTURE_STUDY_CONFIG_ID, FIXTURE_STUDY_PAIR),
  actions: rootActions(FIXTURE_STUDY_CONFIG_ID, FIXTURE_STUDY_PAIR),
  next_likely_line: FIXTURE_CHILD_LINE,
  next_likely_node_key: childKey(FIXTURE_STUDY_CONFIG_ID, FIXTURE_STUDY_PAIR, FIXTURE_CHILD_LINE),
};

export const fixtureChildNode: StudyNode = {
  ...fixtureStudyNode,
  node_key: childKey(FIXTURE_STUDY_CONFIG_ID, FIXTURE_STUDY_PAIR, FIXTURE_CHILD_LINE),
  to_act: "BB",
  pot_cbb: 400,
  stacks_cbb: [10000, 10000, 10000, 10000, 9950, 9750],
  actions: [...childActions],
  hands: HAND_GRID.map((cell) => fixtureHandRow(cell.hand, shifted(cell.row), shifted(cell.col))),
  noise_flags: ["close_ev_mix"],
  // The likeliest answer to the open is a fold, which ends the line, so nothing is next.
  next_likely_line: null,
  next_likely_node_key: null,
  range_by_action: [
    { index: 0, share: 0.62 },
    { index: 1, share: 0.27 },
    { index: 2, share: 0.1 },
    { index: 3, share: 0.01 },
  ],
};

/** The deeper configuration's root: the same synthetic shape under its own ids. */
export const fixtureDeepRootNode: StudyNode = {
  ...fixtureRootNode,
  solution_id: FIXTURE_DEEP_SOLUTION_ID,
  config_id: FIXTURE_DEEP_CONFIG_ID,
  node_key: rootKey(FIXTURE_DEEP_CONFIG_ID, FIXTURE_STUDY_PAIR),
  actions: rootActions(FIXTURE_DEEP_CONFIG_ID, FIXTURE_STUDY_PAIR),
  next_likely_line: null,
  next_likely_node_key: null,
};

export interface FixtureStudyLine {
  readonly configId: string;
  readonly pair: string;
  /** "" is the root. */
  readonly line: string;
  readonly node: StudyNode;
}

export const FIXTURE_STUDY_LINES: readonly FixtureStudyLine[] = [
  { configId: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_STUDY_PAIR, line: "", node: fixtureRootNode },
  { configId: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_STUDY_PAIR, line: FIXTURE_CHILD_LINE, node: fixtureChildNode },
  { configId: FIXTURE_DEEP_CONFIG_ID, pair: FIXTURE_STUDY_PAIR, line: "", node: fixtureDeepRootNode },
];

/** The fixture node at (config, pair, line), or undefined when the fixtures hold none. */
export function findFixtureNode(configId: string, pair: string, line: string): StudyNode | undefined {
  return FIXTURE_STUDY_LINES.find((entry) => entry.configId === configId && entry.pair === pair && entry.line === line)?.node;
}

/** The shared synthetic insights, relabeled for one hand. */
export function fixtureInsightsFor(hand: string): StudyInsights {
  const card = fixtureInsights.threshold_card;
  return {
    ...fixtureInsights,
    threshold_card: card === null ? null : { ...card, hand_position: { ...card.hand_position, hand } },
    blockers: { ...fixtureInsights.blockers, hand },
  };
}
