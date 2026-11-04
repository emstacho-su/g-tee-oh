/**
 * The per-cell fills of the range matrix (S24, S45, R3.12, R3.24), split out of draw.ts so each
 * lens stays small: stacked frequency bars with their hatch (frequency and strategy with EV, the
 * bars scaled to the cell's range weight when asked, O-465), the diverging expected value (EV) step,
 * the weight step filling the whole cell, and the compare-to-best step from the chosen action's
 * served loss (O-462, O-464). Missing hands, unknown weights (weight mode) and zero weights (scaled
 * bars) take the missing fill and hatch. With a highlight set (the action filters, O-468) the bar
 * lenses paint only the highlighted actions' shares, in place, and every lens dims a hand that plays
 * none of them under a translucent overlay, hatch and letters left showing. Pure over the MatrixCanvasContext slice; the frame context
 * holds everything resolved once per frame, so nothing is allocated per cell.
 */
import type { NodeAction } from "../../contracts.js";
import { actionColor, actionStyle, sizeRank, type ActionStyle, type ThemeName } from "../../theme/action-style.js";
import { isDarkFill } from "../../theme/color-contrast.js";
import { MISSING_MARK, UNKNOWN_WEIGHT_MARK, formatEvShort, formatLossShort, formatWeightShort } from "./cell-text.js";
import { evFill, evInk, lossFill, lossInk, weightFill, weightInk, type ResolvedPalette } from "./matrix-theme.js";
import { BAR_MODES, type MatrixCell, type MatrixMode, type MatrixModel } from "./model.js";
import { patternKey, type PatternSource } from "./patterns.js";

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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ActionPaint {
  readonly color: string;
  readonly pattern: CanvasPattern | null;
}

/** Everything a frame resolves once before painting the 169 cells. */
export interface FrameContext {
  readonly ctx: MatrixCanvasContext;
  readonly model: MatrixModel;
  readonly mode: MatrixMode;
  readonly palette: ResolvedPalette;
  readonly paints: readonly ActionPaint[];
  readonly missingPattern: CanvasPattern | null;
  /** Bars take the cell's weight as their height (O-465); bar modes only. */
  readonly scaleByWeight: boolean;
  /** The compared action's position and scale end in compare mode; null outside it or with no action. */
  readonly lens: { readonly position: number; readonly scalePctPot: number } | null;
  /** The highlighted action positions (O-468), or null when nothing is filtered. */
  readonly highlight: ReadonlySet<number> | null;
}

/** What lastPlayedPosition returns when no action has a positive frequency. */
const NONE_PLAYED = -1;
const FULL_WEIGHT = 1;

function patternOf(style: ActionStyle, variant: number, color: string, patterns: PatternSource): CanvasPattern | null {
  if (style.pattern === "none") return null;
  return patterns.get(patternKey(style.pattern, variant, isDarkFill(color) ? "light" : "dark"));
}

export function actionPaints(actions: readonly NodeAction[], theme: ThemeName, patterns: PatternSource): ActionPaint[] {
  return actions.map((action) => {
    const color = actionColor(action, actions, theme);
    return { color, pattern: patternOf(actionStyle(action.kind), sizeRank(action, actions), color, patterns) };
  });
}

