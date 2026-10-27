/**
 * Button labels for the trainer's action bar (S24, R3.13, O-22, ADR 0020). Pure.
 *
 * Standard shows the exact size of every tree action (exactActionLabel, "Bet 3.3bb"). Grouped
 * and Simple show the label the api sends for the node (NodeAction.label: the bucket label in
 * Grouped, the action type in Simple); on a postflop Grouped node a sized action also shows its
 * exact size underneath, and on a preflop node the api label already carries the exact size, so
 * no second line is added (O-22). The web never derives a bucket (ADR 0004).
 */
import type { Grouping, NodeAction, Street } from "../../contracts.js";
import { exactActionLabel, formatCbb } from "../../poker/format.js";

export interface ActionButtonLabel {
  readonly main: string;
  /** The exact size printed under the bucket label, or null. */
  readonly sub: string | null;
}

const PREFLOP: Street = "preflop";

export function actionButtonLabel(action: NodeAction, grouping: Grouping, street: Street): ActionButtonLabel {
  if (grouping === "standard") return { main: exactActionLabel(action), sub: null };
  const showSize = grouping === "grouped" && street !== PREFLOP && action.size_cbb !== null;
  return { main: action.label, sub: showSize && action.size_cbb !== null ? formatCbb(action.size_cbb) : null };
}

/** The accessible name: the label, then the size line when there is one. */
export function actionAccessibleName(label: ActionButtonLabel): string {
  return label.sub === null ? label.main : `${label.main}, ${label.sub}`;
}
