/**
 * Tests for the matrix highlight of filtered actions (S45, R3.12, O-468): with a highlight set,
 * the bar lenses paint only the highlighted actions' shares in place, hands with zero frequency
 * in every highlighted action get a translucent dim over the cell, hatch and hand letters stay,
 * and the other lenses keep their fill and only dim.
 */
import { describe, expect, it } from "vitest";

import { cellEdges, drawMatrix, type DrawOptions } from "../../src/components/range-matrix/draw.js";
import { MATRIX_PALETTES } from "../../src/components/range-matrix/matrix-theme.js";
import { buildMatrixModel, type MatrixCell } from "../../src/components/range-matrix/model.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { actionColor } from "../../src/theme/action-style.js";
import { fakePatternSource, isFakePattern, recordingContext, type RecordedOp } from "./recording-context.js";

const SIZE_PX = 520;
const model = buildMatrixModel(fixtureStudyNode);
const palette = MATRIX_PALETTES.light;
const RAISE = 2;

function options(overrides: Partial<DrawOptions>): DrawOptions {
  return { mode: "frequency", sizePx: SIZE_PX, pixelRatio: 1, theme: "light", focusedIndex: null, selectedHand: null, patterns: fakePatternSource(), ...overrides };
}

function rectOf(cell: MatrixCell) {
  const edges = cellEdges(SIZE_PX);
  const x = edges[cell.col] ?? 0;
  const y = edges[cell.row] ?? 0;
  return { x, y, w: (edges[cell.col + 1] ?? 0) - x, h: (edges[cell.row + 1] ?? 0) - y };
}

type PlacedOp = Exclude<RecordedOp, { op: "clearRect" }>;

function opsIn(ops: readonly RecordedOp[], cell: MatrixCell): PlacedOp[] {
  const rect = rectOf(cell);
  return ops.filter(
    (op): op is PlacedOp => op.op !== "clearRect" && op.x >= rect.x && op.x < rect.x + rect.w && op.y >= rect.y && op.y < rect.y + rect.h,
  );
}

function draw(overrides: Partial<DrawOptions>) {
  const { ctx, ops } = recordingContext();
  drawMatrix(ctx, model, options(overrides));
  return ops;
}

const colors = model.actions.map((action) => actionColor(action, model.actions, "light"));

describe("R3.12 highlighted actions", () => {
  it("R3.12 paints only the highlighted actions' shares, in place, and keeps their hatch", () => {
    const ops = draw({ highlight: new Set([RAISE]) });
    for (const cell of model.cells) {
      const inCell = opsIn(ops, cell);
      const bars = inCell.filter((op) => op.op === "fillRect" && typeof op.style === "string" && colors.includes(op.style));
      const raiseShare = cell.frequencies[RAISE] ?? 0;
      expect(bars.length).toBe(raiseShare > 0 ? 1 : 0);
      if (raiseShare > 0) {
        expect(bars[0]?.style).toBe(colors[RAISE]);
        const hatched = inCell.some((op) => op.op === "fillRect" && isFakePattern(op.style) && op.style.patternKey.startsWith("diagonal"));
        expect(hatched).toBe(true);
      }
      expect(inCell.some((op) => op.op === "fillText" && op.text === cell.hand)).toBe(true);
    }
  });

  it("R3.12 dims a hand with zero frequency in every highlighted action and leaves the others undimmed", () => {
    const ops = draw({ highlight: new Set([RAISE]) });
    for (const cell of model.cells.filter((candidate) => candidate.present)) {
      const dimmed = opsIn(ops, cell).some((op) => op.op === "fillRect" && op.style === palette.dimOverlay);
      expect(dimmed).toBe((cell.frequencies[RAISE] ?? 0) <= 0);
    }
  });

  it("R3.12 without a highlight nothing is dimmed and every share is painted", () => {
    const ops = draw({});
    expect(ops.some((op) => op.op === "fillRect" && op.style === palette.dimOverlay)).toBe(false);
    const aa = model.cells[0] as MatrixCell;
    const bars = opsIn(ops, aa).filter((op) => op.op === "fillRect" && typeof op.style === "string" && colors.includes(op.style));
    expect(bars.length).toBe(aa.frequencies.filter((share) => share > 0).length);
  });

  it("R3.12 in EV mode the fill stays and only the dim applies", () => {
    const ops = draw({ mode: "ev", highlight: new Set([RAISE]) });
    const folder = model.cells.find((cell) => cell.present && (cell.frequencies[RAISE] ?? 0) <= 0) as MatrixCell;
    const inCell = opsIn(ops, folder);
    const fills = inCell.filter((op): op is Extract<RecordedOp, { op: "fillRect" }> => op.op === "fillRect");
    expect(fills.some((op) => [...palette.evNegative, palette.evNeutral, ...palette.evPositive].includes(String(op.style)))).toBe(true);
    expect(inCell.some((op) => op.op === "fillRect" && op.style === palette.dimOverlay)).toBe(true);
  });

  it("R3.12 the dim overlay is a translucent colour in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(MATRIX_PALETTES[theme].dimOverlay).toMatch(/^rgba\(.*0\.\d+\)$/);
    }
  });
});
