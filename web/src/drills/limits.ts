/**
 * The drill schema's limits and value lists, named once for the builder, its client validation
 * and the mocked api (S26, R3.14). Each mirrors services/api/src/schemas/drills.ts,
 * spot-filter-rules.ts, catalog/seats.ts or drills/export-code.ts; the api checks every write again,
 * so a drift here shows as a server field error next to the field, never as a bad stored drill.
 */
import type { PanelKey, Position, PreflopAction, StartStreet, Timebank } from "./types.js";

export const MAX_DRILL_NAME_LENGTH = 120;
export const MAX_TAGS = 20;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const MAX_DEPTHS = 8;
export const MIN_DEPTH_BB = 1;
export const MAX_DEPTH_BB = 1000;
export const MAX_POSITIONS = 9;
export const MAX_HANDS = 169;
export const MAX_FLOPS = 200;
export const MIN_TABLES = 1;
export const MAX_TABLES = 4;
export const MAX_STAKE_LABEL_LENGTH = 32;
export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 9;
/** The table sizes the builder offers first (6-max and full ring); a stored size outside is kept. */
export const OFFERED_TABLE_SIZES: readonly number[] = [6, 7, 8, 9];
export const TIMEBANK_CHOICES: readonly Timebank[] = [null, 7, 15, 25];
export const MAX_EXPORT_CODE_LENGTH = 8192;
/** The export code's version prefix (O-310); the import dialog names it in its hint. */
export const EXPORT_CODE_PREFIX = "gteeoh1.";

/** The suffix a duplicate's name carries (O-311). */
export const COPY_SUFFIX = " (copy)";

export const ONLINE_STAKE_LABEL = "online";
export const LIVE_STAKE_LABEL_PATTERN = /^[0-9]+\/[0-9]+$/;
export const LINE_PATTERN = /^[a-z][0-9]*(\.[a-z][0-9]*)*$/;
export const FLOP_PATTERN = /^([2-9TJQKA][cdhs]){3}$/;
export const HAND_CLASS_PATTERN = /^(([2-9TJQKA])\2|[2-9TJQKA]{2}[so])$/;

export const STREETS: readonly StartStreet[] = ["preflop", "flop", "turn", "river"];

export const PREFLOP_ACTIONS: readonly PreflopAction[] = [
  "rfi",
  "vs_open",
  "srp",
  "three_bet",
  "vs_three_bet",
  "four_bet",
  "squeeze",
  "limp_iso",
  "straddle",
];

/** Panel keys named after the A7 components (O-235), in the schema's order. */
export const PANEL_KEYS: readonly PanelKey[] = [
  "hero_range_matrix",
  "villain_range_matrix",
  "equity_distribution_chart",
  "range_advantage",
  "hand_class",
  "action_frequency_table",
  "made_hand_breakdown",
  "draw_breakdown",
  "threshold_card",
  "hero_strategy_matrix",
  "rng_roller",
  "streak_counter",
];

/** Position::seated by table size (catalog/seats.ts, O-234), in gto-model's order. */
const SEATED: Readonly<Record<number, readonly Position[]>> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

/** The positions seated at a table size; none for a size outside 2 to 9. */
export function seatedPositions(tableSize: number): readonly Position[] {
  return SEATED[tableSize] ?? [];
}
