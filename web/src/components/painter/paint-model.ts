/**
 * The range painter's state (S27 lane B, R3.17, O-300, ADR 0020, ADR 0004): which action each
 * class is painted with, the brush in hand, and the strokes that can be undone. Pure functions over
 * immutable values, so RangePainter only wires events to them.
 *
 * Mechanism: a paint maps each class the node holds to a NodeAction.index (the brushes are the
 * node's tree actions, ADR 0020). It starts with every held class painted with the fold brush when
 * the node has one, else its first action. A stroke is one pointer press (or one keyboard paint, or
 * Paint all): beginStroke remembers the paint before it and paints the first cell, extendStroke
 * paints each cell the pressed pointer enters, and endStroke pushes the remembered paint onto the
 * undo history only when the stroke changed something. Undo restores the last pushed paint. Cells
 * the node does not hold are never painted. The history keeps at most MAX_UNDO strokes.
 *
 * The graded helpers only order, filter and bucket the api's numbers against named thresholds;
 * nothing here computes a loss (ADR 0004).
 */
import type { NodeAction, RangePaintResult } from "../../contracts.js";

export type Paint = Readonly<Record<string, number>>;

export interface PaintState {
  readonly paint: Paint;
  readonly brush: number;
  readonly history: readonly Paint[];
  /** The paint before the stroke in progress; null between strokes. */
  readonly strokeStart: Paint | null;
}

/** Strokes Undo can take back; older ones are dropped. */
export const MAX_UNDO = 100;
/** Number keys 1 to 9 pick the first nine brushes. */
export const MAX_BRUSH_HOTKEYS = 9;

/** The fold brush when the node has one, else its first action (the painter's starting brush). */
export function defaultBrush(actions: readonly NodeAction[]): number {
  const fold = actions.find((action) => action.kind === "fold");
  const first = fold ?? actions[0];
  if (first === undefined) throw new RangeError("a node to paint needs at least one action");
  return first.index;
}

/** Every held class painted with the default brush, which is also the brush in hand. */
export function initialPaintState(hands: readonly string[], actions: readonly NodeAction[]): PaintState {
  const brush = defaultBrush(actions);
  return { paint: Object.fromEntries(hands.map((hand) => [hand, brush])), brush, history: [], strokeStart: null };
}

export function selectBrush(state: PaintState, brush: number): PaintState {
  return state.brush === brush ? state : { ...state, brush };
}

function paintCell(paint: Paint, hand: string, brush: number): Paint {
  if (!Object.hasOwn(paint, hand) || paint[hand] === brush) return paint;
  return { ...paint, [hand]: brush };
}

export function beginStroke(state: PaintState, hand: string): PaintState {
  return { ...state, strokeStart: state.paint, paint: paintCell(state.paint, hand, state.brush) };
}

/** Paints a cell the pressed pointer entered; nothing between strokes. */
export function extendStroke(state: PaintState, hand: string): PaintState {
  if (state.strokeStart === null) return state;
  const paint = paintCell(state.paint, hand, state.brush);
  return paint === state.paint ? state : { ...state, paint };
}

export function endStroke(state: PaintState): PaintState {
  const start = state.strokeStart;
  if (start === null) return state;
  const changed = start !== state.paint;
  return { ...state, strokeStart: null, history: changed ? [...state.history, start].slice(-MAX_UNDO) : state.history };
}

/** One keyboard or click paint of a single cell: a whole stroke. */
export function paintOne(state: PaintState, hand: string): PaintState {
  return endStroke(beginStroke(state, hand));
}

/** Every held class painted with the brush in hand, as one stroke. */
export function paintAll(state: PaintState): PaintState {
  const paint = Object.fromEntries(Object.keys(state.paint).map((hand) => [hand, state.brush]));
  const changed = Object.keys(paint).some((hand) => state.paint[hand] !== state.brush);
  return changed ? { ...state, paint, history: [...state.history, state.paint].slice(-MAX_UNDO), strokeStart: null } : state;
}

export function canUndo(state: PaintState): boolean {
  return state.history.length > 0 && state.strokeStart === null;
}

export function undo(state: PaintState): PaintState {
  const previous = state.history.at(-1);
  if (previous === undefined || state.strokeStart !== null) return state;
  return { ...state, paint: previous, history: state.history.slice(0, -1) };
}

/** The brush number key `position` (1 first) picks, or undefined past the node's actions. */
export function brushAtHotkey(actions: readonly NodeAction[], position: number): NodeAction | undefined {
  return position >= 1 && position <= MAX_BRUSH_HOTKEYS ? actions[position - 1] : undefined;
}

export type HandGrade = RangePaintResult["per_hand"][number];

/** Rows of the costliest classes table. */
export const COSTLIEST_ROWS = 10;

/** The classes with a weighted loss, costliest first (ties in the api's order), at most `limit`. */
export function costliest(perHand: readonly HandGrade[], limit = COSTLIEST_ROWS): HandGrade[] {
  return perHand
    .filter((row) => row.weighted_loss_bb > 0)
    .map((row, order) => ({ row, order }))
    .sort((left, right) => right.row.weighted_loss_bb - left.row.weighted_loss_bb || left.order - right.order)
    .map(({ row }) => row)
    .slice(0, limit);
}

export type LossShade = "none" | "low" | "medium" | "high";

/**
 * The shading buckets of the graded grid, by the api's weighted loss in bb per hand dealt: a class
 * below LOSS_SHADE_BB.medium costs under a hundredth of a big blind across the range.
 */
export const LOSS_SHADE_BB = { medium: 0.001, high: 0.01 } as const;

export function lossShade(weightedLossBb: number): LossShade {
  if (weightedLossBb <= 0) return "none";
  if (weightedLossBb >= LOSS_SHADE_BB.high) return "high";
  return weightedLossBb >= LOSS_SHADE_BB.medium ? "medium" : "low";
}
