/**
 * RangeMatrix: the 13 by 13 hand matrix of a study node, drawn on a canvas for speed with an
 * accessible table that holds the same data (S24, S38, S45, R3.12, R3.24, A7 section 4, O-260,
 * O-347, O-386).
 *
 * Mechanism: the node becomes a MatrixModel once per node (model.ts); useMatrixCanvas draws it
 * through one animation frame per input change at the device pixel ratio, so the backing store
 * is sharp and the CSS box is sizePx wide, or the container's width when that is narrower (a
 * phone): max-width 100% with a square aspect ratio, so the matrix never pushes the page sideways
 * and a click maps through the box it is drawn in. useDevicePixelRatio follows ratio changes (another
 * screen, page zoom), which resizes the backing store and redraws. The table and the legend are
 * memoized on the per-node model, so a focus move or a selection change repaints the canvas
 * without re-rendering the 169 table cells. The canvas is an image (role img) labeled with the mode
 * and hand count and described by the table, which is always in the DOM for screen readers only;
 * there is no visible table toggle (O-347). Keyboard: the matrix wrapper takes focus, arrow keys
 * move the focused cell (stopping at the edges), Enter or Space selects it, and a polite live
 * region reads the focused hand and its numbers. A click selects the cell under the pointer.
 *
 * The pop-out (S38, O-386, use-pop-out.ts, MatrixPopOut.tsx): a click on a cell, or Enter or Space
 * on the focused cell, also opens that cell enlarged with its exact numbers, and the live region
 * reads them; the next click anywhere closes it, and a click on another cell moves it there.
 * Escape, an arrow key or leaving the grid (Tab) closes it. It is non-modal and never takes focus.
 * popOut={false} turns it off; initialPopOutHand opens it on a hand at mount (the gallery).
 *
 * Lenses (S45, R3.24): mode names the lens; lensIndex is the compared action (a NodeAction.index)
 * in compare mode, resolved to its position here and falling back to the default lens when it names
 * no action; scaleByWeight makes the bars' height the cell's range weight (O-465).
 *
 * Colour is never the only signal: bars carry hatch patterns, cells print their hand and numbers,
 * and the legend (MatrixLegend.tsx) names each action, EV step, weight step or loss step in words.
 * The component computes no poker math (ADR 0004); it displays the api numbers.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { GRID_SIZE } from "../../poker/hands.js";
import type { ThemeName } from "../../theme/action-style.js";
import { MODE_NAMES, cellDetailText, cellText } from "./cell-text.js";
import { MatrixLegend } from "./MatrixLegend.js";
import { MatrixPopOut } from "./MatrixPopOut.js";
import { buildMatrixModel, defaultLensPosition, lensPositionOf, type MatrixMode, type MatrixModel, type MatrixSource } from "./model.js";
import { RangeMatrixTable } from "./RangeMatrixTable.js";
import { useDevicePixelRatio } from "./use-device-pixel-ratio.js";
import { useMatrixCanvas } from "./use-matrix-canvas.js";
import { usePopOut } from "./use-pop-out.js";

export interface RangeMatrixProps {
  node: MatrixSource;
  mode: MatrixMode;
  theme: ThemeName;
  /** The matrix edge in CSS pixels. */
  sizePx?: number;
  selectedHand?: string | null;
  onSelectHand: (hand: string) => void;
  /** Open a cell's pop-out on click and on Enter or Space (O-386); on by default. */
  popOut?: boolean;
  /** A hand whose pop-out is open at mount, for the gallery's screenshot. */
  initialPopOutHand?: string;
  /** Compare to best (R3.24): the compared action's NodeAction.index; absent, the first action that is not a fold. */
  lensIndex?: number | null;
  /** Bars take the cell's range weight as their height (R3.24, O-465). */
  scaleByWeight?: boolean;
}

export const DEFAULT_MATRIX_SIZE_PX = 520;

const MOVES: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};
const SELECT_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);
const CLOSE_KEY = "Escape";
const KEY_SHORTCUTS = "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Escape";

function clampToGrid(value: number): number {
  return Math.min(GRID_SIZE - 1, Math.max(0, value));
}

function movedIndex(index: number, [rowStep, colStep]: readonly [number, number]): number {
  const row = clampToGrid(Math.floor(index / GRID_SIZE) + rowStep);
  const col = clampToGrid((index % GRID_SIZE) + colStep);
  return row * GRID_SIZE + col;
}

/** The grid index under a click, or null when the pointer is outside the canvas box. */
function indexAtPointer(event: MouseEvent<HTMLCanvasElement>): number | null {
  const box = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  if (box.width <= 0 || x < 0 || y < 0 || x >= box.width || y >= box.height) return null;
  const col = Math.floor((x / box.width) * GRID_SIZE);
  const row = Math.floor((y / box.height) * GRID_SIZE);
  return row * GRID_SIZE + col;
}

