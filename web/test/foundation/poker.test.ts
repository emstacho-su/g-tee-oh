/**
 * Tests for the shared poker display helpers and the action styles (S24): the 169-cell grid
 * behind RangeMatrix (R3.12), card naming for CardView and the cbb formatting every trainer
 * component prints (R3.13), and the NodeAction to GradeAction mapping the roller hands to
 * packages/learning (O-213, O-262).
 */
import { describe, expect, it } from "vitest";

import { fixtureActions, fixtureStudyNode } from "../../src/fixtures/index.js";
import { cardName, parseCard, rankLabel, suitSymbol } from "../../src/poker/cards.js";
import { exactActionLabel, formatBb, formatCbb, formatPercent, formatShare, formatWholePercent, wholePercent } from "../../src/poker/format.js";
import { toGradeActions } from "../../src/poker/grade-actions.js";
import { HAND_CLASS_COUNT, HAND_GRID, cellOf, handAt } from "../../src/poker/hands.js";
import { ACTION_STYLES, actionColor, actionStyle, sizeRank } from "../../src/theme/action-style.js";

describe("R3.12 hand grid", () => {
  it("R3.12 holds 169 distinct classes: 13 pairs, 78 suited, 78 offsuit, 1326 combos", () => {
    expect(HAND_GRID).toHaveLength(HAND_CLASS_COUNT);
    expect(new Set(HAND_GRID.map((cell) => cell.hand)).size).toBe(HAND_CLASS_COUNT);
    const count = (kind: string) => HAND_GRID.filter((cell) => cell.kind === kind).length;
    expect([count("pair"), count("suited"), count("offsuit")]).toEqual([13, 78, 78]);
    expect(HAND_GRID.reduce((sum, cell) => sum + cell.combos, 0)).toBe(1326);
  });

  it("R3.12 puts pairs on the diagonal, suited above and offsuit below", () => {
    expect(handAt(0, 0).hand).toBe("AA");
    expect(handAt(0, 1).hand).toBe("AKs");
    expect(handAt(1, 0).hand).toBe("AKo");
    expect(handAt(12, 12).hand).toBe("22");
    expect(handAt(4, 5).hand).toBe("T9s");
    expect(cellOf("T9o")).toMatchObject({ row: 5, col: 4, kind: "offsuit" });
    expect(cellOf("XYz")).toBeUndefined();
  });
});

describe("R3.13 cards and formatting", () => {
  it("R3.13 parses and names cards", () => {
    expect(parseCard("Ah")).toEqual({ rank: "A", suit: "h" });
    expect(cardName(parseCard("Td"))).toBe("Ten of diamonds");
    expect(suitSymbol("s")).toBe("♠");
    expect(rankLabel("T")).toBe("10");
    expect(rankLabel("9")).toBe("9");
  });

  it("R3.13 rejects anything that is not a two-character card", () => {
    for (const bad of ["", "A", "Ahh", "1h", "Ax", "ah"]) {
      expect(() => parseCard(bad)).toThrow(RangeError);
    }
  });

  it("R3.13 formats cbb, bb and percentages without recomputing anything", () => {
    expect(formatCbb(250)).toBe("2.5bb");
    expect(formatCbb(10000)).toBe("100bb");
    expect(formatCbb(133)).toBe("1.33bb");
    expect(formatBb(0.1234)).toBe("0.12bb");
    expect(formatShare(0.4567)).toBe("45.7%");
    expect(formatPercent(1.25)).toBe("1.25%");
    expect(exactActionLabel(fixtureActions[2]!)).toBe("Raise 2.5bb");
    expect(exactActionLabel(fixtureActions[0]!)).toBe("Fold");
  });

  it("R3.12 one whole-percent rounding for every share shown as a whole percent (PR #42 review round 1, I)", () => {
    expect(wholePercent(0.996)).toBe(100);
    expect(wholePercent(0.004)).toBe(0);
    expect(wholePercent(0.5)).toBe(50);
    expect(formatWholePercent(0.613)).toBe("61%");
    expect(formatWholePercent(0.996)).toBe(`${wholePercent(0.996)}%`);
  });
});

