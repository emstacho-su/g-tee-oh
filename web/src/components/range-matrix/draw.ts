/**
 * Draws the range matrix onto a 2D canvas context (S24, R3.12, A7 section 4).
 *
 * Mechanism: drawMatrix is pure over a minimal context interface (MatrixCanvasContext), so the
 * tests pass a recording fake and the browser passes a real CanvasRenderingContext2D. It works
 * in device pixels: the backing store is sizePx times the pixel ratio, cut into 13 integer cell
 * edges, so every rectangle lands on whole pixels and nothing blurs. One frame paints in passes
 * to keep context state changes few: the background, every cell's fill (stacked frequency bars
 * with their hatch overlay, the diverging expected value (EV) step, or the weight step filling
 * the whole cell; missing hands and unknown weights take the missing fill and hatch), the grid
 * lines, the label chips (frequency bars and missing cells only: EV and weight print straight on
 * their step in its own ink, S38), the texts, then the selection and focus outlines. Color is
 * never the only signal: every bar carries its action's pattern (fold is the one plain fill),
 * with light hatch lines over a dark fill and dark ones over a light fill, every cell prints its
 * hand, EV and weight print their numbers, missing hands print a dash. Speed (the 16 ms frame
 * budget, O-260): patterns come from a cache built once per theme and ratio (patterns.ts), EV
 * and weight colours and their inks from quantized, pre-resolved palettes (matrix-theme.ts),
 * label chips have a fixed width from a monospace font so no text is measured, and a frame
 * allocates only a handful of small objects per action, none per cell.
 */
import type { NodeAction } from "../../contracts.js";
import { actionColor, actionStyle, sizeRank, type ActionStyle, type ThemeName } from "../../theme/action-style.js";
import { MISSING_MARK, UNKNOWN_WEIGHT_MARK, formatEvShort, formatWeightShort } from "./cell-text.js";
import { isDarkFill } from "./color.js";
import { MATRIX_PALETTES, evFill, evInk, weightFill, weightInk, type ResolvedPalette } from "./matrix-theme.js";
import { GRID_SIZE, HAND_GRID } from "../../poker/hands.js";
import type { MatrixCell, MatrixMode, MatrixModel } from "./model.js";
import { MISSING_PATTERN_KEY, patternKey, type PatternSource } from "./patterns.js";

