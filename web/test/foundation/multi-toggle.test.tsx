/**
 * The multi-choice segmented control and disabled options (S41, R3.16, O-346): the same track and
 * tactile items as the single ToggleGroup, each item a pressed or unpressed button, choices kept in
 * the options' order, a disabled option never chosen, and the single control honouring disabled too.
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CONTROL_EDGE_CLASS, MultiToggleGroup, TACTILE_CLASS, ToggleGroup } from "../../src/components/ui/index.js";

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B", disabled: true },
  { value: "c", label: "C" },
] as const;

describe("R3.16 MultiToggleGroup", () => {
  it("R3.16 a named group of pressed buttons on the checked track", () => {
    render(<MultiToggleGroup label="Seats" value={["c"]} options={OPTIONS} onValueChange={() => undefined} />);
    const group = screen.getByRole("group", { name: "Seats" });
    for (const name of CONTROL_EDGE_CLASS.split(" ")) expect(group).toHaveClass(name);
    expect(screen.getByRole("button", { name: "C" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "A" })).toHaveClass(TACTILE_CLASS);
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute("aria-disabled", "true");
  });

  it("R3.16 reports the choices in the options' order and never a disabled option", async () => {
    const onValueChange = vi.fn();
    render(<MultiToggleGroup label="Seats" value={["c"]} options={OPTIONS} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onValueChange).toHaveBeenLastCalledWith(["a", "c"]);
    await userEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("R3.16 the single ToggleGroup disables an option marked disabled", () => {
    render(<ToggleGroup label="Seat" value="a" options={OPTIONS} onValueChange={() => undefined} />);
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-disabled", "true");
  });
});
