/**
 * Draws the range matrix onto a 2D canvas context (S24, S45, R3.12, R3.24, A7 section 4).
 *
 * Mechanism: drawMatrix is pure over a minimal context interface (MatrixCanvasContext), so the
 * tests pass a recording fake and the browser passes a real CanvasRenderingContext2D. It works
 * in device pixels: the backing store is sizePx times the pixel ratio, cut into 13 integer cell
 * edges, so every rectangle lands on whole pixels and nothing blurs. One frame paints in passes
 * to keep context state changes few: the background, every cell's fill (draw-cells.ts: the bars,
 * the EV, weight or compare step, or the missing hatch), the grid lines, the selection and focus
 * marks, then the label chips (bar modes and missing cells only: EV, weight and compare print
 * straight on their step in its own ink, S38) and the texts. A marked cell's chip and label move
 * inside its ring (the mark's width plus the halo), so the hand stays readable over the selection
 * (S45, screen critic). Color is never the only signal: every bar carries its action's pattern
 * (fold is the one plain fill), with light hatch lines over a dark fill and dark ones over a light
 * fill, every cell prints its hand, EV, weight and compare print their numbers, missing hands
 * print a dash. Speed (the 16 ms frame budget, O-260): patterns come from a cache built once per
 * theme and ratio (patterns.ts), colours and inks from quantized, pre-resolved palettes
 * (matrix-theme.ts), label chips have a fixed width from a monospace font so no text is measured,
 * and a frame allocates only a handful of small objects per action, none per cell.
 */
import type { ThemeName } from "../../theme/action-style.js";
import {
  actionPaints,
  cellInk,
  dimmed,
  drawCellFill,
  fillWith,
  isBarMode,
  usesChip,
  valueText,
  type FrameContext,
  type MatrixCanvasContext,
  type Rect,
} from "./draw-cells.js";
import { MATRIX_PALETTES } from "./matrix-theme.js";
import { GRID_SIZE, HAND_GRID } from "../../poker/hands.js";
import { defaultLensPosition, type MatrixMode, type MatrixModel } from "./model.js";
import { MISSING_PATTERN_KEY, type PatternSource } from "./patterns.js";

export type { MatrixCanvasContext } from "./draw-cells.js";

export interface DrawOptions {
  readonly mode: MatrixMode;
  /** The matrix edge in CSS pixels. */
  readonly sizePx: number;
  /** Device pixels per CSS pixel; the backing store is sizePx times this. */
  readonly pixelRatio: number;
  readonly theme: ThemeName;
  /** The keyboard-focused cell index in grid order, or null. */
  readonly focusedIndex: number | null;
  readonly selectedHand: string | null;
  readonly patterns: PatternSource;
  /** Bars take the cell's range weight as their height (R3.24, O-465); off by default. */
  readonly scaleByWeight?: boolean;
  /** The compared action's position in compare mode; absent or null, the first action that is not a fold. */
  readonly lensPosition?: number | null;
  /** The cell under the pointer (R3.25): a thin outline, no address write; absent or null, none. */
  readonly hoveredIndex?: number | null;
  /** The action positions the filters keep (R3.12, O-468); absent, null or empty, nothing is filtered. */
  readonly highlight?: ReadonlySet<number> | null;
}

interface TextLayout {
  readonly labelFont: string;
  readonly valueFont: string;
  readonly pad: number;
  readonly labelChipW: number;
  readonly labelChipH: number;
  readonly valueChipW: number;
  readonly valueChipH: number;
}

const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const LABEL_FONT_SHARE = 0.26;
const VALUE_FONT_SHARE = 0.28;
const MIN_FONT_PX = 7;
/** Advance of one monospace character as a share of the font size. */
const MONO_ADVANCE = 0.62;
const LABEL_CHARS = 3;
const VALUE_CHARS = 5;
const PAD_CSS_PX = 2;
const GRID_LINE_CSS_PX = 1;
const FOCUS_LINE_CSS_PX = 2;
const SELECTED_LINE_CSS_PX = 4;
const HALO_LINE_CSS_PX = 1;
/** The hover outline is the thinnest mark: it names the cell being read, not a choice (R3.25). */
const HOVER_LINE_CSS_PX = 1;

/** The 14 integer edges that cut a backing store of sizeDevicePx into 13 cells. */
export function cellEdges(sizeDevicePx: number): number[] {
  return Array.from({ length: GRID_SIZE + 1 }, (_, index) => edgeAt(index, sizeDevicePx));
}