/** The slice of CanvasRenderingContext2D the matrix draws with. */
export interface MatrixCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
}

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
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ActionPaint {
  readonly color: string;
  readonly pattern: CanvasPattern | null;
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
/** What lastPlayedPosition returns when no action has a positive frequency. */
const NONE_PLAYED = -1;

/** The 14 integer edges that cut a backing store of sizeDevicePx into 13 cells. */
export function cellEdges(sizeDevicePx: number): number[] {
  return Array.from({ length: GRID_SIZE + 1 }, (_, index) => edgeAt(index, sizeDevicePx));
}

/** The integer position of cell edge index (0 to 13) in a backing store of sizeDevicePx. */
function edgeAt(index: number, sizeDevicePx: number): number {
  return Math.round((index * sizeDevicePx) / GRID_SIZE);
}

function patternOf(style: ActionStyle, variant: number, color: string, patterns: PatternSource): CanvasPattern | null {
  if (style.pattern === "none") return null;
  return patterns.get(patternKey(style.pattern, variant, isDarkFill(color) ? "light" : "dark"));
}

function actionPaints(actions: readonly NodeAction[], theme: ThemeName, patterns: PatternSource): ActionPaint[] {
  return actions.map((action) => {
    const color = actionColor(action, actions, theme);
    return { color, pattern: patternOf(actionStyle(action.kind), sizeRank(action, actions), color, patterns) };
  });
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

function fillWith(ctx: MatrixCanvasContext, style: string | CanvasPattern, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = style;
  ctx.fillRect(x, y, w, h);
}

/** The position of the last action with a positive frequency and a paint, or NONE_PLAYED. */
function lastPlayedPosition(frequencies: readonly number[], paints: readonly ActionPaint[]): number {
  for (let position = frequencies.length - 1; position >= 0; position -= 1) {
    if ((frequencies[position] ?? 0) > 0 && paints[position] !== undefined) return position;
  }
  return NONE_PLAYED;
}

/**
 * Lays the played actions' bars left to right. The last played bar always runs to the cell's
 * right edge, so frequencies that sum slightly under 1 (the api rounds them) leave no unpainted
 * sliver of background at the right.
 */
function drawFrequencyCell(ctx: MatrixCanvasContext, cell: MatrixCell, rect: Rect, paints: readonly ActionPaint[]): void {
  const last = lastPlayedPosition(cell.frequencies, paints);
  let cumulative = 0;
  let left = rect.x;
  cell.frequencies.forEach((frequency, position) => {
    const paint = paints[position];
    if (frequency <= 0 || paint === undefined) return;
    cumulative += frequency;
    const right = position === last ? rect.x + rect.w : rect.x + Math.round(Math.min(1, cumulative) * rect.w);
    fillWith(ctx, paint.color, left, rect.y, right - left, rect.h);
    if (paint.pattern !== null) fillWith(ctx, paint.pattern, left, rect.y, right - left, rect.h);
    left = right;
  });
}

interface FrameContext {
  readonly ctx: MatrixCanvasContext;
  readonly model: MatrixModel;
  readonly mode: MatrixMode;
  readonly palette: ResolvedPalette;
  readonly paints: readonly ActionPaint[];
  readonly missingPattern: CanvasPattern | null;
}

/** True when the cell is drawn as missing: no row, or (weight mode) an unknown weight. */
function drawnMissing(cell: MatrixCell, mode: MatrixMode): boolean {
  return !cell.present || (mode === "weight" && cell.weight === null);
}

/** Frequency bars and missing cells keep the label chip; EV and weight print on their own fill. */
function usesChip(cell: MatrixCell, mode: MatrixMode): boolean {
  return mode === "frequency" || drawnMissing(cell, mode);
}

function drawCellFill(frame: FrameContext, cell: MatrixCell, rect: Rect): void {
  const { ctx, palette } = frame;
  if (drawnMissing(cell, frame.mode)) {
    fillWith(ctx, palette.missingFill, rect.x, rect.y, rect.w, rect.h);
    if (frame.missingPattern !== null) fillWith(ctx, frame.missingPattern, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  if (frame.mode === "frequency") drawFrequencyCell(ctx, cell, rect, frame.paints);
  else if (frame.mode === "ev") fillWith(ctx, evFill(palette, cell.evBestBb ?? 0, frame.model.evScaleBb), rect.x, rect.y, rect.w, rect.h);
  else fillWith(ctx, weightFill(palette, cell.weight) ?? palette.missingFill, rect.x, rect.y, rect.w, rect.h);
}

/** The ink of a cell's texts: the label colour on a chip, else the step's own ink. */
function cellInk(frame: FrameContext, cell: MatrixCell): string {
  if (usesChip(cell, frame.mode)) return frame.palette.labelText;
  if (frame.mode === "ev") return evInk(frame.palette, cell.evBestBb ?? 0, frame.model.evScaleBb);
  return weightInk(frame.palette, cell.weight);
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

/** The printed value of a cell in a mode; null when the mode prints none (frequency). */
function valueText(cell: MatrixCell, mode: MatrixMode): string | null {
  if (!cell.present) return MISSING_MARK;
  if (mode === "ev") return formatEvShort(cell.evBestBb ?? 0);
  if (mode === "weight") return cell.weight === null ? UNKNOWN_WEIGHT_MARK : formatWeightShort(cell.weight);
  return null;
}

function drawChips(frame: FrameContext, rects: readonly Rect[], layout: TextLayout): void {
  const { ctx } = frame;
  ctx.fillStyle = frame.palette.labelChip;
  frame.model.cells.forEach((cell, index) => {
    if (!usesChip(cell, frame.mode)) return;
    const rect = rectAt(rects, index);
    ctx.fillRect(rect.x, rect.y, Math.min(rect.w, layout.labelChipW), Math.min(rect.h, layout.labelChipH));
    if (valueText(cell, frame.mode) === null) return;
    const x = rect.x + Math.floor((rect.w - layout.valueChipW) / 2);
    ctx.fillRect(x, rect.y + rect.h - layout.valueChipH, layout.valueChipW, layout.valueChipH);
  });
}

/**
 * Prints every hand label, then every value. The ink changes per cell only in EV and weight
 * modes, and it is a string from the resolved palette, so no colour is allocated per cell.
 */
function drawTexts(frame: FrameContext, rects: readonly Rect[], layout: TextLayout): void {
  const { ctx } = frame;
  ctx.font = layout.labelFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  frame.model.cells.forEach((cell, index) => {
    const rect = rectAt(rects, index);
    ctx.fillStyle = cellInk(frame, cell);
    ctx.fillText(cell.hand, rect.x + layout.pad, rect.y + layout.pad);
  });
  ctx.font = layout.valueFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  frame.model.cells.forEach((cell, index) => {
    const text = valueText(cell, frame.mode);
    if (text === null) return;
    const rect = rectAt(rects, index);
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

function drawOutlines(frame: FrameContext, rects: readonly Rect[], options: DrawOptions): void {
  const ratio = options.pixelRatio;
  if (options.selectedHand !== null) {
    const index = frame.model.cells.findIndex((cell) => cell.hand === options.selectedHand);
    outline(frame.ctx, rects[index], frame.palette.selected, Math.round(SELECTED_LINE_CSS_PX * ratio));
  }
  if (options.focusedIndex !== null) {
    const rect = rects[options.focusedIndex];
    const width = Math.round(FOCUS_LINE_CSS_PX * ratio);
    outline(frame.ctx, rect, frame.palette.focus, width);
    // A thin line of the ground inside the ring, so the ring shows on a fill of its own hue.
    const halo = rect === undefined ? undefined : { x: rect.x + width, y: rect.y + width, w: rect.w - 2 * width, h: rect.h - 2 * width };
    outline(frame.ctx, halo, frame.palette.focusHalo, Math.max(1, Math.round(HALO_LINE_CSS_PX * ratio)));
  }
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
  };
  const rects = cellRects(size);
  fillWith(ctx, palette.background, 0, 0, size, size);
  model.cells.forEach((cell, index) => {
    drawCellFill(frame, cell, rectAt(rects, index));
  });
  drawGridLines(ctx, size, options.pixelRatio, palette.gridLine);
  const layout = textLayout(edgeAt(1, size), options.pixelRatio);
  drawChips(frame, rects, layout);
  drawTexts(frame, rects, layout);
  drawOutlines(frame, rects, options);
}