/** The grid index of a hand, or null when the hand is absent or not a class. */
function indexOfHand(cells: readonly { hand: string }[], hand: string | null | undefined): number | null {
  if (hand === null || hand === undefined) return null;
  const index = cells.findIndex((cell) => cell.hand === hand);
  return index < 0 ? null : index;
}

/** The compared action's position and scale end in compare mode (the lens, else the default), or null. */
function lensOf(model: MatrixModel, mode: MatrixMode, lensIndex: number | null | undefined) {
  if (mode !== "compare") return null;
  const position = lensPositionOf(model.actions, lensIndex) ?? defaultLensPosition(model.actions);
  return position === null ? null : { position, scalePctPot: model.lossScalePctPot[position] ?? 0 };
}

export function RangeMatrix({
  node,
  mode,
  theme,
  sizePx = DEFAULT_MATRIX_SIZE_PX,
  selectedHand = null,
  onSelectHand,
  popOut = true,
  initialPopOutHand,
  lensIndex = null,
  scaleByWeight = false,
}: RangeMatrixProps) {
  const model = useMemo(() => buildMatrixModel(node), [node]);
  const tableId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelRatio = useDevicePixelRatio();
  const [focusedIndex, setFocusedIndex] = useState(() => indexOfHand(model.cells, selectedHand) ?? 0);
  const [hasFocus, setHasFocus] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const popOutControl = usePopOut(popOut, indexOfHand(model.cells, initialPopOutHand), canvasRef);
  const lens = useMemo(() => lensOf(model, mode, lensIndex), [model, mode, lensIndex]);

  useMatrixCanvas(canvasRef, model, {
    mode,
    sizePx,
    pixelRatio,
    theme,
    focusedIndex: hasFocus ? focusedIndex : null,
    selectedHand,
    scaleByWeight,
    lensPosition: lens?.position ?? null,
  });

  function focusCell(index: number): void {
    const cell = model.cells[index];
    if (cell === undefined) return;
    setFocusedIndex(index);
    setAnnouncement(cellText(cell, model.actions, mode, lens?.position));
  }

  function selectCell(index: number): void {
    const cell = model.cells[index];
    if (cell !== undefined) onSelectHand(cell.hand);
  }

  function announceDetail(index: number): void {
    const cell = model.cells[index];
    if (cell !== undefined) setAnnouncement(cellDetailText(cell, model.actions));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const move = MOVES[event.key];
    if (move !== undefined) {
      event.preventDefault();
      popOutControl.close();
      focusCell(movedIndex(focusedIndex, move));
    } else if (SELECT_KEYS.has(event.key)) {
      event.preventDefault();
      selectCell(focusedIndex);
      if (popOut) {
        popOutControl.open(focusedIndex);
        announceDetail(focusedIndex);
      }
    } else if (event.key === CLOSE_KEY && popOutControl.index !== null) {
      event.preventDefault();
      popOutControl.close();
    }
  }

  function onClick(event: MouseEvent<HTMLCanvasElement>): void {
    const index = indexAtPointer(event);
    if (index === null) return;
    focusCell(index);
    selectCell(index);
    popOutControl.clickCell(index);
  }

  function onBlur(): void {
    setHasFocus(false);
    popOutControl.close();
  }

  const backing = Math.round(sizePx * pixelRatio);
  const label = `Range matrix, ${MODE_NAMES[mode]} mode, ${model.presentCount} hands`;
  const openCell = popOutControl.index === null ? undefined : model.cells[popOutControl.index];

  return (
    <div className="inline-block max-w-full">
      <div className="relative inline-block max-w-full">
        <div
          role="group"
          aria-label="Range matrix cells: arrow keys move, Enter or Space selects and shows the cell's numbers, Escape hides them"
          aria-keyshortcuts={KEY_SHORTCUTS}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setHasFocus(true)}
          onBlur={onBlur}
          className="inline-block max-w-full rounded-sm"
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={label}
            aria-describedby={tableId}
            width={backing}
            height={backing}
            style={{ width: `${sizePx}px`, maxWidth: "100%", height: "auto", aspectRatio: "1 / 1" }}
            onClick={onClick}
            className="block cursor-pointer"
          />
        </div>
        {openCell === undefined ? null : (
          <MatrixPopOut cell={openCell} actions={model.actions} mode={mode} theme={theme} evScaleBb={model.evScaleBb} lens={lens} />
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="mt-2">
        <MatrixLegend mode={mode} actions={model.actions} theme={theme} evScaleBb={model.evScaleBb} lens={lens} />
      </div>
      <div className="sr-only">
        <RangeMatrixTable model={model} mode={mode} id={tableId} {...(lens === null ? {} : { lens: lens.position })} />
      </div>
    </div>
  );
}
