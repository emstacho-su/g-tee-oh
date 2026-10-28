/**
 * The range matrix model (S24, R3.12): the 169 hand classes of a study node in 13 by 13 grid
 * order, each with the numbers the api sent for it.
 *
 * Mechanism: buildMatrixModel walks HAND_GRID (src/poker/hands.ts) and looks every class up in
 * the node's hand rows. A class the node has no row for is kept as a missing cell, so the canvas
 * and the table always have 169 cells in the same order. The numbers are copied, never
 * recomputed (ADR 0004): strategy is the per-action frequency, ev_bb the per-action expected
 * value (EV) in big blinds, ev_best_bb the best EV, and reach[0] the class's range weight (null
 * means unknown). Rows are validated at this boundary: a strategy or ev_bb whose length is not
 * the action count, a hand that is not one of the 169 classes, or a hand that repeats throws a
 * RangeError naming the hand, so a malformed node fails loudly instead of drawing garbage.
 * The model is the single source for both the canvas and the table fallback, which is how the
 * two always show the same data.
 */
import type { NodeAction, NodeHandRow, StudyNode } from "../../contracts.js";
import { HAND_GRID, cellOf, type HandKind } from "../../poker/hands.js";
import { EV_SCALE_PERCENTILE, MIN_EV_SCALE_BB, nearestRank } from "./scales.js";

export type MatrixMode = "frequency" | "ev" | "weight";

export const MATRIX_MODES: readonly MatrixMode[] = ["frequency", "ev", "weight"];

export interface MatrixCell {
  readonly hand: string;
  readonly row: number;
  readonly col: number;
  readonly kind: HandKind;
  readonly combos: number;
  /** False when the node has no row for this class; the number fields are then empty or null. */
  readonly present: boolean;
  /** Frequency per action in record order, 0..1. */
  readonly frequencies: readonly number[];
  /** EV per action in big blinds, record order. */
  readonly evBb: readonly number[];
  readonly evBestBb: number | null;
  /** reach[0], the class's range weight; null when the api does not know it. */
  readonly weight: number | null;
}

export interface MatrixModel {
  readonly actions: readonly NodeAction[];
  readonly cells: readonly MatrixCell[];
  /** The end of the diverging EV scale (evScaleOf, O-384). */
  readonly evScaleBb: number;
  /** How many of the 169 classes the node holds. */
  readonly presentCount: number;
}

/** The part of a StudyNode the matrix reads, so callers and the bench can pass less. */
export type MatrixSource = Pick<StudyNode, "actions" | "hands">;

const EMPTY: readonly number[] = Object.freeze([]);

function validateRow(row: NodeHandRow, actionCount: number): void {
  if (cellOf(row.hand) === undefined) {
    throw new RangeError(`range matrix: hand ${row.hand} is not one of the 169 hand classes`);
  }
  if (row.strategy.length !== actionCount) {
    throw new RangeError(
      `range matrix: hand ${row.hand} has ${row.strategy.length} strategy entries for ${actionCount} actions`,
    );
  }
  if (row.ev_bb.length !== actionCount) {
    throw new RangeError(`range matrix: hand ${row.hand} has ${row.ev_bb.length} ev_bb entries for ${actionCount} actions`);
  }
}

function indexRows(hands: readonly NodeHandRow[], actionCount: number): ReadonlyMap<string, NodeHandRow> {
  const rows = new Map<string, NodeHandRow>();
  for (const row of hands) {
    validateRow(row, actionCount);
    if (rows.has(row.hand)) throw new RangeError(`range matrix: hand ${row.hand} appears more than once`);
    rows.set(row.hand, row);
  }
  return rows;
}

/**
 * The end of the diverging EV scale (O-384): the 90th percentile (nearest rank) of the absolute
 * best EV over the present cells, never below MIN_EV_SCALE_BB, so one huge hand does not wash the
 * rest of the matrix out; beyond it the end step holds.
 */
export function evScaleOf(cells: readonly MatrixCell[]): number {
  const sizes = cells.filter((cell) => cell.present).map((cell) => Math.abs(cell.evBestBb ?? 0));
  return Math.max(MIN_EV_SCALE_BB, nearestRank(sizes, EV_SCALE_PERCENTILE) ?? 0);
}

export function buildMatrixModel(node: MatrixSource): MatrixModel {
  const rows = indexRows(node.hands, node.actions.length);
  const cells: MatrixCell[] = HAND_GRID.map((grid) => {
    const row = rows.get(grid.hand);
    if (row === undefined) {
      return { ...grid, present: false, frequencies: EMPTY, evBb: EMPTY, evBestBb: null, weight: null };
    }
    return {
      ...grid,
      present: true,
      frequencies: row.strategy,
      evBb: row.ev_bb,
      evBestBb: row.ev_best_bb,
      weight: row.reach?.[0] ?? null,
    };
  });
  return { actions: node.actions, cells, evScaleBb: evScaleOf(cells), presentCount: rows.size };
}
