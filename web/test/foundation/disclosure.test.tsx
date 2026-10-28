/**
 * Tests for Disclosure, the shared expand and collapse primitive (S38, R3.13, O-387, O-388): a
 * heading-level button with aria-expanded and aria-controls over a region it labels, controlled
 * and uncontrolled use, a body mounted on first open and kept after, and an inline height
 * transition that reduced motion turns off.
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CONTROL_EDGE_CLASS, Disclosure, TACTILE_CLASS } from "../../src/components/ui/index.js";

function Body({ onMount }: { onMount: () => void }) {
  const [mounted] = useState(() => {
    onMount();
    return true;
  });
  return <p>{mounted ? "body text" : null}</p>;
}

describe("R3.13 Disclosure", () => {
  it("R3.13 is a heading-level button that controls a region it labels", () => {
    render(
      <Disclosure title="Strategy" defaultOpen headingLevel={3}>
        <p>body text</p>
      </Disclosure>,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Strategy" });
    const button = screen.getByRole("button", { name: "Strategy" });
    expect(heading).toContainElement(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Strategy" });
    expect(button).toHaveAttribute("aria-controls", region.id);
    expect(region).toHaveTextContent("body text");
  });

  it("R3.13 starts closed by default and opens and closes inline on click, never as a dialog", async () => {
    render(
      <Disclosure title="Range">
        <p>body text</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Range" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body text")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Range" })).toHaveTextContent("body text");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Range" })).not.toBeInTheDocument();
  });

  it("R3.13 opens from the keyboard with Enter and Space", async () => {
    render(
      <Disclosure title="Insights">
        <p>body text</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Insights" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("R3.13 mounts the body on first open and keeps it mounted after closing (lazy by default)", async () => {
    const onMount = vi.fn();
    render(
      <Disclosure title="Explanation">
        <Body onMount={onMount} />
      </Disclosure>,
    );
    expect(onMount).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Explanation" });
    await userEvent.click(button);
    expect(onMount).toHaveBeenCalledOnce();
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onMount).toHaveBeenCalledOnce();
    expect(screen.getByText("body text")).toBeInTheDocument();
  });

  it("R3.13 a closed, once-opened body stays in the DOM but hidden from everyone", async () => {
    render(
      <Disclosure title="Explanation">
        <p>body text</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Explanation" });
    await userEvent.click(button);
    await userEvent.click(button);
    const kept = screen.getByText("body text", { exact: true });
    expect(kept).not.toBeVisible();
  });

  it("R3.13 lazy false renders the body while closed, hidden", () => {
    render(
      <Disclosure title="Roll" lazy={false}>
        <p>body text</p>
      </Disclosure>,
    );
    expect(screen.getByText("body text")).not.toBeVisible();
  });

  it("R3.13 controlled use follows open and reports each toggle through onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Disclosure title="Strategy" open={false} onOpenChange={onOpenChange}>
        <p>body text</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Strategy" });
    await userEvent.click(button);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(button).toHaveAttribute("aria-expanded", "false");
    rerender(
      <Disclosure title="Strategy" open onOpenChange={onOpenChange}>
        <p>body text</p>
      </Disclosure>,
    );
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(button);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("R3.13 shows an optional hint beside the title, inside the button's name", () => {
    render(
      <Disclosure title="Roll" hint="Roll 37">
        <p>body text</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: "Roll Roll 37" })).toBeInTheDocument();
  });

  it("R3.13 the button takes the shared tactile press and the checked control edge (O-369)", () => {
    render(
      <Disclosure title="Strategy" testId="strategy-section">
        <p>body text</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Strategy" });
    expect(button).toHaveClass(TACTILE_CLASS);
    for (const name of CONTROL_EDGE_CLASS.split(" ")) expect(button).toHaveClass(name);
    expect(screen.getByTestId("strategy-section")).toHaveAttribute("data-open", "false");
  });

  it("R3.13 the height transition is turned off under reduced motion", () => {
    render(
      <Disclosure title="Strategy" defaultOpen>
        <p>body text</p>
      </Disclosure>,
    );
    const track = screen.getByTestId("disclosure-track");
    expect(track.className).toMatch(/transition-\[grid-template-rows\]/);
    expect(track).toHaveClass("motion-reduce:transition-none");
    expect(track).toHaveAttribute("data-open", "true");
  });
});
