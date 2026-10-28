/**
 * The range painter's cell text on action fills (S38, R3.13, O-389). S38 deepened the action colours
 * to 3:1 on the cream grounds, so a fixed black ink no longer reads at 4.5:1 on every fill; each
 * painted cell now takes the ink actionFillStyle picks for its fill in each theme (ACTION_INK_CLASSES).
 * The test paints one hand per action, covering every kind and four raise sizes (the size shades),
 * and checks the ink against the fill in both themes.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaintGrid } from "../../src/components/painter/PaintGrid.js";
import { ACTION_INK_CLASSES } from "../../src/components/trainer/index.js";
import type { ActionKind, NodeAction } from "../../src/contracts.js";
import { contrastRatio } from "../../src/theme/color-contrast.js";

const TEXT_AA = 4.5;
const THEMES = ["light", "dark"] as const;
const HANDS = ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44"] as const;

function action(index: number, kind: ActionKind, sizeCbb: number | null): NodeAction {
  return { index, token: `${kind}-${index}`, kind, size_cbb: sizeCbb, bucket: null, label: `${kind} ${index}`, next_node_key: null };
}

const ACTIONS: readonly NodeAction[] = [
  action(0, "fold", null),
  action(1, "check", null),
  action(2, "call", null),
  action(3, "limp", null),
  action(4, "straddle", 200),
  action(5, "bet", 150),
  action(6, "bet", 300),
  action(7, "raise", 250),
  action(8, "raise", 600),
  action(9, "raise", 1200),
  action(10, "all_in", 10_000),
];

const PAINT = Object.fromEntries(ACTIONS.map((each, position) => [HANDS[position] ?? "22", each.index]));
const ignore = (): void => undefined;

describe("R3.13 the painter's cell text on action fills", () => {
  it("R3.13 every painted cell prints in an ink at 4.5:1 on its fill in both themes", () => {
    render(<PaintGrid paint={PAINT} actions={ACTIONS} enabled onBegin={ignore} onExtend={ignore} onEnd={ignore} onPaintOne={ignore} />);
    for (const painted of ACTIONS) {
      const cell = screen.getAllByRole("button").find((button) => button.getAttribute("data-action") === String(painted.index));
      if (cell === undefined) throw new Error(`no painted cell for action ${painted.index}`);
      expect(cell.className).toContain(ACTION_INK_CLASSES);
      expect(cell.className).not.toMatch(/\btext-black\b/);
      for (const theme of THEMES) {
        const fill = cell.style.getPropertyValue(`--action-${theme}`);
        const ink = cell.style.getPropertyValue(`--ink-${theme}`);
        expect(contrastRatio(ink, fill), `${painted.kind} ${painted.index} in ${theme}: ${ink} on ${fill}`).toBeGreaterThanOrEqual(TEXT_AA);
      }
    }
  });
});
