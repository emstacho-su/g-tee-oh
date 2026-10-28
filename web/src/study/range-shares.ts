/**
 * The node's range share per action, positional (S25, R3.12, O-280, O-198, ADR 0004).
 *
 * StudyNode.range_by_action carries { index, share } entries keyed by NodeAction.index, which is
 * never assumed to equal the action's position. ActionFrequencyTable takes positional frequencies,
 * so this maps each action to the share of the entry carrying its index. Nothing is aggregated or
 * recomputed: the shares are the api's. A list that does not match the actions one to one (a
 * different length, or an action with no entry) is a mismatch the screen shows as an alert, never
 * a table with a guessed row.
 */
import type { StudyNode } from "../contracts.js";

type NodeActions = StudyNode["actions"];
type RangeByAction = StudyNode["range_by_action"];

export type ShareResult =
  | { readonly kind: "ok"; readonly shares: readonly number[] }
  | { readonly kind: "mismatch"; readonly problem: string };

export function sharesByPosition(actions: NodeActions, rangeByAction: RangeByAction): ShareResult {
  if (rangeByAction.length !== actions.length) {
    return { kind: "mismatch", problem: `${actions.length} actions but ${rangeByAction.length} range shares` };
  }
  const shares: number[] = [];
  for (const action of actions) {
    const entry = rangeByAction.find((candidate) => candidate.index === action.index);
    if (entry === undefined) return { kind: "mismatch", problem: `action ${action.index} has no range share` };
    shares.push(entry.share);
  }
  return { kind: "ok", shares };
}
