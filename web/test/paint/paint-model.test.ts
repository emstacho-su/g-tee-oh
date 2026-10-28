/**
 * Tests for the range painter's pure state (S27 lane B, R3.17, O-300): the starting brush, strokes,
 * paint all, undo, brush hotkeys and the graded helpers.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_UNDO,
  beginStroke,
  brushAtHotkey,
  canUndo,
  costliest,
  defaultBrush,
  endStroke,
  extendStroke,
  initialPaintState,
  lossShade,
  paintAll,
  paintOne,
  selectBrush,
  undo,
  type HandGrade,
} from "../../src/components/painter/paint-model.js";
import type { NodeAction } from "../../src/contracts.js";
import { fixturePaintActions } from "../../src/fixtures/paint.js";

const HANDS = ["AA", "AKs", "72o"] as const;
const CALL = 1;
const RAISE = 2;
const CALL_ONLY: NodeAction[] = [{ index: 4, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call", next_node_key: null }];

function start() {
  return initialPaintState(HANDS, fixturePaintActions);
}

function grade(hand: string, weighted: number): HandGrade {
  return { hand, action_index: 0, best_action_index: 0, loss_bb: weighted, loss_pct_pot: 0, weight: 1, weighted_loss_bb: weighted };
}

describe("R3.17 paint model: start and brushes", () => {
  it("R3.17 starts with every held class painted with fold, the brush in hand", () => {
    expect(start()).toEqual({ paint: { AA: 0, AKs: 0, "72o": 0 }, brush: 0, history: [], strokeStart: null });
  });

  it("R3.17 starts with the first action when the node has no fold, and refuses a node with no action", () => {
    expect(defaultBrush(CALL_ONLY)).toBe(4);
    expect(() => defaultBrush([])).toThrow(RangeError);
  });

  it("R3.17 selecting the brush in hand keeps the same state", () => {
    const state = start();
    expect(selectBrush(state, 0)).toBe(state);
    expect(selectBrush(state, RAISE).brush).toBe(RAISE);
  });

  it("R3.17 number keys 1 to 9 name the first nine brushes", () => {
    expect(brushAtHotkey(fixturePaintActions, 1)?.index).toBe(0);
    expect(brushAtHotkey(fixturePaintActions, 3)?.index).toBe(RAISE);
    expect(brushAtHotkey(fixturePaintActions, 4)).toBeUndefined();
    expect(brushAtHotkey(fixturePaintActions, 0)).toBeUndefined();
    expect(brushAtHotkey(fixturePaintActions, 10)).toBeUndefined();
  });
});

describe("R3.17 paint model: strokes and undo", () => {
  it("R3.17 a drag stroke paints every entered cell and undoes as one", () => {
    const raising = selectBrush(start(), RAISE);
    const dragged = endStroke(extendStroke(extendStroke(beginStroke(raising, "AA"), "AKs"), "AKs"));
    expect(dragged.paint).toEqual({ AA: RAISE, AKs: RAISE, "72o": 0 });
    expect(canUndo(dragged)).toBe(true);
    expect(undo(dragged).paint).toEqual(raising.paint);
    expect(canUndo(undo(dragged))).toBe(false);
  });

  it("R3.17 entering a cell without a pressed pointer paints nothing, and a stroke that changed nothing is not undoable", () => {
    const state = start();
    expect(extendStroke(state, "AA")).toBe(state);
    const noop = paintOne(state, "AA");
    expect(noop.history).toEqual([]);
    expect(endStroke(state)).toBe(state);
  });

  it("R3.17 a class the node does not hold is never painted", () => {
    const state = paintOne(selectBrush(start(), CALL), "KK");
    expect(state.paint).toEqual(start().paint);
  });

  it("R3.17 undo waits for the stroke in progress and does nothing on an empty history", () => {
    const pressed = beginStroke(selectBrush(start(), CALL), "AA");
    expect(canUndo(pressed)).toBe(false);
    expect(undo(pressed)).toBe(pressed);
    const fresh = start();
    expect(undo(fresh)).toBe(fresh);
  });

  it("R3.17 paint all fills with the brush in hand as one undoable stroke, and is a no-op when already filled", () => {
    const filled = paintAll(selectBrush(start(), CALL));
    expect(filled.paint).toEqual({ AA: CALL, AKs: CALL, "72o": CALL });
    expect(paintAll(filled)).toBe(filled);
    expect(undo(filled).paint).toEqual(start().paint);
  });

  it("R3.17 the history keeps at most MAX_UNDO strokes", () => {
    let state = start();
    for (let stroke = 0; stroke < MAX_UNDO + 5; stroke += 1) {
      state = paintOne(selectBrush(state, stroke % 2 === 0 ? CALL : RAISE), "AA");
    }
    expect(state.history).toHaveLength(MAX_UNDO);
  });
});

describe("R3.17 paint model: graded helpers", () => {
  it("R3.17 costliest orders by the api's weighted loss, drops zero losses and keeps ties in order", () => {
    const rows = [grade("AA", 0), grade("KK", 0.02), grade("QQ", 0.5), grade("JJ", 0.02)];
    expect(costliest(rows).map((row) => row.hand)).toEqual(["QQ", "KK", "JJ"]);
    expect(costliest(rows, 1).map((row) => row.hand)).toEqual(["QQ"]);
  });

  it("R3.17 lossShade buckets the weighted loss by named thresholds", () => {
    expect(lossShade(0)).toBe("none");
    expect(lossShade(0.0005)).toBe("low");
    expect(lossShade(0.005)).toBe("medium");
    expect(lossShade(0.05)).toBe("high");
  });
});
