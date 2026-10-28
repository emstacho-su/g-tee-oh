/**
 * Tests for the feedback panel's gallery sections (S38, R3.13, O-267, O-387, O-388): the panel as
 * a decision first shows it, with every section collapsed, and the same panel with every section
 * expanded, both from fixtures without a single api request.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEEDBACK_SECTION_TITLES } from "../../src/components/trainer/index.js";
import { FeedbackGallerySections } from "../../src/gallery/feedback-sections.js";
import { TrainerSections } from "../../src/gallery/sections.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderGallery() {
  return render(
    <HotkeyRoot store={createHotkeyStore()}>
      <TrainerSections />
      <FeedbackGallerySections />
    </HotkeyRoot>,
  );
}

function sectionButtons(section: HTMLElement): HTMLElement[] {
  const titles = Object.values(FEEDBACK_SECTION_TITLES);
  return within(section)
    .getAllByRole("button")
    .filter((button) => titles.some((title) => button.textContent?.startsWith(title) === true));
}

describe("R3.13 feedback gallery sections", () => {
  it("R3.13 the panel section shows the summary with Strategy, Range, Where your hand sits, Insights and Explanation collapsed", () => {
    renderGallery();
    const section = screen.getByTestId("gallery-feedback-panel");
    expect(within(section).getByTestId("feedback-summary")).toHaveTextContent("Your action: Call");
    const buttons = sectionButtons(section);
    expect(buttons.map((button) => button.textContent?.replace("›", "").trim())).toEqual([
      FEEDBACK_SECTION_TITLES.strategy,
      FEEDBACK_SECTION_TITLES.range,
      FEEDBACK_SECTION_TITLES.threshold,
      FEEDBACK_SECTION_TITLES.insights,
      FEEDBACK_SECTION_TITLES.explanation,
    ]);
    for (const button of buttons) expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("R3.13 the expanded section opens every section inline, from fixtures, with no api request (O-388)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderGallery();
    const section = screen.getByTestId("gallery-feedback-expanded");
    const buttons = sectionButtons(section);
    expect(buttons).toHaveLength(6);
    for (const button of buttons) expect(button).toHaveAttribute("aria-expanded", "true");
    expect(within(section).getByTestId("rng-follow")).toHaveAttribute("data-followed", "false");
    expect(within(section).getByRole("table", { name: "This hand's strategy" })).toBeInTheDocument();
    expect(within(section).getByTestId("threshold-card")).toHaveTextContent("Your hand: AJo");
    expect(within(section).getByTestId("noise-flags-card")).toBeInTheDocument();
    expect(within(section).getByTestId("more-info-sections")).toBeInTheDocument();
    expect(within(section).queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
