/**
 * Tests for ActionBar, one button per tree action at the node (S24, R3.13, ADR 0020, O-22). The
 * behavioural grouping test (R3.9) is S25's; here the bar renders the actions it is given.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ActionBar } from "../../src/components/trainer/index.js";
import type { NodeAction } from "../../src/contracts.js";
import { fixtureActions } from "../../src/fixtures/index.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";

const FLOP_ACTIONS: readonly NodeAction[] = [
  { index: 0, token: "x", kind: "check", size_cbb: null, bucket: null, label: "Check", next_node_key: null },
  { index: 1, token: "b330", kind: "bet", size_cbb: 330, bucket: "small", label: "Small", next_node_key: null },
  { index: 2, token: "b1000", kind: "bet", size_cbb: 1000, bucket: "pot", label: "Pot", next_node_key: null },
];

/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));

function withRoot(ui: ReactNode) {
  return render(<HotkeyRoot store={createHotkeyStore()}>{ui}</HotkeyRoot>);
}

describe("R3.13 ActionBar", () => {
  it("R3.13 renders exactly one button per tree action, in record order", () => {
    withRoot(<ActionBar actions={fixtureActions} grouping="grouped" street="preflop" onAction={vi.fn()} />);
    const bar = screen.getByTestId("action-bar");
    const buttons = within(bar).getAllByRole("button");
    expect(buttons).toHaveLength(fixtureActions.length);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Fold",
      "Call",
      "Raise to 2.5bb",
      "All-in 100bb",
    ]);
  });

  it("R3.13 renders no button for an empty action list", () => {
    withRoot(<ActionBar actions={[]} grouping="standard" street="flop" onAction={vi.fn()} />);
    expect(within(screen.getByTestId("action-bar")).queryAllByRole("button")).toHaveLength(0);
  });

  it("R3.13 Standard shows the exact size label", () => {
    withRoot(<ActionBar actions={FLOP_ACTIONS} grouping="standard" street="flop" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bet 3.3bb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bet 10bb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
  });

  it("R3.13 Grouped postflop shows the bucket label with the exact size underneath", () => {
    withRoot(<ActionBar actions={FLOP_ACTIONS} grouping="grouped" street="flop" onAction={vi.fn()} />);
    const small = screen.getByRole("button", { name: "Small, 3.3bb" });
    expect(within(small).getByText("Small")).toBeInTheDocument();
    expect(within(small).getByText("3.3bb")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
  });

  it("R3.13 Grouped preflop shows the api label with no size line (O-22)", () => {
    withRoot(<ActionBar actions={fixtureActions} grouping="grouped" street="preflop" onAction={vi.fn()} />);
    const raise = screen.getByRole("button", { name: "Raise to 2.5bb" });
    expect(within(raise).queryByText("2.5bb")).not.toBeInTheDocument();
  });

  it("R3.13 Simple shows the api label", () => {
    withRoot(<ActionBar actions={FLOP_ACTIONS} grouping="simple" street="turn" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pot" })).toBeInTheDocument();
  });

  it("R3.13 each button shows its hotkey number and the action's short letter", () => {
    withRoot(<ActionBar actions={fixtureActions} grouping="standard" street="preflop" onAction={vi.fn()} />);
    const raise = screen.getByRole("button", { name: "Raise 2.5bb" });
    expect(raise).toHaveAttribute("aria-keyshortcuts", "3");
    expect(within(raise).getByText("3")).toBeInTheDocument();
    expect(within(raise).getByText("R")).toBeInTheDocument();
    expect(within(raise).getByTestId("action-swatch")).toHaveAttribute("data-pattern", "diagonal");
  });

  it("R3.13 clicking or pressing the number calls onAction with the record index", async () => {
    const onAction = vi.fn();
    withRoot(<ActionBar actions={fixtureActions} grouping="standard" street="preflop" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(onAction).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard("4");
    expect(onAction).toHaveBeenLastCalledWith(3);
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("R3.13 onAction receives NodeAction.index, not the button's position, when they differ (O-198)", async () => {
    const onAction = vi.fn();
    withRoot(<ActionBar actions={OFFSET_ACTIONS} grouping="standard" street="preflop" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(onAction).toHaveBeenLastCalledWith(11);
    await userEvent.keyboard("3");
    expect(onAction).toHaveBeenLastCalledWith(12);
  });

  it("R3.13 disabled buttons ignore clicks and hotkeys", async () => {
    const onAction = vi.fn();
    withRoot(<ActionBar actions={fixtureActions} grouping="standard" street="preflop" disabled onAction={onAction} />);
    expect(screen.getByRole("button", { name: "Fold" })).toBeDisabled();
    await userEvent.keyboard("1");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("R3.13 only the first nine actions get a hotkey", () => {
    const many: NodeAction[] = Array.from({ length: 10 }, (_, index) => ({
      index,
      token: `b${index}`,
      kind: "bet",
      size_cbb: (index + 1) * 100,
      bucket: null,
      label: `Bet ${index + 1}`,
      next_node_key: null,
    }));
    withRoot(<ActionBar actions={many} grouping="simple" street="river" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bet 9" })).toHaveAttribute("aria-keyshortcuts", "9");
    expect(screen.getByRole("button", { name: "Bet 10" })).not.toHaveAttribute("aria-keyshortcuts");
  });
});