export function fillWith(ctx: MatrixCanvasContext, style: string | CanvasPattern, x: number, y: number, w: number, h: number): void {
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

/** True in the modes whose cells are frequency bars. */
export function isBarMode(mode: MatrixMode): boolean {
  return BAR_MODES.includes(mode);
}

/** The bar band of a cell: the whole cell, or its bottom share by weight when the bars scale (full when unknown). */
function barBand(frame: FrameContext, cell: MatrixCell, rect: Rect): Rect {
  if (!frame.scaleByWeight || cell.weight === null) return rect;
  const height = Math.round(Math.min(FULL_WEIGHT, cell.weight) * rect.h);
  return { x: rect.x, y: rect.y + rect.h - height, w: rect.w, h: height };
}

/**
 * Lays the played actions' bars left to right inside the band. The last played bar always runs to
 * the cell's right edge, so frequencies that sum slightly under 1 (the api rounds them) leave no
 * unpainted sliver of background at the right.
 */
function drawFrequencyCell(frame: FrameContext, cell: MatrixCell, rect: Rect): void {
  const { ctx, paints } = frame;
  const band = barBand(frame, cell, rect);
  const last = lastPlayedPosition(cell.frequencies, paints);
  let cumulative = 0;
  let left = band.x;
  cell.frequencies.forEach((frequency, position) => {
    const paint = paints[position];
    if (frequency <= 0 || paint === undefined) return;
    cumulative += frequency;
    const right = position === last ? band.x + band.w : band.x + Math.round(Math.min(1, cumulative) * band.w);
    // A share the filters leave out keeps its place but stays the ground (O-468).
    if (frame.highlight === null || frame.highlight.has(position)) {
      fillWith(ctx, paint.color, left, band.y, right - left, band.h);
      if (paint.pattern !== null) fillWith(ctx, paint.pattern, left, band.y, right - left, band.h);
    }
    left = right;
  });
}

/** A zero weight under scaled bars: the hand is held but none of it reaches this node. */
function scaledOut(frame: FrameContext, cell: MatrixCell): boolean {
  return isBarMode(frame.mode) && frame.scaleByWeight && cell.weight !== null && cell.weight <= 0;
}

/** True when the cell is drawn as missing: no row, (weight mode) an unknown weight, or (scaled bars) a zero weight. */
export function drawnMissing(frame: FrameContext, cell: MatrixCell): boolean {
  return !cell.present || (frame.mode === "weight" && cell.weight === null) || scaledOut(frame, cell);
}

/** Frequency bars and missing cells keep the label chip; EV, weight and compare print on their own fill. */
export function usesChip(frame: FrameContext, cell: MatrixCell): boolean {
  return isBarMode(frame.mode) || drawnMissing(frame, cell);
}

export function drawCellFill(frame: FrameContext, cell: MatrixCell, rect: Rect): void {
  const { ctx, palette, lens } = frame;
  if (drawnMissing(frame, cell)) {
    fillWith(ctx, palette.missingFill, rect.x, rect.y, rect.w, rect.h);
    if (frame.missingPattern !== null) fillWith(ctx, frame.missingPattern, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  if (isBarMode(frame.mode)) drawFrequencyCell(frame, cell, rect);
  else if (frame.mode === "ev") fillWith(ctx, evFill(palette, cell.evBestBb ?? 0, frame.model.evScaleBb), rect.x, rect.y, rect.w, rect.h);
  else if (frame.mode === "compare") {
    const fill = lens === null ? palette.missingFill : lossFill(palette, cell.lossPctPot[lens.position] ?? 0, lens.scalePctPot);
    fillWith(ctx, fill, rect.x, rect.y, rect.w, rect.h);
  } else fillWith(ctx, weightFill(palette, cell.weight) ?? palette.missingFill, rect.x, rect.y, rect.w, rect.h);
}

/** True when the filters leave the hand out: present, filtered, and playing none of the highlighted actions. */
export function dimmed(frame: FrameContext, cell: MatrixCell): boolean {
  if (frame.highlight === null || !cell.present) return false;
  // A loop over the Set, so a frame allocates nothing per cell (the 16 ms budget, O-260; code review).
  for (const position of frame.highlight) {
    if ((cell.frequencies[position] ?? 0) > 0) return false;
  }
  return true;
}

/** The ink of a cell's texts: the label colour on a chip, else the step's own ink. */
export function cellInk(frame: FrameContext, cell: MatrixCell): string {
  if (usesChip(frame, cell)) return frame.palette.labelText;
  if (frame.mode === "ev") return evInk(frame.palette, cell.evBestBb ?? 0, frame.model.evScaleBb);
  if (frame.mode === "compare") {
    return frame.lens === null ? frame.palette.labelText : lossInk(frame.palette, cell.lossPctPot[frame.lens.position] ?? 0, frame.lens.scalePctPot);
  }
  return weightInk(frame.palette, cell.weight);
}

/** The printed value of a cell in a mode; null when the mode prints none (frequency, a scaled-out cell). */
export function valueText(frame: FrameContext, cell: MatrixCell): string | null {
  if (!cell.present) return MISSING_MARK;
  if (scaledOut(frame, cell)) return null;
  switch (frame.mode) {
    case "ev":
    case "strategy_ev":
      return formatEvShort(cell.evBestBb ?? 0);
    case "weight":
      return cell.weight === null ? UNKNOWN_WEIGHT_MARK : formatWeightShort(cell.weight);
    case "compare":
      return frame.lens === null ? MISSING_MARK : formatLossShort(cell.lossPctPot[frame.lens.position] ?? 0);
    case "frequency":
      return null;
  }
}
