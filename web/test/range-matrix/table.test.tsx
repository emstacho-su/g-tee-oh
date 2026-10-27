/**
 * Tests for the accessible table fallback of the range matrix (S24, R3.12). The "same data"
 * proof: for every mode, every one of the 169 cells prints exactly the numbers the model holds,
 * checked by parsing the numbers back out of the cell text rather than by reusing the
 * formatter, so a formatter that drops or reorders a number fails here.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { actionShortLabel, cellValueText } from "../../src/components/range-matrix/cell-text.js";
import { buildMatrixModel, type MatrixCell, type MatrixMode } from "../../src/components/range-matrix/model.js";
import { RangeMatrixTable } from "../../src/components/range-matrix/RangeMatrixTable.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { RANKS } from "../../src/poker/cards.js";

const PERCENT = 100;
const sparseNode = { ...fixtureStudyNode, hands: fixtureStudyNode.hands.filter((row) => row.hand !== "J4o") };
const model = buildMatrixModel(sparseNode);

function bodyCells(): HTMLElement[] {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);
  return rows.flatMap((row) => within(row).getAllByRole("cell"));
}

function numbers(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

function expectFrequencyText(cell: MatrixCell, text: string): void {
  const expected = cell.frequencies.filter((value) => value > 0).map((value) => Number((value * PERCENT).toFixed(1)));
  expect(numbers(text, /(\d+(?:\.\d+)?)%/g)).toEqual(expected);
  const letters = model.actions.filter((action) => (cell.frequencies[action.index] ?? 0) > 0).map(actionShortLabel);
  let from = 0;
  for (const letter of letters) {
    const at = text.indexOf(letter, from);
    expect(at).toBeGreaterThanOrEqual(from);
    from = at + letter.length;
  }
}

function expectCellText(mode: MatrixMode, cell: MatrixCell, text: string): void {
  expect(text.startsWith(cell.hand)).toBe(true);
  if (!cell.present) {
    expect(text).toContain("not in range");
    return;
  }
  if (mode === "frequency") expectFrequencyText(cell, text);
  if (mode === "ev") expect(numbers(text, /(-?\d+\.\d+)bb/g)).toEqual([Number((cell.evBestBb ?? 0).toFixed(2))]);
  if (mode === "weight") expect(numbers(text, /(\d+(?:\.\d+)?)%/g)).toEqual([Number(((cell.weight ?? 0) * PERCENT).toFixed(1))]);
}

describe("R3.12 range matrix table fallback", () => {
  it("R3.12 is a real table with a caption naming the mode and rank headers on both axes", () => {
    render(<RangeMatrixTable model={model} mode="ev" id="matrix-table" />);
    const table = screen.getByRole("table", { name: /expected value/i });
    expect(table).toHaveAttribute("id", "matrix-table");
    const columnHeaders = within(table).getAllByRole("columnheader");
    expect(columnHeaders.map((header) => header.textContent)).toEqual(["Hand", ...RANKS]);
    expect(within(table).getAllByRole("rowheader").map((header) => header.textContent)).toEqual([...RANKS]);
    expect(within(table).getAllByRole("row")).toHaveLength(14);
  });

  for (const mode of ["frequency", "ev", "weight"] as const) {
    it(`R3.12 every one of the 169 cells shows the model's numbers in ${mode} mode`, () => {
      render(<RangeMatrixTable model={model} mode={mode} id="t" />);
      const cells = bodyCells();
      expect(cells).toHaveLength(169);
      cells.forEach((element, index) => {
        const cell = model.cells[index];
        if (cell === undefined) throw new Error(`no model cell ${index}`);
        expectCellText(mode, cell, element.textContent);
      });
    });
  }

  it("R3.12 a missing hand reads not in range in every mode", () => {
    for (const mode of ["frequency", "ev", "weight"] as const) {
      const missing = model.cells.find((cell) => cell.hand === "J4o") as MatrixCell;
      expect(cellValueText(missing, model.actions, mode)).toBe("not in range");
    }
  });

  it("R3.12 an unknown weight and an all-zero strategy read as such", () => {
    const base = model.cells[0] as MatrixCell;
    expect(cellValueText({ ...base, weight: null }, model.actions, "weight")).toBe("weight unknown");
    expect(cellValueText({ ...base, frequencies: [0, 0, 0, 0] }, model.actions, "frequency")).toBe("no action");
  });

  it("R3.12 sized actions carry their size in the short label", () => {
    expect(model.actions.map(actionShortLabel)).toEqual(["F", "C", "R 2.5bb", "A 100bb"]);
  });
});
