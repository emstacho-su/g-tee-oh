/**
 * Text for one range matrix cell (S24, R3.12), shared by the table fallback, the live region
 * that announces the focused cell, and the numbers the canvas prints.
 *
 * Mechanism: every string is built from a MatrixCell, so the canvas, the table and the
 * announcement read the same model. Frequencies list the short action letter (from
 * src/theme/action-style.ts, plus the size for sized actions so two raise sizes stay apart) and
 * the percent, in action order, only for actions above zero. Expected value (EV) is in big
 * blinds and weight in percent of the class. The canvas uses the short forms (one decimal EV,
 * whole percent weight) because a 40 pixel cell has room for little more; the table carries
 * the longer forms. These are display formats only; nothing is recomputed (ADR 0004).
 */
import type { NodeAction } from "../../contracts.js";
import { formatBb, formatCbb, formatShare } from "../../poker/format.js";
import { actionStyle } from "../../theme/action-style.js";
import type { MatrixCell, MatrixMode } from "./model.js";

const EV_TABLE_DECIMALS = 2;
const SHARE_DECIMALS = 1;
const PERCENT = 100;

export const MODE_NAMES: Readonly<Record<MatrixMode, string>> = {
  frequency: "frequency",
  ev: "expected value",
  weight: "range weight",
};

export const MISSING_TEXT = "not in range";
export const MISSING_MARK = "-";
export const UNKNOWN_WEIGHT_MARK = "?";

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

function frequencyText(cell: MatrixCell, actions: readonly NodeAction[]): string {
  const parts = actions.flatMap((action, position) => {
    const frequency = cell.frequencies[position] ?? 0;
    return frequency > 0 ? [`${actionShortLabel(action)} ${formatShare(frequency, SHARE_DECIMALS)}`] : [];
  });
  return parts.length === 0 ? "no action" : parts.join(", ");
}

/** The value part of a cell's text in a mode, without the hand name. */
export function cellValueText(cell: MatrixCell, actions: readonly NodeAction[], mode: MatrixMode): string {
  if (!cell.present) return MISSING_TEXT;
  if (mode === "frequency") return frequencyText(cell, actions);
  if (mode === "ev") return `EV ${formatBb(cell.evBestBb ?? 0, EV_TABLE_DECIMALS)}`;
  return cell.weight === null ? "weight unknown" : `weight ${formatShare(cell.weight, SHARE_DECIMALS)}`;
}

/** "AKs: R 2.5bb 80.0%, C 20.0%": the hand followed by its value text. */
export function cellText(cell: MatrixCell, actions: readonly NodeAction[], mode: MatrixMode): string {
  return `${cell.hand}: ${cellValueText(cell, actions, mode)}`;
}
