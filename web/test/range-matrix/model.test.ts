/**
 * Tests for the range matrix model (S24, R3.12): 169 cells in grid order built from a StudyNode,
 * missing hands marked, the numbers copied from the api untouched (ADR 0004) and the lengths
 * validated with an error that names the hand.
 */
import { describe, expect, it } from "vitest";

import { buildMatrixModel, evScaleOf } from "../../src/components/range-matrix/model.js";
import type { StudyNode } from "../../src/contracts.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { HAND_GRID } from "../../src/poker/hands.js";

function withoutHands(node: StudyNode, hands: readonly string[]): StudyNode {
  return { ...node, hands: node.hands.filter((row) => !hands.includes(row.hand)) };
}

describe("R3.12 range matrix model", () => {
  it("R3.12 builds 169 cells in the HAND_GRID order", () => {
    const model = buildMatrixModel(fixtureStudyNode);
    expect(model.cells).toHaveLength(169);
    expect(model.cells.map((cell) => cell.hand)).toEqual(HAND_GRID.map((cell) => cell.hand));
    expect(model.cells[0]).toMatchObject({ hand: "AA", row: 0, col: 0, kind: "pair", combos: 6 });
    expect(model.cells[1]).toMatchObject({ hand: "AKs", row: 0, col: 1, kind: "suited", combos: 4 });
    expect(model.cells[13]).toMatchObject({ hand: "AKo", row: 1, col: 0, kind: "offsuit", combos: 12 });
    expect(model.cells[168]).toMatchObject({ hand: "22", row: 12, col: 12 });
  });

  it("R3.12 copies strategy, ev_bb, ev_best_bb and reach[0] from the node rows", () => {
    const model = buildMatrixModel(fixtureStudyNode);
    for (const row of fixtureStudyNode.hands) {
      const cell = model.cells.find((candidate) => candidate.hand === row.hand);
      expect(cell).toBeDefined();
      expect(cell?.present).toBe(true);
      expect(cell?.frequencies).toEqual(row.strategy);
      expect(cell?.evBb).toEqual(row.ev_bb);
      expect(cell?.evBestBb).toBe(row.ev_best_bb);
      expect(cell?.weight).toBe(row.reach?.[0] ?? null);
    }
    expect(model.actions).toEqual(fixtureStudyNode.actions);
  });

  it("R3.12 marks a hand the node has no row for as missing", () => {
    const model = buildMatrixModel(withoutHands(fixtureStudyNode, ["72o", "AA"]));
    const missing = model.cells.filter((cell) => !cell.present).map((cell) => cell.hand);
    expect(missing.sort()).toEqual(["72o", "AA"]);
    const aa = model.cells[0];
    expect(aa).toMatchObject({ hand: "AA", present: false, evBestBb: null, weight: null });
    expect(aa?.frequencies).toEqual([]);
    expect(aa?.evBb).toEqual([]);
  });

  it("R3.12 reads a null reach as an unknown weight", () => {
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "KK" ? { ...row, reach: null } : row));
    const model = buildMatrixModel({ ...fixtureStudyNode, hands });
    expect(model.cells.find((cell) => cell.hand === "KK")?.weight).toBeNull();
    expect(model.cells.find((cell) => cell.hand === "KK")?.present).toBe(true);
  });

  it("R3.12 throws a RangeError naming the hand when strategy length differs from the actions", () => {
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "T9s" ? { ...row, strategy: [1] } : row));
    expect(() => buildMatrixModel({ ...fixtureStudyNode, hands })).toThrow(RangeError);
    expect(() => buildMatrixModel({ ...fixtureStudyNode, hands })).toThrow(/T9s/);
  });

  it("R3.12 throws a RangeError naming the hand when ev_bb length differs from the actions", () => {
    const hands = fixtureStudyNode.hands.map((row) => (row.hand === "55" ? { ...row, ev_bb: [0, 1] } : row));
    expect(() => buildMatrixModel({ ...fixtureStudyNode, hands })).toThrow(/55/);
  });

  it("R3.12 throws a RangeError for a hand that is not one of the 169 classes or repeats", () => {
    const first = fixtureStudyNode.hands[0];
    if (first === undefined) throw new Error("fixture has no rows");
    const unknown = { ...fixtureStudyNode, hands: [{ ...first, hand: "AhKd" }] };
    expect(() => buildMatrixModel(unknown)).toThrow(/AhKd/);
    const repeated = { ...fixtureStudyNode, hands: [first, first] };
    expect(() => buildMatrixModel(repeated)).toThrow(/AA/);
  });

  it("R3.12 evScaleOf is the 90th percentile of the present cells' absolute best EV, at least 0.5bb (O-384)", () => {
    const model = buildMatrixModel(fixtureStudyNode);
    const sorted = fixtureStudyNode.hands.map((row) => Math.abs(row.ev_best_bb)).sort((a, b) => a - b);
    const nearestRank = sorted[Math.ceil(0.9 * sorted.length) - 1] ?? 0;
    expect(model.evScaleBb).toBe(Math.max(0.5, nearestRank));
    expect(evScaleOf([])).toBe(0.5);
  });

  it("R3.12 one huge EV does not stretch the scale end, and missing cells do not count", () => {
    const base = buildMatrixModel(fixtureStudyNode).cells;
    const cells = base.map((cell, index) => ({ ...cell, evBestBb: index === 0 ? 40 : index <= 100 ? 2 : -1, present: index < 150 }));
    expect(evScaleOf(cells)).toBe(2);
    expect(evScaleOf(cells.map((cell) => ({ ...cell, evBestBb: 0.1 })))).toBe(0.5);
  });
});
