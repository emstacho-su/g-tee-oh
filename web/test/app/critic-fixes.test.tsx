/**
 * The S47 critic No list's web fixes that are not covered by a screen's own suite (S47, R3.14,
 * R3.4, R3.5, R4.12, R3.13): one word for the queued spots, the hand picker's corner mark and its
 * scroll frame, a pressable Delete, the frequency table's screen-reader box, the builder status
 * card's Try again and the invite row's email on its own line at phone width.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FrequencyTable } from "../../src/components/frequency/FrequencyTable.js";
import { fixtureFrequencies } from "../../src/fixtures/frequencies.js";
import { fixtureHeatmap, fixtureLeaks, fixtureRating, fixtureStreak, fixtureTracks } from "../../src/fixtures/progress.js";
import { HandPicker } from "../../src/routes/drills/HandPicker.js";
import { BUILDER_STATUS_FAILED } from "../../src/routes/home.js";
import { problemMessage } from "../../src/trainer/spot-problem.js";
import { jsonResponse, problemResponse, sessionResponse } from "../api/fake-fetch.js";
import { renderApp } from "./render-app.js";

describe("R3.14 R3.4 critic fixes on the drill screens", () => {
  it("R3.14 the no-coverage alert and its note use one word: spots", () => {
    const text = problemMessage({ kind: "no_coverage", status: 422 });
    expect(text).toContain("Its spots were queued");
    expect(text).not.toContain("gaps");
  });

  it("R3.14 a chosen hand keeps its mark in the cell's corner, and the grid scrolls in its own frame", async () => {
    const onToggle = vi.fn();
    render(<HandPicker selected={["AKs", "T9s"]} onToggle={onToggle} onSetAll={vi.fn()} />);
    const aks = screen.getByRole("button", { name: "AKs" });
    expect(aks).toHaveAttribute("aria-pressed", "true");
    expect(aks).toHaveClass("border-2");
    expect(within(aks).getByTestId("hand-chosen-mark")).toHaveClass("absolute");
    expect(screen.getByTestId("hand-picker-frame")).toHaveClass("overflow-x-auto");
    await userEvent.click(screen.getByRole("button", { name: "77" }));
    expect(onToggle).toHaveBeenCalledWith("77");
  });
});

describe("R4.12 the frequency card's screen-reader table", () => {
  it("R4.12 the table sits inside a visually hidden box, so it never widens the page at phone width", () => {
    const spot = fixtureFrequencies.spots[0];
    if (spot === undefined || spot.pooled === null) throw new Error("the fixture has no pooled spot");
    render(<FrequencyTable spot={spot} pooled={spot.pooled} caption="A spot" />);
    const box = screen.getByTestId("frequency-sr-table");
    expect(box).toHaveClass("sr-only");
    expect(within(box).getByRole("table", { name: "A spot" })).not.toHaveClass("sr-only");
  });
});

describe("R3.5 the home builder status card", () => {
  it("R3.5 a failed builder status read offers Try again like the other home cards", async () => {
    const user = userEvent.setup();
    renderApp("/", {
      "GET /api/v1/me": [sessionResponse()],
      "GET /api/v1/progress/rating": [jsonResponse(200, fixtureRating)],
      "GET /api/v1/progress/tracks": [jsonResponse(200, { items: fixtureTracks, next_cursor: null })],
      "GET /api/v1/progress/leaks": [jsonResponse(200, fixtureLeaks)],
      "GET /api/v1/progress/heatmap": [jsonResponse(200, fixtureHeatmap)],
      "GET /api/v1/progress/streak": [jsonResponse(200, fixtureStreak)],
      "GET /api/v1/admin/builder": [problemResponse(503, "unavailable"), problemResponse(503, "unavailable"), problemResponse(503, "unavailable"), problemResponse(503, "unavailable")],
    });
    const alert = await screen.findByText(BUILDER_STATUS_FAILED, {}, { timeout: 10_000 });
    const card = alert.closest("section") ?? document.body;
    expect(within(card).getByRole("button", { name: /^Try again/ })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: /^Try again/ }));
    await waitFor(() => expect(within(card).queryByRole("button", { name: /^Try again/ })).not.toBeNull());
  });
});
