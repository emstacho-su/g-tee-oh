/**
 * Tests for the S25 gallery sections (R3.10, R3.13, O-267, S37 O-378): the explainer, the hidden
 * roll scale and the wired feedback sections render from seeded fixtures without a single api request.
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

describe("R3.10 Mixed-frequency mode gallery sections", () => {
  it("R3.10 shows the explainer inline and opens the dialog from its button", async () => {
    renderSections();
    const section = screen.getByTestId("gallery-rng-explainer");
    expect(within(section).getByTestId("rng-explainer-content")).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: "Open the explainer dialog" }));
    expect(screen.getByRole("dialog", { name: "How Mixed-frequency mode works" })).toBeInTheDocument();
  });

  it("R3.10 the roll scale section shows the roll on the hidden scale and no bands (O-344, O-378)", () => {
    renderSections();
    const section = screen.getByTestId("gallery-roll-scale");
    const scale = within(section).getByTestId("rng-roller");
    expect(scale).toHaveAttribute("data-revealed", "false");
    expect(scale).toHaveTextContent("Roll 37");
    expect(within(section).queryByRole("list", { name: "Mixed-frequency bands" })).not.toBeInTheDocument();
  });

  it("R3.13 the wired feedback section renders the revealed scale with its followed mark, range view and threshold card from the seeded cache (ADR 0024)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderSections();
    const section = screen.getByTestId("gallery-feedback-wired");
    expect(within(section).getByTestId("rng-follow")).toHaveTextContent("You followed the roll: roll 37 fell on Raise to 2.5bb");
    expect(within(section).queryByTestId("rng-best")).not.toBeInTheDocument();
    expect(within(section).getByTestId("feedback-range-view")).toHaveAttribute("data-selected-hand", "AJo");
    expect(within(section).getByTestId("threshold-card")).toHaveTextContent("Your hand: AJo");
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
