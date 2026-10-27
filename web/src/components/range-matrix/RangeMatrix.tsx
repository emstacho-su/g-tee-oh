/**
 * RangeMatrix: the 13 by 13 hand matrix of a study node, drawn on a canvas for speed with an
 * accessible table that holds the same data (S24, R3.12, A7 section 4, O-260).
 *
 * Mechanism: the node becomes a MatrixModel once per node (model.ts); useMatrixCanvas draws it
 * through one animation frame per input change at the device pixel ratio, so the backing store
 * is sharp and the CSS box stays sizePx. useDevicePixelRatio follows ratio changes (another
 * screen, page zoom), which resizes the backing store and redraws. The table and the legend are
 * memoized on the per-node model, so a focus move or a selection change repaints the canvas
 * without re-rendering the 169 table cells. The canvas is an image (role img) labeled with the mode
 * and hand count and described by the table fallback, which is always in the DOM for screen
 * readers and shown on screen by the "Show as table" toggle. Keyboard: the matrix wrapper takes
 * focus, arrow keys move the focused cell (stopping at the edges), Enter or Space selects it,
 * and a polite live region reads the focused hand and its numbers. A click selects the cell
 * under the pointer. Color is never the only signal: bars carry hatch patterns, cells print
 * their hand and numbers, and the legend names each action with its letter and pattern. The
 * component computes no poker math (ADR 0004); it displays the api numbers.
 */
import { memo, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { GRID_SIZE } from "../../poker/hands.js";
import { actionStyle, type ThemeName } from "../../theme/action-style.js";
import { Button } from "../ui/Button.js";
import { MODE_NAMES, actionShortLabel, cellText } from "./cell-text.js";
import { buildMatrixModel, type MatrixMode, type MatrixModel, type MatrixSource } from "./model.js";
import { RangeMatrixTable } from "./RangeMatrixTable.js";
import { useDevicePixelRatio } from "./use-device-pixel-ratio.js";
import { useMatrixCanvas } from "./use-matrix-canvas.js";

export interface RangeMatrixProps {
  node: MatrixSource;
  mode: MatrixMode;
  theme: ThemeName;
  /** The matrix edge in CSS pixels. */
  sizePx?: number;
  selectedHand?: string | null;
  onSelectHand: (hand: string) => void;
}

export const DEFAULT_MATRIX_SIZE_PX = 520;

const MOVES: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};
const SELECT_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);
const KEY_SHORTCUTS = "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space";

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

interface MatrixLegendProps {
  actions: MatrixModel["actions"];
}

/** Memoized: its actions come from the memoized model, so focus and selection skip it. */
const MatrixLegend = memo(function MatrixLegend({ actions }: MatrixLegendProps) {
  return (
    <ul aria-label="Action legend" className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
      {actions.map((action) => (
        <li key={action.index}>
          {`${actionShortLabel(action)}: ${action.label}, ${actionStyle(action.kind).pattern} pattern`}
        </li>
      ))}
    </ul>
  );
});

export function RangeMatrix({
  node,
  mode,
  theme,
  sizePx = DEFAULT_MATRIX_SIZE_PX,
  selectedHand = null,
  onSelectHand,
}: RangeMatrixProps) {
  const model = useMemo(() => buildMatrixModel(node), [node]);
  const tableId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelRatio = useDevicePixelRatio();
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const selected = model.cells.findIndex((cell) => cell.hand === selectedHand);
    return selected < 0 ? 0 : selected;
  });
  const [hasFocus, setHasFocus] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [tableVisible, setTableVisible] = useState(false);

  useMatrixCanvas(canvasRef, model, {
    mode,
    sizePx,
    pixelRatio,
    theme,
    focusedIndex: hasFocus ? focusedIndex : null,
    selectedHand,
  });

  function focusCell(index: number): void {
    const cell = model.cells[index];
    if (cell === undefined) return;
    setFocusedIndex(index);
    setAnnouncement(cellText(cell, model.actions, mode));
  }

  function selectCell(index: number): void {
    const cell = model.cells[index];
    if (cell !== undefined) onSelectHand(cell.hand);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const move = MOVES[event.key];
    if (move !== undefined) {
      event.preventDefault();
      focusCell(movedIndex(focusedIndex, move));
    } else if (SELECT_KEYS.has(event.key)) {
      event.preventDefault();
      selectCell(focusedIndex);
    }
  }

  function onClick(event: MouseEvent<HTMLCanvasElement>): void {
    const index = indexAtPointer(event);
    if (index === null) return;
    focusCell(index);
    selectCell(index);
  }

  const backing = Math.round(sizePx * pixelRatio);
  const label = `Range matrix, ${MODE_NAMES[mode]} mode, ${model.presentCount} hands`;

  return (
    <div className="inline-block">
      <div
        role="group"
        aria-label="Range matrix cells: arrow keys move, Enter or Space selects"
        aria-keyshortcuts={KEY_SHORTCUTS}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={() => setHasFocus(false)}
        className="inline-block rounded-sm"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          aria-describedby={tableId}
          width={backing}
          height={backing}
          style={{ width: `${sizePx}px`, height: `${sizePx}px` }}
          onClick={onClick}
          className="block cursor-pointer"
        />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <MatrixLegend actions={model.actions} />
      <Button size="sm" className="mt-2" aria-pressed={tableVisible} onClick={() => setTableVisible((shown) => !shown)}>
        Show as table
      </Button>
      <div data-table-visible={tableVisible ? "true" : "false"} className={tableVisible ? "mt-2 overflow-auto" : "sr-only"}>
        <RangeMatrixTable model={model} mode={mode} id={tableId} />
      </div>
    </div>
  );
}
