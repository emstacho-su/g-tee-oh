// Tests for the position carousel's pure rules (S39, R3.12, O-354, O-393, O-394): the decisions a
// line holds, read from each prefix node's to_act and actions, and the seat items in action order,
// with seats outside the pair folded, a pair seat whose turn has not come waiting, and every
// decision past the first orbit appended as its own item.
import { describe, expect, it } from "vitest";

import type { NodeAction, StudyNode } from "../../src/contracts.js";
import { seatedPositions } from "../../src/drills/limits.js";
import { carouselItems, lineDecisions, type CarouselItem } from "../../src/study/carousel.js";
import { linePrefixes } from "../../src/study/line.js";

type LineNode = Pick<StudyNode, "to_act" | "actions">;

function action(index: number, token: string, kind: NodeAction["kind"], sizeCbb: number | null): NodeAction {
  return { index, token, kind, size_cbb: sizeCbb, bucket: null, label: token, next_node_key: null };
}

const OPEN: LineNode = { to_act: "BTN", actions: [action(0, "f", "fold", null), action(1, "r250", "raise", 250)] };
const VERSUS_OPEN: LineNode = { to_act: "BB", actions: [action(0, "f", "fold", null), action(1, "r1100", "raise", 1100)] };
const VERSUS_RERAISE: LineNode = { to_act: "BTN", actions: [action(0, "f", "fold", null), action(1, "c", "call", null)] };

const BB_BTN = { oop: "BB", ip: "BTN" } as const;

function brief(items: readonly CarouselItem[]) {
  return items.map(({ seat, state, text, line, reason }) => ({ seat, state, text, line, reason }));
}

describe("R3.12 line prefixes and decisions", () => {
  it("R3.12 the prefixes run from the root to the line itself", () => {
    expect(linePrefixes(undefined)).toEqual([""]);
    expect(linePrefixes("")).toEqual([""]);
    expect(linePrefixes("r250.r1100")).toEqual(["", "r250", "r250.r1100"]);
  });

  it("R3.12 each prefix node is one decision: its seat, its line and the action the line took there", () => {
    const decisions = lineDecisions([OPEN, VERSUS_OPEN], "r250");
    expect(decisions).toEqual([
      { seat: "BTN", line: "", taken: "Raise 2.5bb" },
      { seat: "BB", line: "r250", taken: undefined },
    ]);
  });

  it("R3.12 a token the node does not offer shows as the raw token", () => {
    expect(lineDecisions([OPEN, VERSUS_OPEN], "x9")[0]?.taken).toBe("x9");
  });
});

describe("R3.12 carousel items", () => {
  it("R3.12 at the root of BB-BTN at six players: folds, the opener to act and the big blind waiting", () => {
    const items = carouselItems(seatedPositions(6), BB_BTN, lineDecisions([OPEN], undefined));
    expect(brief(items)).toEqual([
      { seat: "UTG", state: "folded", text: "Folds", line: undefined, reason: "Outside this pair's solution" },
      { seat: "HJ", state: "folded", text: "Folds", line: undefined, reason: "Outside this pair's solution" },
      { seat: "CO", state: "folded", text: "Folds", line: undefined, reason: "Outside this pair's solution" },
      { seat: "BTN", state: "current", text: "To act", line: "", reason: undefined },
      { seat: "SB", state: "folded", text: "Folds", line: undefined, reason: "Outside this pair's solution" },
      { seat: "BB", state: "waiting", text: "Waiting", line: undefined, reason: "Acts after BTN" },
    ]);
  });

  it("R3.12 one step down, the opener shows its action and the big blind is to act", () => {
    const items = carouselItems(seatedPositions(6), BB_BTN, lineDecisions([OPEN, VERSUS_OPEN], "r250"));
    expect(brief(items).slice(3)).toEqual([
      { seat: "BTN", state: "acted", text: "Raise 2.5bb", line: "", reason: undefined },
      { seat: "SB", state: "folded", text: "Folds", line: undefined, reason: "Outside this pair's solution" },
      { seat: "BB", state: "current", text: "To act", line: "r250", reason: undefined },
    ]);
  });

  it("R3.12 a decision after the first orbit is appended as its own item", () => {
    const items = carouselItems(seatedPositions(6), BB_BTN, lineDecisions([OPEN, VERSUS_OPEN, VERSUS_RERAISE], "r250.r1100"));
    expect(items).toHaveLength(7);
    expect(brief(items).slice(5)).toEqual([
      { seat: "BB", state: "acted", text: "Raise 11bb", line: "r250", reason: undefined },
      { seat: "BTN", state: "current", text: "To act", line: "r250.r1100", reason: undefined },
    ]);
    expect(new Set(items.map((item) => item.key)).size).toBe(7);
  });

  it("R3.12 small blind against big blind folds everyone before the small blind", () => {
    const open: LineNode = { ...OPEN, to_act: "SB" };
    const items = carouselItems(seatedPositions(6), { oop: "SB", ip: "BB" }, lineDecisions([open], undefined));
    expect(items.map((item) => `${item.seat}:${item.state}`)).toEqual([
      "UTG:folded",
      "HJ:folded",
      "CO:folded",
      "BTN:folded",
      "SB:current",
      "BB:waiting",
    ]);
  });

  it("R3.12 a heads-up table has no folded seat", () => {
    const items = carouselItems(seatedPositions(2), BB_BTN, lineDecisions([OPEN], undefined));
    expect(items.map((item) => `${item.seat}:${item.state}`)).toEqual(["BTN:current", "BB:waiting"]);
  });
});
