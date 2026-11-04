/**
 * The pop-out in Compare to Best (S45, R3.12, R3.24; code review round 2, item 1): a cell the row
 * carries no loss for takes the missing fill and the label ink, as the canvas paints it, never the
 * best action's neutral colour.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MATRIX_PALETTES } from "../../src/components/range-matrix/matrix-theme.js";
import { MatrixPopOut } from "../../src/components/range-matrix/MatrixPopOut.js";
import { buildMatrixModel } from "../../src/components/range-matrix/model.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";

const LENS = { position: 2, scalePctPot: 2 };

/** The palette's hex as jsdom reports an inline colour. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe("R3.12 the pop-out's compare fill", () => {
  it("R3.12 a cell with no loss for the compared action takes the missing fill, not the best colour", () => {
    const model = buildMatrixModel(fixtureStudyNode);
    const aa = model.cells.find((cell) => cell.hand === "AA");
    if (aa === undefined) throw new Error("the fixture has no AA cell");
    const palette = MATRIX_PALETTES.light;
    render(<MatrixPopOut cell={{ ...aa, lossPctPot: [] }} actions={model.actions} mode="compare" theme="light" evScaleBb={model.evScaleBb} lens={LENS} />);
    const styled = screen.getByTestId("popout-cell");
    expect(styled.style.backgroundColor).toBe(rgb(palette.missingFill));
    expect(styled.style.backgroundColor).not.toBe(rgb(palette.evNeutral));
    expect(styled.style.color).toBe(rgb(palette.labelText));
  });
});