describe("R3.13 action styles", () => {
  it("R3.13 gives every action kind a label and a pattern, so color is never the only signal", () => {
    for (const style of Object.values(ACTION_STYLES)) {
      expect(style.short).toMatch(/^[A-Z]$/);
      expect(style.name.length).toBeGreaterThan(0);
      expect(style.color.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(style.color.dark).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(actionStyle("fold").pattern).not.toBe(actionStyle("raise").pattern);
  });

  it("R3.13 shades two raise sizes at one node differently", () => {
    const small = { index: 0, token: "r250", kind: "raise", size_cbb: 250, bucket: "pot", label: "", next_node_key: null } as const;
    const large = { index: 1, token: "r600", kind: "raise", size_cbb: 600, bucket: "overbet-large", label: "", next_node_key: null } as const;
    const both = [small, large];
    expect(actionColor(small, both, "light")).not.toBe(actionColor(large, both, "light"));
    expect(actionColor(fixtureActions[0]!, fixtureActions, "dark")).toBe(ACTION_STYLES.fold.color.dark);
  });

  it("R3.13 caps the shade at the darkest one past four sizes and treats a missing size as 0", () => {
    const sizes = [100, 200, 300, 400, 500, 600];
    const raises = sizes.map(
      (size, index) => ({ index, token: `r${size}`, kind: "raise", size_cbb: size, bucket: "pot", label: "", next_node_key: null }) as const,
    );
    expect(actionColor(raises[5]!, raises, "light")).toBe(actionColor(raises[3]!, raises, "light"));
    const unsized = { index: 0, token: "b", kind: "bet", size_cbb: null, bucket: null, label: "", next_node_key: null } as const;
    expect(actionColor(unsized, [unsized], "dark")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("R3.12 sizeRank ranks bets and raises by size ascending and gives unsized kinds 0", () => {
    const large = { index: 1, token: "r900", kind: "raise", size_cbb: 900, bucket: "pot", label: "", next_node_key: null } as const;
    const small = { index: 2, token: "b300", kind: "bet", size_cbb: 300, bucket: "pot", label: "", next_node_key: null } as const;
    const middle = { index: 3, token: "r600", kind: "raise", size_cbb: 600, bucket: "pot", label: "", next_node_key: null } as const;
    const allIn = { index: 4, token: "a", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "", next_node_key: null } as const;
    const fold = { index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "", next_node_key: null } as const;
    const actions = [fold, large, small, middle, allIn];
    expect([small, middle, large].map((action) => sizeRank(action, actions))).toEqual([0, 1, 2]);
    expect(sizeRank(fold, actions)).toBe(0);
    expect(sizeRank(allIn, actions)).toBe(0);
    const unsized = { index: 5, token: "b", kind: "bet", size_cbb: null, bucket: null, label: "", next_node_key: null } as const;
    expect(sizeRank(unsized, [unsized, small])).toBe(0);
    expect(sizeRank(small, [unsized, small])).toBe(1);
    expect(sizeRank(middle, [small])).toBe(0);
  });

  it("R3.12 actionColor shades by sizeRank, capped at the darkest shade", () => {
    const sizes = [100, 200, 300, 400, 500];
    const raises = sizes.map(
      (size, index) => ({ index, token: `r${size}`, kind: "raise", size_cbb: size, bucket: "pot", label: "", next_node_key: null }) as const,
    );
    const shades = raises.map((raise) => actionColor(raise, raises, "dark"));
    expect(new Set(shades.slice(0, 4)).size).toBe(4);
    expect(shades[4]).toBe(shades[3]);
    expect(shades[0]).toBe(ACTION_STYLES.raise.color.dark);
  });
});

describe("R3.13 grade action mapping (O-213)", () => {
  it("R3.13 maps NodeAction rows to GradeAction in record order", () => {
    expect(toGradeActions(fixtureStudyNode.actions)).toEqual([
      { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 0 },
      { kind: "call", bucket: null, sizeCbb: 0, lossPctPot: 0 },
      { kind: "raise", bucket: "pot", sizeCbb: 250, lossPctPot: 0 },
      { kind: "all_in", bucket: "all-in", sizeCbb: 10000, lossPctPot: 0 },
    ]);
  });

  it("R3.13 refuses a bucket name learning does not know", () => {
    const bad = [{ index: 0, token: "b1", kind: "bet", size_cbb: 100, bucket: "huge", label: "", next_node_key: null } as const];
    expect(() => toGradeActions(bad)).toThrow(/unknown bucket/);
  });
});

describe("R3.12 fixtures", () => {
  it("R3.12 the synthetic study node has 169 rows whose strategies sum to 1", () => {
    expect(fixtureStudyNode.hands).toHaveLength(HAND_CLASS_COUNT);
    for (const row of fixtureStudyNode.hands) {
      const sum = row.strategy.reduce((total, share) => total + share, 0);
      expect(sum).toBeCloseTo(1, 3);
      expect(row.strategy).toHaveLength(fixtureStudyNode.actions.length);
    }
  });
});
