/**
 * What earns Best, and whether a decision followed the roll (ADR 0024, O-343, O-344, O-370,
 * O-375). One module, so grade(), services/api's best_action_indexes and the web roller all ask
 * the same functions and can never disagree.
 *
 * Mechanism: every action gets a group key under the grouping mode and street (src/grouping.ts).
 * A group's loss is its lowest member loss (05 section 6.4 rule 3, O-211). A group is Best when
 * its loss is at or below the floor and within LOSS_TIE_TOLERANCE_PCT_POT of the lowest loss at
 * the node, the highest-EV action; frequencies and the roll never enter it (ADR 0024 rule 1).
 * bestActionIndexes lists every member of every Best group in record order, so each listed action,
 * chosen alone, grades Best (rule 4). In Mixed-frequency mode the roll selects one action through
 * rollSelectedAction (O-213); the decision followed the roll when that action is in the chosen
 * action's group (rule 2). Every loss arrives from Rust and is only compared here (ADR 0004).
 */
import { requireActions } from "./actions.js";
import { groupKeys } from "./grouping.js";
import { rollSelectedAction } from "./rng-bands.js";
import type { GradeAction, Grouping, Street } from "./types.js";
import { elementAt, requireIntegerInRange, requireNonNegative, requireOneOf } from "./validate.js";

/**
 * Losses this close, in percent of the pot, tie for Best (O-370): a tenth of Rust's stored loss
 * unit (0.01 percent of the pot, a u16 count of units), so two actions stored at the same unit tie
 * and a one-unit gap never does.
 */
export const LOSS_TIE_TOLERANCE_PCT_POT = 0.001;

/** The grouping mode when none is named (05 section 4: standard grades exact tree sizes). */
export const DEFAULT_GROUPING: Grouping = "standard";

export const GROUPINGS: readonly Grouping[] = Object.freeze(["standard", "grouped", "simple"]);
export const STREETS: readonly Street[] = Object.freeze(["preflop", "flop", "turn", "river"]);

/** The node's actions with their losses, the grouping and street that group them, and the floor. */
export type BestActionsInput = {
  actions: readonly GradeAction[];
  grouping?: Grouping;
  street: Street;
  floorPctPot: number;
};

/** A Mixed-frequency mode decision: the hand's frequencies, the node's actions, the roll and the choice. */
export type RollFollowInput = {
  freqByAction: readonly number[];
  actions: readonly GradeAction[];
  grouping?: Grouping;
  street: Street;
  roll: number;
  actionIndex: number;
};

/** Lowest member loss per group key. */
function groupLosses(keys: readonly string[], losses: readonly number[]): ReadonlyMap<string, number> {
  const lowest = new Map<string, number>();
  keys.forEach((key, index) => {
    const loss = elementAt(losses, index, "losses");
    lowest.set(key, Math.min(lowest.get(key) ?? Number.POSITIVE_INFINITY, loss));
  });
  return lowest;
}

/**
 * Whether the group of `key` is Best: its loss at or below the floor and within the tie tolerance
 * of the lowest loss. keys and losses are parallel and already validated.
 */
export function isBestKey(keys: readonly string[], losses: readonly number[], key: string, floorPctPot: number): boolean {
  const byGroup = groupLosses(keys, losses);
  // A key no action holds has no loss, so it is never Best.
  const groupLoss = byGroup.get(key) ?? Number.POSITIVE_INFINITY;
  const lowest = Math.min(...byGroup.values());
  return groupLoss <= floorPctPot && groupLoss - lowest <= LOSS_TIE_TOLERANCE_PCT_POT;
}

function requireNodeActions(actions: readonly GradeAction[]): readonly GradeAction[] {
  if (Array.isArray(actions) && actions.length === 0) {
    throw new RangeError("actions must list at least one action");
  }
  return requireActions(actions, Array.isArray(actions) ? actions.length : 0);
}

/** The group key of every action under a validated grouping mode and street. */
function keysFor(actions: readonly GradeAction[], grouping: Grouping | undefined, street: Street): string[] {
  const mode = requireOneOf(grouping ?? DEFAULT_GROUPING, GROUPINGS, "grouping");
  return groupKeys(actions, mode, requireOneOf(street, STREETS, "street"));
}

/**
 * The record indices of every member of every Best group, ascending (ADR 0024 rule 4, O-375).
 * Throws a RangeError on an empty or malformed actions list or a negative floor.
 */
export function bestActionIndexes(input: BestActionsInput): number[] {
  const actions = requireNodeActions(input.actions);
  const floorPctPot = requireNonNegative(input.floorPctPot, "floorPctPot");
  const keys = keysFor(actions, input.grouping, input.street);
  const losses = actions.map((action) => action.lossPctPot);
  return keys.flatMap((key, index) => (isBestKey(keys, losses, key, floorPctPot) ? [index] : []));
}

/**
 * Whether the roll-selected action is in the chosen action's group (ADR 0024 rule 2, O-344).
 * Throws a RangeError on malformed frequencies or actions, a roll outside 1 to 100, or a choice
 * that is not one of the actions.
 */
export function followsRoll(input: RollFollowInput): boolean {
  const actions = requireActions(input.actions, input.freqByAction.length);
  requireIntegerInRange(input.actionIndex, 0, actions.length - 1, "actionIndex");
  const selected = rollSelectedAction(input.freqByAction, actions, input.roll);
  const keys = keysFor(actions, input.grouping, input.street);
  return keys[selected] === elementAt(keys, input.actionIndex, "keys");
}
