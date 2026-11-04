/**
 * The trainer's start panels and recaps on the S36 system (S38 lane E, R3.13, O-346, O-348; screen
 * review rows 33, 34, 87 to 94): each panel is a raised card, the drill's settings read as chips
 * instead of a definition list, the Mixed-frequency switch takes the tactile press and the checked
 * control edge while keeping its role, name and On or Off text, and a recap leads with a row of
 * stat tiles. Numbers and names are the ones the screens showed before; only the look changes.
 */
import { DAILY_RATED_CAP } from "@g-tee-oh/learning";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONTROL_EDGE_CLASS, RAISED_CLASS, TACTILE_CLASS } from "../../src/components/ui/index.js";
import { fixtureDrill, fixtureRecap } from "../../src/fixtures/trainer.js";
import { SessionAlert, SessionRecapView } from "../../src/routes/drill-run/SessionParts.js";
import { RECAP_TIPS } from "../../src/routes/drill-run/SessionLook.js";
import { StartPanel } from "../../src/routes/drill-run/StartPanel.js";
import { HoldoutStart } from "../../src/routes/train/AutomatedStart.js";

function classesOf(element: HTMLElement): string[] {
  return element.className.split(/\s+/);
}

describe("R3.13 drill start panel look (S38)", () => {
  it("R3.13 the start panel is a raised card whose drill settings are chips, not a definition list", () => {
    render(<StartPanel drill={fixtureDrill} rng={false} onRngChange={vi.fn()} onStart={vi.fn()} starting={false} sessionLength={null} onSessionLengthChange={vi.fn()} />);
    const panel = screen.getByTestId("start-panel");
    expect(classesOf(panel)).toContain(RAISED_CLASS);
    expect(within(panel).queryByRole("term")).not.toBeInTheDocument();
    const chips = within(panel).getByRole("list", { name: "Drill settings" });
    const items = within(chips).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["GroupingGrouped", "Stop ruleSpot", "PauseAfter every action"]);
    expect(within(panel).getByTestId("pause-rule")).toHaveTextContent("After every action");
  });

  it("R3.13 the Mixed-frequency switch takes the tactile press and the checked control edge, and still says On or Off", () => {
    const { rerender } = render(<StartPanel drill={fixtureDrill} rng={false} onRngChange={vi.fn()} onStart={vi.fn()} starting={false} sessionLength={null} onSessionLengthChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Mixed-frequency mode" });
    expect(classesOf(toggle)).toContain(TACTILE_CLASS);
    for (const part of CONTROL_EDGE_CLASS.split(" ")) expect(classesOf(toggle)).toContain(part);
    expect(toggle).toHaveTextContent("Off");
    rerender(<StartPanel drill={fixtureDrill} rng onRngChange={vi.fn()} onStart={vi.fn()} starting={false} sessionLength={null} onSessionLengthChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Mixed-frequency mode" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Mixed-frequency mode" })).toHaveTextContent("On");
  });
});

describe("R3.13 holdout start look (S38)", () => {
  it("R3.13 the holdout start is a raised card with its heading and Start", () => {
    render(<HoldoutStart onStart={vi.fn()} starting={false} />);
    const panel = screen.getByTestId("holdout-start");
    expect(classesOf(panel)).toContain(RAISED_CLASS);
    expect(within(panel).getByRole("heading", { name: "What the retest is" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Start the retest" })).toBeEnabled();
  });
});

describe("R3.13 drill recap look (S38)", () => {
  it("R3.13 the recap is a raised card that leads with one stat tile per figure", () => {
    render(<SessionRecapView recap={fixtureRecap} onStartAnother={vi.fn()} />);
    const recap = screen.getByRole("region", { name: "Session recap" });
    expect(classesOf(recap)).toContain(RAISED_CLASS);
    const tiles = within(recap).getAllByTestId("stat-tile");
    // S46 (item 1): the mean score is a percent, as /train's recap prints it; each statistic has a definition tip.
    const text = (tile: HTMLElement) => `${within(tile).getByRole("term").textContent}${within(tile).getByRole("definition").textContent}`;
    expect(tiles.map(text)).toEqual(["Decisions3", "Rated decisions3", "Mean score75%", "EV loss0.19bb"]);
    expect(within(recap).getByRole("button", { name: "About mean score" })).toBeInTheDocument();
    expect(within(recap).getByRole("button", { name: "About rated decisions" })).toBeInTheDocument();
    expect(within(recap).getByRole("button", { name: "Start another session" })).toBeEnabled();
  });

  it("R3.13 the session alert names the failure in words and keeps Try again for a transient one", () => {
    render(<SessionAlert problem={{ kind: "network", status: null }} canRetry onRetry={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("did not reach the server");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

describe("R3.32 recap label counts", () => {
  it("R3.32 the drill recap adds the five label counts from the session's tally, each with the grade tip", () => {
    const tally = { decisions: 3, counts: { best: 1, correct: 1, inaccuracy: 1, mistake: 0, blunder: 0 }, rated: 3, evLossTotalBb: 0.19, evLossMeanBb: 0.0633, run: 0 };
    render(<SessionRecapView recap={fixtureRecap} tally={tally} onStartAnother={vi.fn()} />);
    const counts = within(screen.getByRole("region", { name: "Session recap" })).getByTestId("recap-label-counts");
    const tiles = within(counts).getAllByTestId("stat-tile").map((tile) => `${within(tile).getByRole("term").textContent}${within(tile).getByRole("definition").textContent}`);
    expect(tiles).toEqual(["Best1", "Correct1", "Inaccuracy1", "Mistake0", "Blunder0"]);
    expect(within(counts).getAllByRole("button", { name: "About grade labels" })).toHaveLength(5);
  });

  it("R3.32 without a tally the recap shows the api's four tiles only", () => {
    render(<SessionRecapView recap={fixtureRecap} onStartAnother={vi.fn()} />);
    expect(screen.queryByTestId("recap-label-counts")).not.toBeInTheDocument();
  });
});

describe("R3.13 PR #45 review round 4, finding c: the Rated decisions tip names every rating rule", () => {
  it("R3.13 the tip names the daily rated cap from learning's DAILY_RATED_CAP and that a seeded automated session is never rated", () => {
    const { text } = RECAP_TIPS.ratedDecisions;
    expect(text).toContain(`${DAILY_RATED_CAP}`);
    expect(text).toMatch(/a day/);
    expect(text).toMatch(/seed/);
  });
});
