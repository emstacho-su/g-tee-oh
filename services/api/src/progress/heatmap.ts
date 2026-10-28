/**
 * The mastery heat map (R4.12, 06 section 7.2, O-253, ADR 0012), pure: rows are action family by
 * position pair, columns depth band by format, and each catalog class is one cell with its BKT
 * p_known, whether it is mastered, its FSRS retrievability now as the overlay, and how many
 * decisions it holds.
 *
 * Mechanism: the classes come from solver-query's catalog (family, pair, depth band and format are
 * solver-query's, ADR 0004). Rows sort by the Rust family order (sessions/action-family.ts) and then
 * pair; columns by format and then depth band, numbers compared as numbers. A class never practiced
 * has p_known and retrievability null and n 0; mastered is learning's isMastered over p_known.
 */
import { isMastered } from "@g-tee-oh/learning";
import type { z } from "zod";

import type { heatmapSchema } from "../schemas/insights.js";
import { RUST_ACTION_FAMILIES } from "../sessions/action-family.js";

export type Heatmap = z.infer<typeof heatmapSchema>;

/** One class's coordinates, from the catalog. */
export interface HeatmapClass {
  spotClassKey: string;
  family: string;
  pair: string;
  depthBand: string;
  format: string;
}

/** What the user's learning state holds for a class. */
export interface ClassMemory {
  pKnown: number | null;
  retrievability: number | null;
  n: number;
}

const NEVER_PRACTICED: ClassMemory = { pKnown: null, retrievability: null, n: 0 };
const KEY_SEPARATOR = "|";

function familyRank(family: string): number {
  const index = RUST_ACTION_FAMILIES.findIndex((candidate) => candidate === family);
  return index === -1 ? RUST_ACTION_FAMILIES.length : index;
}

const compareText = (left: string, right: string): number => left.localeCompare(right, "en", { numeric: true });

function uniqueSorted<T>(items: readonly T[], keyOf: (item: T) => string, compare: (left: T, right: T) => number): T[] {
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  return [...byKey.values()].sort(compare);
}

/** The heat map over `classes`; `memoryOf` answers a class's learning state, or undefined when never practiced. */
export function heatmapOf(classes: readonly HeatmapClass[], memoryOf: (spotClassKey: string) => ClassMemory | undefined): Heatmap {
  const rowKey = (cls: Pick<HeatmapClass, "family" | "pair">): string => `${cls.family}${KEY_SEPARATOR}${cls.pair}`;
  const columnKey = (cls: Pick<HeatmapClass, "depthBand" | "format">): string => `${cls.format}${KEY_SEPARATOR}${cls.depthBand}`;
  const rows = uniqueSorted(
    classes.map((cls) => ({ family: cls.family, pair: cls.pair })),
    rowKey,
    (left, right) => familyRank(left.family) - familyRank(right.family) || compareText(left.family, right.family) || compareText(left.pair, right.pair),
  );
  const columns = uniqueSorted(
    classes.map((cls) => ({ depthBand: cls.depthBand, format: cls.format })),
    columnKey,
    (left, right) => compareText(left.format, right.format) || compareText(left.depthBand, right.depthBand),
  );
  const rowIndex = new Map(rows.map((row, index) => [rowKey(row), index]));
  const columnIndex = new Map(columns.map((column, index) => [columnKey(column), index]));
  const cells = [...classes]
    .sort((left, right) => compareText(left.spotClassKey, right.spotClassKey))
    .map((cls) => {
      const memory = memoryOf(cls.spotClassKey) ?? NEVER_PRACTICED;
      return {
        spot_class_key: cls.spotClassKey,
        row: rowIndex.get(rowKey(cls)) ?? 0,
        column: columnIndex.get(columnKey(cls)) ?? 0,
        p_known: memory.pKnown,
        mastered: memory.pKnown !== null && isMastered({ pKnown: memory.pKnown }),
        retrievability: memory.retrievability,
        n: memory.n,
      };
    });
  return {
    rows: rows.map((row) => ({ family: row.family, pair: row.pair })),
    columns: columns.map((column) => ({ depth_band: column.depthBand, format: column.format })),
    cells,
  };
}
