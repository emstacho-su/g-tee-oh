/**
 * R3.9 proof for the trainer's action buttons (S25, ADR 0020, O-22, O-198). The buttons are the
 * node's tree actions: one per action, in record order, each answering with its NodeAction.index;
 * a bucket the tree does not offer has no button. Grouped shows the bucket label with the exact
 * size underneath, except at preflop nodes, where the api label already carries the exact size;
 * Standard always shows the exact size. The S24 R3.13 tests in action-bar.test.tsx cover the
 * hotkeys and the disabled state; this file is the R3.9 behaviour on realistic nodes.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ActionBar } from "../../src/components/trainer/index.js";
import type { NodeAction } from "../../src/contracts.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";

/** A button open preflop, numbered from 20 so NodeAction.index never equals the position. */
const PREFLOP_OPEN: readonly NodeAction[] = [
  { index: 20, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null },
  { index: 21, token: "r250", kind: "raise", size_cbb: 250, bucket: "pot", label: "Raise to 2.5bb", next_node_key: "k/r250" },
  { index: 22, token: "r10000", kind: "all_in", size_cbb: 10000, bucket: "all-in", label: "All-in 100bb", next_node_key: null },
];

/** A flop node whose tree offers a small and a pot bet and nothing in the medium bucket. */
const FLOP_SMALL_AND_POT: readonly NodeAction[] = [
  { index: 30, token: "x", kind: "check", size_cbb: null, bucket: null, label: "Check", next_node_key: "k/x" },
  { index: 31, token: "b330", kind: "bet", size_cbb: 330, bucket: "small", label: "Small", next_node_key: "k/b330" },
  { index: 32, token: "b1000", kind: "bet", size_cbb: 1000, bucket: "pot", label: "Pot", next_node_key: "k/b1000" },
];

function withRoot(ui: ReactNode) {
  return render(<HotkeyRoot store={createHotkeyStore()}>{ui}</HotkeyRoot>);
}

function barButtons(): HTMLElement[] {
  return within(screen.getByTestId("action-bar")).getAllByRole("button");
}

describe("R3.9 action buttons come from the node's tree actions", () => {
  it("R3.9 buttons equal the node's tree actions: same count, same order, each answering its NodeAction.index", async () => {
    const onAction = vi.fn();
    withRoot(<ActionBar actions={FLOP_SMALL_AND_POT} grouping="grouped" street="flop" onAction={onAction} />);
    const buttons = barButtons();
    expect(buttons).toHaveLength(FLOP_SMALL_AND_POT.length);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Check", "Small, 3.3bb", "Pot, 10bb"]);
    for (const [position, button] of buttons.entries()) {
      await userEvent.click(button);
      expect(onAction).toHaveBeenLastCalledWith(FLOP_SMALL_AND_POT[position]?.index);
    }
    expect(onAction).toHaveBeenCalledTimes(FLOP_SMALL_AND_POT.length);
  });

  it("R3.9 a bucket with no tree action has no button: small and pot bets offered, no medium button", () => {
    withRoot(<ActionBar actions={FLOP_SMALL_AND_POT} grouping="grouped" street="flop" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /medium/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/medium/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Small, 3.3bb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pot, 10bb" })).toBeInTheDocument();
  });

  it("R3.9 a preflop node in Grouped mode shows the exact size, with no bucket name and no second size line (O-22)", () => {
    withRoot(<ActionBar actions={PREFLOP_OPEN} grouping="grouped" street="preflop" onAction={vi.fn()} />);
    expect(barButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Fold",
      "Raise to 2.5bb",
      "All-in 100bb",
    ]);
    const raise = screen.getByRole("button", { name: "Raise to 2.5bb" });
    expect(raise).toHaveTextContent("Raise to 2.5bb");
    expect(within(raise).queryByText("2.5bb")).not.toBeInTheDocument();
    expect(raise).not.toHaveTextContent(/pot/i);
  });

  it("R3.9 Standard shows the exact size of every sized action, preflop and postflop", () => {
    const { unmount } = withRoot(<ActionBar actions={FLOP_SMALL_AND_POT} grouping="standard" street="flop" onAction={vi.fn()} />);
    expect(barButtons().map((button) => button.getAttribute("aria-label"))).toEqual(["Check", "Bet 3.3bb", "Bet 10bb"]);
    expect(screen.queryByText("Small")).not.toBeInTheDocument();
    unmount();
    withRoot(<ActionBar actions={PREFLOP_OPEN} grouping="standard" street="preflop" onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Raise 2.5bb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All-in 100bb" })).toBeInTheDocument();
  });

  it("R3.9 Grouped postflop shows the bucket label with the exact size underneath", () => {
    withRoot(<ActionBar actions={FLOP_SMALL_AND_POT} grouping="grouped" street="flop" onAction={vi.fn()} />);
    const small = screen.getByRole("button", { name: "Small, 3.3bb" });
    expect(within(small).getByText("Small")).toBeInTheDocument();
    expect(within(small).getByText("3.3bb")).toBeInTheDocument();
    const pot = screen.getByRole("button", { name: "Pot, 10bb" });
    expect(within(pot).getByText("Pot")).toBeInTheDocument();
    expect(within(pot).getByText("10bb")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
  });
});
