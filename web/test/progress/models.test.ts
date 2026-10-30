// The /progress view models (S32, R4.12, O-320, O-321): heat map bins, due flags and grouping,
// the leak trend's shared scale, sparkline geometry and the leak to cell join. Expectations are
// computed by hand from the formulas in src/fixtures/progress.ts.
import { describe, expect, it } from "vitest";

import { fixtureHeatmap, fixtureLeaks } from "../../src/fixtures/progress.js";
import {
  cellLookup,
  cellView,
  cellViewAt,
  classLabel,
  depthBandLabel,
  groupRowsByFamily,
  heatBin,
  HEAT_FILL,
  HEAT_INK,
  isDue,
  NEW_CELL_TEXT,
} from "../../src/progress/heatmap-model.js";
import { isDue as queueIsDue } from "../../src/progress/queue-model.js";
import {
  EMPTY_SCALE_MAX,
  HEATMAP_LOADING_REASON,
  joinLeaksToCells,
  niceCeil,
  NOT_ON_HEATMAP_REASON,
  sharedLeakScale,
  sparklineGeometry,
} from "../../src/progress/leak-model.js";
import type { HeatmapCell, HeatmapColumn, HeatmapRow, LeakItem } from "../../src/progress/types.js";

const lookup = cellLookup(fixtureHeatmap);

function cell(row: number, column: number): HeatmapCell {
  const found = lookup(row, column);
  if (found === undefined) throw new Error(`no fixture cell at ${row}, ${column}`);
  return found;
}

