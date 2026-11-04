/**
 * The leak-cost trend's view model (S32, R4.12, 06 section 7, O-320, O-321). Pure.
 *
 * Mechanism: the top ten classes are drawn as small multiples, one sparkline per class, all on one
 * y-scale so a taller line means a bigger leak in every row: the scale runs from 0 to the largest
 * value of any series or current cost, rounded up to the next of 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or
 * 10 times its power of ten (58.8 becomes 60), so the lines use most of their height.
 * sparklineGeometry places each week evenly across the width; a week with no value is a gap that
 * splits the line into segments, and the partial current week is returned on its own so the
 * chart draws it as a hollow marker. joinLeaksToCells pairs each leak item with its heat map cell
 * by spot_class_key (a string equality, never a parse, ADR 0004): the cell carries the class's
 * pair, format and depth band, which label the row and build its drill (O-321). An item with no
 * cell keeps a null cell and a reason, so its row shows why it has no drill button.
 */
import type { HeatmapCell, HeatmapColumn, HeatmapRow, LeakItem, ProgressHeatmap, ProgressLeaks } from "./types.js";
import { classLabel } from "./heatmap-model.js";
import { capitalize, familyWords } from "./spot-words.js";

/** The scale's top when no class has any cost yet. */
export const EMPTY_SCALE_MAX = 1;
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;
const DECIMAL_BASE = 10;

export interface LeakScale {
  readonly min: 0;
  readonly max: number;
}

/** The smallest NICE_STEPS multiple of the value's power of ten at or above the value. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return EMPTY_SCALE_MAX;
  const power = DECIMAL_BASE ** Math.floor(Math.log10(value));
  const step = NICE_STEPS.find((candidate) => candidate * power >= value) ?? DECIMAL_BASE;
  return step * power;
}

/** One y-scale over every series and current cost (0 to a rounded-up max). */
export function sharedLeakScale(items: readonly LeakItem[]): LeakScale {
  const values = items.flatMap((item) => [
    item.leak_cost_bb_per_1k,
    ...item.series.flatMap((point) => (point.leak_cost_bb_per_1k === null ? [] : [point.leak_cost_bb_per_1k])),
  ]);
  return { min: 0, max: niceCeil(Math.max(0, ...values)) };
}

export interface SparkPoint {
  readonly index: number;
  readonly week: string;
  readonly value: number;
  readonly partial: boolean;
  readonly x: number;
  readonly y: number;
}

export interface SparklineGeometry {
  /** Runs of consecutive weeks with a value; a null week ends a run. */
  readonly segments: readonly (readonly SparkPoint[])[];
  /** Every week with a value, in order. */
  readonly points: readonly SparkPoint[];
  /** The partial current week, when it has a value. */
  readonly partialPoint: SparkPoint | null;
  /** The x of every week, valued or not, for the crosshair. */
  readonly weekX: readonly number[];
}

export interface SparkBox {
  readonly width: number;
  readonly height: number;
  /** Room kept at each edge so markers are not clipped. */
  readonly inset: number;
}

function xOf(index: number, count: number, box: SparkBox): number {
  const span = box.width - 2 * box.inset;
  return count <= 1 ? box.width / 2 : box.inset + (span * index) / (count - 1);
}

function yOf(value: number, scale: LeakScale, box: SparkBox): number {
  const span = box.height - 2 * box.inset;
  const clamped = Math.min(Math.max(value, scale.min), scale.max);
  return box.inset + span * (1 - (clamped - scale.min) / (scale.max - scale.min));
}

export function sparklineGeometry(item: LeakItem, scale: LeakScale, box: SparkBox): SparklineGeometry {
  const count = item.series.length;
  const weekX = item.series.map((_, index) => xOf(index, count, box));
  const segments: SparkPoint[][] = [];
  let current: SparkPoint[] = [];
  item.series.forEach((point, index) => {
    if (point.leak_cost_bb_per_1k === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    const x = weekX[index] ?? 0;
    current = [...current, { index, week: point.week, value: point.leak_cost_bb_per_1k, partial: point.partial, x, y: yOf(point.leak_cost_bb_per_1k, scale, box) }];
  });
  if (current.length > 0) segments.push(current);
  const points = segments.flat();
  return { segments, points, partialPoint: points.find((point) => point.partial) ?? null, weekX };
}

export interface LeakRow {
  readonly rank: number;
  readonly item: LeakItem;
  readonly cell: HeatmapCell | null;
  readonly row: HeatmapRow | null;
  readonly column: HeatmapColumn | null;
  /** "Facing an open, big blind versus button, live 100 bb" from the cell, else the item's family in words. */
  readonly label: string;
  /** Why the row has no drill button; null when it has one. */
  readonly noDrillReason: string | null;
}

export const HEATMAP_LOADING_REASON = "The heat map is still loading, so this class has no drill yet.";
export const NOT_ON_HEATMAP_REASON = "This class is not on the heat map, so there is no spot to drill.";

function unjoined(item: LeakItem, rank: number, reason: string): LeakRow {
  return { rank, item, cell: null, row: null, column: null, label: capitalize(familyWords(item.family)), noDrillReason: reason };
}

/** Each leak item, ranked in api order, joined to its heat map cell by spot_class_key. */
export function joinLeaksToCells(leaks: ProgressLeaks, heatmap: ProgressHeatmap | undefined): LeakRow[] {
  const cells = new Map((heatmap?.cells ?? []).map((cell) => [cell.spot_class_key, cell]));
  return leaks.items.map((item, index) => {
    const rank = index + 1;
    if (heatmap === undefined) return unjoined(item, rank, HEATMAP_LOADING_REASON);
    const cell = cells.get(item.spot_class_key);
    const row = cell === undefined ? undefined : heatmap.rows[cell.row];
    const column = cell === undefined ? undefined : heatmap.columns[cell.column];
    if (cell === undefined || row === undefined || column === undefined) return unjoined(item, rank, NOT_ON_HEATMAP_REASON);
    return { rank, item, cell, row, column, label: classLabel(row, column), noDrillReason: null };
  });
}
