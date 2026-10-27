/**
 * Tests for the action index helpers (S24, R3.13, O-198): every index that crosses a component
 * boundary is NodeAction.index, and array positions are derived only at render time. The node
 * here numbers its actions 10 to 13, so an index is never equal to its position.
 */
import { describe, expect, it } from "vitest";

import type { NodeAction } from "../../src/contracts.js";
import { fixtureActions } from "../../src/fixtures/index.js";
import { actionOfIndex, indexAtPosition, positionOfIndex, unknownIndexes } from "../../src/poker/action-index.js";

const INDEX_OFFSET = 10;
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({
  ...action,
  index: action.index + INDEX_OFFSET,
}));

describe("R3.13 action index helpers (O-198)", () => {
  it("R3.13 positionOfIndex maps a NodeAction.index to its position in the actions", () => {
    expect(positionOfIndex(OFFSET_ACTIONS, 10)).toBe(0);
    expect(positionOfIndex(OFFSET_ACTIONS, 12)).toBe(2);
    expect(positionOfIndex(OFFSET_ACTIONS, 13)).toBe(3);
  });

  it("R3.13 positionOfIndex returns undefined for an unknown index, including a bare position", () => {
    expect(positionOfIndex(OFFSET_ACTIONS, 2)).toBeUndefined();
    expect(positionOfIndex(OFFSET_ACTIONS, 14)).toBeUndefined();
    expect(positionOfIndex([], 0)).toBeUndefined();
  });

  it("R3.13 indexAtPosition maps a position back to the NodeAction.index", () => {
    expect(indexAtPosition(OFFSET_ACTIONS, 0)).toBe(10);
    expect(indexAtPosition(OFFSET_ACTIONS, 3)).toBe(13);
  });

  it("R3.13 indexAtPosition throws a RangeError for a position outside the actions", () => {
    expect(() => indexAtPosition(OFFSET_ACTIONS, 4)).toThrow(RangeError);
    expect(() => indexAtPosition(OFFSET_ACTIONS, -1)).toThrow(RangeError);
    expect(() => indexAtPosition(OFFSET_ACTIONS, 1.5)).toThrow(RangeError);
  });

  it("R3.13 actionOfIndex returns the action with that NodeAction.index, or undefined", () => {
    expect(actionOfIndex(OFFSET_ACTIONS, 11)?.label).toBe("Call");
    expect(actionOfIndex(OFFSET_ACTIONS, 1)).toBeUndefined();
  });

  it("R3.13 unknownIndexes lists the indexes that name no action, in the order given", () => {
    expect(unknownIndexes(OFFSET_ACTIONS, [12, 2, 13, 99])).toEqual([2, 99]);
    expect(unknownIndexes(OFFSET_ACTIONS, [10, 11])).toEqual([]);
    expect(unknownIndexes(OFFSET_ACTIONS, [])).toEqual([]);
  });
});