/** The integer position of cell edge index (0 to 13) in a backing store of sizeDevicePx. */
function edgeAt(index: number, sizeDevicePx: number): number {
  return Math.round((index * sizeDevicePx) / GRID_SIZE);
}

function textLayout(cellPx: number, pixelRatio: number): TextLayout {
  const labelPx = Math.max(MIN_FONT_PX, Math.round(cellPx * LABEL_FONT_SHARE));
  const valuePx = Math.max(MIN_FONT_PX, Math.round(cellPx * VALUE_FONT_SHARE));
  const pad = Math.max(1, Math.round(PAD_CSS_PX * pixelRatio));
  return {
    labelFont: `600 ${labelPx}px ${FONT_FAMILY}`,
    valueFont: `600 ${valuePx}px ${FONT_FAMILY}`,
    pad,
    labelChipW: Math.ceil(labelPx * MONO_ADVANCE * LABEL_CHARS) + 2 * pad,
    labelChipH: labelPx + 2 * pad,
    valueChipW: Math.min(cellPx, Math.ceil(valuePx * MONO_ADVANCE * VALUE_CHARS) + 2 * pad),
    valueChipH: valuePx + 2 * pad,
  };
}

const rectCache = new Map<number, readonly Rect[]>();

/** The 169 cell rectangles in grid order for one backing store size, computed once per size. */
function cellRects(size: number): readonly Rect[] {
  const known = rectCache.get(size);
  if (known !== undefined) return known;
  const rects = HAND_GRID.map(({ row, col }) => {
    const x = edgeAt(col, size);
    const y = edgeAt(row, size);
    return { x, y, w: edgeAt(col + 1, size) - x, h: edgeAt(row + 1, size) - y };
  });
  rectCache.set(size, rects);
  return rects;
}

/** The rectangle of the cell at a grid index; the model always holds the 169 grid cells. */
function rectAt(rects: readonly Rect[], index: number): Rect {
  const rect = rects[index];
  if (rect === undefined) throw new RangeError(`range matrix: no cell at grid index ${index}`);
  return rect;
}

function drawGridLines(ctx: MatrixCanvasContext, size: number, pixelRatio: number, color: string): void {
  const width = Math.max(1, Math.round(GRID_LINE_CSS_PX * pixelRatio));
  ctx.fillStyle = color;
  for (let index = 1; index < GRID_SIZE; index += 1) {
    const at = edgeAt(index, size) - Math.floor(width / 2);
    ctx.fillRect(at, 0, width, size);
    ctx.fillRect(0, at, size, width);
  }
}

/** The marks on cells this frame: each marked index with the inset its chip and label keep from the cell edge. */
type Marks = ReadonlyMap<number, number>;

/** A cell's rectangle shrunk by its mark's inset, so chips and texts sit inside the ring. */
function textRect(rect: Rect, marks: Marks, index: number): Rect {
  const inset = marks.get(index);
  if (inset === undefined) return rect;
  return { x: rect.x + inset, y: rect.y + inset, w: Math.max(0, rect.w - 2 * inset), h: Math.max(0, rect.h - 2 * inset) };
}

function drawChips(frame: FrameContext, rects: readonly Rect[], layout: TextLayout, marks: Marks): void {
  const { ctx } = frame;
  ctx.fillStyle = frame.palette.labelChip;
  frame.model.cells.forEach((cell, index) => {
    if (!usesChip(frame, cell)) return;
    const rect = textRect(rectAt(rects, index), marks, index);
    ctx.fillRect(rect.x, rect.y, Math.min(rect.w, layout.labelChipW), Math.min(rect.h, layout.labelChipH));
    if (valueText(frame, cell) === null) return;
    const x = rect.x + Math.floor((rect.w - layout.valueChipW) / 2);
    ctx.fillRect(x, rect.y + rect.h - layout.valueChipH, layout.valueChipW, layout.valueChipH);
  });
}

/**
 * Prints every hand label, then every value. The ink changes per cell only on a filled step, and
 * it is a string from the resolved palette, so no colour is allocated per cell.
 */
function drawTexts(frame: FrameContext, rects: readonly Rect[], layout: TextLayout, marks: Marks): void {
  const { ctx } = frame;
  ctx.font = layout.labelFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  frame.model.cells.forEach((cell, index) => {
    const rect = textRect(rectAt(rects, index), marks, index);
    ctx.fillStyle = cellInk(frame, cell);
    ctx.fillText(cell.hand, rect.x + layout.pad, rect.y + layout.pad);
  });
  ctx.font = layout.valueFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  frame.model.cells.forEach((cell, index) => {
    const text = valueText(frame, cell);
    if (text === null) return;
    const rect = textRect(rectAt(rects, index), marks, index);
    ctx.fillStyle = cellInk(frame, cell);
    ctx.fillText(text, rect.x + rect.w / 2, rect.y + rect.h - layout.pad);
  });
}

