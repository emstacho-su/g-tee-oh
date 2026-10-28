/**
 * The edits the builder form makes to a draft (S26, R3.14). Each takes a draft and returns a new
 * one; none mutates its input. The few that keep the draft consistent do so the way a user would
 * expect: changing the format resets a stake that no longer fits it, shrinking the table drops
 * seats it no longer has, and choosing a hero position removes it from the villains, so the
 * disjoint-seats rule (SpotFilterWrite) is rarely the one a user meets.
 */
import type { DrillDraft } from "./draft.js";
import { LIVE_STAKE_LABEL_PATTERN, MAX_TABLE_SIZE, ONLINE_STAKE_LABEL, PREFLOP_ACTIONS, seatedPositions } from "./limits.js";
import type { GameFormat, PanelKey, Position, PreflopAction, TrainerSettings } from "./types.js";
import { HAND_GRID } from "../poker/hands.js";

const POSITION_ORDER: readonly Position[] = seatedPositions(MAX_TABLE_SIZE);
const HAND_ORDER: readonly string[] = HAND_GRID.map((cell) => cell.hand);

/** The list with the value added or removed, kept in the reference order. */
export function toggledInOrder<T>(list: readonly T[], value: T, order: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  return [...next].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

export function withFormat(draft: DrillDraft, format: GameFormat): DrillDraft {
  const keeps = format === "online" ? draft.stake === ONLINE_STAKE_LABEL : LIVE_STAKE_LABEL_PATTERN.test(draft.stake);
  const stake = keeps ? draft.stake : format === "online" ? ONLINE_STAKE_LABEL : "";
  return { ...draft, format, stake };
}

export function withTableSize(draft: DrillDraft, tableSize: number): DrillDraft {
  const seated = seatedPositions(tableSize);
  return {
    ...draft,
    tableSize,
    heroPositions: draft.heroPositions.filter((position) => seated.includes(position)),
    villainPositions: draft.villainPositions.filter((position) => seated.includes(position)),
  };
}

export function toggleHero(draft: DrillDraft, position: Position): DrillDraft {
  const heroPositions = toggledInOrder(draft.heroPositions, position, POSITION_ORDER);
  const villainPositions = heroPositions.includes(position)
    ? draft.villainPositions.filter((entry) => entry !== position)
    : draft.villainPositions;
  return { ...draft, heroPositions, villainPositions };
}

export function toggleVillain(draft: DrillDraft, position: Position): DrillDraft {
  return { ...draft, villainPositions: toggledInOrder(draft.villainPositions, position, POSITION_ORDER) };
}

export function toggleAction(draft: DrillDraft, action: PreflopAction): DrillDraft {
  return { ...draft, preflopAction: toggledInOrder(draft.preflopAction, action, PREFLOP_ACTIONS) };
}

export function toggleHand(draft: DrillDraft, hand: string): DrillDraft {
  return { ...draft, manualHands: toggledInOrder(draft.manualHands, hand, HAND_ORDER) };
}

export function withManualHands(draft: DrillDraft, hands: readonly string[]): DrillDraft {
  return { ...draft, manualHands: HAND_ORDER.filter((hand) => hands.includes(hand)) };
}

export function withTrainer(draft: DrillDraft, change: Partial<TrainerSettings>): DrillDraft {
  return { ...draft, trainer: { ...draft.trainer, ...change } };
}

/** Turns a panel on, or off when it is on; an absent key counts as off. */
export function togglePanel(draft: DrillDraft, key: PanelKey): DrillDraft {
  const on = draft.trainer.panels[key] === true;
  return withTrainer(draft, { panels: { ...draft.trainer.panels, [key]: !on } });
}

