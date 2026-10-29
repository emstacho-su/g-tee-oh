/**
 * Tests for the two S45 lenses and the weight-scaled bars (R3.24, O-462 to O-465, ADR 0004): the
 * acting seat's reach as the weight (O-463), the compare-to-best loss scale in percent of the pot
 * on the EV palette's negative steps (O-464), strategy with EV (frequency bars plus the best EV
 * printed), compare to best (the chosen action's served loss_pct_pot painted and printed, no
 * subtraction here), bars whose height is the weight (full when null, hatched when zero) and the
 * default rule for scaling (O-465). All through the recording context; nothing touches a browser.
 */
import { describe, expect, it } from "vitest";

import { MODE_NAMES, cellValueText, formatLossShort } from "../../src/components/range-matrix/cell-text.js";
import { cellEdges, drawMatrix, type DrawOptions } from "../../src/components/range-matrix/draw.js";
import { MATRIX_PALETTES, lossFill, lossInk } from "../../src/components/range-matrix/matrix-theme.js";
import {
  MATRIX_MODES,
  actingSeatIndex,
  buildMatrixModel,
  defaultLensPosition,
  defaultScaleByWeight,
  lossScaleOf,
  type MatrixCell,
  type MatrixModel,
} from "../../src/components/range-matrix/model.js";
import { MISSING_PATTERN_KEY } from "../../src/components/range-matrix/patterns.js";
import {
  COMPARE_NEUTRAL_PCT_POT,
  COMPARE_STEPS,
  MIN_COMPARE_SCALE_PCT_POT,
  compareLegend,
  lossStep,
} from "../../src/components/range-matrix/scales.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { actionColor } from "../../src/theme/action-style.js";
import { fakePatternSource, isFakePattern, recordingContext, type RecordedOp } from "./recording-context.js";

const SIZE_PX = 520;

function options(overrides: Partial<DrawOptions> = {}): DrawOptions {
  return { mode: "frequency", sizePx: SIZE_PX, pixelRatio: 1, theme: "light", focusedIndex: null, selectedHand: null, patterns: fakePatternSource(), ...overrides };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cellRect(cell: MatrixCell): Rect {
  const edges = cellEdges(SIZE_PX);
  const x = edges[cell.col] ?? 0;
  const y = edges[cell.row] ?? 0;
  return { x, y, w: (edges[cell.col + 1] ?? 0) - x, h: (edges[cell.row + 1] ?? 0) - y };
}

function inside(op: { x: number; y: number }, rect: Rect): boolean {
  return op.x >= rect.x && op.x < rect.x + rect.w && op.y >= rect.y && op.y < rect.y + rect.h;
}

function fillsIn(ops: readonly RecordedOp[], rect: Rect) {
  return ops.filter((op): op is Extract<RecordedOp, { op: "fillRect" }> => op.op === "fillRect" && inside(op, rect));
}

function textsIn(ops: readonly RecordedOp[], rect: Rect) {
  return ops.filter((op): op is Extract<RecordedOp, { op: "fillText" }> => op.op === "fillText" && inside(op, rect));
}

function draw(model: MatrixModel, overrides: Partial<DrawOptions> = {}) {
  const { ctx, ops } = recordingContext();
  drawMatrix(ctx, model, options(overrides));
  return ops;
}

function cellOf(model: MatrixModel, hand: string): MatrixCell {
  const cell = model.cells.find((candidate) => candidate.hand === hand);
  if (cell === undefined) throw new Error(`no cell ${hand}`);
  return cell;
}

function actionBars(model: MatrixModel, ops: readonly RecordedOp[], rect: Rect) {
  const colors = new Set(model.actions.map((action) => actionColor(action, model.actions, "light")));
  return fillsIn(ops, rect).filter((op) => typeof op.style === "string" && colors.has(op.style));
}

const model = buildMatrixModel(fixtureStudyNode);
const palette = MATRIX_PALETTES.light;

describe("R3.24 the acting seat's reach is the weight (O-463)", () => {
  it("R3.24 the in-position seat acting reads index 1, the out-of-position seat index 0, an unnamed seat index 0", () => {
    expect(actingSeatIndex({ pair: "BB-BTN", to_act: "BTN" })).toBe(1);
    expect(actingSeatIndex({ pair: "BB-BTN", to_act: "BB" })).toBe(0);
    expect(actingSeatIndex({})).toBe(0);
    expect(actingSeatIndex({ pair: "BB-BTN", to_act: "CO" })).toBe(0);
  });

  it("R3.24 the fixture root (BTN acts in BB-BTN) reads reach[1], and a one-entry reach is an unknown weight there", () => {
    expect(model.actingSeat).toBe(1);
    for (const row of fixtureStudyNode.hands) {
      expect(cellOf(model, row.hand).weight).toBe(row.reach?.[1] ?? null);
    }
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "AA" ? { ...row, reach: [0.4] } : row));
    expect(cellOf(buildMatrixModel({ ...fixtureStudyNode, hands }), "AA").weight).toBeNull();
  });

  it("R3.24 copies loss_pct_pot per action and rejects a row whose length differs from the actions", () => {
    for (const row of fixtureStudyNode.hands) expect(cellOf(model, row.hand).lossPctPot).toEqual(row.loss_pct_pot);
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "T9s" ? { ...row, loss_pct_pot: [1] } : row));
    expect(() => buildMatrixModel({ ...fixtureStudyNode, hands })).toThrow(/T9s/);
  });
});