function outline(ctx: MatrixCanvasContext, rect: Rect | undefined, color: string, width: number): void {
  if (rect === undefined) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const inset = width / 2;
  ctx.strokeRect(rect.x + inset, rect.y + inset, rect.w - width, rect.h - width);
}

/**
 * A mark over a cell: the ring on the cell's edge and a thin line of the ground inside it, so the
 * ring or its halo reaches 3:1 on any fill (the contrast gate checks both marks, O-432 to O-434).
 * Returns the inset the cell's texts keep: the ring plus the halo.
 */
function markCell(frame: FrameContext, rect: Rect | undefined, color: string, width: number, ratio: number): number {
  const haloWidth = Math.max(1, Math.round(HALO_LINE_CSS_PX * ratio));
  outline(frame.ctx, rect, color, width);
  const halo = rect === undefined ? undefined : { x: rect.x + width, y: rect.y + width, w: rect.w - 2 * width, h: rect.h - 2 * width };
  outline(frame.ctx, halo, frame.palette.focusHalo, haloWidth);
  return width + haloWidth;
}

/** Draws the selection and focus marks and returns each marked cell's text inset. */
function drawMarks(frame: FrameContext, rects: readonly Rect[], options: DrawOptions): Marks {
  const ratio = options.pixelRatio;
  const marks = new Map<number, number>();
  if (options.selectedHand !== null) {
    const index = frame.model.cells.findIndex((cell) => cell.hand === options.selectedHand);
    if (index >= 0) marks.set(index, markCell(frame, rects[index], frame.palette.selected, Math.round(SELECTED_LINE_CSS_PX * ratio), ratio));
  }
  if (options.focusedIndex !== null && rects[options.focusedIndex] !== undefined) {
    const inset = markCell(frame, rects[options.focusedIndex], frame.palette.focus, Math.round(FOCUS_LINE_CSS_PX * ratio), ratio);
    marks.set(options.focusedIndex, Math.max(inset, marks.get(options.focusedIndex) ?? 0));
  }
  const hovered = options.hoveredIndex ?? null;
  // The hover outline is drawn only where no heavier mark already names the cell; it moves no text.
  if (hovered !== null && !marks.has(hovered) && rects[hovered] !== undefined) {
    outline(frame.ctx, rects[hovered], frame.palette.focus, Math.max(1, Math.round(HOVER_LINE_CSS_PX * ratio)));
  }
  return marks;
}

/** The compared action and its scale end, or null outside compare mode or when no action can be compared. */
function lensOf(model: MatrixModel, options: DrawOptions): FrameContext["lens"] {
  if (options.mode !== "compare") return null;
  const position = options.lensPosition ?? defaultLensPosition(model.actions);
  if (position === null || model.actions[position] === undefined) return null;
  return { position, scalePctPot: model.lossScalePctPot[position] ?? 0 };
}

export function drawMatrix(ctx: MatrixCanvasContext, model: MatrixModel, options: DrawOptions): void {
  const size = Math.round(options.sizePx * options.pixelRatio);
  const palette = MATRIX_PALETTES[options.theme];
  const frame: FrameContext = {
    ctx,
    model,
    mode: options.mode,
    palette,
    paints: actionPaints(model.actions, options.theme, options.patterns),
    missingPattern: options.patterns.get(MISSING_PATTERN_KEY),
    scaleByWeight: options.scaleByWeight === true && isBarMode(options.mode),
    lens: lensOf(model, options),
    highlight: options.highlight === undefined || options.highlight === null || options.highlight.size === 0 ? null : options.highlight,
  };
  const rects = cellRects(size);
  fillWith(ctx, palette.background, 0, 0, size, size);
  model.cells.forEach((cell, index) => {
    drawCellFill(frame, cell, rectAt(rects, index));
  });
  if (frame.highlight !== null) {
    model.cells.forEach((cell, index) => {
      if (!dimmed(frame, cell)) return;
      const rect = rectAt(rects, index);
      fillWith(ctx, palette.dimOverlay, rect.x, rect.y, rect.w, rect.h);
    });
  }
  drawGridLines(ctx, size, options.pixelRatio, palette.gridLine);
  const marks = drawMarks(frame, rects, options);
  const layout = textLayout(edgeAt(1, size), options.pixelRatio);
  drawChips(frame, rects, layout, marks);
  drawTexts(frame, rects, layout, marks);
}
