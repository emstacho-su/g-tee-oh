/**
 * The prompt's visible panels open their feedback sections by default (S46, R3.33, item 14): the
 * api derives visible_panels from the drill's panels (services/api/src/sessions/prompt.ts), and a
 * panel the drill turned on starts open on the reveal. Every other section keeps its own default,
 * and what the user opens or closes still wins (O-387).
 */
import { describe, expect, it } from "vitest";

import { resolveSectionOpen, sectionsFromPanels } from "../../src/components/trainer/feedback-sections.js";

describe("R3.33 the prompt's visible panels open their feedback sections", () => {
  it("R3.33 each panel with a section opens it: range matrix, strategy matrix, frequency table, threshold card, roll", () => {
    expect(sectionsFromPanels(["hero_range_matrix", "threshold_card", "rng_roller"])).toEqual({ range: true, threshold: true, roll: true });
    expect(sectionsFromPanels(["hero_strategy_matrix"])).toEqual({ strategy: true });
    expect(sectionsFromPanels(["action_frequency_table"])).toEqual({ strategy: true });
  });

  it("R3.33 no panel opens nothing, and a panel with no section here is ignored", () => {
    expect(sectionsFromPanels([])).toEqual({});
    expect(sectionsFromPanels(["draw_breakdown", "streak_counter", "villain_range_matrix", "not_a_panel"])).toEqual({});
  });

  it("R3.33 the user's own choice wins over the panel's default for the rest of the session (O-387)", () => {
    const defaults = sectionsFromPanels(["hero_range_matrix"]);
    expect(resolveSectionOpen("range", {}, defaults, { workedExample: false })).toBe(true);
    expect(resolveSectionOpen("range", { range: false }, defaults, { workedExample: false })).toBe(false);
    expect(resolveSectionOpen("insights", {}, defaults, { workedExample: false }), "a section no panel names keeps its default").toBe(false);
  });
});
