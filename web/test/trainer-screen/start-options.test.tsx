/**
 * The start panel's Options and Edit drill (S47, R3.13, R3.36, O-487): session-only pause and
 * speed overrides sit behind an Options disclosure and change nothing in the stored drill; spot
 * mode shows no pause choice (it always pauses, O-284); the Mixed-frequency switch stays where it
 * was; Edit drill links to the drill's builder.
 */
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_DRILL_ID, FIXTURE_STREET_DRILL_ID, fixtureDrill, fixtureStreetDrill } from "../../src/fixtures/trainer.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { renderRun } from "./render-run.js";

async function openOptions(): Promise<HTMLElement> {
  await screen.findByRole("heading", { name: /Opens|synthetic/ });
  await userEvent.click(screen.getByRole("button", { name: "Options" }));
  return screen.getByTestId("session-overrides");
}

describe("R3.13 the start panel's Options", () => {
  it("R3.13 Options holds Pause and Speed overrides that change the session's run settings and never the drill", async () => {
    const view = renderRun({ drillId: FIXTURE_STREET_DRILL_ID, script: { [`GET /api/v1/drills/${FIXTURE_STREET_DRILL_ID}`]: [jsonResponse(200, fixtureStreetDrill)] } });
    const overrides = await openOptions();
    const pause = within(overrides).getByRole("radiogroup", { name: "Pause this session" });
    expect(within(pause).getByRole("radio", { name: "After a mistake" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(pause).getByRole("radio", { name: "Never" }));
    expect(within(pause).getByRole("radio", { name: "Never" })).toHaveAttribute("aria-checked", "true");
    const speed = within(overrides).getByRole("radiogroup", { name: "Speed this session" });
    await userEvent.click(within(speed).getByRole("radio", { name: "Slow" }));
    expect(within(speed).getByRole("radio", { name: "Slow" })).toHaveAttribute("aria-checked", "true");
    expect(overrides).toHaveTextContent("This session only; the drill keeps its own settings.");
    // Nothing is written to the stored drill, and the switch is still outside Options.
    expect(view.sent.filter((request) => request.key.startsWith("PATCH"))).toEqual([]);
    expect(screen.getByRole("switch", { name: "Mixed-frequency mode" })).toBeInTheDocument();
  });

  it("R3.13 spot mode offers no pause override (it always pauses, O-284), and Edit drill links to the builder", async () => {
    renderRun({ script: {} });
    const overrides = await openOptions();
    expect(within(overrides).queryByRole("radiogroup", { name: "Pause this session" })).not.toBeInTheDocument();
    expect(within(overrides).getByRole("radiogroup", { name: "Speed this session" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit drill" })).toHaveAttribute("href", `/drills/${FIXTURE_DRILL_ID}/details`);
    expect(screen.getByRole("heading", { name: fixtureDrill.name })).toBeInTheDocument();
  });
});
