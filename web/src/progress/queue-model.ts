/**
 * The home screen's "Today's queue" (S32, R4.12, O-322): how many practiced classes are due, how
 * many classes were never practiced, and the three costliest leaks, with the text for each.
 *
 * Mechanism: there is no queue endpoint, so the counts come from the heat map read, through the
 * heat map's own isDue and isPracticed (heatmap-model.ts), so the two screens cannot disagree: a
 * practiced class (p_known not null) is due when its retrievability is at or under the retention
 * learning schedules it at (O-253); a class with p_known null was never practiced. The leaks come from the leak read, ranked by current
 * cost (a copy is sorted; the read is never changed), and each is joined to its heat map cell by
 * spot_class_key for the position pair and the format and depth: values from the api only, the
 * key itself is never parsed (ADR 0004), and the family, pair and depth read in words
 * (spot-words.ts, S47). A server queue preview can replace this later (O-322).
 */
import { formatLeak } from "./format.js";
import { isDue, isPracticed } from "./heatmap-model.js";
import { capitalize, depthBandLabel, familyWords, pairWords } from "./spot-words.js";
import type { HeatmapCell, LeakItem, ProgressHeatmap, ProgressLeaks } from "./types.js";

export const TOP_LEAK_COUNT = 3;

export interface QueueLeak {
  readonly spotClassKey: string;
  readonly family: string;
  /** The pair, format and depth of the class's heat map cell, or null when the map lacks it. */
  readonly where: string | null;
  readonly costText: string;
}

export interface HomeQueue {
  readonly due: number;
  readonly fresh: number;
  readonly leaks: readonly QueueLeak[];
}

export { isDue, isPracticed };

function whereOf(heatmap: ProgressHeatmap, cell: HeatmapCell | undefined): string | null {
  if (cell === undefined) return null;
  const row = heatmap.rows[cell.row];
  const column = heatmap.columns[cell.column];
  if (row === undefined || column === undefined) return null;
  return `${pairWords(row.pair)}, ${column.format} ${depthBandLabel(column.depth_band)}`;
}

function queueLeak(heatmap: ProgressHeatmap, item: LeakItem): QueueLeak {
  const cell = heatmap.cells.find((each) => each.spot_class_key === item.spot_class_key);
  return {
    spotClassKey: item.spot_class_key,
    family: capitalize(familyWords(item.family)),
    where: whereOf(heatmap, cell),
    costText: `${formatLeak(item.leak_cost_bb_per_1k)} bb per 1,000 hands`,
  };
}

export function buildHomeQueue(heatmap: ProgressHeatmap, leaks: ProgressLeaks): HomeQueue {
  const ranked = [...leaks.items].sort((a, b) => b.leak_cost_bb_per_1k - a.leak_cost_bb_per_1k);
  return {
    due: heatmap.cells.filter(isDue).length,
    fresh: heatmap.cells.filter((cell) => !isPracticed(cell)).length,
    leaks: ranked.slice(0, TOP_LEAK_COUNT).map((item) => queueLeak(heatmap, item)),
  };
}

function classes(count: number): string {
  return count === 1 ? "1 class" : `${count} classes`;
}

export function dueText(due: number): string {
  return due === 0 ? "Nothing due for review now." : `${classes(due)} due for review.`;
}

export function freshText(fresh: number): string {
  return fresh === 0 ? "Every class has been practiced." : `${classes(fresh)} not practiced yet.`;
}

export const NO_LEAKS_TEXT = "No leaks measured yet. Rated decisions build the leak list.";
export const NO_CLASSES_TEXT = "No spot classes are in the library yet.";
