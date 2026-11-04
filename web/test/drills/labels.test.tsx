/**
 * One wording per drill setting value (S26, R3.14, PR #30 review LOW 10): the drill library, the
 * builder and the drill run's start panel name a stop rule, a grouping and a pause rule from the
 * same map in src/drills/labels.ts, and the run screen's labels hold no second copy.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GROUPING_LABELS, PAUSE_LABELS, STOP_RULE_LABELS } from "../../src/drills/labels.js";
import { fixtureDrill, fixtureFullHandDrill, fixtureStreetDrill } from "../../src/fixtures/trainer.js";
import * as runLabels from "../../src/routes/drill-run/labels.js";
import { StartPanel } from "../../src/routes/drill-run/StartPanel.js";
import type { Drill } from "../../src/trainer/session-types.js";

/** The start panel's value for a setting of its chip list (S38: chips, name then value). */
function shownValue(term: string): string {
  const chips = within(screen.getByTestId("start-panel")).getByRole("list", { name: "Drill settings" });
  const chip = within(chips)
    .getAllByRole("listitem")
    .find((item) => item.firstElementChild?.textContent === term);
  return chip?.lastElementChild?.textContent ?? "";
}

function renderPanel(drill: Drill): void {
  render(<StartPanel drill={drill} rng={false} onRngChange={() => undefined} onStart={() => undefined} starting={false} sessionLength={null} onSessionLengthChange={() => undefined} />);
}

describe("R3.14 one label map for drill settings", () => {
  it.each([fixtureDrill, fixtureStreetDrill, fixtureFullHandDrill])("R3.14 the start panel names %#'s stop rule, grouping and pause as the builder does", (drill) => {
    renderPanel(drill);
    expect(shownValue("Stop rule")).toBe(STOP_RULE_LABELS[drill.trainer.stop_rule]);
    expect(shownValue("Grouping")).toBe(GROUPING_LABELS[drill.trainer.grouping]);
    const pause = drill.trainer.stop_rule === "after_action" ? "every_action" : drill.trainer.pause;
    expect(shownValue("Pause")).toBe(PAUSE_LABELS[pause]);
  });

  it("R3.14 the run screen's labels keep no second copy of the drill setting names", () => {
    expect(Object.keys(runLabels)).not.toEqual(expect.arrayContaining(["STOP_RULE_NAMES"]));
    expect(Object.keys(runLabels)).not.toEqual(expect.arrayContaining(["GROUPING_NAMES"]));
    expect(Object.keys(runLabels)).not.toEqual(expect.arrayContaining(["PAUSE_RULE_NAMES"]));
  });
});
