/**
 * Text for one range matrix cell (S24, S45, R3.12, R3.24), shared by the table fallback, the live
 * region that announces the focused cell, and the numbers the canvas prints.
 *
 * Mechanism: every string is built from a MatrixCell, so the canvas, the table and the
 * announcement read the same model. Frequencies list the short action letter (from
 * src/theme/action-style.ts, plus the size for sized actions so two raise sizes stay apart) and
 * the percent, in action order, only for actions above zero. Expected value (EV) is in big
 * blinds and weight in percent of the class. Strategy with EV adds the best EV after the
 * frequencies; Compare to Best names the compared action and its served loss against the best in
 * percent of the pot (O-462, O-464). The canvas uses the short forms (one decimal EV, whole
 * percent weight, one decimal loss) because a 40 pixel cell has room for little more; the table
 * carries the longer forms. These are display formats only; nothing is recomputed (ADR 0004).
 */
import type { NodeAction } from "../../contracts.js";
import { exactActionLabel, formatBb, formatCbb, formatPercent, formatShare } from "../../poker/format.js";
import { actionStyle } from "../../theme/action-style.js";
import { defaultLensPosition, type MatrixCell, type MatrixMode } from "./model.js";
import { COMPARE_NEUTRAL_PCT_POT } from "./scales.js";

const EV_TABLE_DECIMALS = 2;
const LOSS_TABLE_DECIMALS = 2;
const SHARE_DECIMALS = 1;
const PERCENT = 100;

export const MODE_NAMES: Readonly<Record<MatrixMode, string>> = {
  frequency: "frequency",
  ev: "expected value",
  weight: "range weight",
  strategy_ev: "strategy with EV",
  compare: "compare to best",
};

export const MISSING_TEXT = "not in range";
export const MISSING_MARK = "-";
export const UNKNOWN_WEIGHT_MARK = "?";
/** What a compare cell prints when the chosen action is the best there (within the neutral band). */
export const BEST_MARK = "best";

/** "F", "C", "R 2.5bb": the short letter, with the size for sized actions. */
export function actionShortLabel(action: NodeAction): string {
  const short = actionStyle(action.kind).short;
  return action.size_cbb === null ? short : `${short} ${formatCbb(action.size_cbb)}`;
}

/** The canvas EV figure: one decimal, and never a negative zero. */
export function formatEvShort(evBb: number): string {
  const text = evBb.toFixed(1);
  return text === "-0.0" ? "0.0" : text;
}

/** The canvas weight figure: a whole percent. */
export function formatWeightShort(weight: number): string {
  return `${Math.round(weight * PERCENT)}%`;
}

/** The canvas compare figure: "best" within the neutral band, else the loss as a negative percent of the pot. */
export function formatLossShort(lossPctPot: number): string {
  return lossPctPot < COMPARE_NEUTRAL_PCT_POT ? BEST_MARK : `-${lossPctPot.toFixed(1)}%`;
}

function frequencyText(cell: MatrixCell, actions: readonly NodeAction[]): string {
  const parts = actions.flatMap((action, position) => {
    const frequency = cell.frequencies[position] ?? 0;
    return frequency > 0 ? [`${actionShortLabel(action)} ${formatShare(frequency, SHARE_DECIMALS)}`] : [];
  });
  return parts.length === 0 ? "no action" : parts.join(", ");
}

/** "Raise 2.5bb is the best action" or "Raise 2.5bb is 1.20% of the pot behind the best". */
function compareText(cell: MatrixCell, actions: readonly NodeAction[], lens: number | undefined): string {
  const position = lens ?? defaultLensPosition(actions);
  const action = position === null ? undefined : actions[position];
  if (action === undefined || position === null) return "no action to compare";
  const loss = cell.lossPctPot[position] ?? 0;
  const name = exactActionLabel(action);
  if (loss < COMPARE_NEUTRAL_PCT_POT) return `${name} is the best action`;
  return `${name} is ${formatPercent(loss, LOSS_TABLE_DECIMALS)} of the pot behind the best`;
}

/**
 * The value part of a cell's text in a mode, without the hand name. For compare, `lens` is the
 * compared action's position; absent, the default lens (the first action that is not a fold).
 */
export function cellValueText(cell: MatrixCell, actions: readonly NodeAction[], mode: MatrixMode, lens?: number): string {
  if (!cell.present) return MISSING_TEXT;
  if (mode === "frequency") return frequencyText(cell, actions);
  if (mode === "ev") return `EV ${formatBb(cell.evBestBb ?? 0, EV_TABLE_DECIMALS)}`;
  if (mode === "strategy_ev") return `${frequencyText(cell, actions)}, best EV ${formatBb(cell.evBestBb ?? 0, EV_TABLE_DECIMALS)}`;
  if (mode === "compare") return compareText(cell, actions, lens);
  return cell.weight === null ? "weight unknown" : `weight ${formatShare(cell.weight, SHARE_DECIMALS)}`;
}

/** "AKs: R 2.5bb 80.0%, C 20.0%": the hand followed by its value text. */
export function cellText(cell: MatrixCell, actions: readonly NodeAction[], mode: MatrixMode, lens?: number): string {
  return `${cell.hand}: ${cellValueText(cell, actions, mode, lens)}`;
}

/** The range weight in words, as the pop-out prints it. */
export function weightText(cell: MatrixCell): string {
  return cell.weight === null ? "Range weight unknown" : `Range weight ${formatShare(cell.weight, SHARE_DECIMALS)}`;
}

/**
 * The pop-out's numbers in one sentence for the live region (S38, O-386): every action, played
 * or not, with its exact frequency and EV, then the range weight. "AKs: Fold 0.0%, EV 0.00bb;
 * Raise to 2.5bb 80.0%, EV 1.30bb; range weight 64.0%".
 */
export function cellDetailText(cell: MatrixCell, actions: readonly NodeAction[]): string {
  if (!cell.present) return `${cell.hand}: ${MISSING_TEXT}`;
  const parts = actions.map((action, position) => {
    const frequency = formatShare(cell.frequencies[position] ?? 0, SHARE_DECIMALS);
    return `${action.label} ${frequency}, EV ${formatBb(cell.evBb[position] ?? 0, EV_TABLE_DECIMALS)}`;
  });
  return `${cell.hand}: ${[...parts, weightText(cell).toLowerCase()].join("; ")}`;
}
