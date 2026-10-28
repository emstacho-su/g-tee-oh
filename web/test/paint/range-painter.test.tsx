/**
 * Tests for RangePainter (S27 lane B, R3.17, O-300, ADR 0020, A7 section 4): a 13 by 13 grid of
 * buttons in chart order, one brush per node action, painting by click, pointer drag and keyboard,
 * brush hotkeys, Paint all, Undo, disabled out-of-range cells and the submitted paint map.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RangePainter } from "../../src/components/painter/RangePainter.js";
import { FIXTURE_PAINT_ABSENT, fixturePaintPrompt } from "../../src/fixtures/paint.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { HAND_GRID } from "../../src/poker/hands.js";

const FOLD = "Fold";
const CALL = "Call";
const RAISE = "Raise to 10bb";

function setup(submitting = false) {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(
    <HotkeyRoot store={createHotkeyStore()}>
      <RangePainter prompt={fixturePaintPrompt} submitting={submitting} onSubmit={onSubmit} />
    </HotkeyRoot>,
  );
  return { onSubmit, user };
}

function cell(hand: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${hand}: `) });
}

function submitted(onSubmit: ReturnType<typeof vi.fn>): Record<string, number> {
  const [paint] = onSubmit.mock.lastCall as [Record<string, number>];
  return paint;
}

describe("R3.17 RangePainter grid", () => {
  it("R3.17 renders 169 cells in chart order, each named by its class and painted action, fold first", () => {
    setup();
    const grid = screen.getByRole("grid", { name: /range to paint/i });
    const buttons = within(grid).getAllByRole("button");
    expect(buttons).toHaveLength(HAND_GRID.length);
    expect(buttons[0]).toHaveAccessibleName(`AA: ${FOLD}`);
    expect(buttons[1]).toHaveAccessibleName(`AKs: ${FOLD}`);
    expect(buttons[13]).toHaveAccessibleName(`AKo: ${FOLD}`);
    expect(within(grid).getAllByRole("row")).toHaveLength(13);
  });

  it("R3.17 cells the node does not hold are disabled and marked not in range", async () => {
    const { user } = setup();
    for (const hand of FIXTURE_PAINT_ABSENT) {
      expect(cell(hand)).toHaveAccessibleName(`${hand}: not in range`);
      expect(cell(hand)).toHaveAttribute("aria-disabled", "true");
    }
    await user.click(screen.getByRole("radio", { name: new RegExp(RAISE) }));
    await user.click(cell("72o"));
    expect(cell("72o")).toHaveAccessibleName("72o: not in range");
  });

  it("R3.17 offers one brush per node action with its label, fold selected", () => {
    setup();
    const brushes = within(screen.getByRole("radiogroup", { name: /brush/i })).getAllByRole("radio");
    expect(brushes.map((brush) => brush.textContent)).toEqual([
      expect.stringContaining(FOLD),
      expect.stringContaining(CALL),
      expect.stringContaining(RAISE),
    ]);
    expect(brushes[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByTestId("action-swatch").length).toBeGreaterThanOrEqual(3);
  });
});

describe("R3.17 RangePainter painting", () => {
  it("R3.17 a click paints a cell with the selected brush", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: new RegExp(RAISE) }));
    await user.click(cell("AA"));
    expect(cell("AA")).toHaveAccessibleName(`AA: ${RAISE}`);
    expect(cell("KK")).toHaveAccessibleName(`KK: ${FOLD}`);
  });

  it("R3.17 a pointer drag paints every cell it enters, and stops at pointer up", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: new RegExp(CALL) }));
    fireEvent.pointerDown(cell("AA"));
    fireEvent.pointerEnter(cell("AKs"));
    fireEvent.pointerEnter(cell("AQs"));
    fireEvent.pointerUp(window);
    fireEvent.pointerEnter(cell("AJs"));
    expect(cell("AA")).toHaveAccessibleName(`AA: ${CALL}`);
    expect(cell("AKs")).toHaveAccessibleName(`AKs: ${CALL}`);
    expect(cell("AQs")).toHaveAccessibleName(`AQs: ${CALL}`);
    expect(cell("AJs")).toHaveAccessibleName(`AJs: ${FOLD}`);
  });

  it("R3.17 arrow keys move between cells and Space or Enter paints the focused one", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: new RegExp(RAISE) }));
    cell("AA").focus();
    await user.keyboard("{ArrowRight}");
    expect(cell("AKs")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(cell("KK")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(cell("KK")).toHaveAccessibleName(`KK: ${RAISE}`);
    await user.keyboard("{ArrowLeft}");
    expect(cell("AKo")).toHaveFocus();
    await user.keyboard(" ");
    expect(cell("AKo")).toHaveAccessibleName(`AKo: ${RAISE}`);
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowLeft}");
    expect(cell("AA")).toHaveFocus();
  });

  it("R3.17 number keys pick a brush", async () => {
    const { user } = setup();
    await user.keyboard("2");
    expect(screen.getByRole("radio", { name: new RegExp(CALL) })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("3");
    expect(screen.getByRole("radio", { name: new RegExp(RAISE) })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("9");
    expect(screen.getByRole("radio", { name: new RegExp(RAISE) })).toHaveAttribute("aria-checked", "true");
  });

  it("R3.17 Paint all fills the held classes with the brush and Undo takes back the last stroke", async () => {
    const { user } = setup();
    const undoButton = screen.getByRole("button", { name: /undo/i });
    expect(undoButton).toBeDisabled();
    await user.keyboard("2");
    await user.click(screen.getByRole("button", { name: /paint all/i }));
    expect(cell("AA")).toHaveAccessibleName(`AA: ${CALL}`);
    expect(cell("22")).toHaveAccessibleName(`22: ${CALL}`);
    expect(cell("72o")).toHaveAccessibleName("72o: not in range");
    await user.keyboard("3");
    await user.click(cell("AA"));
    await user.click(undoButton);
    expect(cell("AA")).toHaveAccessibleName(`AA: ${CALL}`);
    await user.click(undoButton);
    expect(cell("22")).toHaveAccessibleName(`22: ${FOLD}`);
    expect(undoButton).toBeDisabled();
  });
});

describe("R3.17 RangePainter submit", () => {
  it("R3.17 Submit sends the painted map: every held class once, no class the node lacks", async () => {
    const { user, onSubmit } = setup();
    await user.keyboard("3");
    await user.click(cell("AA"));
    await user.click(screen.getByRole("button", { name: /submit/i }));
    const paint = submitted(onSubmit);
    expect(Object.keys(paint).sort()).toEqual([...fixturePaintPrompt.hands].sort());
    expect(paint).toMatchObject({ AA: 2, KK: 0 });
  });

  it("R3.17 while submitting, the buttons are disabled", () => {
    setup(true);
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /paint all/i })).toBeDisabled();
  });
});
