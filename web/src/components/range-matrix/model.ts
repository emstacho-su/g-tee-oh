/**
 * The range matrix model (S24, S45, R3.12, R3.24): the 169 hand classes of a study node in 13 by
 * 13 grid order, each with the numbers the api sent for it.
 *
 * Mechanism: buildMatrixModel walks HAND_GRID (src/poker/hands.ts) and looks every class up in
 * the node's hand rows. A class the node has no row for is kept as a missing cell, so the canvas
 * and the table always have 169 cells in the same order. The numbers are copied, never
 * recomputed (ADR 0004): strategy is the per-action frequency, ev_bb the per-action expected
 * value (EV) in big blinds, loss_pct_pot the per-action loss against the best action in percent
 * of the pot (what Compare to Best paints, O-462), ev_best_bb the best EV, and the acting seat's
 * reach the class's range weight (null means unknown). Reach is per seat in pair order, the
 * out-of-position seat first, so the index is 1 when the in-position seat acts and 0 otherwise
 * (O-463); a source that names no seats reads reach[0]. Rows are validated at this boundary: a
 * strategy, ev_bb or loss_pct_pot whose length is not the action count, a hand that is not one of
 * the 169 classes, or a hand that repeats throws a RangeError naming the hand, so a malformed node
 * fails loudly instead of drawing garbage. The model is the single source for both the canvas and
 * the table fallback, which is how the two always show the same data.
 */
import type { NodeAction, NodeHandRow, StudyNode } from "../../contracts.js";
import { HAND_GRID, cellOf, type HandKind } from "../../poker/hands.js";
import {
  COMPARE_NEUTRAL_PCT_POT,
  EV_NEUTRAL_BB,
  EV_SCALE_PERCENTILE,
  MIN_COMPARE_SCALE_PCT_POT,
  MIN_EV_SCALE_BB,
  nearestRank,
} from "./scales.js";

/**
 * The lenses (S45, R3.24): frequency bars, the best EV step, the range-weight step, frequency bars
 * with the best EV printed (strategy_ev) and the chosen action's loss against the best (compare).
 */
export type MatrixMode = "frequency" | "ev" | "weight" | "strategy_ev" | "compare";

export const MATRIX_MODES: readonly MatrixMode[] = ["frequency", "ev", "weight", "strategy_ev", "compare"];

/** The modes whose cells are frequency bars, the ones scale-by-weight applies to. */
export const BAR_MODES: readonly MatrixMode[] = ["frequency", "strategy_ev"];

export type SeatIndex = 0 | 1;

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
  /** Loss per action against the best action in percent of the pot, record order; 0 for the best. */
  readonly lossPctPot: readonly number[];
  readonly evBestBb: number | null;
  /** The acting seat's reach, the class's range weight; null when the api does not know it. */
  readonly weight: number | null;
}

export interface MatrixModel {
  readonly actions: readonly NodeAction[];
  readonly cells: readonly MatrixCell[];
  /** The end of the diverging EV scale (evScaleOf, O-384). */
  readonly evScaleBb: number;
  /** The end of the compare scale per action position (lossScaleOf, O-464). */
  readonly lossScalePctPot: readonly number[];
  /** Which seat's reach is the weight: 0 out of position, 1 in position (O-463). */
  readonly actingSeat: SeatIndex;
  /** How many of the 169 classes the node holds. */
  readonly presentCount: number;
}

/**
 * The part of a StudyNode the matrix reads, so callers and the bench can pass less. The pair and
 * the seat to act name the reach index (O-463); without them reach[0] is the weight.
 */
export type MatrixSource = Pick<StudyNode, "actions" | "hands"> & Partial<Pick<StudyNode, "to_act" | "pair">>;

const EMPTY: readonly number[] = Object.freeze([]);
const PAIR_SEPARATOR = "-";
const IN_POSITION: SeatIndex = 1;
const OUT_OF_POSITION: SeatIndex = 0;

