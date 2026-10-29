/**
 * The home queue model (S32, R4.12, O-322): due and never-practiced counts from the heat map and
 * the top three leaks from the leak read, checked against hand-computed counts.
 */
import { describe, expect, it } from "vitest";

import {
  fixtureFreshHeatmap,
  fixtureFreshLeaks,
  fixtureHeatmap,
  fixtureLeaks,
} from "../../src/fixtures/progress.js";
import { buildHomeQueue, dueText, freshText, isDue, TOP_LEAK_COUNT } from "../../src/progress/queue-model.js";
import type { HeatmapCell, ProgressHeatmap } from "../../src/progress/types.js";

function cell(overrides: Partial<HeatmapCell>): HeatmapCell {
  return { spot_class_key: "k", row: 0, column: 0, p_known: 0.5, mastered: false, retrievability: 0.95, n: 4, ...overrides };
}

describe("R4.12 home queue model", () => {
  it("R4.12 due means practiced with retrievability at or under 0.9, or 0.85 once mastered", () => {
    expect(isDue(cell({ retrievability: 0.9 }))).toBe(true);
    expect(isDue(cell({ retrievability: 0.91 }))).toBe(false);
    expect(isDue(cell({ mastered: true, p_known: 0.97, retrievability: 0.87 }))).toBe(false);
    expect(isDue(cell({ mastered: true, p_known: 0.97, retrievability: 0.85 }))).toBe(true);
    expect(isDue(cell({ retrievability: null }))).toBe(false);
    expect(isDue(cell({ p_known: null, retrievability: 0.1 }))).toBe(false);
  });

  it("R4.12 counts the fixture's 22 due and 8 never-practiced classes", () => {
    // New cells are those with (row + 2 * column) mod 5 = 4: two rows per column over four
    // columns, so 8 of the 40 cells. Of the 32 practiced cells, 22 sit at or under their
    // retention (worked by hand from the fixture's formulas: 18 unmastered at or under 0.9 and
    // 4 mastered at or under 0.85); the other 10 are above it.
    const queue = buildHomeQueue(fixtureHeatmap, fixtureLeaks);
    expect(queue.fresh).toBe(8);
    expect(queue.due).toBe(22);
  });

  it("R4.12 lists the three costliest leaks with family, cell coordinates and current cost", () => {
    const queue = buildHomeQueue(fixtureHeatmap, fixtureLeaks);
    expect(queue.leaks).toHaveLength(TOP_LEAK_COUNT);
    expect(queue.leaks.map((leak) => leak.spotClassKey)).toEqual(fixtureLeaks.items.slice(0, 3).map((item) => item.spot_class_key));
    const first = fixtureLeaks.items[0];
    const firstCell = fixtureHeatmap.cells.find((each) => each.spot_class_key === first?.spot_class_key);
    const row = fixtureHeatmap.rows[firstCell?.row ?? -1];
    const column = fixtureHeatmap.columns[firstCell?.column ?? -1];
    expect(queue.leaks[0]).toEqual({
      spotClassKey: first?.spot_class_key,
      family: "Open or fold",
      where: `big blind versus under the gun, ${column?.format} ${column?.depth_band}bb`,
      costText: "42.0 bb per 1,000 hands",
    });
  });

  it("R4.12 ranks leaks by cost without changing the read, and names a leak without a cell", () => {
    const [a, b] = fixtureLeaks.items;
    if (a === undefined || b === undefined) throw new Error("fixture leaks missing");
    const cheap = { ...a, spot_class_key: "outside-the-map", leak_cost_bb_per_1k: 1 };
    const leaks = { weeks: fixtureLeaks.weeks, items: [cheap, b] };
    const queue = buildHomeQueue(fixtureHeatmap, leaks);
    expect(queue.leaks.map((leak) => leak.spotClassKey)).toEqual([b.spot_class_key, "outside-the-map"]);
    expect(queue.leaks[1]?.where).toBeNull();
    expect(leaks.items[0]).toBe(cheap);
    const broken: ProgressHeatmap = { ...fixtureHeatmap, cells: [cell({ spot_class_key: b.spot_class_key, row: 99 })] };
    expect(buildHomeQueue(broken, leaks).leaks[0]?.where).toBeNull();
  });

  it("R4.12 a fresh learner has nothing due, every class new and no leaks", () => {
    const queue = buildHomeQueue(fixtureFreshHeatmap, fixtureFreshLeaks);
    expect(queue).toEqual({ due: 0, fresh: 40, leaks: [] });
  });

  it("R4.12 words the counts in plain text", () => {
    expect(dueText(0)).toBe("Nothing due for review now.");
    expect(dueText(1)).toBe("1 class due for review.");
    expect(dueText(22)).toBe("22 classes due for review.");
    expect(freshText(0)).toBe("Every class has been practiced.");
    expect(freshText(8)).toBe("8 classes not practiced yet.");
  });
});
