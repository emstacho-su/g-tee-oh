/**
 * Tests for the Radix and Tailwind primitives (S24, O-44) that the trainer and study components
 * build on (R3.13).
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button, Dialog, ToggleGroup, cn } from "../../src/components/ui/index.js";

describe("R3.13 ui primitives", () => {
  it("R3.13 cn joins only real class names", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("R3.13 Button defaults to type button and forwards clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("R3.13 Button renders its child through asChild", () => {
    render(
      <Button asChild variant="primary" size="lg">
        <a href="/study">Study</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Study" })).toHaveAttribute("href", "/study");
  });

  it("R3.13 Dialog shows its title and description and closes from its close button", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen} title="Shortcuts" description="Keys">
          <p>body</p>
        </Dialog>
      );
    }
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: "Shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Keys")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("R3.13 ToggleGroup reports the chosen value and ignores deselection", async () => {
    const onValueChange = vi.fn();
    const options = [
      { value: "frequency", label: "Frequency" },
      { value: "ev", label: "EV" },
    ] as const;
    render(<ToggleGroup label="Mode" value="frequency" options={options} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "EV" }));
    expect(onValueChange).toHaveBeenCalledWith("ev");
    onValueChange.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: "Frequency" }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("R3.12 ToggleGroup's existing callers keep a chosen item, plain names and no disabled marks", () => {
    const options = [
      { value: "frequency", label: "Frequency" },
      { value: "ev", label: "EV" },
    ] as const;
    render(<ToggleGroup label="Mode" value="ev" options={options} onValueChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "EV" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Frequency" })).toHaveAttribute("aria-checked", "false");
    for (const item of screen.getAllByRole("radio")) {
      expect(item).not.toHaveAttribute("aria-disabled");
      expect(item).not.toBeDisabled();
    }
  });

  it("R3.12 ToggleGroup can start with nothing chosen", () => {
    const options = [
      { value: "online", label: "Online" },
      { value: "live", label: "Live" },
    ] as const;
    render(<ToggleGroup label="Format" value={undefined} options={options} onValueChange={vi.fn()} />);
    for (const item of screen.getAllByRole("radio")) expect(item).toHaveAttribute("aria-checked", "false");
  });

  it("R3.12 ToggleGroup shows a detail line and keeps a disabled item focusable, announced with its reason, never chosen", async () => {
    const onValueChange = vi.fn();
    const options = [
      { value: "six", label: "6 players", disabled: true, reason: "No live game at this size" },
      { value: "nine", label: "9 players", detail: "full ring" },
    ];
    render(<ToggleGroup label="Table size" value={undefined} options={options} onValueChange={onValueChange} />);
    const six = screen.getByRole("radio", { name: /6 players/ });
    expect(six).toHaveAccessibleName("6 players No live game at this size");
    expect(six).toHaveAttribute("aria-disabled", "true");
    expect(six).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: /9 players/ })).toHaveAccessibleName("9 players full ring");

    await userEvent.click(six);
    expect(onValueChange).not.toHaveBeenCalled();
    six.focus();
    expect(six).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: /9 players/ }));
    expect(onValueChange).toHaveBeenCalledWith("nine");
  });
});
