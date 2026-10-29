/**
 * Tests for the insights on the study screen (S45, R3.12, O-461): before any cell is selected the
 * screen reads insights with a stand-in hand (the first class the node holds), so the range and
 * nut advantage show at once; the hand-dependent tiles (threshold card, blockers, hand role)
 * appear only once a hand is selected, and the threshold rows carry the node's action names and
 * swatches. A selected hand that left the range keeps the advantage card.
 */
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_OUT_OF_RANGE_HAND, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { renderStudy } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;

let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

function insightHands(requests: { path: string; query: Record<string, string> }[]): (string | undefined)[] {
  return requests.filter((request) => request.path === "/api/v1/study/insights").map((request) => request.query["hand"]);
}

describe("R3.12 insights on the study screen", () => {
  it("R3.12 the advantage card shows before any selection, read with the first class as a stand-in hand", async () => {
    const { requests } = renderStudy(BASE);
    const card = await screen.findByRole("region", { name: "Range and nut advantage" });
    expect(card).toHaveTextContent("BB 48.0%");
    expect(card).toHaveTextContent("BTN 52.0%");
    expect(insightHands(requests)).toEqual(["AA"]);
    expect(screen.queryByTestId("threshold-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Blockers" })).not.toBeInTheDocument();
    expect(screen.getByText("Pick a cell in the matrix to see that hand's threshold card, blockers and role.")).toBeInTheDocument();
  });

  it("R3.12 a selected hand adds the threshold card with named actions, the blockers and the role chip", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    await screen.findByRole("region", { name: "Range and nut advantage" });
    const grid = screen.getByRole("group", { name: /range matrix cells/i });
    grid.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    const card = await screen.findByTestId("threshold-card");
    expect(card).toHaveTextContent("Your hand: AKs");
    expect(within(card).getByRole("listitem", { name: "Raise to 2.5bb" })).toBeInTheDocument();
    expect(within(card).getAllByTestId("action-swatch").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Blockers" })).toHaveTextContent("Removes 6 combos");
    expect(screen.getByTestId("hand-role")).toHaveTextContent("Value");
    expect(screen.getByRole("heading", { name: /^AKs/ })).toBeInTheDocument();
  });

  it("R3.12 a selected hand outside the range says so and the advantage card stays", async () => {
    renderStudy(`${BASE}&hand=${FIXTURE_OUT_OF_RANGE_HAND}`);
    expect(await screen.findByText("72o is not in the range at this node, so it has no threshold card.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Range and nut advantage" })).toBeInTheDocument();
  });
});
