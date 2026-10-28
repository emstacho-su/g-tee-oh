/**
 * More info templates (R3.19, O-309, 05 section 10.1, A6 section 5, ADR 0004, ADR 0016): five
 * pure functions over one grounding, each returning { template, title, text } in plain text, in
 * the order of 05 section 10.1 (strategy facts first, then range and nut advantage, hand role,
 * position and equity realization, blockers).
 *
 * Every number is a grounding value passed through format.ts (bb two decimals, percent one
 * decimal) and nothing else, so the number-membership test and the Ask validator accept every
 * template. The words carry no numerals of their own: "half" is written out, and a preflop node
 * gives position and realization as a sentence with no number because solver-query gives none.
 * Hand roles are Rust's (O-153); the sentence for each role is naming data.
 */
import { formatBb, formatPct } from "./format.js";
import type { Grounding } from "./grounding.js";

export const MORE_INFO_TEMPLATES = ["facts", "range_advantage", "hand_role", "position", "blockers"] as const;
export type MoreInfoTemplate = (typeof MORE_INFO_TEMPLATES)[number];

export interface MoreInfoSection {
  template: MoreInfoTemplate;
  title: string;
  text: string;
}

const PREFLOP = "preflop";
const LIST_SEPARATOR = ", ";
const NONE_LISTED = "none";
const PARAGRAPH = "\n\n";

/** Rust's hand roles (HandRole, O-153) in words. */
const ROLE_SENTENCES: Readonly<Record<string, string>> = {
  value: "a value hand: it wants to build the pot with worse hands calling",
  marginal: "a marginal hand: it can continue but gains little from a bigger pot",
  bluff: "a bluff: it bets to make better hands fold",
  fold: "a give-up hand: it does better folding than putting more chips in",
  trap: "a trap: a strong hand played passively to keep weaker hands in",
};

function percentOfShare(share: number): string {
  return `${formatPct(share, "share")}%`;
}

function list(items: readonly string[]): string {
  return items.length === 0 ? NONE_LISTED : items.join(LIST_SEPARATOR);
}

function thresholdSentences(grounding: Grounding): string {
  const threshold = grounding.threshold;
  if (threshold === null) {
    return "No threshold card is available for this hand at this node.";
  }
  const actions = threshold.actions.map((action) => {
    const weakest = action.weakest_hand_taking_half ?? "no hand";
    return `${action.label}: ${percentOfShare(action.share_taking)} of the range takes it, and the weakest hand taking it at least half the time is ${weakest}.`;
  });
  const relative = threshold.relative.map((entry) => `${entry.position} the ${entry.label} threshold`);
  const folding = threshold.strongest_folding_hand ?? "no hand";
  return [
    ...actions,
    `This hand sits ${list(relative)}. The strongest hand folding at least half the time is ${folding}.`,
    `Its equity against the opponent's range is ${percentOfShare(threshold.equity_vs_villain)}, and it ranks at ${percentOfShare(threshold.rank_in_range)} of its own range by equity.`,
  ].join(" ");
}

export function factsTemplate(grounding: Grounding): MoreInfoSection {
  const strategy = grounding.hand_strategy.map(
    (entry) => `${entry.label} ${percentOfShare(entry.frequency)} (EV ${formatBb(entry.ev_bb)} bb)`,
  );
  const shares = grounding.range_shares.map((entry) => `${entry.label} ${percentOfShare(entry.share)}`);
  const { chosen } = grounding;
  const hand = `${grounding.hand} (${grounding.hand_class}) as ${grounding.position}`;
  const paragraphs = [
    `The solver plays ${hand}: ${list(strategy)}. Best by EV: ${list(grounding.best_actions)}.`,
    `You chose ${chosen.label}, which loses ${formatBb(chosen.ev_loss_bb)} bb, ${formatPct(chosen.ev_loss_pct_pot, "percent")}% of the pot.`,
    `Across the whole range, ${grounding.position} plays ${list(shares)}.`,
    thresholdSentences(grounding),
  ];
  return { template: "facts", title: "The facts", text: paragraphs.join(PARAGRAPH) };
}

export function rangeAdvantageTemplate(grounding: Grounding): MoreInfoSection {
  const oop = grounding.out_of_position_seat;
  const ip = grounding.in_position_seat;
  const range = grounding.range_advantage;
  const nut = grounding.nut_advantage;
  const rangeText =
    range === null
      ? "No range advantage figure is available at this node."
      : `Mean equity of each range: ${oop} ${percentOfShare(range.oop_mean_equity)}, ${ip} ${percentOfShare(range.ip_mean_equity)}. The acting seat is ${formatPct(range.to_act_advantage_pct_points, "percent")} percentage points from an even split.`;
  const nutText =
    nut === null
      ? "No nut advantage figure is available at this node."
      : `Share of each range at or above ${percentOfShare(nut.threshold_equity)} equity: ${oop} ${percentOfShare(nut.oop_share)}, ${ip} ${percentOfShare(nut.ip_share)}; the acting seat's share minus the other's is ${formatPct(nut.to_act_advantage, "share")} percentage points.`;
  return { template: "range_advantage", title: "Range and nut advantage", text: [rangeText, nutText].join(PARAGRAPH) };
}

export function handRoleTemplate(grounding: Grounding): MoreInfoSection {
  const role = grounding.hand_role;
  const roleText =
    role === null
      ? "The solver gives no hand role for this hand at this node."
      : `The solver reads ${grounding.hand_class} here as ${ROLE_SENTENCES[role] ?? role}.`;
  const choice = `You chose ${grounding.chosen.label}; the best action by EV is ${list(grounding.best_actions)}.`;
  return { template: "hand_role", title: "Hand role", text: [roleText, choice].join(PARAGRAPH) };
}

export function positionTemplate(grounding: Grounding): MoreInfoSection {
  const outOfPosition = grounding.position === grounding.out_of_position_seat;
  const seat = `${grounding.position} acts here against ${grounding.opponent}`;
  const playsOn = outOfPosition
    ? `${grounding.position} plays the rest of the hand out of position, which tends to realize less of its equity.`
    : `${grounding.position} plays the rest of the hand in position, which tends to realize more of its equity.`;
  const realization =
    grounding.street === PREFLOP
      ? "The solver gives no equity realization figure preflop, so this is a sentence rather than a number."
      : "The stack-to-pot plan for the next street is not part of this explanation yet.";
  return {
    template: "position",
    title: "Position and equity realization",
    text: [`${seat}, ${grounding.street}.`, `${playsOn} ${realization}`].join(PARAGRAPH),
  };
}

export function blockersTemplate(grounding: Grounding): MoreInfoSection {
  const { blockers } = grounding;
  const removed = `${grounding.hand} removes ${blockers.villain_combos_removed} of the opponent's combos, ${percentOfShare(blockers.villain_reach_removed_share)} of its weighted range.`;
  const top = `Most blocked classes, most first: ${list(blockers.top_blocked)}.`;
  return { template: "blockers", title: "Blockers", text: [removed, top].join(PARAGRAPH) };
}

const RENDERERS: Readonly<Record<MoreInfoTemplate, (grounding: Grounding) => MoreInfoSection>> = {
  facts: factsTemplate,
  range_advantage: rangeAdvantageTemplate,
  hand_role: handRoleTemplate,
  position: positionTemplate,
  blockers: blockersTemplate,
};

/** The five sections in scaffold order (05 section 10.1). */
export function renderMoreInfo(grounding: Grounding): MoreInfoSection[] {
  return MORE_INFO_TEMPLATES.map((template) => RENDERERS[template](grounding));
}
