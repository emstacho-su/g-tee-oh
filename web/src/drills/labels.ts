/**
 * Plain words for every drill schema value the drill screens show (S26, R3.14, O-317). The stop
 * rule reads "Spot", "Street" and "Full hand", as the plan names them; each other value gets a
 * short label a player recognises. This is the one map for these values (PR #30 review LOW 10):
 * the library, the builder and the drill run's start panel all read it, one wording per value.
 * The V1_NOTES say which stored settings v1 does not serve yet
 * (O-317): the field stays editable so a drill round-trips, and the note says what v1 does.
 */
import type {
  BoardConnectivity,
  BoardSuits,
  GameFormat,
  Grouping,
  HandsMode,
  PanelKey,
  PauseRule,
  PreflopAction,
  Speed,
  StartStreet,
  StopRule,
  Timebank,
  TrainerInput,
} from "./types.js";

export const FORMAT_LABELS: Readonly<Record<GameFormat, string>> = { online: "Online", live: "Live" };

export const STREET_LABELS: Readonly<Record<StartStreet, string>> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

export const PREFLOP_ACTION_LABELS: Readonly<Record<PreflopAction, string>> = {
  rfi: "RFI (raise first in)",
  vs_open: "Facing an open",
  srp: "Single-raised pot",
  three_bet: "Three-bet",
  vs_three_bet: "Facing a three-bet",
  four_bet: "Four-bet",
  squeeze: "Squeeze",
  limp_iso: "Isolate a limper",
  straddle: "Straddle",
};

/** The short names the library's spot summary uses. */
export const PREFLOP_ACTION_SHORT: Readonly<Record<PreflopAction, string>> = {
  rfi: "RFI",
  vs_open: "vs open",
  srp: "single-raised",
  three_bet: "3-bet",
  vs_three_bet: "vs 3-bet",
  four_bet: "4-bet",
  squeeze: "squeeze",
  limp_iso: "limp iso",
  straddle: "straddle",
};

export const HANDS_MODE_LABELS: Readonly<Record<HandsMode, string>> = {
  all: "All hands",
  close_decisions: "Close decisions",
  manual: "Manual list",
};

export const STOP_RULE_LABELS: Readonly<Record<StopRule, string>> = {
  after_action: "Spot",
  end_of_street: "Street",
  end_of_hand: "Full hand",
};

export const STOP_RULE_HINTS: Readonly<Record<StopRule, string>> = {
  after_action: "One decision, then the next spot.",
  end_of_street: "Play on until the street closes.",
  end_of_hand: "Play the hand until it ends.",
};

export const INPUT_LABELS: Readonly<Record<TrainerInput, string>> = { actions: "Actions", frequency: "Frequencies" };

export const GROUPING_LABELS: Readonly<Record<Grouping, string>> = { standard: "Standard", grouped: "Grouped", simple: "Simple" };

export const PAUSE_LABELS: Readonly<Record<PauseRule, string>> = {
  every_action: "After every action",
  after_mistake: "After a mistake",
  never: "Never",
};

export const SPEED_LABELS: Readonly<Record<Speed, string>> = { slow: "Slow", normal: "Normal", fast: "Fast" };

export function timebankLabel(seconds: Timebank): string {
  return seconds === null ? "Off" : `${seconds} seconds`;
}

export const SUITS_LABELS: Readonly<Record<BoardSuits, string>> = { monotone: "Monotone", two_tone: "Two-tone", rainbow: "Rainbow" };

export const CONNECTIVITY_LABELS: Readonly<Record<BoardConnectivity, string>> = {
  connected: "Connected",
  gapped: "Gapped",
  disconnected: "Disconnected",
};

export const PANEL_LABELS: Readonly<Record<PanelKey, string>> = {
  hero_range_matrix: "Your range",
  villain_range_matrix: "Opponent's range",
  equity_distribution_chart: "Equity distribution",
  range_advantage: "Range advantage",
  hand_class: "Hand class",
  action_frequency_table: "Action frequencies",
  made_hand_breakdown: "Made hands",
  draw_breakdown: "Draws",
  threshold_card: "Threshold card",
  hero_strategy_matrix: "Your strategy",
  rng_roller: "RNG roller",
  streak_counter: "Streak counter",
};

/** What v1 serves, said next to a stored setting it does not serve yet (O-317). */
export const V1_NOTES = {
  street: "v1 serves preflop spots; this start street is kept with the drill.",
  board: "v1 serves preflop spots; a board filter is kept with the drill.",
  input: "v1 takes action input; frequency input is kept with the drill.",
  tables: "v1 plays one table; this count is kept with the drill.",
} as const;