describe("R3.24 compare-to-best scale (O-464)", () => {
  it("R3.24 a loss under the neutral band is step 0, then five steps by share of the scale end, the end holding", () => {
    expect(lossStep(0, 2)).toBe(0);
    expect(lossStep(COMPARE_NEUTRAL_PCT_POT - 0.001, 2)).toBe(0);
    expect(lossStep(COMPARE_NEUTRAL_PCT_POT, 2)).toBe(1);
    expect(lossStep(0.4, 2)).toBe(1);
    expect(lossStep(0.8, 2)).toBe(2);
    expect(lossStep(2, 2)).toBe(COMPARE_STEPS);
    expect(lossStep(9, 2)).toBe(COMPARE_STEPS);
    expect(lossStep(-1, 2)).toBe(0);
  });

  it("R3.24 lossScaleOf is the 90th percentile of the non-neutral losses of one action, at least the floor", () => {
    const position = 0;
    const losses = model.cells
      .filter((cell) => cell.present)
      .map((cell) => cell.lossPctPot[position] ?? 0)
      .filter((loss) => loss >= COMPARE_NEUTRAL_PCT_POT)
      .sort((a, b) => a - b);
    const nearestRank = losses[Math.ceil(0.9 * losses.length) - 1] ?? 0;
    expect(lossScaleOf(model.cells, position)).toBe(Math.max(MIN_COMPARE_SCALE_PCT_POT, nearestRank));
    expect(model.lossScalePctPot).toHaveLength(model.actions.length);
    expect(model.lossScalePctPot[position]).toBe(lossScaleOf(model.cells, position));
    expect(lossScaleOf(model.cells.map((cell) => ({ ...cell, lossPctPot: [0, 0, 0, 0] })), 0)).toBe(MIN_COMPARE_SCALE_PCT_POT);
    expect(lossScaleOf([], 0)).toBe(MIN_COMPARE_SCALE_PCT_POT);
  });

  it("R3.24 the compare legend has six steps from best to the end, worded in percent of the pot", () => {
    const steps = compareLegend(2);
    expect(steps).toHaveLength(COMPARE_STEPS + 1);
    expect(steps[0]?.long).toMatch(/best/i);
    expect(steps[1]?.long).toBe(`${COMPARE_NEUTRAL_PCT_POT}% to 0.4% of the pot behind the best`);
    expect(steps[5]?.long).toBe("more than 1.6% of the pot behind the best");
    expect(steps.map((step) => step.step)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("R3.24 the loss fill is the EV palette's neutral for the best and its negative steps otherwise, with the step's ink", () => {
    expect(lossFill(palette, 0, 2)).toBe(palette.evNeutral);
    expect(lossInk(palette, 0, 2)).toBe(palette.evNeutralInk);
    expect(lossFill(palette, 0.2, 2)).toBe(palette.evNegative[0]);
    expect(lossFill(palette, 5, 2)).toBe(palette.evNegative.at(-1));
    expect(lossInk(palette, 5, 2)).toBe(palette.evNegativeInk.at(-1));
  });

  it("R3.24 the default lens is the first action that is not a fold, or null", () => {
    expect(defaultLensPosition(model.actions)).toBe(1);
    expect(defaultLensPosition(model.actions.slice(0, 1))).toBeNull();
    expect(defaultLensPosition([])).toBeNull();
  });

  it("R3.24 the mode list and the mode names hold the two lenses", () => {
    expect(MATRIX_MODES).toEqual(["frequency", "ev", "weight", "strategy_ev", "compare"]);
    expect(MODE_NAMES.strategy_ev).toBe("strategy with EV");
    expect(MODE_NAMES.compare).toBe("compare to best");
  });
});

describe("R3.24 strategy with EV", () => {
  it("R3.24 draws the frequency bars and prints the best EV in the value chip in the label ink", () => {
    const ops = draw(model, { mode: "strategy_ev" });
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      const drawn = model.actions.filter((_, position) => (cell.frequencies[position] ?? 0) > 0);
      expect(actionBars(model, ops, rect)).toHaveLength(drawn.length);
      const texts = textsIn(ops, rect);
      expect(texts.map((op) => op.text)).toEqual([cell.hand, `${(cell.evBestBb ?? 0).toFixed(1)}`.replace("-0.0", "0.0")]);
      expect(texts.every((op) => op.style === palette.labelText)).toBe(true);
      expect(fillsIn(ops, rect).filter((op) => op.style === palette.labelChip)).toHaveLength(2);
    }
  });

  it("R3.24 the table text adds the best EV after the frequencies", () => {
    const aa = cellOf(model, "AA");
    expect(cellValueText(aa, model.actions, "strategy_ev")).toBe(
      `${cellValueText(aa, model.actions, "frequency")}, best EV ${(aa.evBestBb ?? 0).toFixed(2)}bb`,
    );
  });
});

describe("R3.24 compare to best", () => {
  const lensPosition = 2;

  it("R3.24 fills each present cell by the chosen action's served loss step and prints the loss in that step's ink", () => {
    const ops = draw(model, { mode: "compare", lensPosition });
    const scale = model.lossScalePctPot[lensPosition] ?? 0;
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      const loss = cell.lossPctPot[lensPosition] ?? 0;
      const fill = fillsIn(ops, rect).find((op) => op.style === lossFill(palette, loss, scale));
      expect(fill).toMatchObject({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      const texts = textsIn(ops, rect);
      expect(texts.map((op) => op.text)).toEqual([cell.hand, formatLossShort(loss)]);
      expect(texts.every((op) => op.style === lossInk(palette, loss, scale))).toBe(true);
    }
  });

  it("R3.24 a cell where the chosen action is best paints neutral and reads best; a loss prints as a negative percent", () => {
    const best = model.cells.find((cell) => (cell.lossPctPot[lensPosition] ?? 1) < COMPARE_NEUTRAL_PCT_POT);
    const behind = model.cells.find((cell) => (cell.lossPctPot[lensPosition] ?? 0) >= 1);
    if (best === undefined || behind === undefined) throw new Error("fixture has no best and behind cells for the raise");
    expect(formatLossShort(best.lossPctPot[lensPosition] ?? 0)).toBe("best");
    expect(formatLossShort(behind.lossPctPot[lensPosition] ?? 0)).toMatch(/^-\d+\.\d%$/);
    expect(formatLossShort(0.04)).toBe("best");
    const ops = draw(model, { mode: "compare", lensPosition });
    expect(fillsIn(ops, cellRect(best)).some((op) => op.style === palette.evNeutral)).toBe(true);
  });

  it("R3.24 without a lens the first action that is not a fold is compared; the table text names the action", () => {
    const explicit = draw(model, { mode: "compare", lensPosition: defaultLensPosition(model.actions) });
    const implicit = draw(model, { mode: "compare" });
    expect(implicit).toEqual(explicit);
    const aa = cellOf(model, "AA");
    expect(cellValueText(aa, model.actions, "compare", 2)).toMatch(/^Raise to 2.5bb (is the best action|is .* of the pot behind the best)$/);
    const text = cellValueText(aa, model.actions, "compare");
    expect(text.startsWith("Call ")).toBe(true);
  });

  it("R3.24 a missing hand stays hatched with a dash in both lenses", () => {
    const sparse = buildMatrixModel({ ...fixtureStudyNode, hands: fixtureStudyNode.hands.filter((row) => row.hand !== "K7o") });
    const rect = cellRect(cellOf(sparse, "K7o"));
    for (const mode of ["strategy_ev", "compare"] as const) {
      const ops = draw(sparse, { mode });
      expect(fillsIn(ops, rect).some((op) => isFakePattern(op.style) && op.style.patternKey === MISSING_PATTERN_KEY)).toBe(true);
      expect(textsIn(ops, rect).map((op) => op.text)).toEqual(["K7o", "-"]);
    }
  });
});

describe("R3.24 bars scaled by range weight (O-465)", () => {
  /** AA's bars at a 200 pixel cell with one reach and one strategy. */
  function aaBars(reach: readonly number[] | null, strategy: readonly number[], mode: DrawOptions["mode"] = "frequency") {
    const pixelRatio = 5;
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "AA" ? { ...row, reach: reach === null ? null : [...reach], strategy: [...strategy] } : row));
    const scaled = buildMatrixModel({ ...fixtureStudyNode, hands });
    const edges = cellEdges(SIZE_PX * pixelRatio);
    const rect = { x: 0, y: 0, w: edges[1] ?? 0, h: edges[1] ?? 0 };
    const ops = draw(scaled, { pixelRatio, mode, scaleByWeight: true });
    return { rect, ops, bars: actionBars(scaled, ops, rect) };
  }

  it("R3.24 bar height is the acting seat's weight times the cell height, anchored at the bottom", () => {
    const { rect, bars } = aaBars([0.9, 0.25], [0.5, 0.5, 0, 0]);
    expect(rect.h).toBe(200);
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.h).toBe(50);
      expect(bar.y).toBe(rect.y + rect.h - 50);
    }
    expect(bars.reduce((sum, bar) => sum + bar.w, 0)).toBe(rect.w);
  });

  it("R3.24 a null weight draws full-height bars and a weight above 1 is clamped", () => {
    expect(aaBars(null, [0.5, 0.5, 0, 0]).bars.every((bar) => bar.h === 200)).toBe(true);
    expect(aaBars([1, 1.5], [0.5, 0.5, 0, 0]).bars.every((bar) => bar.h === 200)).toBe(true);
  });

  it("R3.24 a zero weight paints no bar and the not-in-range hatch, keeping the hand label", () => {
    const { rect, ops, bars } = aaBars([1, 0], [0.5, 0.5, 0, 0]);
    expect(bars).toHaveLength(0);
    const fills = fillsIn(ops, rect);
    expect(fills.some((op) => op.style === palette.missingFill)).toBe(true);
    expect(fills.some((op) => isFakePattern(op.style) && op.style.patternKey === MISSING_PATTERN_KEY)).toBe(true);
    expect(textsIn(ops, rect).map((op) => op.text)).toEqual(["AA"]);
  });

  it("R3.24 strategy with EV scales too and still prints the best EV; without the option the bars are full height", () => {
    expect(aaBars([1, 0.5], [0.5, 0.5, 0, 0], "strategy_ev").bars.every((bar) => bar.h === 100)).toBe(true);
    const ops = draw(model);
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      expect(actionBars(model, ops, rect).every((bar) => bar.h === rect.h)).toBe(true);
    }
  });

  it("R3.24 the default is on when any present weight is below 1 or the street is postflop, off otherwise", () => {
    expect(defaultScaleByWeight(model.cells, "preflop")).toBe(true);
    const full = model.cells.map((cell) => ({ ...cell, weight: cell.present ? 1 : null }));
    expect(defaultScaleByWeight(full, "preflop")).toBe(false);
    expect(defaultScaleByWeight(full, "flop")).toBe(true);
    const unknown = model.cells.map((cell) => ({ ...cell, weight: null }));
    expect(defaultScaleByWeight(unknown, "preflop")).toBe(false);
  });
});
