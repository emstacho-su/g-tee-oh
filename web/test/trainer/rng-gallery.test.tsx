/**
 * Tests for the S25 gallery sections (R3.10, R3.13, O-267): the explainer, roll badge and wired
 * feedback sections render from seeded fixtures without a single api request.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RngSections } from "../../src/gallery/rng-sections.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderSections() {
  return render(
    <HotkeyRoot store={createHotkeyStore()}>
      <RngSections />
    </HotkeyRoot>,
  );
}

describe("R3.10 RNG gallery sections", () => {
  it("R3.10 shows the explainer inline and opens the dialog from its button", async () => {
    renderSections();
    const section = screen.getByTestId("gallery-rng-explainer");
    expect(within(section).getByTestId("rng-explainer-content")).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: "Open the explainer dialog" }));
    expect(screen.getByRole("dialog", { name: "How RNG mode works" })).toBeInTheDocument();
  });

  it("R3.10 the roll badge section shows the roll and no bands", () => {
    renderSections();
    const section = screen.getByTestId("gallery-roll-badge");
    expect(within(section).getByTestId("roll-badge")).toHaveTextContent("Roll 37");
    expect(within(section).queryByTestId("rng-roller")).not.toBeInTheDocument();
  });

  it("R3.13 the wired feedback section renders the roller, range view and threshold card from the seeded cache", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderSections();
    const section = screen.getByTestId("gallery-feedback-wired");
    expect(within(section).getByTestId("rng-best")).toHaveTextContent("Best: Raise to 2.5bb, selected by roll 37");
    expect(within(section).getByTestId("feedback-range-view")).toHaveAttribute("data-selected-hand", "AJo");
    expect(within(section).getByTestId("threshold-card")).toHaveTextContent("Your hand: AJo");
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
