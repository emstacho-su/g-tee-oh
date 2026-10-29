/**
 * Tests for the lens legends, the table fallback in the two lenses and the marked-cell label band
 * (R3.24, R3.12): the strategy-with-EV legend names the actions and says where the EV prints, the
 * compare legend is a six-step bar in percent of the pot naming the compared action, the table
 * prints the lens values for every cell, the weight legend speaks of the range (never the class),
 * and a selected or focused cell's label chip sits inside its ring so the hand stays readable.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cellEdges, drawMatrix, type DrawOptions } from "../../src/components/range-matrix/draw.js";
import { MATRIX_PALETTES } from "../../src/components/range-matrix/matrix-theme.js";
import { buildMatrixModel, type MatrixCell } from "../../src/components/range-matrix/model.js";
import { RangeMatrix } from "../../src/components/range-matrix/RangeMatrix.js";
import { RangeMatrixTable } from "../../src/components/range-matrix/RangeMatrixTable.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { fakePatternSource, recordingContext, type RecordedOp } from "./recording-context.js";

const model = buildMatrixModel(fixtureStudyNode);
const SIZE_PX = 520;

function stubNoContext(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
}

describe("R3.24 lens legends", () => {
  it("R3.24 strategy with EV keeps the action legend and says the corner prints the best EV", () => {
    stubNoContext();
    render(<RangeMatrix node={fixtureStudyNode} mode="strategy_ev" theme="light" onSelectHand={() => undefined} />);
    expect(screen.getByRole("list", { name: "Action legend" })).toBeInTheDocument();
    expect(screen.getByText(/best action's EV in bb/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Range matrix, strategy with EV mode, 169 hands" })).toBeInTheDocument();
  });

  it("R3.24 compare to best shows six steps in percent of the pot and names the compared action", () => {
    stubNoContext();
    render(<RangeMatrix node={fixtureStudyNode} mode="compare" theme="light" lensIndex={2} onSelectHand={() => undefined} />);
    const legend = screen.getByRole("list", { name: /Compare legend/ });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(6);
    expect(legend).toHaveTextContent("best");
    expect(legend).toHaveTextContent(/more than [\d.]+% of the pot behind the best/);
    expect(screen.getByText(/Raise 2\.5bb against the best action/)).toBeInTheDocument();
  });

  it("R3.12 the weight legend speaks of the range, never of the class", () => {
    stubNoContext();
    render(<RangeMatrix node={fixtureStudyNode} mode="weight" theme="light" onSelectHand={() => undefined} />);
    const legend = screen.getByRole("list", { name: /Weight legend/ });
    const caption = legend.parentElement?.textContent ?? "";
    expect(caption).toMatch(/range/);
    expect(caption).not.toMatch(/class/i);
  });
});

describe("R3.24 table fallback in the lenses", () => {
  it("R3.24 strategy with EV prints the frequencies and the best EV for every cell", () => {
    render(<RangeMatrixTable model={model} mode="strategy_ev" id="t" />);
    const table = screen.getByRole("table", { name: /strategy with EV/ });
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(169);
    cells.forEach((element, index) => {
      const cell = model.cells[index] as MatrixCell;
      expect(element.textContent).toContain(`best EV ${(cell.evBestBb ?? 0).toFixed(2)}bb`);
    });
  });

  it("R3.24 compare to best prints the chosen action's loss for every cell", () => {
    render(<RangeMatrixTable model={model} mode="compare" lens={2} id="t" />);
    const table = screen.getByRole("table", { name: /compare to best/ });
    const cells = within(table).getAllByRole("cell");
    cells.forEach((element, index) => {
      const cell = model.cells[index] as MatrixCell;
      const loss = cell.lossPctPot[2] ?? 0;
      expect(element.textContent.startsWith(`${cell.hand}: Raise 2.5bb`)).toBe(true);
      if (loss >= 0.1) expect(element.textContent).toContain(`${loss.toFixed(2)}% of the pot behind the best`);
      else expect(element.textContent).toContain("is the best action");
    });
  });
});

describe("R3.12 a marked cell keeps its label readable", () => {
  function options(overrides: Partial<DrawOptions>): DrawOptions {
    return { mode: "frequency", sizePx: SIZE_PX, pixelRatio: 1, theme: "light", focusedIndex: null, selectedHand: null, patterns: fakePatternSource(), ...overrides };
  }

  function rectOf(index: number) {
    const cell = model.cells[index] as MatrixCell;
    const edges = cellEdges(SIZE_PX);
    const x = edges[cell.col] ?? 0;
    const y = edges[cell.row] ?? 0;
    return { x, y, w: (edges[cell.col + 1] ?? 0) - x, h: (edges[cell.row + 1] ?? 0) - y };
  }

  function strokeAndChip(ops: readonly RecordedOp[], index: number, strokeStyle: string) {
    const rect = rectOf(index);
    const within = (op: { x: number; y: number }) => op.x >= rect.x && op.x < rect.x + rect.w && op.y >= rect.y && op.y < rect.y + rect.h;
    const stroke = ops.find((op): op is Extract<RecordedOp, { op: "strokeRect" }> => op.op === "strokeRect" && op.style === strokeStyle && within(op));
    const chip = ops.find((op): op is Extract<RecordedOp, { op: "fillRect" }> => op.op === "fillRect" && op.style === MATRIX_PALETTES.light.labelChip && within(op));
    const label = ops.find((op): op is Extract<RecordedOp, { op: "fillText" }> => op.op === "fillText" && within(op) && op.text === (model.cells[index] as MatrixCell).hand);
    if (stroke === undefined || chip === undefined || label === undefined) throw new Error("no stroke, chip or label in the cell");
    return { rect, stroke, chip, label };
  }

  it("R3.12 the selection ring leaves the label band clear: the chip and the label sit inside the ring", () => {
    const { ctx, ops } = recordingContext();
    drawMatrix(ctx, model, options({ selectedHand: "AKs" }));
    const { stroke, chip, label } = strokeAndChip(ops, 1, MATRIX_PALETTES.light.selected);
    const inner = stroke.y + stroke.lineWidth / 2;
    const innerLeft = stroke.x + stroke.lineWidth / 2;
    expect(chip.y).toBeGreaterThanOrEqual(inner);
    expect(chip.x).toBeGreaterThanOrEqual(innerLeft);
    expect(label.y).toBeGreaterThanOrEqual(chip.y);
    expect(label.x).toBeGreaterThanOrEqual(chip.x);
    expect(ops.indexOf(chip)).toBeGreaterThan(ops.indexOf(stroke));
  });

  it("R3.12 an unmarked cell's chip stays at the cell corner and a focused cell's chip moves inside the focus ring", () => {
    const { ctx, ops } = recordingContext();
    drawMatrix(ctx, model, options({ focusedIndex: 14 }));
    const plain = rectOf(0);
    const plainChip = ops.find((op): op is Extract<RecordedOp, { op: "fillRect" }> => op.op === "fillRect" && op.style === MATRIX_PALETTES.light.labelChip && op.x === plain.x && op.y === plain.y);
    expect(plainChip).toBeDefined();
    const { stroke, chip } = strokeAndChip(ops, 14, MATRIX_PALETTES.light.focus);
    expect(chip.y).toBeGreaterThanOrEqual(stroke.y + stroke.lineWidth / 2);
  });
});
