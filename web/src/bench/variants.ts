/**
 * Synthetic study nodes for the matrix frame bench (S24, R3.12, O-260, O-26).
 *
 * Mechanism: the bench draws fresh data every frame, so it rotates through several nodes that
 * differ in every cell. Each variant reuses the fixture formula (fixtureHandRow) at shifted grid
 * positions, so the strategies, EVs and weights move around the matrix; one variant drops every
 * seventh hand (missing cells) and one splits the raise into two sizes (five actions, two
 * diagonal hatch spacings), which is the heaviest frequency frame. Synthetic numbers only.
 */
import type { NodeAction, NodeHandRow } from "../contracts.js";
import type { MatrixSource } from "../components/range-matrix/model.js";
import { fixtureActions, fixtureHandRow } from "../fixtures/index.js";
import { GRID_SIZE, HAND_GRID } from "../poker/hands.js";

const ROW_SHIFTS = [0, 3, 6, 9, 11] as const;
const COL_SHIFT_FACTOR = 5;
const DROP_EVERY = 7;
const DROPPING_VARIANT = 2;
const SPLIT_VARIANT = 4;
const RAISE_POSITION = 2;
const SECOND_RAISE_SHARE = 0.4;

const SPLIT_ACTIONS: readonly NodeAction[] = [
  ...fixtureActions.slice(0, RAISE_POSITION + 1),
  { index: 3, token: "r600", kind: "raise", size_cbb: 600, bucket: "overbet", label: "Raise to 6bb", next_node_key: null },
  { index: 4, token: "r10000", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "All-in 100bb", next_node_key: null },
];

function shiftedRow(hand: string, row: number, col: number, variant: number): NodeHandRow {
  const rowShift = ROW_SHIFTS[variant % ROW_SHIFTS.length] ?? 0;
  return fixtureHandRow(hand, (row + rowShift) % GRID_SIZE, (col + variant * COL_SHIFT_FACTOR) % GRID_SIZE);
}

/** Inserts a second raise size after the first: the raise frequency and EV split in two. */
function splitRaise(row: NodeHandRow): NodeHandRow {
  const insert = <T>(values: readonly T[], extra: T): T[] => [
    ...values.slice(0, RAISE_POSITION + 1),
    extra,
    ...values.slice(RAISE_POSITION + 1),
  ];
  const raise = row.strategy[RAISE_POSITION] ?? 0;
  const strategy = row.strategy.map((value, position) =>
    position === RAISE_POSITION ? value * (1 - SECOND_RAISE_SHARE) : value,
  );
  return {
    ...row,
    strategy: insert(strategy, raise * SECOND_RAISE_SHARE),
    ev_bb: insert(row.ev_bb, (row.ev_bb[RAISE_POSITION] ?? 0) * (1 - SECOND_RAISE_SHARE)),
    loss_pct_pot: insert(row.loss_pct_pot, row.loss_pct_pot[RAISE_POSITION] ?? 0),
  };
}

function variant(index: number): MatrixSource {
  const rows = HAND_GRID.map((cell) => shiftedRow(cell.hand, cell.row, cell.col, index));
  if (index === SPLIT_VARIANT) return { actions: [...SPLIT_ACTIONS], hands: rows.map(splitRaise) };
  const hands = index === DROPPING_VARIANT ? rows.filter((_, position) => position % DROP_EVERY !== 0) : rows;
  return { actions: [...fixtureActions], hands };
}

/** The bench's rotating nodes, built once before timing starts. */
export function benchVariants(): readonly MatrixSource[] {
  return ROW_SHIFTS.map((_, index) => variant(index));
}