/** The index of the acting seat's reach: 1 when the seat to act is the pair's in-position (second) seat, else 0. */
export function actingSeatIndex(source: Pick<MatrixSource, "to_act" | "pair">): SeatIndex {
  if (source.pair === undefined || source.to_act === undefined) return OUT_OF_POSITION;
  const inPosition = source.pair.split(PAIR_SEPARATOR)[1];
  return inPosition === source.to_act ? IN_POSITION : OUT_OF_POSITION;
}

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
  if (row.loss_pct_pot.length !== actionCount) {
    throw new RangeError(
      `range matrix: hand ${row.hand} has ${row.loss_pct_pot.length} loss_pct_pot entries for ${actionCount} actions`,
    );
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
 * best EV over the present cells outside the neutral band, never below MIN_EV_SCALE_BB, so one huge
 * hand does not wash the rest of the matrix out; beyond it the end step holds. Cells inside the band
 * (a fold's EV is exactly 0) paint neutral and never set the end: on a fold-heavy node they would
 * otherwise pull the end down to the floor and paint every played hand the end step (review round 1).
 */
export function evScaleOf(cells: readonly MatrixCell[]): number {
  const sizes = cells
    .filter((cell) => cell.present)
    .map((cell) => Math.abs(cell.evBestBb ?? 0))
    .filter((size) => size >= EV_NEUTRAL_BB);
  return Math.max(MIN_EV_SCALE_BB, nearestRank(sizes, EV_SCALE_PERCENTILE) ?? 0);
}

/**
 * The end of the compare scale for one action position (O-464): the same nearest-rank rule over
 * that action's served losses outside the neutral band, never below MIN_COMPARE_SCALE_PCT_POT.
 */
export function lossScaleOf(cells: readonly MatrixCell[], position: number): number {
  const losses = cells
    .filter((cell) => cell.present)
    .map((cell) => cell.lossPctPot[position] ?? 0)
    .filter((loss) => loss >= COMPARE_NEUTRAL_PCT_POT);
  return Math.max(MIN_COMPARE_SCALE_PCT_POT, nearestRank(losses, EV_SCALE_PERCENTILE) ?? 0);
}

/** The action Compare to Best shows when the address names none: the first that is not a fold, or null. */
export function defaultLensPosition(actions: readonly NodeAction[]): number | null {
  const position = actions.findIndex((action) => action.kind !== "fold");
  return position < 0 ? null : position;
}

/** The position of a NodeAction.index in the actions, or null when no action carries it. */
export function lensPositionOf(actions: readonly NodeAction[], lensIndex: number | null | undefined): number | null {
  if (lensIndex === null || lensIndex === undefined) return null;
  const position = actions.findIndex((action) => action.index === lensIndex);
  return position < 0 ? null : position;
}

const FULL_WEIGHT = 1;

/**
 * Whether the bars scale by weight unless the user says otherwise (O-465): on when any present
 * cell is known to hold less than its full class, or when the street is postflop, where ranges
 * are always partial; off on a preflop root where every hand is fully in the range.
 */
export function defaultScaleByWeight(cells: readonly MatrixCell[], street: StudyNode["street"]): boolean {
  if (street !== "preflop") return true;
  return cells.some((cell) => cell.present && cell.weight !== null && cell.weight < FULL_WEIGHT);
}

export function buildMatrixModel(node: MatrixSource): MatrixModel {
  const rows = indexRows(node.hands, node.actions.length);
  const actingSeat = actingSeatIndex(node);
  const cells: MatrixCell[] = HAND_GRID.map((grid) => {
    const row = rows.get(grid.hand);
    if (row === undefined) {
      return { ...grid, present: false, frequencies: EMPTY, evBb: EMPTY, lossPctPot: EMPTY, evBestBb: null, weight: null };
    }
    return {
      ...grid,
      present: true,
      frequencies: row.strategy,
      evBb: row.ev_bb,
      lossPctPot: row.loss_pct_pot,
      evBestBb: row.ev_best_bb,
      weight: row.reach?.[actingSeat] ?? null,
    };
  });
  return {
    actions: node.actions,
    cells,
    evScaleBb: evScaleOf(cells),
    lossScalePctPot: node.actions.map((_, position) => lossScaleOf(cells, position)),
    actingSeat,
    presentCount: rows.size,
  };
}
