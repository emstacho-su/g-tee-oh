/**
 * The 169 preflop hand classes in 13 by 13 grid order (S24, R3.12). Row and column both run
 * from A down to 2. The diagonal holds the pairs (AA, KK, ...), the cells above it the suited
 * hands (row rank first: AKs at row A, column K) and the cells below it the offsuit hands (column
 * rank first: AKo at row K, column A). This is the conventional chart layout, so the matrix reads
 * the way every preflop chart does.
 */
import { RANKS, type Rank } from "./cards.js";

export const GRID_SIZE = RANKS.length;
export const HAND_CLASS_COUNT = GRID_SIZE * GRID_SIZE;

export type HandKind = "pair" | "suited" | "offsuit";

export interface HandCell {
  readonly hand: string;
  readonly row: number;
  readonly col: number;
  readonly kind: HandKind;
  /** Card combinations of this class: 6 for a pair, 4 suited, 12 offsuit. */
  readonly combos: number;
}

const COMBOS: Readonly<Record<HandKind, number>> = { pair: 6, suited: 4, offsuit: 12 };

function rankAt(index: number): Rank {
  const rank = RANKS[index];
  if (rank === undefined) throw new RangeError(`no rank at grid index ${index}`);
  return rank;
}

/** The hand class at a grid position. */
export function handAt(row: number, col: number): HandCell {
  const high = rankAt(Math.min(row, col));
  const low = rankAt(Math.max(row, col));
  if (row === col) return { hand: `${high}${low}`, row, col, kind: "pair", combos: COMBOS.pair };
  const kind: HandKind = row < col ? "suited" : "offsuit";
  return { hand: `${high}${low}${kind === "suited" ? "s" : "o"}`, row, col, kind, combos: COMBOS[kind] };
}

/** All 169 cells, row by row from AA to 22. */
export const HAND_GRID: readonly HandCell[] = Object.freeze(
  Array.from({ length: HAND_CLASS_COUNT }, (_, index) => handAt(Math.floor(index / GRID_SIZE), index % GRID_SIZE)),
);

const CELL_BY_HAND: ReadonlyMap<string, HandCell> = new Map(HAND_GRID.map((cell) => [cell.hand, cell]));

/** The cell of a hand class such as "AKs", "T9o" or "77"; undefined for anything else. */
export function cellOf(hand: string): HandCell | undefined {
  return CELL_BY_HAND.get(hand);
}
