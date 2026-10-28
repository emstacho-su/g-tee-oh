/**
 * Tests for InfoTip, the shared explanation tooltip (S38, R3.12, O-368, PM note a): an info button
 * named for what it explains, whose text reaches screen readers through aria-describedby without
 * opening, that opens on keyboard focus and on hover, toggles on click or tap (touch screens have
 * no hover), closes on Escape, layers through the tooltip layer and needs no provider from the
 * caller, also inside a dialog.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Dialog, InfoTip, TOOLTIP_LAYER_CLASS } from "../../src/components/ui/index.js";

const EXPLANATION = "The strongest hand that folds at least half the time here.";

function renderTip() {
  return render(
    <p>
      Strongest folding hand <InfoTip subject="the strongest folding hand">{EXPLANATION}</InfoTip>
    </p>,
  );
}

describe("R3.12 InfoTip", () => {
  it("R3.12 is a button named for its subject, described by the explanation without opening", () => {
    renderTip();
    const button = screen.getByRole("button", { name: "About the strongest folding hand" });
    expect(button).toHaveAccessibleDescription(EXPLANATION);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("R3.12 opens on keyboard focus and closes on Escape", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.tab();
    const button = screen.getByRole("button", { name: "About the strongest folding hand" });
    expect(button).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(EXPLANATION);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("R3.12 a tap or click toggles it, so it works without hover on a touch screen", () => {
    renderTip();
    const button = screen.getByRole("button", { name: "About the strongest folding hand" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent(EXPLANATION);
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("R3.12 a tap outside closes it", () => {
    render(
      <div>
        <InfoTip subject="actions">{EXPLANATION}</InfoTip>
        <span>elsewhere</span>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "About actions" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      fireEvent.pointerDown(screen.getByText("elsewhere"));
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("R3.12 the open tip takes the tooltip layer and the explanation text", () => {
    renderTip();
    fireEvent.click(screen.getByRole("button", { name: "About the strongest folding hand" }));
    const content = document.querySelector("[data-info-tip-content]");
    expect(content).not.toBeNull();
    expect(content?.className).toContain(TOOLTIP_LAYER_CLASS);
    expect(content).toHaveTextContent(EXPLANATION);
  });

  it("R3.12 works inside a dialog, rendered within the dialog so it is never painted under it", () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Details">
        <InfoTip subject="hand position">{EXPLANATION}</InfoTip>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Details" });
    fireEvent.click(screen.getByRole("button", { name: "About hand position" }));
    const content = document.querySelector("[data-info-tip-content]");
    expect(content).not.toBeNull();
    expect(dialog.contains(content)).toBe(true);
  });
});
