/**
 * The painter's 13 by 13 grid (S27 lane B, R3.17, A7 section 4): a new grid of buttons, not
 * RangeMatrix (whose canvas S24's frame bench measures), in HAND_GRID chart order. Each cell is a
 * button named "AKs: Raise to 10bb" and filled with the painted action's color and hatch, with the
 * action's short letter printed, so color is never the only signal. A cell the node does not hold is
 * aria-disabled, named "72o: not in range" and never painted.
 *
 * Input: a pointer press starts a stroke on its cell and every cell the pressed pointer enters
 * joins it (the press releases its implicit pointer capture, so touch drags reach other cells too;
 * the grid sets touch-action none so a drag paints instead of scrolling); the window's pointerup or
 * pointercancel ends it. The keyboard uses one roving tab stop: arrow keys move it, and Space or
 * Enter press the focused button, which paints that one cell (a click paints too).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { NodeAction } from "../../contracts.js";
import { GRID_SIZE, HAND_GRID } from "../../poker/hands.js";
import { actionStyle } from "../../theme/action-style.js";
import { ACTION_FILL_CLASSES, ACTION_INK_CLASSES, actionFillStyle } from "../trainer/ActionSwatch.js";
import { cn } from "../ui/index.js";
import type { Paint } from "./paint-model.js";

export const NOT_IN_RANGE = "not in range";

const ARROW_STEPS: Readonly<Record<string, { row: number; col: number }>> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
};

const ROWS: readonly (typeof HAND_GRID)[number][][] = Array.from({ length: GRID_SIZE }, (_, row) =>
  HAND_GRID.slice(row * GRID_SIZE, (row + 1) * GRID_SIZE),
);

export interface PaintGridProps {
  paint: Paint;
  actions: readonly NodeAction[];
  enabled: boolean;
  onBegin: (hand: string) => void;
  onExtend: (hand: string) => void;
  onEnd: () => void;
  onPaintOne: (hand: string) => void;
}

function clampIndex(value: number): number {
  return Math.min(GRID_SIZE - 1, Math.max(0, value));
}

/** The grid index the arrow key moves the tab stop to, or undefined for any other key. */
function movedIndex(index: number, key: string): number | undefined {
  const step = ARROW_STEPS[key];
  if (step === undefined) return undefined;
  const row = clampIndex(Math.floor(index / GRID_SIZE) + step.row);
  const col = clampIndex((index % GRID_SIZE) + step.col);
  return row * GRID_SIZE + col;
}

/** Ends the stroke on any pointer release, wherever it happens. */
function useStrokeEnd(onEnd: () => void): void {
  const endRef = useRef(onEnd);
  useEffect(() => {
    endRef.current = onEnd;
  });
  useEffect(() => {
    const end = () => endRef.current();
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);
}

export function PaintGrid({ paint, actions, enabled, onBegin, onExtend, onEnd, onPaintOne }: PaintGridProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useStrokeEnd(onEnd);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = movedIndex(index, event.key);
    if (next === undefined) return;
    event.preventDefault();
    setFocusIndex(next);
    cellRefs.current[next]?.focus();
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, hand: string) => {
    if (!enabled) return;
    const target = event.currentTarget;
    if (typeof target.hasPointerCapture === "function" && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    onBegin(hand);
  };

  return (
    <div role="grid" aria-label="Range to paint" className="grid w-full max-w-[36rem] touch-none select-none gap-px" aria-disabled={!enabled}>
      {ROWS.map((cells, row) => (
        <div role="row" key={row} className="grid grid-cols-13 gap-px">
          {cells.map((cell) => {
            const index = cell.row * GRID_SIZE + cell.col;
            const painted = paint[cell.hand];
            const action = painted === undefined ? undefined : actions.find((candidate) => candidate.index === painted);
            const held = action !== undefined;
            return (
              <div role="gridcell" key={cell.hand}>
                <button
                  type="button"
                  ref={(element) => {
                    cellRefs.current[index] = element;
                  }}
                  tabIndex={index === focusIndex ? 0 : -1}
                  aria-label={`${cell.hand}: ${action?.label ?? NOT_IN_RANGE}`}
                  aria-disabled={!held || !enabled}
                  data-hand={cell.hand}
                  data-action={action?.index ?? ""}
                  style={action === undefined ? undefined : actionFillStyle(action, actions)}
                  onFocus={() => setFocusIndex(index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onPointerDown={(event) => onPointerDown(event, cell.hand)}
                  onPointerEnter={() => {
                    if (enabled) onExtend(cell.hand);
                  }}
                  onClick={() => {
                    if (enabled && held) onPaintOne(cell.hand);
                  }}
                  className={cn(
                    "flex aspect-square w-full flex-col items-center justify-center rounded-sm border border-black/10 font-mono text-[0.6rem] leading-tight sm:text-xs",
                    held ? cn(ACTION_FILL_CLASSES, ACTION_INK_CLASSES) : "bg-surface-sunken text-muted line-through",
                  )}
                >
                  <span aria-hidden="true">{cell.hand}</span>
                  <span aria-hidden="true" className="font-bold">
                    {action === undefined ? "·" : actionStyle(action.kind).short}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
