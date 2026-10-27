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
});