describe("R4.12 heat map model", () => {
  it("R4.12 bins p_known in five ordinal steps with the lower edge inclusive", () => {
    expect([0, 0.249, 0.25, 0.499, 0.5, 0.749, 0.75, 0.949, 0.95, 1].map(heatBin)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(HEAT_FILL[1]).toBe("bg-heat-1");
    expect(HEAT_FILL[5]).toBe("bg-heat-5");
    expect([HEAT_INK[1], HEAT_INK[2]]).toEqual(["text-heat-ink-low", "text-heat-ink-low"]);
    expect([HEAT_INK[3], HEAT_INK[4], HEAT_INK[5]]).toEqual(["text-heat-ink-high", "text-heat-ink-high", "text-heat-ink-high"]);
  });

  it("R4.12 a class is due when R is at or under retentionFor(mastered): 0.9, or 0.85 when mastered", () => {
    expect(isDue(cell(0, 0))).toBe(false); // R 0.98
    expect(isDue(cell(0, 3))).toBe(true); // R 0.83, not mastered
    expect(isDue(cell(6, 1))).toBe(false); // R 0.93, mastered
    expect(isDue(cell(7, 0))).toBe(true); // R 0.83, mastered
    expect(isDue({ ...cell(0, 0), retrievability: 0.9 })).toBe(true);
    expect(isDue({ ...cell(6, 1), retrievability: 0.86 })).toBe(false);
    expect(isDue(cell(0, 2))).toBe(false); // never practiced
    // A class never practiced is new, never due, even if a retrievability came with it.
    expect(isDue({ ...cell(0, 2), p_known: null, retrievability: 0.1 })).toBe(false);
    expect(cellView({ ...cell(0, 2), p_known: null, retrievability: 0.1 }, fixtureHeatmap.rows[0] as HeatmapRow, fixtureHeatmap.columns[2] as HeatmapColumn).due).toBe(false);
    // The heat map and the home queue share one rule.
    expect(queueIsDue).toBe(isDue);
  });

  it("R4.12 groups rows by family in api order and keeps each row's index", () => {
    const groups = groupRowsByFamily(fixtureHeatmap.rows);
    expect(groups.map((group) => group.family)).toEqual(["rfi", "facing-open", "facing-3bet", "blind-vs-blind"]);
    expect(groups[1]?.rows.map((entry) => entry.index)).toEqual([4, 5, 6]);
    expect(groups[1]?.rows[0]?.row.pair).toBe("BB-CO");
  });

  it("R4.12 finds cells by row and column and labels them with every figure", () => {
    const view = cellViewAt(fixtureHeatmap, lookup, 0, 0);
    expect(view?.text).toBe("12%");
    expect(view?.bin).toBe(1);
    expect(view?.recallPercent).toBe(98);
    expect(view?.classText).toBe("Open or fold, big blind versus under the gun, live 100bb");
    expect(view?.label).toBe("Open or fold, big blind versus under the gun, live 100bb: Known: 12%, Recall: 98%, Attempts: 6, Mastered: no, Due for review: no");
    expect(cellViewAt(fixtureHeatmap, lookup, 0, 99)).toBeUndefined();
    expect(cellViewAt(fixtureHeatmap, lookup, 99, 0)).toBeUndefined();
  });

  it("R4.12 a never-practiced cell reads new with no bin and no recall bar", () => {
    const row = fixtureHeatmap.rows[0];
    const column = fixtureHeatmap.columns[2];
    if (row === undefined || column === undefined) throw new Error("fixture grid");
    const view = cellView(cell(0, 2), row, column);
    expect(view.text).toBe(NEW_CELL_TEXT);
    expect(view.bin).toBeNull();
    expect(view.recallPercent).toBeNull();
    expect(view.details).toEqual(["Known: never practiced", "Recall: not scheduled", "Attempts: 0", "Mastered: no", "Due for review: no"]);
  });

  it("R4.12 a mastered cell sits in the top bin and says so", () => {
    const view = cellViewAt(fixtureHeatmap, lookup, 8, 1);
    expect(view?.bin).toBe(5);
    expect(view?.text).toBe("95%");
    expect(view?.details).toContain("Mastered: yes");
    expect(view?.due).toBe(true); // R 0.63
  });

  it("R4.12 depth bands read in bb when numeric", () => {
    expect(depthBandLabel("150")).toBe("150bb");
    expect(depthBandLabel("deep")).toBe("deep");
    expect(classLabel({ family: "rfi", pair: "SB-BB" }, { format: "online", depth_band: "short" })).toBe("Open or fold, small blind versus big blind, online short");
  });
});

describe("R4.12 leak trend model", () => {
  it("R4.12 rounds the scale's top up to a nice step", () => {
    expect(niceCeil(58.8)).toBe(60);
    expect(niceCeil(42)).toBe(50);
    expect(niceCeil(7)).toBe(8);
    expect(niceCeil(100)).toBe(100);
    expect(niceCeil(101)).toBe(150);
    expect(niceCeil(0)).toBe(EMPTY_SCALE_MAX);
    expect(niceCeil(Number.NaN)).toBe(EMPTY_SCALE_MAX);
  });

  it("R4.12 one scale spans every series: the fixture's largest value is 58.8, so 0 to 60", () => {
    expect(sharedLeakScale(fixtureLeaks.items)).toEqual({ min: 0, max: 60 });
    expect(sharedLeakScale([])).toEqual({ min: 0, max: EMPTY_SCALE_MAX });
  });

  it("R4.12 a null week splits the line, the partial week is singled out", () => {
    const first = fixtureLeaks.items[0] as LeakItem;
    const box = { width: 72, height: 40, inset: 5 };
    const geometry = sparklineGeometry(first, { min: 0, max: 60 }, box);
    expect(geometry.segments.map((segment) => segment.map((point) => point.index))).toEqual([[0, 1], [3, 4, 5, 6, 7]]);
    // Eight weeks across a 62 px span starting at the 5 px inset.
    expect(geometry.weekX).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((index) => 5 + (62 * index) / 7));
    expect(geometry.partialPoint?.index).toBe(7);
    // 42 of 60 on a 30 px span starting at 5: y = 5 + 30 * (1 - 0.7) = 14.
    expect(geometry.partialPoint?.y).toBeCloseTo(14);
    expect(geometry.points[0]?.y).toBeCloseTo(5 + 30 * (1 - 58.8 / 60));
  });

  it("R4.12 a single week sits in the middle; values clamp to the scale", () => {
    const one: LeakItem = { ...(fixtureLeaks.items[0] as LeakItem), series: [{ week: "2026-10-26", leak_cost_bb_per_1k: 90, partial: true }] };
    const geometry = sparklineGeometry(one, { min: 0, max: 60 }, { width: 100, height: 40, inset: 5 });
    expect(geometry.points[0]?.x).toBe(50);
    expect(geometry.points[0]?.y).toBe(5);
    const empty = sparklineGeometry({ ...one, series: [{ week: "2026-10-26", leak_cost_bb_per_1k: null, partial: true }] }, { min: 0, max: 60 }, { width: 100, height: 40, inset: 5 });
    expect(empty.segments).toEqual([]);
    expect(empty.partialPoint).toBeNull();
  });

  it("R4.12 joins each leak to its heat map cell by spot_class_key and labels it from the cell", () => {
    const rows = joinLeaksToCells(fixtureLeaks, fixtureHeatmap);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows[0]?.label).toBe("Open or fold, big blind versus under the gun, live 100bb");
    expect(rows[1]?.label).toBe("Open or fold, big blind versus cutoff, live 100bb");
    expect(rows[9]?.label).toBe("Facing a 3-bet, small blind versus button, online 100bb");
    expect(rows.every((row) => row.cell !== null && row.noDrillReason === null)).toBe(true);
  });

  it("R4.12 a leak without a cell keeps its family as the label and says why it has no drill", () => {
    const stranger: LeakItem = { ...(fixtureLeaks.items[0] as LeakItem), spot_class_key: "absent", family: "squeeze" };
    const [missing] = joinLeaksToCells({ ...fixtureLeaks, items: [stranger] }, fixtureHeatmap);
    expect(missing?.cell).toBeNull();
    expect(missing?.label).toBe("Squeeze");
    expect(missing?.noDrillReason).toBe(NOT_ON_HEATMAP_REASON);
    const [loading] = joinLeaksToCells(fixtureLeaks, undefined);
    expect(loading?.noDrillReason).toBe(HEATMAP_LOADING_REASON);
  });
});
