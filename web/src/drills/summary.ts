/**
 * One line that says what spots a drill draws (S26, R3.14), for the library list and the builder
 * header: the game, the seats, the preflop actions and the hands. Pure. Flow 2 compares an imported
 * drill's line with its source's, so the line depends on the spot filter only, never on the name or
 * the id. S47 adds spotWords, the same line in the shared spot vocabulary, which the screens show
 * with the token line as a tooltip; amounts write as "100bb" (O-500).
 */
import { drillActionWords, positionWords } from "../progress/spot-words.js";
import { FORMAT_LABELS, HANDS_MODE_LABELS, PREFLOP_ACTION_SHORT, STREET_LABELS, stakeWords } from "./labels.js";
import type { Position, PreflopAction, SpotFilter } from "./types.js";

const ANY_OPPONENT = "any opponent";

function handsText(filter: SpotFilter): string {
  if (filter.hands.mode !== "manual") return HANDS_MODE_LABELS[filter.hands.mode].toLowerCase();
  const count = filter.hands.hands.length;
  return `${count} chosen ${count === 1 ? "hand" : "hands"}`;
}

function streetText(filter: SpotFilter): string {
  return filter.start_street === "preflop" ? "" : `, from the ${STREET_LABELS[filter.start_street].toLowerCase()}`;
}

/** How a line names a seat and a preflop action: tokens (spotSummary) or words (spotWords). */
interface LineWords {
  readonly seat: (seat: Position) => string;
  readonly action: (action: PreflopAction) => string;
}

/** The one line both forms share: the game, the seats, the actions and the hands. */
function summaryLine(filter: SpotFilter, words: LineWords): string {
  const { format, table_size: size, depths_bb: depths } = filter.game_config;
  const seats = (list: readonly Position[]) => list.map(words.seat).join(", ");
  const villains = filter.villain_positions.length === 0 ? ANY_OPPONENT : seats(filter.villain_positions);
  return [
    `${FORMAT_LABELS[format]} ${size}-handed, ${depths.map((depth) => `${depth}bb`).join(", ")}, stake ${stakeWords(filter.stake, format)}`,
    `hero ${seats(filter.hero_positions)} against ${villains}`,
    `${filter.preflop_action.map(words.action).join(", ")}${streetText(filter)}`,
    handsText(filter),
  ].join("; ");
}

const TOKENS: LineWords = { seat: (seat) => seat, action: (action) => PREFLOP_ACTION_SHORT[action] };
const WORDS: LineWords = { seat: positionWords, action: drillActionWords };

/** The compact token line: seats and action tokens, as the export round trip compares (flow 2). */
export function spotSummary(filter: SpotFilter): string {
  return summaryLine(filter, TOKENS);
}

/**
 * The same line in words (S47 critic, R3.14, design rule 4): seats and the pot type through the
 * shared spot vocabulary (progress/spot-words.ts), for the library's Spot column and the builder
 * header, with spotSummary as the tooltip.
 */
export function spotWords(filter: SpotFilter): string {
  return summaryLine(filter, WORDS);
}
