/**
 * Tests for the range matrix canvas drawing (S24, R3.12) through a recording fake context:
 * frequency bars proportional to the frequencies, every painted action also painting its hatch
 * pattern and every cell its hand label (color is never the only signal, A7 section 4), the EV
 * and weight numbers printed, missing hands hatched with a dash, and the focus and selection
 * outlines.
 */
import { describe, expect, it } from "vitest";

import { formatEvShort, formatWeightShort } from "../../src/components/range-matrix/cell-text.js";
import { cellEdges, drawMatrix, type DrawOptions } from "../../src/components/range-matrix/draw.js";
import { MATRIX_PALETTES, evFill } from "../../src/components/range-matrix/matrix-theme.js";
import { buildMatrixModel, type MatrixCell, type MatrixModel } from "../../src/components/range-matrix/model.js";
import { MISSING_PATTERN_KEY } from "../../src/components/range-matrix/patterns.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { actionColor, actionStyle } from "../../src/theme/action-style.js";
import { fakePatternSource, isFakePattern, recordingContext, type RecordedOp } from "./recording-context.js";

const SIZE_PX = 520;
const CELL_PX = SIZE_PX / 13;

function options(overrides: Partial<DrawOptions> = {}): DrawOptions {
  return {
    mode: "frequency",
    sizePx: SIZE_PX,
    pixelRatio: 1,
    theme: "light",
    focusedIndex: null,
    selectedHand: null,
    patterns: fakePatternSource(),
    ...overrides,
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cellRect(cell: MatrixCell, pixelRatio = 1): Rect {
  const edges = cellEdges(SIZE_PX * pixelRatio);
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

function textsIn(ops: readonly RecordedOp[], rect: Rect): string[] {
  return ops
    .filter((op): op is Extract<RecordedOp, { op: "fillText" }> => op.op === "fillText" && inside(op, rect))
    .map((op) => op.text);
}

function draw(model: MatrixModel, overrides: Partial<DrawOptions> = {}) {
  const { ctx, ops } = recordingContext();
  drawMatrix(ctx, model, options(overrides));
  return ops;
}

describe("R3.12 range matrix drawing", () => {
  const model = buildMatrixModel(fixtureStudyNode);

  it("R3.12 cellEdges splits the size into 13 integer cells that cover it exactly", () => {
    const edges = cellEdges(1040);
    expect(edges).toHaveLength(14);
    expect(edges[0]).toBe(0);
    expect(edges[13]).toBe(1040);
    expect(edges.every((edge) => Number.isInteger(edge))).toBe(true);
  });

  it("R3.12 frequency bars have widths proportional to the frequencies, in action order", () => {
    const ops = draw(model);
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      const colors = new Set(model.actions.map((action) => actionColor(action, model.actions, "light")));
      const bars = fillsIn(ops, rect).filter((op) => typeof op.style === "string" && colors.has(op.style));
      const drawn = model.actions.filter((_, index) => (cell.frequencies[index] ?? 0) > 0);
      expect(bars).toHaveLength(drawn.length);
      bars.forEach((bar, position) => {
        const action = drawn[position];
        if (action === undefined) throw new Error("bar without action");
        expect(bar.style).toBe(actionColor(action, model.actions, "light"));
        expect(Math.abs(bar.w - (cell.frequencies[action.index] ?? 0) * rect.w)).toBeLessThanOrEqual(1);
        expect(bar.h).toBe(rect.h);
      });
      const lefts = bars.map((bar) => bar.x);
      expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    }
  });

  it("R3.12 every painted action also paints its hatch pattern and every cell prints its hand", () => {
    const ops = draw(model);
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      const patterns = fillsIn(ops, rect).filter((op) => isFakePattern(op.style));
      const patterned = model.actions.filter(
        (action) => (cell.frequencies[action.index] ?? 0) > 0 && actionStyle(action.kind).pattern !== "none",
      );
      const keys = patterns.map((op) => (isFakePattern(op.style) ? op.style.patternKey : ""));
      expect(keys).toHaveLength(patterned.length);
      patterned.forEach((action, position) => {
        expect(keys[position]?.startsWith(actionStyle(action.kind).pattern)).toBe(true);
      });
      expect(textsIn(ops, rect)).toContain(cell.hand);
    }
  });

  it("R3.12 two sizes of one sized kind get different pattern keys, so shade is not the only signal", () => {
    const actions = [
      { index: 0, token: "f", kind: "fold" as const, size_cbb: null, bucket: null, label: "Fold" },
      { index: 1, token: "r250", kind: "raise" as const, size_cbb: 250, bucket: null, label: "Raise 2.5bb" },
      { index: 2, token: "r600", kind: "raise" as const, size_cbb: 600, bucket: null, label: "Raise 6bb" },
    ];
    const hands = fixtureStudyNode.hands.map((row) => ({
      ...row,
      strategy: [0.2, 0.4, 0.4],
      ev_bb: [0, 1, 2],
      loss_pct_pot: [1, 1, 0],
    }));
    const twoSizes = buildMatrixModel({ actions, hands });
    const source = fakePatternSource();
    draw(twoSizes, { patterns: source });
    const raiseKeys = new Set(source.requested.filter((key) => key.startsWith("diagonal")));
    expect(raiseKeys.size).toBe(2);
  });

  it("R3.12 EV mode prints each present cell's best EV with one decimal on a diverging fill", () => {
    const ops = draw(model, { mode: "ev" });
    const palette = MATRIX_PALETTES.light;
    const scale = new Set([...palette.evNegative, ...palette.evPositive, palette.evNeutral]);
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      const texts = textsIn(ops, rect);
      expect(texts).toContain(cell.hand);
      expect(texts).toContain(formatEvShort(cell.evBestBb ?? 0));
      const fill = fillsIn(ops, rect).find((op) => typeof op.style === "string" && scale.has(op.style));
      expect(fill).toMatchObject({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
    const best = model.cells.reduce((top, cell) => ((cell.evBestBb ?? 0) > (top.evBestBb ?? 0) ? cell : top));
    const worst = model.cells.reduce((low, cell) => ((cell.evBestBb ?? 0) < (low.evBestBb ?? 0) ? cell : low));
    const fillOf = (cell: MatrixCell) => fillsIn(ops, cellRect(cell)).find((op) => scale.has(op.style as string))?.style;
    expect(palette.evPositive).toContain(fillOf(best));
    if ((worst.evBestBb ?? 0) < 0) expect(palette.evNegative).toContain(fillOf(worst));
  });

  it("R3.12 weight mode fills a height proportional to the weight and prints the percent", () => {
    const ops = draw(model, { mode: "weight" });
    const palette = MATRIX_PALETTES.light;
    for (const cell of model.cells) {
      const rect = cellRect(cell);
      const weight = cell.weight ?? 0;
      expect(textsIn(ops, rect)).toContain(formatWeightShort(weight));
      const bar = fillsIn(ops, rect).find((op) => op.style === palette.weightFill);
      expect(bar).toBeDefined();
      expect(Math.abs((bar?.h ?? 0) - weight * rect.h)).toBeLessThanOrEqual(1);
      expect((bar?.y ?? 0) + (bar?.h ?? 0)).toBe(rect.y + rect.h);
    }
  });

  it("R3.12 weight mode prints a question mark when the reach is unknown", () => {
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "AA" ? { ...row, reach: null } : row));
    const unknown = buildMatrixModel({ ...fixtureStudyNode, hands });
    const ops = draw(unknown, { mode: "weight" });
    expect(textsIn(ops, cellRect(unknown.cells[0] as MatrixCell))).toContain("?");
  });

  it("R3.12 a missing hand is drawn gray with the missing hatch and a dash in every mode", () => {
    const sparse = buildMatrixModel({ ...fixtureStudyNode, hands: fixtureStudyNode.hands.filter((row) => row.hand !== "K7o") });
    const cell = sparse.cells.find((candidate) => candidate.hand === "K7o") as MatrixCell;
    for (const mode of ["frequency", "ev", "weight"] as const) {
      const ops = draw(sparse, { mode });
      const fills = fillsIn(ops, cellRect(cell));
      expect(fills.some((op) => op.style === MATRIX_PALETTES.light.missingFill)).toBe(true);
      expect(fills.some((op) => isFakePattern(op.style) && op.style.patternKey === MISSING_PATTERN_KEY)).toBe(true);
      expect(textsIn(ops, cellRect(cell))).toEqual(expect.arrayContaining(["K7o", "-"]));
    }
  });

  it("R3.12 outlines the focused cell and the selected hand with different line widths", () => {
    const ops = draw(model, { focusedIndex: 14, selectedHand: "AKs" });
    const strokes = ops.filter((op): op is Extract<RecordedOp, { op: "strokeRect" }> => op.op === "strokeRect");
    const focused = strokes.find((op) => op.style === MATRIX_PALETTES.light.focus);
    const selected = strokes.find((op) => op.style === MATRIX_PALETTES.light.selected);
    expect(focused && inside(focused, cellRect(model.cells[14] as MatrixCell))).toBe(true);
    expect(selected && inside(selected, cellRect(model.cells[1] as MatrixCell))).toBe(true);
    expect(focused?.lineWidth).not.toBe(selected?.lineWidth);
  });

  it("R3.12 draws no outline without focus or selection", () => {
    const ops = draw(model);
    const outlines = ops.filter(
      (op) => op.op === "strokeRect" && (op.style === MATRIX_PALETTES.light.focus || op.style === MATRIX_PALETTES.light.selected),
    );
    expect(outlines).toHaveLength(0);
  });

  it("R3.12 at device pixel ratio 2 every rectangle is integer aligned within the backing store", () => {
    const ops = draw(model, { pixelRatio: 2, theme: "dark", mode: "frequency" });
    const rects = ops.filter((op) => op.op === "fillRect" || op.op === "strokeRect" || op.op === "clearRect");
    expect(rects.length).toBeGreaterThan(169);
    for (const op of rects) {
      expect(Number.isInteger(op.x) && Number.isInteger(op.y) && Number.isInteger(op.w) && Number.isInteger(op.h)).toBe(true);
      expect(op.x + op.w).toBeLessThanOrEqual(SIZE_PX * 2);
    }
    expect(ops[0]).toMatchObject({ op: "fillRect", x: 0, y: 0, w: 1040, h: 1040, style: MATRIX_PALETTES.dark.background });
  });

  it("R3.12 one cell is 40 by 40 CSS pixels at the default 520", () => {
    expect(cellRect(model.cells[0] as MatrixCell)).toEqual({ x: 0, y: 0, w: CELL_PX, h: CELL_PX });
  });

  it("R3.12 ignores a focus index off the grid and a selected hand the grid does not hold", () => {
    const ops = draw(model, { focusedIndex: 400, selectedHand: "AhKd" });
    expect(ops.some((op) => op.op === "strokeRect")).toBe(false);
  });

  it("R3.12 clamps a weight above 1 and frequencies summing above 1 to the cell", () => {
    const hands = fixtureStudyNode.hands.map((row) =>
      row.hand === "AA" ? { ...row, reach: [1.5], strategy: [0.6, 0.6, 0, 0] } : row,
    );
    const odd = buildMatrixModel({ ...fixtureStudyNode, hands });
    const rect = cellRect(odd.cells[0] as MatrixCell);
    const weightBar = fillsIn(draw(odd, { mode: "weight" }), rect).find((op) => op.style === MATRIX_PALETTES.light.weightFill);
    expect(weightBar?.h).toBe(rect.h);
    const colors = new Set(odd.actions.map((action) => actionColor(action, odd.actions, "light")));
    const bars = fillsIn(draw(odd), rect).filter((op) => typeof op.style === "string" && colors.has(op.style));
    expect(bars.reduce((sum, bar) => sum + bar.w, 0)).toBe(rect.w);
  });

  /** The frequency bars of cell AA when its strategy is replaced, drawn at a 200 pixel cell. */
  function aaBars(strategy: readonly number[]) {
    const pixelRatio = 5;
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "AA" ? { ...row, strategy: [...strategy] } : row));
    const node = buildMatrixModel({ ...fixtureStudyNode, hands });
    const rect = cellRect(node.cells[0] as MatrixCell, pixelRatio);
    const colors = new Set(node.actions.map((action) => actionColor(action, node.actions, "light")));
    const bars = fillsIn(draw(node, { pixelRatio }), rect).filter((op) => typeof op.style === "string" && colors.has(op.style));
    return { rect, bars };
  }

  it("R3.12 the last played bar runs to the cell's right edge when the frequencies sum slightly under 1", () => {
    const { rect, bars } = aaBars([0.3, 0.3, 0.397, 0]);
    expect(rect.w).toBe(200);
    expect(bars).toHaveLength(3);
    const last = bars.at(-1);
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBe(rect.x + rect.w);
    expect(bars.map((bar) => bar.w)).toEqual([60, 60, 80]);
  });

  it("R3.12 frequencies summing to exactly 1 keep their rounded widths", () => {
    const { rect, bars } = aaBars([0.25, 0.25, 0.25, 0.25]);
    expect(bars.map((bar) => bar.w)).toEqual([50, 50, 50, 50]);
    const last = bars.at(-1);
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBe(rect.x + rect.w);
  });

  it("R3.12 a present hand with no played action paints no bar", () => {
    expect(aaBars([0, 0, 0, 0]).bars).toHaveLength(0);
  });
});

describe("R3.12 range matrix EV scale", () => {
  const palette = MATRIX_PALETTES.dark;

  it("R3.12 zero EV is neutral and the ends of the scale take the strongest step", () => {
    expect(evFill(palette, 0, 2)).toBe(palette.evNeutral);
    expect(evFill(palette, 2, 2)).toBe(palette.evPositive.at(-1));
    expect(evFill(palette, -5, 2)).toBe(palette.evNegative.at(-1));
    expect(evFill(palette, 0.001, 2)).toBe(palette.evPositive[0]);
    expect(evFill(palette, -0.001, 2)).toBe(palette.evNegative[0]);
  });
});
