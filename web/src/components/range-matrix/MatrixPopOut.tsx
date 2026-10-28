/**
 * The range matrix pop-out (S38, R3.12, O-386, screen review rows 10 and 12): one cell enlarged
 * with its exact numbers beneath it.
 *
 * Mechanism: RangeMatrix renders this inside the positioned box that wraps the canvas, for the
 * cell a click or Enter opened. The top shows the cell about three cells wide in the mode's own
 * fill (the frequency bars with their patterns, the EV step or the weight step) with the hand
 * name; beneath it every action of the node, played or not, with its swatch, the api's label, the
 * frequency to one decimal and the EV in big blinds, then the range weight. Nothing is computed
 * (ADR 0004). Placement is popOutPosition: beside the cell, on the right when it fits and on the
 * left otherwise, top aligned with the cell, and clamped inside the box, so it never overflows a
 * phone screen; a layout effect measures the box and the pop-out once per cell. It is non-modal
 * and not focusable (focus stays on the matrix grid, whose live region reads the same numbers),
 * and its layer comes from components/ui (TOOLTIP_LAYER_CLASS, O-368).
 */
import { useLayoutEffect, useRef, useState } from "react";

import type { NodeAction } from "../../contracts.js";
import { formatBb, formatShare } from "../../poker/format.js";
import { GRID_SIZE } from "../../poker/hands.js";
import type { ThemeName } from "../../theme/action-style.js";
import { ACTION_FILL_CLASSES, ActionSwatch, actionFillStyle } from "../trainer/ActionSwatch.js";
import { TOOLTIP_LAYER_CLASS, cn } from "../ui/index.js";
import { MISSING_TEXT, weightText } from "./cell-text.js";
import { MATRIX_PALETTES, evFill, evInk, weightFill, weightInk } from "./matrix-theme.js";
import type { MatrixCell, MatrixMode } from "./model.js";

/** The space between the cell and the pop-out, in CSS pixels. */
export const POP_OUT_GAP_PX = 6;
const PERCENT = 100;
const SHARE_DECIMALS = 1;
const EV_DECIMALS = 2;

export interface PopOutPlacementInput {
  readonly row: number;
  readonly col: number;
  /** The matrix box and the pop-out, in CSS pixels. */
  readonly boxW: number;
  readonly boxH: number;
  readonly popW: number;
  readonly popH: number;
}

export interface PopOutPosition {
  readonly left: number;
  readonly top: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(low, high), Math.max(low, value));
}

/** Where the pop-out's top left corner goes inside the matrix box. */
export function popOutPosition({ row, col, boxW, boxH, popW, popH }: PopOutPlacementInput): PopOutPosition {
  const cellW = boxW / GRID_SIZE;
  const cellH = boxH / GRID_SIZE;
  const right = (col + 1) * cellW + POP_OUT_GAP_PX;
  const preferred = right + popW <= boxW ? right : col * cellW - popW - POP_OUT_GAP_PX;
  return {
    left: Math.round(clamp(preferred, 0, boxW - popW)),
    top: Math.round(clamp(row * cellH, 0, boxH - popH)),
  };
}

export interface MatrixPopOutProps {
  cell: MatrixCell;
  actions: readonly NodeAction[];
  mode: MatrixMode;
  theme: ThemeName;
  /** The model's EV scale end, so the EV fill matches the canvas. */
  evScaleBb: number;
}

type EnlargedCellProps = MatrixPopOutProps;

function FrequencyBars({ cell, actions }: Pick<EnlargedCellProps, "cell" | "actions">) {
  return (
    <span className="absolute inset-0 flex">
      {actions.map((action, position) => {
        const share = cell.frequencies[position] ?? 0;
        if (share <= 0) return null;
        return (
          <span
            key={action.index}
            style={{ ...actionFillStyle(action, actions), width: `${share * PERCENT}%` }}
            className={cn("block h-full", ACTION_FILL_CLASSES)}
          />
        );
      })}
    </span>
  );
}

/** The cell drawn large in the mode's fill, with the hand name. */
function EnlargedCell(props: EnlargedCellProps) {
  const { cell, actions, mode, theme, evScaleBb } = props;
  const palette = MATRIX_PALETTES[theme];
  const missing = !cell.present || (mode === "weight" && cell.weight === null);
  const flat = missing
    ? { background: palette.missingFill, color: palette.labelText }
    : mode === "ev"
      ? { background: evFill(palette, cell.evBestBb ?? 0, evScaleBb), color: evInk(palette, cell.evBestBb ?? 0, evScaleBb) }
      : mode === "weight"
        ? { background: weightFill(palette, cell.weight) ?? palette.missingFill, color: weightInk(palette, cell.weight) }
        : null;
  return (
    <div
      aria-hidden="true"
      data-testid="popout-cell"
      style={flat === null ? undefined : { backgroundColor: flat.background, color: flat.color }}
      className="relative flex h-20 items-start overflow-hidden rounded-lg border border-border"
    >
      {flat === null && !missing ? <FrequencyBars cell={cell} actions={actions} /> : null}
      <span
        className={cn(
          "relative m-1 rounded px-1.5 font-mono text-lg font-bold",
          flat === null && "bg-surface-raised/85 text-text",
        )}
      >
        {cell.hand}
      </span>
    </div>
  );
}

function ActionLines({ cell, actions }: Pick<MatrixPopOutProps, "cell" | "actions">) {
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {actions.map((action, position) => (
        <li key={action.index} data-testid={`popout-action-${action.index}`} className="flex items-center gap-1.5">
          <ActionSwatch action={action} actions={actions} showLetter={false} />
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          <span className="font-semibold tabular-nums">{formatShare(cell.frequencies[position] ?? 0, SHARE_DECIMALS)}</span>
          <span className="w-16 text-right text-muted tabular-nums">{`EV ${formatBb(cell.evBb[position] ?? 0, EV_DECIMALS)}`}</span>
        </li>
      ))}
    </ul>
  );
}

export function MatrixPopOut(props: MatrixPopOutProps) {
  const { cell, actions } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopOutPosition | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const box = element?.offsetParent;
    if (element === null || !(box instanceof HTMLElement)) return;
    setPosition(
      popOutPosition({
        row: cell.row,
        col: cell.col,
        boxW: box.clientWidth,
        boxH: box.clientHeight,
        popW: element.offsetWidth,
        popH: element.offsetHeight,
      }),
    );
  }, [cell.row, cell.col]);

  // Before the first measure the pop-out sits by the cell in percent of the box.
  const style =
    position === null
      ? { left: `${((cell.col + 1) / GRID_SIZE) * PERCENT}%`, top: `${(cell.row / GRID_SIZE) * PERCENT}%` }
      : { left: `${position.left}px`, top: `${position.top}px` };

  return (
    <div
      ref={ref}
      role="note"
      aria-label={`${cell.hand} in detail`}
      data-testid="matrix-popout"
      data-hand={cell.hand}
      style={style}
      className={cn(
        "absolute flex w-60 max-w-full flex-col gap-2 rounded-xl border border-border bg-surface-raised p-2 text-text shadow-lg",
        TOOLTIP_LAYER_CLASS,
      )}
    >
      <EnlargedCell {...props} />
      {cell.present ? (
        <>
          <ActionLines cell={cell} actions={actions} />
          <p className="text-xs tabular-nums">{weightText(cell)}</p>
        </>
      ) : (
        <p className="text-xs text-muted">{MISSING_TEXT}</p>
      )}
    </div>
  );
}
