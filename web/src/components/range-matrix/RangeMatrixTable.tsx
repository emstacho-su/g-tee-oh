/**
 * The accessible table fallback of the range matrix (S24, R3.12, A7 section 4).
 *
 * Mechanism: a real <table> of 13 rows by 13 columns with rank letters as row and column
 * headers, one cell per hand class in grid order, built from the same MatrixModel the canvas
 * draws (cell-text.ts formats both), so a screen reader user reads exactly the numbers the canvas
 * shows. The caption names the mode. RangeMatrix keeps the table in the DOM at all times, for
 * screen readers only (S38, O-347: no visible table), and points the canvas's aria-describedby at
 * its id; sighted users get the same numbers from the pop-out.
 */
import { memo } from "react";

import { RANKS } from "../../poker/cards.js";
import { GRID_SIZE } from "../../poker/hands.js";
import { MODE_NAMES, cellText } from "./cell-text.js";
import type { MatrixMode, MatrixModel } from "./model.js";

export interface RangeMatrixTableProps {
  model: MatrixModel;
  mode: MatrixMode;
  /** The table's id, which the canvas references through aria-describedby. */
  id: string;
}

const ROW_INDEXES = Array.from({ length: GRID_SIZE }, (_, index) => index);

/**
 * Memoized: model comes memoized per node, mode is a string and id comes from useId, so a focus
 * move or a selection change in RangeMatrix does not re-render the 169 cells.
 */
export const RangeMatrixTable = memo(function RangeMatrixTable({ model, mode, id }: RangeMatrixTableProps) {
  return (
    <table id={id} className="w-full border-collapse text-xs">
      <caption className="mb-1 text-left text-sm font-semibold">
        {`Range matrix, ${MODE_NAMES[mode]} mode: rows are the first rank, columns the second; suited above the pairs, offsuit below`}
      </caption>
      <thead>
        <tr>
          <th scope="col" className="border border-border px-1">
            Hand
          </th>
          {RANKS.map((rank) => (
            <th key={rank} scope="col" className="border border-border px-1">
              {rank}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROW_INDEXES.map((row) => (
          <tr key={RANKS[row]}>
            <th scope="row" className="border border-border px-1">
              {RANKS[row]}
            </th>
            {model.cells.slice(row * GRID_SIZE, (row + 1) * GRID_SIZE).map((cell) => (
              <td key={cell.hand} className="border border-border px-1 align-top">
                {cellText(cell, model.actions, mode)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
});
