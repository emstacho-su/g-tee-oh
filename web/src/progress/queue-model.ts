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
 * (spot-words.ts, S47). A server queue preview can replace this later (O-322). Since the S47
 * follow-up (R4.9, O-488) each leak with a cell carries its drill target (open-drill.ts), and
 * Start training opens the costliest leak that has one (startTarget).
 */
import { formatLeak } from "./format.js";
import { isDue, isPracticed } from "./heatmap-model.js";
import { drillTargetOf, type DrillTarget } from "./open-drill.js";
import { capitalize, columnPhrase, familyWords, pairWords } from "./spot-words.js";
import type { HeatmapCell, HeatmapColumn, HeatmapRow, LeakItem, ProgressHeatmap, ProgressLeaks } from "./types.js";

export const TOP_LEAK_COUNT = 3;

export interface QueueLeak {
  readonly spotClassKey: string;
  /** What its Drill button opens, or null when the heat map has no cell for the class. */
  readonly target: DrillTarget | null;
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

interface CellPlace {
  readonly cell: HeatmapCell;
  readonly row: HeatmapRow;
  readonly column: HeatmapColumn;
}

function placeOf(heatmap: ProgressHeatmap, cell: HeatmapCell | undefined): CellPlace | null {
  if (cell === undefined) return null;
  const row = heatmap.rows[cell.row];
  const column = heatmap.columns[cell.column];
  return row === undefined || column === undefined ? null : { cell, row, column };
}

function queueLeak(heatmap: ProgressHeatmap, item: LeakItem): QueueLeak {
  const place = placeOf(heatmap, heatmap.cells.find((each) => each.spot_class_key === item.spot_class_key));
  return {
    spotClassKey: item.spot_class_key,
    target: place === null ? null : drillTargetOf(place.cell, place.row, place.column),
    family: capitalize(familyWords(item.family)),
    where: place === null ? null : `${pairWords(place.row.pair)}, ${columnPhrase(place.column)}`,
    costText: `${formatLeak(item.leak_cost_bb_per_1k)} bb per 1,000 hands`,
  };
}

/** Start training's drill (O-488): the costliest listed leak that has a target, or null to keep /train. */
export function startTarget(queue: HomeQueue): DrillTarget | null {
  return queue.leaks.find((leak) => leak.target !== null)?.target ?? null;
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
