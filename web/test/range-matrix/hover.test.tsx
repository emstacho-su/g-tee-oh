/**
 * Tests for hover on the range matrix (S45, R3.25, O-386): moving the pointer over a cell reports
 * its hand with no selection and no address write, leaving reports null, a touch pointer is
 * ignored, an open pop-out shows the hovered cell while the pointer is over the canvas and the
 * pinned cell again once it leaves, and the canvas strokes a thin outline on the hovered cell.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cellEdges, drawMatrix, type DrawOptions } from "../../src/components/range-matrix/draw.js";
import { MATRIX_PALETTES } from "../../src/components/range-matrix/matrix-theme.js";
import { buildMatrixModel, type MatrixCell } from "../../src/components/range-matrix/model.js";
import { RangeMatrix } from "../../src/components/range-matrix/RangeMatrix.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { fakePatternSource, recordingContext, type RecordedOp } from "./recording-context.js";

const SIZE_PX = 520;
const CELL_PX = 40;
const BOX = { x: 10, y: 20 };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function placedCanvas(): HTMLElement {
  const canvas = screen.getByRole("img");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ ...BOX, width: SIZE_PX, height: SIZE_PX }));
  return canvas;
}

function at(row: number, col: number) {
  return { clientX: BOX.x + CELL_PX * col + 5, clientY: BOX.y + CELL_PX * row + 5 };
}

describe("R3.25 hover inspects a cell, click pins it", () => {
  it("R3.25 pointer move reports the hand under the pointer, leaving reports null, and nothing is selected", () => {
    const onHoverHand = vi.fn();
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} onHoverHand={onHoverHand} />);
    const canvas = placedCanvas();
    fireEvent.pointerMove(canvas, at(1, 2));
    expect(onHoverHand).toHaveBeenLastCalledWith("KQs");
    fireEvent.pointerMove(canvas, at(1, 2));
    expect(onHoverHand).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(canvas, at(0, 0));
    expect(onHoverHand).toHaveBeenLastCalledWith("AA");
    fireEvent.pointerLeave(canvas);
    expect(onHoverHand).toHaveBeenLastCalledWith(null);
    expect(onSelectHand).not.toHaveBeenCalled();
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
  });

  it("R3.25 a touch pointer moving over the canvas reports nothing", () => {
    const onHoverHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} onHoverHand={onHoverHand} />);
    fireEvent.pointerMove(placedCanvas(), { ...at(1, 2), pointerType: "touch" });
    expect(onHoverHand).not.toHaveBeenCalled();
  });

  it("R3.25 an open pop-out follows the hovered cell and returns to the pinned cell when the pointer leaves", () => {
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    const canvas = placedCanvas();
    fireEvent.click(canvas, at(0, 0));
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AA");
    fireEvent.pointerMove(canvas, at(0, 1));
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AKs");
    fireEvent.pointerLeave(canvas);
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AA");
    fireEvent.pointerMove(canvas, at(2, 2));
    fireEvent.click(canvas, at(2, 2));
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "QQ");
  });

  it("R3.25 hovering with no pop-out open opens none", () => {
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    fireEvent.pointerMove(placedCanvas(), at(0, 1));
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
  });
});

describe("R3.25 the hover outline", () => {
  const model = buildMatrixModel(fixtureStudyNode);

  function options(overrides: Partial<DrawOptions>): DrawOptions {
    return { mode: "frequency", sizePx: SIZE_PX, pixelRatio: 1, theme: "light", focusedIndex: null, selectedHand: null, patterns: fakePatternSource(), ...overrides };
  }

  function strokesIn(ops: readonly RecordedOp[], index: number) {
    const cell = model.cells[index] as MatrixCell;
    const edges = cellEdges(SIZE_PX);
    const x = edges[cell.col] ?? 0;
    const y = edges[cell.row] ?? 0;
    const w = (edges[cell.col + 1] ?? 0) - x;
    const h = (edges[cell.row + 1] ?? 0) - y;
    return ops.filter(
      (op): op is Extract<RecordedOp, { op: "strokeRect" }> => op.op === "strokeRect" && op.x >= x && op.x < x + w && op.y >= y && op.y < y + h,
    );
  }

  it("R3.25 strokes a thin outline on the hovered cell, thinner than the focus ring, and none when nothing is hovered", () => {
    const { ctx, ops } = recordingContext();
    drawMatrix(ctx, model, options({ hoveredIndex: 14, focusedIndex: 0 }));
    const hover = strokesIn(ops, 14).find((op) => op.style === MATRIX_PALETTES.light.focus);
    const focus = strokesIn(ops, 0).find((op) => op.style === MATRIX_PALETTES.light.focus);
    expect(hover).toBeDefined();
    expect(focus).toBeDefined();
    expect(hover?.lineWidth ?? 0).toBeLessThan(focus?.lineWidth ?? 0);
    const plain = recordingContext();
    drawMatrix(plain.ctx, model, options({}));
    expect(plain.ops.some((op) => op.op === "strokeRect")).toBe(false);
  });
});
