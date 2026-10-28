/**
 * The mastery heat map's view model (S32, R4.12, 06 section 7, O-320, O-253). Pure.
 *
 * Mechanism: every cell's p_known falls in one of five ordinal bins (under 0.25, 0.25 to under
 * 0.5, 0.5 to under 0.75, 0.75 to under 0.95, and 0.95 and up), each bin naming its Tailwind fill
 * (bg-heat-1 to bg-heat-5, the validated ramp in styles.css) and its ink (bins 1 and 2 take
 * text-heat-ink-low, bins 3 to 5 text-heat-ink-high, so every label keeps its contrast). A cell
 * never practiced (p_known null) has no bin and reads "new". A practiced cell is due when its
 * retrievability is at or under the retention its class is scheduled at, learning's
 * retentionFor(mastered) (0.9, or 0.85 once mastered); web reads that function from
 * @g-tee-oh/learning (O-262), so the rule cannot drift from the scheduler. Rows are grouped by
 * family in the order the api lists them, each row keeping its api index, and cells are found by
 * (row, column) through one lookup map. Every figure shown comes from the api response; nothing
 * here reads a spot_class_key (ADR 0004).
 */
import { retentionFor } from "@g-tee-oh/learning";

import { formatPercent } from "./format.js";
import type { HeatmapCell, HeatmapColumn, HeatmapRow, ProgressHeatmap } from "./types.js";

export type HeatBin = 1 | 2 | 3 | 4 | 5;

/** The lower edges of bins 2 to 5 (lower edge inclusive). */
export const HEAT_BIN_EDGES = [0.25, 0.5, 0.75, 0.95] as const;
export const HEAT_BINS: readonly HeatBin[] = [1, 2, 3, 4, 5];

export const HEAT_FILL: Readonly<Record<HeatBin, string>> = {
  1: "bg-heat-1",
  2: "bg-heat-2",
  3: "bg-heat-3",
  4: "bg-heat-4",
  5: "bg-heat-5",
};

const INK_LOW = "text-heat-ink-low";
const INK_HIGH = "text-heat-ink-high";

export const HEAT_INK: Readonly<Record<HeatBin, string>> = { 1: INK_LOW, 2: INK_LOW, 3: INK_HIGH, 4: INK_HIGH, 5: INK_HIGH };

/** The legend's words for each bin. */
export const HEAT_BIN_LABELS: Readonly<Record<HeatBin, string>> = {
  1: "Under 25% known",
  2: "25% to 49%",
  3: "50% to 74%",
  4: "75% to 94%",
  5: "95% and up",
};

export const NEW_CELL_TEXT = "new";

export function heatBin(pKnown: number): HeatBin {
  const passed = HEAT_BIN_EDGES.filter((edge) => pKnown >= edge).length;
  return (passed + 1) as HeatBin;
}

/** Due for review: practiced, with retrievability at or under its class's retention (O-253). */
export function isCellDue(cell: HeatmapCell): boolean {
  return cell.retrievability !== null && cell.retrievability <= retentionFor(cell.mastered);
}

const BAND_IN_BB = /^\d+$/;

/** "100 bb" for a numeric band, the band itself ("short", "deep") otherwise. */
export function depthBandLabel(band: string): string {
  return BAND_IN_BB.test(band) ? `${band} bb` : band;
}

export function columnLabel(column: HeatmapColumn): string {
  return `${column.format} ${depthBandLabel(column.depth_band)}`;
}

export function rowLabel(row: HeatmapRow): string {
  return `${row.family} ${row.pair}`;
}

export function classLabel(row: HeatmapRow, column: HeatmapColumn): string {
  return `${rowLabel(row)}, ${columnLabel(column)}`;
}

export interface HeatRowEntry {
  /** The row's index in the api's rows. */
  readonly index: number;
  readonly row: HeatmapRow;
}

export interface HeatFamilyGroup {
  readonly family: string;
  readonly rows: readonly HeatRowEntry[];
}

/** Rows grouped by family, families in the order they first appear, rows in api order. */
export function groupRowsByFamily(rows: readonly HeatmapRow[]): HeatFamilyGroup[] {
  const families = [...new Set(rows.map((row) => row.family))];
  return families.map((family) => ({
    family,
    rows: rows.flatMap((row, index) => (row.family === family ? [{ index, row }] : [])),
  }));
}

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export type CellLookup = (row: number, column: number) => HeatmapCell | undefined;

export function cellLookup(heatmap: ProgressHeatmap): CellLookup {
  const cells = new Map(heatmap.cells.map((cell) => [cellKey(cell.row, cell.column), cell]));
  return (row, column) => cells.get(cellKey(row, column));
}

/** The text and styling of one cell. */
export interface HeatCellView {
  readonly cell: HeatmapCell;
  readonly row: HeatmapRow;
  readonly column: HeatmapColumn;
  readonly classText: string;
  /** Null when never practiced. */
  readonly bin: HeatBin | null;
  /** "62%" or "new". */
  readonly text: string;
  readonly due: boolean;
  /** Retrievability as a 0 to 100 bar length, null when never practiced. */
  readonly recallPercent: number | null;
  /** The cell button's accessible name: class and every figure the tooltip shows. */
  readonly label: string;
  /** The tooltip's lines. */
  readonly details: readonly string[];
}

const PERCENT = 100;

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function detailsOf(cell: HeatmapCell, due: boolean): string[] {
  return [
    `Known: ${cell.p_known === null ? "never practiced" : formatPercent(cell.p_known)}`,
    `Recall: ${cell.retrievability === null ? "not scheduled" : formatPercent(cell.retrievability)}`,
    `Attempts: ${cell.n}`,
    `Mastered: ${yesNo(cell.mastered)}`,
    `Due for review: ${yesNo(due)}`,
  ];
}

export function cellView(cell: HeatmapCell, row: HeatmapRow, column: HeatmapColumn): HeatCellView {
  const due = isCellDue(cell);
  const classText = classLabel(row, column);
  const details = detailsOf(cell, due);
  return {
    cell,
    row,
    column,
    classText,
    bin: cell.p_known === null ? null : heatBin(cell.p_known),
    text: cell.p_known === null ? NEW_CELL_TEXT : formatPercent(cell.p_known),
    due,
    recallPercent: cell.retrievability === null ? null : Math.round(cell.retrievability * PERCENT),
    label: `${classText}: ${details.join(", ")}`,
    details,
  };
}

/** The view of the cell at (row, column), or undefined when the api sent none there. */
export function cellViewAt(heatmap: ProgressHeatmap, lookup: CellLookup, rowIndex: number, columnIndex: number): HeatCellView | undefined {
  const cell = lookup(rowIndex, columnIndex);
  const row = heatmap.rows[rowIndex];
  const column = heatmap.columns[columnIndex];
  if (cell === undefined || row === undefined || column === undefined) return undefined;
  return cellView(cell, row, column);
}
