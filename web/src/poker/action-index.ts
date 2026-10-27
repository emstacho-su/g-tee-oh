/**
 * One numbering for actions across the web (S24, R3.12, R3.13, O-198). Pure.
 *
 * The rule: every action index that crosses a component boundary (props in, callbacks out, data
 * attributes) is the api's NodeAction.index, which is what the contract's fields carry
 * (DecisionFeedback.best_action_indexes, the decision's action_index). A node may number its
 * actions in any way, so NodeAction.index is never assumed to equal the action's position in the
 * actions array.
 *
 * Arrays that hold one value per action in record order (freq_by_action, ev_by_action, a hand
 * row's strategy, and the component props frequencies, evBb and freqByAction) stay positional:
 * the contract defines them that way, so their i-th entry belongs to actions[i]. The record
 * position packages/learning returns (RngBand.actionIndex, rollSelectedAction) is such a
 * position too. Components convert between the two only at render time, through these helpers.
 */
import type { NodeAction } from "../contracts.js";

/** The position in actions of the action whose NodeAction.index is index, or undefined. */
export function positionOfIndex(actions: readonly NodeAction[], index: number): number | undefined {
  const position = actions.findIndex((action) => action.index === index);
  return position === -1 ? undefined : position;
}

/** The action whose NodeAction.index is index, or undefined when no action carries it. */
export function actionOfIndex(actions: readonly NodeAction[], index: number): NodeAction | undefined {
  return actions.find((action) => action.index === index);
}

/**
 * The NodeAction.index of the action at a record position. Throws a RangeError for a position
 * that is not an integer inside actions, because a guessed index would grade the wrong action.
 */
export function indexAtPosition(actions: readonly NodeAction[], position: number): number {
  const action = Number.isInteger(position) ? actions[position] : undefined;
  if (action === undefined) {
    throw new RangeError(`position ${position} is outside the ${actions.length} actions`);
  }
  return action.index;
}

/** The indexes, in the order given, that name no action's NodeAction.index. */
export function unknownIndexes(actions: readonly NodeAction[], indexes: readonly number[]): number[] {
  return indexes.filter((index) => positionOfIndex(actions, index) === undefined);
}
