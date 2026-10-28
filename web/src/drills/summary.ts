/**
 * One line that says what spots a drill draws (S26, R3.14), for the library list and the builder
 * header: the game, the seats, the preflop actions and the hands, in plain words. Pure. Flow 2
 * compares an imported drill's line with its source's, so the line depends on the spot filter
 * only, never on the name or the id.
 */
import { FORMAT_LABELS, HANDS_MODE_LABELS, PREFLOP_ACTION_SHORT, STREET_LABELS } from "./labels.js";
import type { SpotFilter } from "./types.js";

const ANY_OPPONENT = "any opponent";

function handsText(filter: SpotFilter): string {
  if (filter.hands.mode !== "manual") return HANDS_MODE_LABELS[filter.hands.mode].toLowerCase();
  const count = filter.hands.hands.length;
  return `${count} chosen ${count === 1 ? "hand" : "hands"}`;
}

export function spotSummary(filter: SpotFilter): string {
  const { format, table_size: size, depths_bb: depths } = filter.game_config;
  const villains = filter.villain_positions.length === 0 ? ANY_OPPONENT : filter.villain_positions.join(", ");
  const street = filter.start_street === "preflop" ? "" : `, from the ${STREET_LABELS[filter.start_street].toLowerCase()}`;
  return [
    `${FORMAT_LABELS[format]} ${size}-handed, ${depths.join(", ")} bb, stake ${filter.stake}`,
    `hero ${filter.hero_positions.join(", ")} against ${villains}`,
    `${filter.preflop_action.map((action) => PREFLOP_ACTION_SHORT[action]).join(", ")}${street}`,
    handsText(filter),
  ].join("; ");
}
